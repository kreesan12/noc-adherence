// scripts/ingestDailyLight.js
// Pull latest ADVA Rx Levels CSV from Gmail (or CSV_FILE), parse, map to circuits,
// and POST rows to /engineering/circuits/daily-light.

import { google } from 'googleapis'
import { parse as parseCsv } from 'csv-parse/sync'
import dayjs from 'dayjs'
import fetch from 'node-fetch'
import path from 'path'
import fs from 'fs/promises'

// ─── env ────────────────────────────────────────────────────────────────────
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  API_URL,
  API_TOKEN,
  GMAIL_SUBJECT = 'ADVA Rx Levels',
  GMAIL_SENDER = '',
  CSV_FILE // optional: read local CSV instead of Gmail
} = process.env

if (!API_URL || !API_TOKEN) {
  throw new Error('Missing API_URL or API_TOKEN in env')
}

// ─── Gmail auth (same style as your importVolumes script) ────────────────────
async function gmailClient () {
  if (CSV_FILE) return null // not needed in local-file mode
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Missing CLIENT_ID/CLIENT_SECRET/REFRESH_TOKEN for Gmail OAuth')
  }
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
  auth.setCredentials({ refresh_token: REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

// ─── Download latest CSV (last 7 days) or open CSV_FILE ─────────────────────
async function getCsvBufferAndMeta (gmail) {
  if (CSV_FILE) {
    const filePath = path.resolve(CSV_FILE)
    const buf = await fs.readFile(filePath)
    return { csvBuffer: buf, emailId: 'local-test', filename: path.basename(filePath) }
  }

  const q = [
    `subject:"${GMAIL_SUBJECT}"`,
    GMAIL_SENDER ? `from:${GMAIL_SENDER}` : null,
    'newer_than:7d'
  ].filter(Boolean).join(' ')
  const { data: { messages } } = await gmail.users.messages.list({ userId: 'me', q, maxResults: 5 })
  if (!messages?.length) throw new Error('Daily email not found')

  // pick the newest
  const msgId = messages[0].id
  const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: msgId })

  const walk = (parts=[]) => parts.flatMap(p => p.parts ? walk(p.parts) : [p])
  const parts = walk(msg.payload?.parts || [])
  const attach = parts.find(p => (p.filename || '').toLowerCase().endsWith('.csv'))
  if (!attach) throw new Error('CSV attachment not found')

  const { data: att } = await gmail.users.messages.attachments.get({
    userId: 'me', messageId: msgId, id: attach.body.attachmentId
  })
  const csvBuffer = Buffer.from(att.data, 'base64')
  return { csvBuffer, emailId: msgId, filename: attach.filename || 'daily.csv' }
}

// ─── Helpers: mapping & side detection ───────────────────────────────────────
const codeRegex = /027[A-Z]{4}\d+/ // adjust if needed for your circuitId pattern
const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/^adva-/, '')
  .replace(/\(.*?\)/g, '') // strip (MED)/(HIGH) etc
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

function decideSide(nodeA, nodeB, mnemonic, router) {
  const leftMnemonic = (mnemonic || '').split('|')[0] || ''
  const nA = norm(nodeA), nB = norm(nodeB)
  const mn = norm(leftMnemonic)
  const rt = norm(router)

  const score = (x, y) => {
    const a = new Set(x.split(' ').filter(Boolean))
    const b = new Set(y.split(' ').filter(Boolean))
    let s = 0
    for (const t of a) if (b.has(t)) s++
    return s
  }

  const aScore = Math.max(score(nA, mn), score(nA, rt))
  const bScore = Math.max(score(nB, mn), score(nB, rt))
  if (aScore === 0 && bScore === 0) return null
  return aScore >= bScore ? 'A' : 'B'
}

// pick ~02:00 SAST snapshot as sample timestamp (we don't pull timezone lib here)
function computeSampleTimeIso() {
  // If the filename embeds a timestamp you can parse it; otherwise default to today 02:00
  const now = dayjs()
  const twoAm = now.startOf('day').add(2, 'hour')
  return twoAm.toISOString()
}

// ─── Core ingest ─────────────────────────────────────────────────────────────
async function run() {
  const gmail = await gmailClient()
  const { csvBuffer, emailId, filename } = await getCsvBufferAndMeta(gmail)

  const records = parseCsv(csvBuffer, { columns: true, skip_empty_lines: true })
  // Expected columns: Mnemonic, Router, OPR
  // Robustness for different headings:
  const col = (name) => {
    const keys = Object.keys(records[0] || {})
    const k = keys.find(k => k.toLowerCase() === name.toLowerCase())
    return k || name
  }
  const MNEMONIC = col('Mnemonic')
  const ROUTER   = col('Router')
  const OPR      = col('OPR')

  // Pull circuits to map by circuitId
  const circuits = await fetch(`${API_URL}/engineering/circuits`).then(r => r.json())
  const byCode = new Map(circuits.map(c => [String(c.circuitId).trim(), c]))

  const rows = []
  const sampleTime = computeSampleTimeIso()

  for (const r of records) {
    const mnemonic = r[MNEMONIC] || ''
    const router = r[ROUTER] || ''
    const rawRx = r[OPR]
    const rx = rawRx === '' || rawRx == null ? null : Number(rawRx)
    if (rx == null || Number.isNaN(rx)) continue

    const code = (mnemonic.match(codeRegex) || [])[0] || null
    if (!code) continue
    const circuit = byCode.get(code)
    if (!circuit) continue

    const side = decideSide(circuit.nodeA, circuit.nodeB, mnemonic, router)
    if (!side) continue

    rows.push({
      circuitId: circuit.id,
      side,
      rx,
      mnemonic,
      routerName: router,
      parsedCode: code,
      sourceEmailId: emailId,
      sampleTime,
    })
  }

  if (!rows.length) {
    console.log(`No rows to upsert from ${filename}.`)
    return
  }

  const res = await fetch(`${API_URL}/engineering/circuits/daily-light`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({ rows })
  })
  if (!res.ok) {
    const t = await res.text()
    throw new Error(`Ingest failed: ${res.status} ${t}`)
  }
  console.log(`Upserted ${rows.length} rows from ${filename}.`)
}

run().catch(err => {
  console.error(err)
  process.exitCode = 1
})
