// scripts/ingestDailyLight.js
import { google } from 'googleapis'
import fs from 'fs/promises'
import path from 'path'
import fetch from 'node-fetch'
import { parse } from 'csv-parse/sync'
import dayjs from 'dayjs'
import dotenv from 'dotenv'
dotenv.config()

const SUBJECT = 'ADVA Rx Levels'            // adjust to exact subject if stable
const SENDER  = ''                          // optional filter
const API_URL = process.env.API_URL         // e.g., https://yourapp.herokuapp.com
const API_TOKEN = process.env.API_TOKEN     // JWT for an Engineering user

const codeRegex = /027[A-Z]{4}\d+/ // adapt if needed

// name normalize
const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/^adva-/, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim()

function decideSide(nodeA, nodeB, mnemonic, router) {
  const nA = norm(nodeA), nB = norm(nodeB)
  const mn = norm(mnemonic?.split('|')[0]) // left side of Mnemonic
  const rt = norm(router)

  // score matches by token overlap
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

async function fetchAttachmentCSV(auth) {
  const gmail = google.gmail({ version: 'v1', auth })
  const q = [
    `subject:"${SUBJECT}"`,
    SENDER ? `from:${SENDER}` : null,
    'newer_than:7d'
  ].filter(Boolean).join(' ')
  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults: 5 })
  if (!list.data.messages?.length) throw new Error('Daily email not found')
  // pick the newest
  const msgId = list.data.messages[0].id
  const msg = await gmail.users.messages.get({ userId: 'me', id: msgId })
  const parts = msg.data.payload?.parts || []
  const attach = parts.find(p => (p.filename || '').toLowerCase().endsWith('.csv'))
  if (!attach) throw new Error('CSV attachment not found')

  const att = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: msgId,
    id: attach.body.attachmentId
  })
  const buf = Buffer.from(att.data.data, 'base64')
  const filename = attach.filename || `daily-${Date.now()}.csv`
  const fp = path.join(process.cwd(), 'tmp', filename)
  await fs.mkdir(path.dirname(fp), { recursive: true })
  await fs.writeFile(fp, buf)
  return { filePath: fp, emailId: msgId }
}

async function run() {
  // auth (use the same creds you already have for your other Gmail automation)
  // ... set up OAuth2 or service account as per your existing scripts ...
  // For brevity here, assume you have an auth client in `auth`.
  const auth = await getAuthSomehow() // implement like your other schedule scripts

  const { filePath, emailId } = await fetchAttachmentCSV(auth)
  const text = await fs.readFile(filePath)
  const recs = parse(text, { columns: true, skip_empty_lines: true })

  // pull circuits for mapping by circuitId and node names
  const circuits = await fetch(`${API_URL}/engineering/circuits`).then(r => r.json())
  const byCircuitId = new Map(circuits.map(c => [String(c.circuitId).trim(), c]))

  const rows = []
  const sampleTime = dayjs().startOf('day').add(2, 'hour').toISOString() // ~02:00 SAST snapshot time
  for (const r of recs) {
    const mnemonic = r.Mnemonic || ''
    const router = r.Router || ''
    const rx = r.OPR !== undefined && r.OPR !== '' ? Number(r.OPR) : null
    if (rx === null || Number.isNaN(rx)) continue

    const code = (mnemonic.match(codeRegex) || [])[0] || null
    let circuit = code ? byCircuitId.get(code) : null

    // fallback: fuzzy match by node names (optional)
    if (!circuit) continue // safer to skip unknowns, or you can add a backlog

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
    console.log('No rows to upsert.')
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
  console.log(`Upserted ${rows.length} rows.`)
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
