#!/usr/bin/env node
// scripts/ingestDailyLight.js
// Pull latest ADVA Rx Levels CSV from Gmail (or CSV_FILE), parse, map to circuits,
// and UPSERT rows into public.daily_light_level.

import { google } from 'googleapis'
import AdmZip from 'adm-zip'
import { parse as parseCsv } from 'csv-parse/sync'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'
import timezone from 'dayjs/plugin/timezone.js'
import path from 'path'
import fs from 'fs/promises'
import pg from 'pg'
import prisma from '../lib/prisma.js'
import { syncStagedZendeskTickets } from '../lib/nldTicketStaging.js'

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
  GMAIL_LOOKBACK_DAYS = '14',
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

const SUBJECT_PREFIX_RE = /^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i

function normalizeSubject(subject) {
  return String(subject || '')
    .replace(SUBJECT_PREFIX_RE, '')
    .trim()
    .toLowerCase()
}

function getSubjectHeader(msg) {
  const headers = msg?.payload?.headers || []
  return headers.find(h => String(h?.name || '').toLowerCase() === 'subject')?.value || ''
}

function buildSubjectNeedles() {
  const defaults = [
    GMAIL_SUBJECT,
    'Iris Automated Report: ADVA Rx Levels',
    'Fw: Iris Automated Report: ADVA Rx Levels',
    'Fwd: Iris Automated Report: ADVA Rx Levels'
  ]

  return Array.from(new Set(
    defaults
      .flatMap(subject => [subject, normalizeSubject(subject)])
      .map(x => String(x || '').trim())
      .filter(Boolean)
  ))
}

function matchesWantedSubject(subject, needles = buildSubjectNeedles()) {
  const normalized = normalizeSubject(subject)
  return needles.some(needle => {
    const n = normalizeSubject(needle)
    return n && normalized.includes(n)
  })
}

function walkParts(parts = []) {
  return parts
    .flatMap(p => p?.parts ? walkParts(p.parts) : [p])
    .filter(Boolean)
}

async function getAttachmentBuffer(gmail, msgId, attachId) {
  const { data: { data: b64 } } = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: msgId,
    id: attachId
  })
  return Buffer.from(b64, 'base64')
}

function pickSupportedAttachment(parts = []) {
  const supported = parts
    .filter(p => /\.(csv|zip)$/i.test(p.filename || ''))
    .map(p => ({ ...p, size: Number(p.body?.size || 0) }))
    .sort((a, b) => b.size - a.size)

  return supported[0] || null
}

function extractCsvFromZip(zipBuffer, zipName = 'daily.zip') {
  const zip = new AdmZip(zipBuffer)
  const entry = zip.getEntries()
    .filter(e => !e.isDirectory && /\.csv$/i.test(e.entryName || ''))
    .sort((a, b) => b.header.size - a.header.size)[0]

  if (!entry) {
    throw new Error(`ZIP attachment ${zipName} does not contain a CSV file`)
  }

  return {
    csvBuffer: entry.getData(),
    filename: entry.entryName
  }
}

// ─── Download latest CSV email or open CSV_FILE ──────────────────────────────
async function getCsvBufferAndMeta (gmail) {
  if (CSV_FILE) {
    const filePath = path.resolve(CSV_FILE)
    const buf = await fs.readFile(filePath)
    return { csvBuffer: buf, emailId: 'local-test', filename: path.basename(filePath) }
  }

  const q = [
    GMAIL_SENDER ? `from:${GMAIL_SENDER}` : null,
    `newer_than:${Number(GMAIL_LOOKBACK_DAYS) || 14}d`,
    'has:attachment'
  ].filter(Boolean).join(' ')

  const { data: { messages } } = await gmail.users.messages.list({
    userId: 'me',
    q,
    maxResults: 25
  })
  if (!messages?.length) throw new Error('Daily email not found in mailbox lookback window')

  const subjectNeedles = buildSubjectNeedles()
  const attachmentErrors = []

  for (const summary of messages) {
    const msgId = summary.id
    const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: msgId })
    const subject = getSubjectHeader(msg)
    if (!matchesWantedSubject(subject, subjectNeedles)) continue

    const parts = walkParts(msg.payload?.parts || [])
    const attach = pickSupportedAttachment(parts)
    if (!attach) {
      attachmentErrors.push(`message ${msgId} matched subject but had no CSV/ZIP attachment`)
      continue
    }

    const buffer = await getAttachmentBuffer(gmail, msgId, attach.body.attachmentId)
    if (/\.zip$/i.test(attach.filename || '')) {
      const extracted = extractCsvFromZip(buffer, attach.filename || 'daily.zip')
      return {
        csvBuffer: extracted.csvBuffer,
        emailId: msgId,
        filename: extracted.filename
      }
    }

    return {
      csvBuffer: buffer,
      emailId: msgId,
      filename: attach.filename || 'daily.csv'
    }
  }

  if (attachmentErrors.length) {
    throw new Error(`Daily email found but attachment could not be processed: ${attachmentErrors[0]}`)
  }

  throw new Error(`Daily email not found for subjects: ${subjectNeedles.join(' | ')}`)
}

// ─── Helpers: mapping & side detection ───────────────────────────────────────
// Known code patterns:
//  - FNO "027" style: 027 + 3/4 letters + digits (e.g., 027CAPE292014216096, 027NEW292013461734)
//  - DFA style: DFA##-####### (e.g., DFA21-0025521)
//  - DFX style: DFX##_####### (e.g., DFX21_0000065)
//  - FRG style: liberal catch for FRG-prefixed ids (letters/digits/_/-)
const RX_PATTERNS = [
  /027[A-Z]{3,4}\d+/g,      // 027CAPE292014216096 / 027NEW292013461734
  /DFA\d{2}-\d+/g,          // DFA21-0025521
  /DFX\d{2}_\d+/g,          // DFX21_0000065
  /FRG[A-Z0-9_-]+/gi        // FRG... (loose)
]

function extractCodesFromText(text) {
  const s = String(text || '')
    // remove parenthetical suffixes like (Pair2)
    .replace(/\(.*?\)/g, ' ')
  const found = new Set()
  for (const re of RX_PATTERNS) {
    const rx = new RegExp(re) // clone, because /g/ stateful
    let m
    while ((m = rx.exec(s)) !== null) {
      found.add(m[0].toUpperCase().trim())
    }
  }
  // also pick up tokens between pipes if they look like codes (letters/digits/_/- and contain a digit)
  const pipeParts = s.split('|').map(x => x.trim()).filter(Boolean)
  for (const p of pipeParts) {
    if (/^[A-Z0-9_-]+$/i.test(p) && /\d/.test(p) && p.length >= 6) {
      found.add(p.toUpperCase())
    }
  }
  return Array.from(found)
}

const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/\(.*?\)/g, '')
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

// Router vendor/tech tokens to ignore
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
  return parts.slice(-1)
}

function looseContains(nodeNorm, candNorm) {
  if (!nodeNorm || !candNorm) return false
  if (nodeNorm.includes(candNorm)) return true
  const nodeTokens = nodeNorm.split(' ').filter(Boolean)
  const c = candNorm
  if (c.length >= 4) {
    if (nodeTokens.some(t => (t.startsWith(c) || c.startsWith(t)) && t.length >= 4)) return true
  }
  return dice(nodeNorm, candNorm) >= 0.6
}

/** Decide side using Router-derived site candidates only. */
function decideSide(nodeA, nodeB, mnemonic, router) {
  const nA = norm(nodeA)
  const nB = norm(nodeB)
  const candidates = extractRouterSiteCandidates(router)

  let votesA = 0, votesB = 0
  for (const c of candidates) {
    if (looseContains(nA, c)) votesA++
    if (looseContains(nB, c)) votesB++
  }
  if (votesA !== votesB) return votesA > votesB ? 'A' : 'B'

  const rt = norm(router)
  const aFull = tokenScore(nA, rt) + dice(nA, rt)
  const bFull = tokenScore(nB, rt) + dice(nB, rt)
  if (aFull !== bFull) return aFull > bFull ? 'A' : 'B'

  // Last resort: mnemonic-left names opposite end
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
  return k || null
}

// Build lookup map for circuits by both full circuit_id and ANY embedded codes (027/DFA/DFX/FRG)
function buildCircuitLookup(circuits) {
  const map = new Map()
  for (const c of circuits) {
    const cid = String(c.circuit_id || '').trim()
    if (cid) map.set(cid.toUpperCase(), c)
    const codes = extractCodesFromText(cid)
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

  if (!MNEMONIC || !ROUTER || !OPR) {
    const cols = Object.keys(records[0] || {})
    throw new Error(
      `CSV columns do not match expected format. Needed Mnemonic/Router/OPR, got: ${cols.join(', ')}`
    )
  }

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
    const blankIssueUpsertSql = `
      INSERT INTO public.blank_daily_light_issue
        (circuit_id, side, raw_rx, mnemonic, router_name, parsed_code, source_email_id, sample_time)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (circuit_id, side, sample_time, mnemonic)
      DO UPDATE SET
        raw_rx          = EXCLUDED.raw_rx,
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
      const isBlankRx = rx == null || Number.isNaN(rx)

      // Extract ALL plausible codes from the mnemonic (supports 027 / DFA / DFX / FRG)
      const rowCodes = extractCodesFromText(mnemonic)
      if (!rowCodes.length) {
        if (isBlankRx) skippedBlank++
        else skippedNoCode++
        continue
      }

      // Find first code that maps to a circuit
      let circuit = null, matchedCode = null
      for (const code of rowCodes) {
        const c = byIdOrCode.get(code) || byIdOrCode.get(String(code).toUpperCase())
        if (c) { circuit = c; matchedCode = code; break }
      }
      if (!circuit) {
        if (isBlankRx) skippedBlank++
        else skippedNoCircuit++
        continue
      }

      if (isBlankRx) {
        const blankSide = decideSide(circuit.node_a, circuit.node_b, mnemonic, router) || 'UNKNOWN'
        await cx.query(blankIssueUpsertSql, [
          circuit.id,
          blankSide,
          rawRx == null ? null : String(rawRx),
          mnemonic,
          router,
          matchedCode,
          emailId,
          sampleTime
        ])
        skippedBlank++
        continue
      }

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
            mnemonic,
            codes_in_row: rowCodes,
            matched_code: matchedCode
          })
          debugPrinted++
        }
        continue
      }

      await cx.query(upsertSql, [
        circuit.id, side, rx, mnemonic, router, matchedCode, emailId, sampleTime
      ])
      inserted++
    }

    if (inserted === 0) {
      throw new Error(
        `Parsed ${records.length} rows from ${filename} but inserted 0 rows. ` +
        `Skipped: blank_rx=${skippedBlank}, no_code=${skippedNoCode}, ` +
        `no_circuit=${skippedNoCircuit}, ambiguous_side=${skippedAmbiguous}`
      )
    }

    await cx.query('COMMIT')
    console.log(`Upserted ${inserted} rows from ${filename}.`)
    console.log(`Skipped: blank_rx=${skippedBlank}, no_code=${skippedNoCode}, no_circuit=${skippedNoCircuit}, ambiguous_side=${skippedAmbiguous}`)

    try {
      const ticketSummary = await syncStagedZendeskTickets(prisma)
      console.log(
        `Ticket staging synced: created=${ticketSummary.created}, escalated=${ticketSummary.escalated}, ` +
        `updated=${ticketSummary.updated}, skipped=${ticketSummary.skipped}`
      )
    } catch (ticketErr) {
      console.warn('Ticket staging sync failed after daily light ingest:', ticketErr?.message || ticketErr)
    }
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
