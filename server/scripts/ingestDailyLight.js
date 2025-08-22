#!/usr/bin/env node
// scripts/ingestDailyLight.js
// Pull latest ADVA Rx Levels CSV from Gmail (or CSV_FILE), parse, map to circuits,
// and UPSERT rows into public.daily_light_level.

import { google } from 'googleapis'
import { parse as parseCsv } from 'csv-parse/sync'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import path from 'path'
import fs from 'fs/promises'
import pg from 'pg'

dayjs.extend(utc)
dayjs.extend(timezone)

// ─── env ────────────────────────────────────────────────────────────────────
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  DATABASE_URL,
  GMAIL_SUBJECT = 'Fw: Iris Automated Report: ADVA Rx Levels',
  GMAIL_SENDER = '',
  CSV_FILE // optional: read local CSV instead of Gmail
} = process.env

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !DATABASE_URL) {
  throw new Error('Missing one of CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN/DATABASE_URL')
}

// ─── Gmail auth ─────────────────────────────────────────────────────────────
async function gmailClient () {
  if (CSV_FILE) return null
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
  auth.setCredentials({ refresh_token: REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

// ─── Download latest CSV (last 4 days) or open CSV_FILE ─────────────────────
async function getCsvBufferAndMeta (gmail) {
  if (CSV_FILE) {
    const filePath = path.resolve(CSV_FILE)
    const buf = await fs.readFile(filePath)
    return { csvBuffer: buf, emailId: 'local-test', filename: path.basename(filePath) }
  }

  const q = [
    `subject:"${GMAIL_SUBJECT}"`,
    GMAIL_SENDER ? `from:${GMAIL_SENDER}` : null,
    'newer_than:4d'
  ].filter(Boolean).join(' ')

  const { data: { messages } } = await gmail.users.messages.list({ userId: 'me', q, maxResults: 5 })
  if (!messages?.length) throw new Error('Daily email not found')
  const msgId = messages[0].id
  const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: msgId })

  const walk = (parts = []) => parts.flatMap(p => p?.parts ? walk(p.parts) : [p]).filter(Boolean)
  const parts = walk(msg.payload?.parts || [])
  const csvParts = parts.filter(p => (p.filename || '').toLowerCase().endsWith('.csv'))
  if (!csvParts.length) throw new Error('CSV attachment not found')
  const attach = csvParts
    .map(p => ({ ...p, size: Number(p.body?.size || 0) }))
    .sort((a, b) => b.size - a.size)[0]

  const { data: { data: b64 } } = await gmail.users.messages.attachments.get({
    userId: 'me', messageId: msgId, id: attach.body.attachmentId
  })
  const csvBuffer = Buffer.from(b64, 'base64')
  return { csvBuffer, emailId: msgId, filename: attach.filename || 'daily.csv' }
}

// ─── Helpers: mapping & side detection ───────────────────────────────────────
// Single code, e.g. 027CAPE292014216096
const codeRegex = /027[A-Z]{4}\d+/g

const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/\(.*?\)/g, '')          // strip (MED)/(HIGH) etc
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

function tokenScore(a, b) {
  const A = new Set((a || '').split(' ').filter(Boolean))
  const B = new Set((b || '').split(' ').filter(Boolean))
  let s = 0
  for (const t of A) if (B.has(t)) s++
  return s
}

// Common vendor/tech tokens to ignore in Router names
const VENDOR_TOKENS = new Set([
  'adva','liquid','frogfoot','dfa','openserve','seacom','vodacom','mtn','telkom',
  'metrofibre','dark','darkfiber','dfn','juniper','calix','smart','olt','switch',
  'iris','solid','router','edge','core','metro','access','backhaul'
])

/**
 * Extract candidate site names from Router by splitting on '-' and '|',
 * removing vendor/tech tokens, returning remaining normalized tokens (in order).
 * e.g. "ADVA-Liquid-Yzerfontein" -> ["yzerfontein"]
 */
function extractRouterSiteCandidates(router) {
  const parts = String(router || '')
    .split(/[-|]/)
    .map(x => norm(x))
    .filter(Boolean)

  const kept = parts.filter(p => !VENDOR_TOKENS.has(p))
  // If everything was filtered (e.g., "ADVA-Liquid"), fallback to last part anyway
  if (kept.length === 0 && parts.length) {
    return [parts[parts.length - 1]]
  }
  return kept
}

/**
 * Decide side using the Router-derived site candidates only.
 * - Prefer exact-inclusion of candidate in node name.
 * - Then token similarity to candidate.
 * - Then token similarity to full router (normalized).
 * No “default A” on ties —— return null if ambiguous.
 */
function decideSide(nodeA, nodeB, router) {
  const nA = norm(nodeA)
  const nB = norm(nodeB)
  const candidates = extractRouterSiteCandidates(router) // e.g., ["yzerfontein"]

  if (!candidates.length) return null

  // 1) Exact-inclusion pass
  for (const c of candidates) {
    const aIncl = c && nA.includes(c)
    const bIncl = c && nB.includes(c)
    if (aIncl !== bIncl) return aIncl ? 'A' : 'B'
  }

  // 2) Token similarity vs each candidate (take best candidate)
  let best = { side: null, delta: 0 }
  for (const c of candidates) {
    const aScore = tokenScore(nA, c)
    const bScore = tokenScore(nB, c)
    if (aScore !== bScore) {
      const delta = Math.abs(aScore - bScore)
      if (delta > best.delta) {
        best = { side: aScore > bScore ? 'A' : 'B', delta }
      }
    }
  }
  if (best.side) return best.side

  // 3) Final fallback vs full router string
  const rtFull = norm(router)
  const aFull = tokenScore(nA, rtFull)
  const bFull = tokenScore(nB, rtFull)
  if (aFull !== bFull) return aFull > bFull ? 'A' : 'B'

  return null
}

// Snapshot time from filename like "..._19-Aug-2025-01-00.csv", else 01:00 SAST today
function computeSampleTimeIso(filename) {
  const m = filename?.match(/_(\d{1,2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})-(\d{2})-(\d{2})/i)
  if (m) {
    const [, d, mon, y, hh, mm] = m
    const str = `${d}-${mon}-${y} ${hh}:${mm}`
    return dayjs.tz(str, 'D-MMM-YYYY HH:mm', 'Africa/Johannesburg').utc().toISOString()
  }
  return dayjs.tz('Africa/Johannesburg').startOf('day').add(1, 'hour').utc().toISOString()
}

// Flexible column resolver (handles "OPR (dBm)" etc)
function resolveCol(records, wanted) {
  const keys = Object.keys(records[0] || {})
  const w = wanted.toLowerCase()
  let k = keys.find(k => k.toLowerCase() === w)
  if (k) return k
  k = keys.find(k => k.toLowerCase().includes(w))
  return k || wanted
}

// Build lookup map for circuits by both full circuit_id and any embedded codes
function buildCircuitLookup(circuits) {
  const map = new Map()
  for (const c of circuits) {
    const cid = String(c.circuit_id || '').trim()
    if (cid) map.set(cid, c)
    // also index every 027CODE… found in circuit_id (handles "&" cases)
    const codes = cid.match(codeRegex) || []
    for (const code of codes) map.set(code, c)
  }
  return map
}

// ─── Core ingest ─────────────────────────────────────────────────────────────
async function run() {
  const gmail = await gmailClient()
  const { csvBuffer, emailId, filename } = await getCsvBufferAndMeta(gmail)

  const records = parseCsv(csvBuffer, { columns: true, skip_empty_lines: true })
  if (!records.length) {
    console.log(`CSV empty from ${filename}.`)
    return
  }

  const MNEMONIC = resolveCol(records, 'Mnemonic')
  const ROUTER   = resolveCol(records, 'Router')
  const OPR      = resolveCol(records, 'OPR')

  // DB connect
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  })
  const cx = await pool.connect()

  try {
    // Load all circuits once
    const { rows: circuits } = await cx.query(
      'SELECT id, circuit_id, node_a, node_b FROM "Circuit"'
    )
    const byIdOrCode = buildCircuitLookup(circuits)

    const sampleTime = computeSampleTimeIso(filename)

    // Prepare UPSERT
    const upsertSql = `
      INSERT INTO public.daily_light_level
        (circuit_id, side, rx, mnemonic, router_name, parsed_code, source_email_id, sample_time)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (circuit_id, side, sample_time)
      DO UPDATE SET
        rx              = EXCLUDED.rx,
        mnemonic        = EXCLUDED.mnemonic,
        router_name     = EXCLUDED.router_name,
        parsed_code     = EXCLUDED.parsed_code,
        source_email_id = EXCLUDED.source_email_id
    `

    await cx.query('BEGIN')

    let inserted = 0
    let skippedBlank = 0
    let skippedNoCode = 0
    let skippedNoCircuit = 0
    let skippedAmbiguous = 0

    for (const r of records) {
      const mnemonic = r[MNEMONIC] ?? ''
      const router = r[ROUTER] ?? ''
      const rawRx = r[OPR]
      const rx = rawRx === '' || rawRx == null ? null : Number(rawRx)
      if (rx == null || Number.isNaN(rx)) { skippedBlank++; continue }

      // Pull the FIRST code in the row's mnemonic (rows refer to one side)
      const rowCodes = String(mnemonic).match(codeRegex) || []
      const code = rowCodes[0] || null
      if (!code) { skippedNoCode++; continue }

      const circuit = byIdOrCode.get(code) || byIdOrCode.get(String(code).trim())
      if (!circuit) { skippedNoCircuit++; continue }

      const side = decideSide(circuit.node_a, circuit.node_b, /*mnemonic*/'', router)
      if (!side) { skippedAmbiguous++; continue }

      await cx.query(upsertSql, [
        circuit.id, side, rx, mnemonic, router, code, emailId, sampleTime
      ])
      inserted++
    }

    await cx.query('COMMIT')
    console.log(`Upserted ${inserted} rows from ${filename}.`)
    console.log(`Skipped: blank_rx=${skippedBlank}, no_code=${skippedNoCode}, no_circuit=${skippedNoCircuit}, ambiguous_side=${skippedAmbiguous}`)
  } catch (err) {
    await cx.query('ROLLBACK')
    throw err
  } finally {
    cx.release()
    await pool.end()
  }
}

run().catch(err => {
  console.error(err)
  process.exitCode = 1
})
