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

const DEBUG = process.env.DEBUG_LIGHT === '1'

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

// Dice coefficient on bigrams, for loose fuzzy matching
function dice(a, b) {
  a = (a || '').toLowerCase()
  b = (b || '').toLowerCase()
  if (a === b) return 1
  const bigrams = str => {
    const s = str.replace(/[^a-z0-9]+/g, ' ').trim().replace(/ /g, '')
    if (s.length < 2) return []
    const arr = []
    for (let i=0; i<s.length-1; i++) arr.push(s.slice(i, i+2))
    return arr
  }
  const A = bigrams(a), B = bigrams(b)
  if (!A.length || !B.length) return 0
  const m = new Map()
  for (const g of A) m.set(g, (m.get(g) || 0) + 1)
  let inter = 0
  for (const g of B) {
    const c = m.get(g) || 0
    if (c) { inter++; m.set(g, c - 1) }
  }
  return (2 * inter) / (A.length + B.length)
}

// Common vendor/tech tokens to ignore in Router names
const STOP = new Set([
  'adva','liquid','frogfoot','dfa','openserve','seacom','vodacom','mtn','telkom',
  'metrofibre','dark','darkfiber','darkfibre','dfn','juniper','calix','smart','iris','solid',
  'olt','switch','router','edge','core','backbone','ring','agg','aggregation',
  'metro','access','backhaul','nld','nwd','east','west','north','south'
])

function splitTokens(str) {
  return String(str || '').split(/[-|]/).map(norm).filter(Boolean)
}

/** e.g. "ADVA-Liquid-Yzerfontein" -> ["yzerfontein"] */
function extractRouterSiteCandidates(router) {
  const parts = splitTokens(router)
  const kept = parts.filter(p => !STOP.has(p))
  if (kept.length) return kept
  // fallback: last part even if it's a stopword
  return parts.slice(-1)
}

function looseContains(nodeNorm, candNorm) {
  if (!nodeNorm || !candNorm) return false
  if (nodeNorm.includes(candNorm)) return true
  // starts-with on tokens (>=4 chars)
  const nodeTokens = nodeNorm.split(' ').filter(Boolean)
  const c = candNorm
  if (c.length >= 4) {
    if (nodeTokens.some(t => t.startsWith(c) || c.startsWith(t) && t.length >= 4)) return true
  }
  // fuzzy bigram similarity
  return dice(nodeNorm, candNorm) >= 0.6
}

/**
 * Decide side using Router-derived site candidates only.
 * Final fallback: if mnemonic-left looks like nodeA, pick B (and vice versa).
 */
function decideSide(nodeA, nodeB, mnemonic, router) {
  const nA = norm(nodeA)
  const nB = norm(nodeB)
  const candidates = extractRouterSiteCandidates(router)

  // 1) Inclusion / starts-with / fuzzy vs candidates
  let votesA = 0, votesB = 0
  for (const c of candidates) {
    if (looseContains(nA, c)) votesA++
    if (looseContains(nB, c)) votesB++
  }
  if (votesA !== votesB) return votesA > votesB ? 'A' : 'B'

  // 2) Full-router similarity tiebreak
  const rt = norm(router)
  const aFull = tokenScore(nA, rt) + dice(nA, rt)
  const bFull = tokenScore(nB, rt) + dice(nB, rt)
  if (aFull !== bFull) return aFull > bFull ? 'A' : 'B'

  // 3) LAST RESORT (you asked to ignore this, so we only use it if still tied):
  // If mnemonic-left clearly names nodeA, choose B (opposite end), and vice versa.
  const leftMnemonic = (mnemonic || '').split('|')[0] || ''
  const mn = norm(leftMnemonic)
  const matchA = looseContains(nA, mn)
  const matchB = looseContains(nB, mn)
  if (matchA && !matchB) return 'B'
  if (!matchA && matchB) return 'A'

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
    let debugPrinted = 0

    for (const r of records) {
      const mnemonic = r[MNEMONIC] ?? ''
      const router = r[ROUTER] ?? ''
      const rawRx = r[OPR]
      const rx = rawRx === '' || rawRx == null ? null : Number(rawRx)
      if (rx == null || Number.isNaN(rx)) { skippedBlank++; continue }

      const rowCodes = String(mnemonic).match(codeRegex) || []
      const code = rowCodes[0] || null
      if (!code) { skippedNoCode++; continue }

      const circuit = byIdOrCode.get(code) || byIdOrCode.get(String(code).trim())
      if (!circuit) { skippedNoCircuit++; continue }

      const side = decideSide(circuit.node_a, circuit.node_b, mnemonic, router)
      if (!side) {
        skippedAmbiguous++
        if (DEBUG && debugPrinted < 15) {
          const candidates = extractRouterSiteCandidates(router)
          console.warn('[AMBIGUOUS]', {
            node_a: circuit.node_a,
            node_b: circuit.node_b,
            router,
            candidates,
            mnemonic
          })
          debugPrinted++
        }
        continue
      }

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
