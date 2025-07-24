/**
 * scripts/importHistoricVolumes.js
 * --------------------------------
 * Usage:
 *   heroku run -- node scripts/importHistoricVolumes.js \
 *     scripts/data/T1-hourly-workload.csv \
 *     scripts/data/T1-hourly-workload-updates.csv \
 *     scripts/data/T1-hourly-workload-mnt-auto.csv
 */
import fs   from 'fs'
import pg   from 'pg'
import dayjs from 'dayjs'
import { parse } from 'csv-parse/sync'

const { DATABASE_URL } = process.env
if (!DATABASE_URL) {
  console.error('ERROR: set DATABASE_URL'); process.exit(1)
}

/* ─── Helper: load & merge the three CSVs ───────────────────── */
function loadCsvs([mainPath, updPath, mntPath]) {
  if (!mainPath || !updPath || !mntPath) {
    throw new Error('Need three CSV paths: main, updates, mnt-auto')
  }
  [mainPath, updPath, mntPath].forEach(p => {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)
  })

  const opt = { columns: true, skip_empty_lines: true, trim: true }
  const mainRows = parse(fs.readFileSync(mainPath, 'utf8'), opt)
  const updRows  = parse(fs.readFileSync(updPath , 'utf8'), opt)
  const mntRows  = parse(fs.readFileSync(mntPath , 'utf8'), opt)

  /* maps keyed by "YYYY-MM-DD|H" */
  const ticketsMap   = new Map()
  const mntSolvedMap = new Map()

  updRows.forEach(r => {
    const d = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const k = `${d}|${+r.hour}`
    const v = Number(r.tickets)
    ticketsMap.set(k, isNaN(v) ? null : v)
  })

  mntRows.forEach(r => {
    const d = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const k = `${d}|${+r.hour}`
    const v = Number(r.auto_mnt_solved)
    mntSolvedMap.set(k, isNaN(v) ? null : v)
  })

  /* merge into one record-map */
  const recMap = new Map()
  mainRows.forEach(r => {
    const date = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const hour = Number(r.hour)
    const key  = `${date}|${hour}`

    recMap.set(key, {
      date,
      hour,
      priority1        : Number(r.priority1)        || 0,
      autoDfaLogged    : Number(r.autoDfa)          || 0,
      autoMntLogged    : Number(r.autoMnt)          || 0,
      autoOutageLinked : Number(r.autoOutage)       || 0,
      tickets          : ticketsMap.get(key)        ?? null,
      autoMntSolved    : mntSolvedMap.get(key)      ?? null
    })
  })

  return recMap
}

/* ─── main() ───────────────────────────────────────────────── */
async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 3) {
    console.error('Usage: node importHistoricVolumes.js <main.csv> <updates.csv> <mnt-auto.csv>')
    process.exit(1)
  }

  const records = loadCsvs(args)
  console.log(`Loaded ${records.size} distinct (date,hour) rows`)

  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{ rejectUnauthorized:false }})
  const cx   = await pool.connect()
  let ins = 0, upd = 0, skip = 0

  try {
    await cx.query('BEGIN')
    for (const r of records.values()) {
      const sel = await cx.query(
        `SELECT priority1, auto_dfa_logged, auto_mnt_logged,
                auto_outage_linked, tickets, "autoMntSolved"
         FROM "VolumeActual"
         WHERE date=$1 AND hour=$2`,
        [r.date, r.hour]
      )

      /* ---------- INSERT ---------- */
      if (sel.rowCount === 0) {
        await cx.query(
          `INSERT INTO "VolumeActual"
             (role,date,hour,priority1,auto_dfa_logged,
              auto_mnt_logged,auto_outage_linked,tickets,"autoMntSolved")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          ['NOC Tier 1', r.date, r.hour,
           r.priority1, r.autoDfaLogged, r.autoMntLogged,
           r.autoOutageLinked, r.tickets, r.autoMntSolved]
        )
        ins++; continue
      }

      /* ---------- UPDATE only if something differs ---------- */
      const e = sel.rows[0]
      const differs =
           e.priority1          !== r.priority1
        || e.auto_dfa_logged    !== r.autoDfaLogged
        || e.auto_mnt_logged    !== r.autoMntLogged
        || e.auto_outage_linked !== r.autoOutageLinked
        || (e.tickets ?? null)       !== (r.tickets ?? null)
        || (e.autoMntSolved ?? null) !== (r.autoMntSolved ?? null)

      if (!differs) { skip++; continue }

      await cx.query(
        `UPDATE "VolumeActual" SET
             priority1          = $3,
             auto_dfa_logged    = $4,
             auto_mnt_logged    = $5,
             auto_outage_linked = $6,
             tickets            = $7,
             "autoMntSolved"    = $8
         WHERE date=$1 AND hour=$2`,
        [r.date, r.hour,
         r.priority1, r.autoDfaLogged, r.autoMntLogged,
         r.autoOutageLinked, r.tickets, r.autoMntSolved]
      )
      upd++
    }
    await cx.query('COMMIT')
    console.log(`Done. inserted=${ins}, updated=${upd}, skipped=${skip}`)
  } catch (err) {
    await cx.query('ROLLBACK'); throw err
  } finally {
    cx.release(); await pool.end()
  }
}

main().catch(err => { console.error('❌  Import failed:', err.message); process.exit(1) })
