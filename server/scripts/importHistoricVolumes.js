/**
 * scripts/importHistoricVolumes.js
 *
 * Usage:
 *   node scripts/importHistoricVolumes.js \
 *     path/to/T1-hourly-workload.csv \
 *     path/to/T1-hourly-workload-updates.csv \
 *     path/to/T1-hourly-workload-mnt-auto.csv
 *
 * Expects your DATABASE_URL env var to point at Postgres.
 */
import fs from 'fs'
import path from 'path'
import pg from 'pg'
import dayjs from 'dayjs'
import { parse } from 'csv-parse/sync'

const { DATABASE_URL } = process.env
if (!DATABASE_URL) {
  console.error('ERROR: set DATABASE_URL')
  process.exit(1)
}

// Helper: map date|hour → merged record
function loadCsvs(filePaths) {
  // match either a space or dash between words:
  // allow either space or dash in “hourly-workload” and “mnt-auto”
   const mainRe    = /hourly[- ]workload(?!.*updates).*\.csv$/i
   const updateRe  = /updates.*\.csv$/i
   const mntAutoRe = /mnt[- ]auto.*\.csv$/i

  let mainPath, updPath, mntPath
  for (const p of filePaths) {
    if (mainRe.test(p))        mainPath = p
    else if (updateRe.test(p)) updPath  = p
    else if (mntAutoRe.test(p)) mntPath  = p
  }

  // fallback to the exact order you passed on the CLI
  if (!mainPath && filePaths[0]) mainPath = filePaths[0]
  if (!updPath  && filePaths[1]) updPath  = filePaths[1]
  if (!mntPath  && filePaths[2]) mntPath  = filePaths[2]

  if (!mainPath || !updPath || !mntPath) {
    console.error('Could not identify all three CSVs. Got:', filePaths)
    process.exit(1)
  }

  const mainRows = parse(fs.readFileSync(mainPath,'utf8'), {
    columns:true, skip_empty_lines:true
  })
  const updRows  = parse(fs.readFileSync(updPath,'utf8'), {
    columns:true, skip_empty_lines:true
  })
  const mntRows  = parse(fs.readFileSync(mntPath,'utf8'), {
    columns:true, skip_empty_lines:true
  })

  // build lookup maps
  const ticketsMap = new Map()
  updRows.forEach(r => {
    const d = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    ticketsMap.set(`${d}|${+r.hour}`, +r.tickets)
  })

  const mntSolvedMap = new Map()
  mntRows.forEach(r => {
    const d = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    mntSolvedMap.set(`${d}|${+r.hour}`, +r.autoMntSolved)
  })

  // merge into recordMap
  const recordMap = new Map()
  mainRows.forEach(r => {
    const date = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const hour = Number(r.hour)
    const key  = `${date}|${hour}`

    recordMap.set(key, {
      date,
      hour,
      priority1        : +r.priority1,
      autoDfaLogged    : +r.autoDfa    || 0,
      autoMntLogged    : +r.autoMnt    || 0,
      autoOutageLinked : +r.autoOutage || 0,
      tickets          : ticketsMap.get(key)     ?? null,
      autoMntSolved    : mntSolvedMap.get(key)   ?? null
    })
  })

  return recordMap
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 3) {
    console.error('Usage: node importHistoricVolumes.js <main.csv> <updates.csv> <mnt-auto.csv>')
    process.exit(1)
  }

  const records = loadCsvs(args)
  console.log(`Loaded ${records.size} distinct (date,hour) rows`)

  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{ rejectUnauthorized:false } })
  const cx   = await pool.connect()

  let inserted = 0, updated = 0, skipped = 0

  try {
    await cx.query('BEGIN')

    for (const [key, r] of records.entries()) {
      // check existing
      const sel = await cx.query(
        `SELECT priority1, auto_dfa_logged, auto_mnt_logged,
                auto_outage_linked, tickets, "autoMntSolved"
         FROM "VolumeActual"
         WHERE date=$1 AND hour=$2`,
        [ r.date, r.hour ]
      )

      if (sel.rowCount === 0) {
        // no row → insert
        await cx.query(
          `INSERT INTO "VolumeActual"
            ( role, date, hour, priority1, auto_dfa_logged,
              auto_mnt_logged, auto_outage_linked, tickets, "autoMntSolved" )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            'NOC Tier 1',   // adjust if needed
            r.date, r.hour,
            r.priority1, r.autoDfaLogged,
            r.autoMntLogged, r.autoOutageLinked,
            r.tickets, r.autoMntSolved
          ]
        )
        inserted++
      } else {
        // compare
        const e = sel.rows[0]
        const same =
          e.priority1          === r.priority1 &&
          e.auto_dfa_logged    === r.autoDfaLogged &&
          e.auto_mnt_logged    === r.autoMntLogged &&
          e.auto_outage_linked === r.autoOutageLinked &&
          (e.tickets      === r.tickets) &&
          (e.autoMntSolved === r.autoMntSolved)
        if (same) {
          skipped++
        } else {
          await cx.query(
            `UPDATE "VolumeActual"
             SET priority1          = $3,
                 auto_dfa_logged    = $4,
                 auto_mnt_logged    = $5,
                 auto_outage_linked = $6,
                 tickets            = $7,
                 "autoMntSolved"      = $8
             WHERE date=$1 AND hour=$2`,
            [
              r.date, r.hour,
              r.priority1, r.autoDfaLogged,
              r.autoMntLogged, r.autoOutageLinked,
              r.tickets, r.autoMntSolved
            ]
          )
          updated++
        }
      }
    }

    await cx.query('COMMIT')

    console.log(`Done. inserted=${inserted}, updated=${updated}, skipped=${skipped}`)
  } catch (err) {
    await cx.query('ROLLBACK')
    console.error('Error:', err)
  } finally {
    cx.release()
    await pool.end()
  }
}

main()
  .catch(err => {
    console.error(err)
    process.exit(1)
  })
