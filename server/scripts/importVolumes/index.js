/**
 * scripts/importVolumes/index.js
 * ------------------------------------------------------------
 * 1.  Pull yesterday’s Explore “hourly workload” e-mail from Gmail
 * 2.  Accept raw CSVs or a ZIP containing multiple CSVs
 * 3.  Parse three CSVs:
 *     • Main  → date | hour | priority1 | autoDfa | autoMnt | autoOutage
 *     • Updates → date | hour | tickets
 *     • MntAuto → date | hour | auto_mnt_solved
 * 4.  UPSERT into dbo.VolumeActual  (key = date + hour)
 *     Columns: role | date | hour | priority1 | auto_dfa_logged |
 *              auto_mnt_logged | auto_outage_linked | tickets | auto_mnt_solved
 * ------------------------------------------------------------
 */
import { google } from 'googleapis'
import { parse }  from 'csv-parse/sync'
import AdmZip     from 'adm-zip'
import pg         from 'pg'
import dayjs      from 'dayjs'

// ─── environment ────────────────────────────────────────────
const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN, DATABASE_URL } = process.env

// ─── 1. gmail helper ─────────────────────────────────────────
async function gmailClient() {
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
  auth.setCredentials({ refresh_token: REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

// ─── 2. download yesterday’s attachments (CSV / ZIP) ───────
async function downloadCsvs(gmail) {
  const y      = dayjs().subtract(1, 'day').format('YYYY/MM/DD')
  const search = `subject:"Your delivery of T1 - hourly workload P1" after:${y}`

  const { data:{ messages } } = await gmail.users.messages.list({
    userId:'me', q:search, maxResults:1
  })
  if (!messages?.length) throw new Error('No matching e-mail yet')

  const { data: msg } = await gmail.users.messages.get({
    userId:'me', id:messages[0].id
  })

  const parts = msg.payload.parts?.filter(
    p => /\.csv$|\.zip$/i.test(p.filename)
  ) ?? []
  if (!parts.length) throw new Error('No CSV or ZIP attachment found')

  const csvMap = new Map()

  async function fetchAttachment(part) {
    const { data:{ data:b64 } } =
      await gmail.users.messages.attachments.get({
        userId:'me',
        messageId: msg.id,
        id: part.body.attachmentId
      })
    return Buffer.from(b64, 'base64')
  }

  for (const part of parts) {
    const bin = await fetchAttachment(part)
    if (part.filename.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(bin)
      zip.getEntries()
         .filter(e => e.entryName.toLowerCase().endsWith('.csv'))
         .forEach(e => csvMap.set(e.entryName, e.getData().toString('utf8')))
    } else {
      csvMap.set(part.filename, bin.toString('utf8'))
    }
  }

  return csvMap
}

// ─── 3. upsert into dbo.VolumeActual ────────────────────────
async function upsert(csvMap) {
  const files = [...csvMap.keys()]

  // main workload CSV
  const mainName = files.find(n =>
    /hourly workload(?!.*updates).*\.csv/i.test(n)
  ) ?? files[0]

  // updates CSV
  const updatesName = files.find(n =>
    /updates.*\.csv/i.test(n)
  ) ?? files[1]

  // mnt-auto CSV
  const mntName = files.find(n =>
    /mnt auto.*\.csv/i.test(n)
  ) ?? files[2]

  if (!mainName)   throw new Error('Primary workload CSV missing')
  if (!updatesName) console.warn('⚠️  No updates CSV – tickets will stay null')
  if (!mntName)     console.warn('⚠️  No mnt-auto CSV – auto_mnt_solved will stay null')

  const mainRows    = parse(csvMap.get(mainName),   { columns:true, skip_empty_lines:true })
  const updateRows  = updatesName
    ? parse(csvMap.get(updatesName), { columns:true, skip_empty_lines:true })
    : []
  const mntRows     = mntName
    ? parse(csvMap.get(mntName),    { columns:true, skip_empty_lines:true })
    : []

  // build maps by "YYYY-MM-DD|hour"
  const ticketMap = new Map()
  for (const r of updateRows) {
    const iso = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    ticketMap.set(`${iso}|${Number(r.hour)}`, Number(r.tickets))
  }

  const mntMap = new Map()
  for (const r of mntRows) {
    const iso = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const v = Number(r.auto_mnt_solved)
    mntMap.set(`${iso}|${+r.hour}`, isNaN(v) ? null : v)
  }

  // connect to Postgres
  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized:false }
  })
  const cx = await pool.connect()

  const sql = `
    INSERT INTO "VolumeActual" (
      role, date, hour,
      priority1, auto_dfa_logged,
      auto_mnt_logged, auto_outage_linked,
      tickets, auto_mnt_solved
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    ON CONFLICT (date,hour)
    DO UPDATE SET
      priority1          = EXCLUDED.priority1,
      auto_dfa_logged    = EXCLUDED.auto_dfa_logged,
      auto_mnt_logged    = EXCLUDED.auto_mnt_logged,
      auto_outage_linked = EXCLUDED.auto_outage_linked,
      tickets            = COALESCE(EXCLUDED.tickets, "VolumeActual".tickets),
      auto_mnt_solved    = COALESCE(EXCLUDED.auto_mnt_solved, "VolumeActual".auto_mnt_solved);
  `

  try {
    await cx.query('BEGIN')

    for (const r of mainRows) {
      const iso   = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
      const hr    = Number(r.hour)
      const key   = `${iso}|${hr}`
      const tickets     = ticketMap.get(key) ?? null
      const mntSolved   = mntMap.get(key)    ?? null

      await cx.query(sql, [
        'NOC Tier 1',           // role
        iso,
        hr,
        Number(r.priority1),
        Number(r.autoDfa ?? 0),
        Number(r.autoMnt ?? 0),
        Number(r.autoOutage ?? 0),
        (tickets   ?? 0),         // INSERT must satisfy NOT-NULL; 0 = “no tickets”
        mntSolved                 // can stay null – column is nullable
      ])
    }

    await cx.query('COMMIT')
  } catch (err) {
    await cx.query('ROLLBACK')
    throw err
  } finally {
    cx.release()
  }
}

// ─── 4. main ────────────────────────────────────────────────
;(async () => {
  try {
    const gmail = await gmailClient()
    const csvs  = await downloadCsvs(gmail)
    await upsert(csvs)
    console.log('Imported workload for', dayjs().subtract(1,'day').format('YYYY-MM-DD'))
  } catch (err) {
    console.error('Import failed:', err.message)
    process.exitCode = 1
  }
})()
