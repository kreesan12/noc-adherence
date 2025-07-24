/**
 * scripts/importHistoricVolumes.js
 *
 * Usage:
 *   node scripts/importHistoricVolumes.js \
 *     path/to/T1-hourly-workload.csv \
 *     path/to/T1-hourly-workload-updates.csv \
 *     path/to/T1-hourly-workload-mnt-auto.csv
 *
 * Needs DATABASE_URL in the env.
 */
import fs               from 'fs'
import pg               from 'pg'
import dayjs            from 'dayjs'
import { parse }        from 'csv-parse/sync'

/* ─── ENV ─────────────────────────────────────────────────── */
const { DATABASE_URL } = process.env
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL not set'); process.exit(1)
}

/* ─── tiny helpers ────────────────────────────────────────── */
const num        = v => { const n = Number(v); return isNaN(n) ? 0    : n }
const numOrNull  = v => { const n = Number(v); return isNaN(n) ? null : n }

/* ─── Load & merge the three CSV files ───────────────────── */
function loadCsvs(filePaths) {
  /* recognise files by name fragment (space or dash both allowed) */
  const mainRe    = /hourly[- ]workload(?!.*updates).*\.csv$/i
  const updateRe  = /updates.*\.csv$/i
  const mntAutoRe = /mnt[- ]auto.*\.csv$/i

  let mainPath, updPath, mntPath
  for (const p of filePaths) {
    if (mainRe.test(p))        mainPath = p
    else if (updateRe.test(p)) updPath  = p
    else if (mntAutoRe.test(p)) mntPath = p
  }
  /* fall back to positional order */
  if (!mainPath && filePaths[0]) mainPath = filePaths[0]
  if (!updPath  && filePaths[1]) updPath  = filePaths[1]
  if (!mntPath  && filePaths[2]) mntPath  = filePaths[2]

  if (!mainPath || !updPath || !mntPath) {
    console.error('❌  Could not identify all three CSVs.\nGot:', filePaths)
    process.exit(1)
  }

  /* single parser config: trim headers AND every cell */
  const parseOpts = {
    columns: hdr => hdr.map(h => h.trim()),
    skip_empty_lines: true,
    trim: true
  }
  const mainRows = parse(fs.readFileSync(mainPath,'utf8'), parseOpts)
  const updRows  = parse(fs.readFileSync(updPath ,'utf8'), parseOpts)
  const mntRows  = parse(fs.readFileSync(mntPath ,'utf8'), parseOpts)

  /* --- build quick-lookup maps ------------------------------------ */
  const ticketsMap = new Map()
  updRows.forEach(r => {
    const d = dayjs(r.date,['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    ticketsMap.set(`${d}|${num(r.hour)}`, numOrNull(r.tickets))
  })

  const mntSolvedMap = new Map()
  mntRows.forEach(r => {
    const d = dayjs(r.date,['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    mntSolvedMap.set(`${d}|${num(r.hour)}`, numOrNull(r.auto_mnt_solved))
  })

  /* --- merge into one record per date|hour ------------------------ */
  const recMap = new Map()

  mainRows.forEach(r => {
    const date = dayjs(r.date,['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const hour = num(r.hour)           // 0-23 or 0 if bad
    if (hour < 0 || hour > 23) return  // skip garbage rows

    const key = `${date}|${hour}`
    recMap.set(key, {
      date,
      hour,
      priority1         : num(r.priority1),
      autoDfaLogged     : num(r.autoDfa),
      autoMntLogged     : num(r.autoMnt),
      autoOutageLinked  : num(r.autoOutage),
      tickets           : ticketsMap.get(key),
      autoMntSolved     : mntSolvedMap.get(key)
    })
  })

  return recMap
}

/* ─── MAIN ────────────────────────────────────────────────── */
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

    for (const r of records.values()) {
      /* does a row already exist? */
      const { rows } = await cx.query(
        `SELECT priority1, auto_dfa_logged, auto_mnt_logged,
                auto_outage_linked, tickets, "autoMntSolved"
           FROM "VolumeActual"
          WHERE date=$1 AND hour=$2`,
        [ r.date, r.hour ]
      )

      if (!rows.length) {
        /* INSERT new row */
        await cx.query(`
          INSERT INTO "VolumeActual"
            (role, date, hour, priority1,
             auto_dfa_logged, auto_mnt_logged, auto_outage_linked,
             tickets, "autoMntSolved")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            'NOC Tier 1',
            r.date, r.hour,
            r.priority1, r.autoDfaLogged, r.autoMntLogged, r.autoOutageLinked,
            r.tickets, r.autoMntSolved
          ])
        inserted++
      } else {
        const e = rows[0]
        const same =
          e.priority1          === r.priority1 &&
          e.auto_dfa_logged    === r.autoDfaLogged &&
          e.auto_mnt_logged    === r.autoMntLogged &&
          e.auto_outage_linked === r.autoOutageLinked &&
          (e.tickets          ?? null) === r.tickets &&
          (e.autoMntSolved    ?? null) === r.autoMntSolved

        if (same) { skipped++; continue }

        await cx.query(`
          UPDATE "VolumeActual"
             SET priority1          = $3,
                 auto_dfa_logged    = $4,
                 auto_mnt_logged    = $5,
                 auto_outage_linked = $6,
                 tickets            = $7,
                 "autoMntSolved"    = $8
           WHERE date=$1 AND hour=$2`,
          [
            r.date, r.hour,
            r.priority1, r.autoDfaLogged, r.autoMntLogged, r.autoOutageLinked,
            r.tickets, r.autoMntSolved
          ])
        updated++
      }
    }

    await cx.query('COMMIT')
    console.log(`✅  Done. inserted=${inserted}, updated=${updated}, skipped=${skipped}`)
  } catch (err) {
    await cx.query('ROLLBACK')
    console.error('❌  Import failed:', err.message)
  } finally {
    cx.release(); await pool.end()
  }
}

main().catch(e => { console.error(e); process.exit(1) })
