#!/usr/bin/env node
/**
 * Daily cron – fetch “NLD Tracking” e-mail (ZIP / CSV),
 * parse it, UPSERT events, auto-correct swapped sides, update live levels.
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

/* ───────── helper: detect swapped sides ───────── */
function maybeSwap (aLive, bLive, prevA, prevB, currA, currB) {
  const d = (x, y) => Math.abs((x ?? 0) - (y ?? 0))
  const same      = d(currA,aLive) + d(currB,bLive)
  const cross     = d(currA,bLive) + d(currB,aLive)
  const samePrev  = d(prevA,aLive) + d(prevB,bLive)
  const crossPrev = d(prevA,bLive) + d(prevB,aLive)

  if ((cross+crossPrev) + 0.4 < (same+samePrev)) {
    return { prevA:prevB, prevB:prevA, currA:currB, currB:currA, swapped:true }
  }
  return { prevA, prevB, currA, currB, swapped:false }
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
  const cx = await new pg.Pool({
    connectionString: DATABASE_URL,
    ssl:{ rejectUnauthorized:false }
  }).connect()

  const g   = await gmail()
  const msg = await findMail(g, targetDate)

  /* gather CSV buffers */
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

  await cx.query('BEGIN')

  for (const buf of csvBuffers) {
    const rows = parse(buf,{ columns:true, skip_empty_lines:true })

    for (const r of rows) {
      /* ── normalise circuit-ID ───────────────────────── */
      let circuitId = (r.Circuit ?? r['Circuit ID'] ?? '').trim()
      if (!circuitId) continue
      circuitId = circuitId.replace(/\|/g,'&').replace(/\s*&\s*/g,' & ')

      /* parse numeric / text fields */
      const tid   = r['Ticket ID']
      const it    = r['Impact Type']
      const edate = r['Date']
      let prevA   = parseFloat(r['Side A previous level'])
      let currA   = parseFloat(r['Side A current level'])
      let prevB   = parseFloat(r['Side B previous level'])
      let currB   = parseFloat(r['Side B current level'])
      const hours = parseFloat(r['Impact Duration (hours)'])

      /* look-up circuit first (needed for swap logic) */
      const { rows:cRows } = await cx.query(
        `SELECT id,current_rx_site_a,current_rx_site_b
           FROM "Circuit" WHERE circuit_id=$1`, [circuitId])
      if (!cRows.length) { console.warn('⚠︎ unknown circuit', circuitId); continue }
      const c = cRows[0]

      /* auto-fix swapped sides */
      ;({ prevA, prevB, currA, currB, swapped } =
          maybeSwap(c.current_rx_site_a, c.current_rx_site_b,
                    prevA, prevB, currA, currB))
      if (swapped)
        console.log(`↻ swapped sides for ticket ${tid} (${circuitId})`)

      /* UPSERT event */
      await cx.query(
        `INSERT INTO "LightLevelEvent"
           (circuit_id,ticket_id,impact_type,event_date,
            side_a_prev,side_a_curr,side_b_prev,side_b_curr,
            side_a_delta,side_b_delta,impact_hours,source_email_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (ticket_id) DO UPDATE SET
           impact_type     = EXCLUDED.impact_type,
           event_date      = EXCLUDED.event_date,
           side_a_prev     = EXCLUDED.side_a_prev,
           side_a_curr     = EXCLUDED.side_a_curr,
           side_b_prev     = EXCLUDED.side_b_prev,
           side_b_curr     = EXCLUDED.side_b_curr,
           side_a_delta    = EXCLUDED.side_a_delta,
           side_b_delta    = EXCLUDED.side_b_delta,
           impact_hours    = EXCLUDED.impact_hours,
           source_email_id = EXCLUDED.source_email_id`,
        [
          c.id, tid, it, edate,
          prevA, currA, prevB, currB,
          currA - prevA, currB - prevB,
          hours, msg.id
        ])

      /* live-level drift ≥0.1 dB → update & history */
      const diffA = Math.abs((currA ?? 0) - (c.current_rx_site_a ?? 0))
      const diffB = Math.abs((currB ?? 0) - (c.current_rx_site_b ?? 0))
      if (diffA >= 0.1 || diffB >= 0.1) {
        await cx.query(
          `UPDATE "Circuit"
             SET current_rx_site_a=$1,current_rx_site_b=$2
           WHERE id=$3`,
          [currA,currB,c.id])
        await cx.query(
          `INSERT INTO "CircuitLevelHistory"
             (circuit_id,rx_site_a,rx_site_b,reason,source)
           VALUES ($1,$2,$3,'event importer',$4)`,
          [c.id,currA,currB,'light-level csv '+msg.id])
      }
    }
  }

  await cx.query('COMMIT')
  cx.release()
  console.log('Imported light levels for', targetDate.format('YYYY-MM-DD'))
}

/* ── Runner ───────────────────────────────────────────── */
(async () => {
  const target = process.argv[2]
    ? dayjs.tz(process.argv[2],'YYYY-MM-DD','Africa/Johannesburg')
    : dayjs().subtract(1,'day')
  try { await main(target) }
  catch (e) { console.error(e.message); process.exitCode = 1 }
})()
