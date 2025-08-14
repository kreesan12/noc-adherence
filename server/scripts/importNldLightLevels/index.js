#!/usr/bin/env node
/**
 * Daily cron – fetch “NLD Tracking” e-mail (ZIP / CSV),
 * parse it, INSERT-ONCE events, decide A/B swap using CURRENT levels only,
 * then update live levels if needed.
 *
 * CLI : node … [YYYY-MM-DD]   ← optional back-fill; default = yesterday
 */
import { google } from 'googleapis'
import AdmZip     from 'adm-zip'
import { parse }  from 'csv-parse/sync'
import pg         from 'pg'
import dayjs      from 'dayjs'
import utc        from 'dayjs/plugin/utc.js'
import timezone   from 'dayjs/plugin/timezone.js'
dayjs.extend(utc)
dayjs.extend(timezone)
dayjs.tz.setDefault('Africa/Johannesburg')

const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, DATABASE_URL } = process.env

/* ───────── helpers ───────── */
function toNum (v) {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}
function delta (a,b) {
  const A = toNum(a), B = toNum(b)
  return (A==null || B==null) ? null : (A - B)
}
function norm (s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
function pick (row, keys) {
  for (const k of keys) {
    if (row[k] != null && String(row[k]).trim() !== '') return row[k]
  }
  return undefined
}

/**
 * Decide if currA/currB look swapped compared only to live levels.
 * Optional soft bias from names.
 */
function maybeSwapCurrentOnly ({
  liveA, liveB,
  currA, currB,
  csvAName, csvBName,
  nodeAName, nodeBName
}) {
  // must have both live and both current to compare
  if (liveA == null || liveB == null || currA == null || currB == null) {
    return { currA, currB, swapped:false, reason:'insufficient data' }
  }

  const d = (x,y) => Math.abs((x ?? 0) - (y ?? 0))
  let sameScore = d(currA, liveA) + d(currB, liveB)
  let swapScore = d(currA, liveB) + d(currB, liveA)

  // rough name hints
  const aCsv = norm(csvAName)
  const bCsv = norm(csvBName)
  const aCir = norm(nodeAName)
  const bCir = norm(nodeBName)

  // if A name looks like B side and B name looks like A side, bias toward swap
  const aLooksB = aCsv && (aCsv.includes(' b ') || aCsv.endsWith(' b') || aCsv.startsWith('b ') || (bCir && aCsv.includes(bCir)))
  const bLooksA = bCsv && (bCsv.includes(' a ') || bCsv.endsWith(' a') || bCsv.startsWith('a ') || (aCir && bCsv.includes(aCir)))
  // if A name looks like A and B like B, bias toward keeping
  const aLooksA = aCsv && (aCsv.includes(' a ') || aCsv.endsWith(' a') || aCsv.startsWith('a ') || (aCir && aCsv.includes(aCir)))
  const bLooksB = bCsv && (bCsv.includes(' b ') || bCsv.endsWith(' b') || bCsv.startsWith('b ') || (bCir && bCsv.includes(bCir)))

  const NAME_BIAS = 0.2   // small bias, do not dominate
  if (aLooksB && bLooksA) swapScore -= NAME_BIAS
  if (aLooksA && bLooksB) sameScore -= NAME_BIAS

  const MARGIN = 0.4      // need a clear win to swap
  if (swapScore + MARGIN < sameScore) {
    return { currA: currB, currB: currA, swapped:true, reason:`swap by current-only heuristic (swap=${swapScore.toFixed(2)} < same=${sameScore.toFixed(2)} - ${MARGIN})` }
  }
  return { currA, currB, swapped:false, reason:`keep by current-only heuristic (same=${sameScore.toFixed(2)} <= swap+${MARGIN})` }
}

/* ── Gmail helpers ─────────────────────────────────────── */
async function gmail () {
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
  auth.setCredentials({ refresh_token: REFRESH_TOKEN })
  return google.gmail({ version:'v1', auth })
}
async function findMail (client, day) {
  const after  = day.format('YYYY/MM/DD')
  const before = day.add(1,'day').format('YYYY/MM/DD')
  const q = `subject:(NLD Tracking) after:${after} before:${before}`
  const { data:{ messages } } = await client.users.messages.list({
    userId:'me', q, maxResults:1
  })
  if (!messages?.length) throw new Error('No e-mail for date '+after)
  return (await client.users.messages.get({ userId:'me', id:messages[0].id })).data
}
async function fetchAttachment (client,msg,part) {
  const { data:{ data:b64 } } =
    await client.users.messages.attachments.get({
      userId:'me', messageId:msg.id, id:part.body.attachmentId
    })
  return Buffer.from(b64,'base64')
}

/* ── Main import ───────────────────────────────────────── */
async function main (targetDate) {
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl:{ rejectUnauthorized:false }
  })
  const cx = await pool.connect()

  const g   = await gmail()
  const msg = await findMail(g, targetDate)

  const csvBuffers=[]
  for (const p of msg.payload.parts ?? []) {
    if (!/\.csv$|\.zip$/i.test(p.filename)) continue
    const bin = await fetchAttachment(g,msg,p)
    if (p.filename.toLowerCase().endsWith('.zip')) {
      new AdmZip(bin).getEntries()
        .filter(e=>e.entryName.toLowerCase().endsWith('.csv'))
        .forEach(e=>csvBuffers.push(e.getData()))
    } else csvBuffers.push(bin)
  }
  if (!csvBuffers.length) throw new Error('No CSV attachment in mail')

  const allRows = []
  for (const buf of csvBuffers) {
    const parsed = parse(buf, { columns:true, skip_empty_lines:true })
    allRows.push(...parsed)
  }

  const seenInBatch = new Set()

  await cx.query('BEGIN')
  try {
    for (const r of allRows) {
      /* normalise circuitId */
      let circuitId = (r.Circuit ?? r['Circuit ID'] ?? '').trim()
      if (!circuitId) continue
      circuitId = circuitId.replace(/\|/g,'&').replace(/\s*&\s*/g,' & ')

      const tid = String(r['Ticket ID'] ?? '').trim()
      if (!tid) continue
      if (seenInBatch.has(tid)) continue

      const it    = r['Impact Type'] ?? null
      const edate = r['Date'] ?? null

      // CSV current and previous levels
      let currA   = toNum(pick(r, ['Side A current level', 'Side A Current Level', 'A Current']))
      let currB   = toNum(pick(r, ['Side B current level', 'Side B Current Level', 'B Current']))
      let prevA   = toNum(pick(r, ['Side A previous level', 'Side A Previous Level', 'A Previous']))
      let prevB   = toNum(pick(r, ['Side B previous level', 'Side B Previous Level', 'B Previous']))

      // Optional names for soft bias
      const csvAName = pick(r, ['Side A name','Side A Name','A Name','A Site','Side A'])
      const csvBName = pick(r, ['Side B name','Side B Name','B Name','B Site','Side B'])

      // circuit lookup with live levels and node names
      const { rows:cRows } = await cx.query(
        `SELECT id, node_a, node_b, current_rx_site_a, current_rx_site_b
           FROM "Circuit" WHERE circuit_id=$1`, [circuitId])
      if (!cRows.length) { console.warn('⚠︎ unknown circuit', circuitId); continue }
      const c = cRows[0]

      // decide swap using CURRENT only
      const decision = maybeSwapCurrentOnly({
        liveA: c.current_rx_site_a,
        liveB: c.current_rx_site_b,
        currA, currB,
        csvAName, csvBName,
        nodeAName: c.node_a,
        nodeBName: c.node_b
      })

      if (decision.swapped) {
        console.log(`↻ swapped sides for ticket ${tid} (${circuitId}) → ${decision.reason}`)
        // swap both current and previous so event is consistent
        ;[currA, currB] = [decision.currA, decision.currB]
        ;[prevA, prevB] = [prevB, prevA]
      }

      const saDelta = delta(currA, prevA)
      const sbDelta = delta(currB, prevB)

      // INSERT ONCE for this ticket
      const insertSql = `
        INSERT INTO "LightLevelEvent"
          (circuit_id, ticket_id, impact_type, event_date,
           side_a_prev, side_a_curr, side_b_prev, side_b_curr,
           side_a_delta, side_b_delta, impact_hours, source_email_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (ticket_id) DO NOTHING
        RETURNING id
      `
      const hours = toNum(r['Impact Duration (hours)'])
      const { rows: ins } = await cx.query(insertSql, [
        c.id, tid, it, edate,
        prevA, currA, prevB, currB,
        saDelta, sbDelta,
        hours, msg.id
      ])

      if (ins.length === 0) {
        seenInBatch.add(tid)
        console.log(`⤳ skip duplicate ticket ${tid} (already recorded)`)
        continue
      }
      seenInBatch.add(tid)

      // diffs
      const diffA = Math.abs((currA ?? 0) - (c.current_rx_site_a ?? 0))
      const diffB = Math.abs((currB ?? 0) - (c.current_rx_site_b ?? 0))

      // always write history (even with no drift)
      const reason = (diffA >= 0.1 || diffB >= 0.1) ? 'event importer' : 'event importer (no drift)'
      await cx.query(
        `INSERT INTO "CircuitLevelHistory"
          (circuit_id, rx_site_a, rx_site_b, reason, source)
        VALUES ($1,$2,$3,$4,'light-level csv ' || $5)`,
        [c.id, currA, currB, reason, msg.id]
      )

      // set updated_at to event date (monotonic), and update levels only if drift
      if (diffA >= 0.1 || diffB >= 0.1) {
        await cx.query(
          `UPDATE "Circuit"
            SET current_rx_site_a = $1,
                current_rx_site_b = $2,
                updated_at        = GREATEST(COALESCE(updated_at,'epoch'::timestamptz), $3::timestamptz)
          WHERE id = $4`,
          [currA, currB, edate, c.id]
        )
      } else {
        await cx.query(
          `UPDATE "Circuit"
            SET updated_at = GREATEST(COALESCE(updated_at,'epoch'::timestamptz), $1::timestamptz)
          WHERE id = $2`,
          [edate, c.id]
        )
      }
    }

    await cx.query('COMMIT')
    console.log('Imported light levels for', targetDate.format('YYYY-MM-DD'))
  } catch (e) {
    await cx.query('ROLLBACK')
    console.error('Import failed:', e)
    process.exitCode = 1
  } finally {
    cx.release()
    await pool.end()
  }
}

/* ── Runner ───────────────────────────────────────────── */
;(async () => {
  const target = process.argv[2]
    ? dayjs.tz(process.argv[2],'YYYY-MM-DD','Africa/Johannesburg')
    : dayjs().subtract(1,'day')
  try { await main(target) }
  catch (e) { console.error(e.message); process.exitCode = 1 }
})()
