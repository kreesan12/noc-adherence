/**
 * scripts/importHistoricVolumes.js
 * --------------------------------
 */
import fs from 'fs'
import pg from 'pg'
import dayjs from 'dayjs'
import { parse } from 'csv-parse/sync'

const { DATABASE_URL } = process.env
if (!DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(1) }

/* util ─────────────────────────────────────────────────────── */
const safeNum = v => {
  const n = Number(v)
  return isNaN(n) ? undefined : n           // undefined = “absent”
}

/* load & merge three CSVs ──────────────────────────────────── */
function loadCsvs([mainPath, updPath, mntPath]) {
  [mainPath, updPath, mntPath].forEach(p => {
    if (!p || !fs.existsSync(p)) throw new Error(`Missing CSV: ${p}`)
  })
  const opt = { columns: true, skip_empty_lines: true, trim: true }

  const main = parse(fs.readFileSync(mainPath,'utf8'), opt)
  const upd  = parse(fs.readFileSync(updPath ,'utf8'), opt)
  const mnt  = parse(fs.readFileSync(mntPath ,'utf8'), opt)

  const ticketMap = new Map()
  upd.forEach(r => {
    const d = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    ticketMap.set(`${d}|${+r.hour}`, safeNum(r.tickets))
  })

  const mntMap = new Map()
  mnt.forEach(r => {
    const d = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    mntMap.set(`${d}|${+r.hour}`, safeNum(r.auto_mnt_solved))
  })

  const rec = new Map()
  main.forEach(r => {
    const date = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const hour = +r.hour
    const key  = `${date}|${hour}`

    rec.set(key, {
      date, hour,
      priority1        : safeNum(r.priority1)        || 0,
      autoDfaLogged    : safeNum(r.autoDfa)          || 0,
      autoMntLogged    : safeNum(r.autoMnt)          || 0,
      autoOutageLinked : safeNum(r.autoOutage)       || 0,
      tickets          : ticketMap.get(key),
      autoMntSolved    : mntMap.get(key)
    })
  })
  return rec
}

/* main import routine ─────────────────────────────────────── */
async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 3) {
    console.error('Usage: node importHistoricVolumes.js <main> <updates> <mnt-auto>')
    process.exit(1)
  }

  const recs = loadCsvs(args)
  console.log(`Loaded ${recs.size} (date,hour) combos`)

  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl:{rejectUnauthorized:false}})
  const cx   = await pool.connect()
  let ins=0, upd=0, skip=0

  try {
    await cx.query('BEGIN')
    for (const r of recs.values()) {
      const { rows } = await cx.query(
        `SELECT priority1, auto_dfa_logged, auto_mnt_logged,
                auto_outage_linked, tickets, "autoMntSolved"
         FROM "VolumeActual"
         WHERE date=$1 AND hour=$2`,
        [r.date, r.hour]
      )

      if (!rows.length) {                    /* INSERT */
        await cx.query(
          `INSERT INTO "VolumeActual"
             (role,date,hour,priority1,auto_dfa_logged,
              auto_mnt_logged,auto_outage_linked,tickets,"autoMntSolved")
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          ['NOC Tier 1', r.date, r.hour,
           r.priority1, r.autoDfaLogged, r.autoMntLogged,
           r.autoOutageLinked, r.tickets ?? 0, r.autoMntSolved ?? 0]
        )
        ins++; continue
      }

      /* UPDATE only the fields present in CSV ------------------------- */
      const cur = rows[0]
      const newVals = {
        priority1        : r.priority1,
        auto_dfa_logged  : r.autoDfaLogged,
        auto_mnt_logged  : r.autoMntLogged,
        auto_outage_linked: r.autoOutageLinked,
        tickets          : r.tickets,
        autoMntSolved    : r.autoMntSolved
      }

      // build a SET list dynamically
      const setParts = []
      const params   = [r.date, r.hour]      // $1, $2
      Object.entries(newVals).forEach(([col, val]) => {
        if (val === undefined) return              // absent → keep
        if (cur[col] === val) return               // no change
        params.push(val)
        setParts.push(`"${col}" = $${params.length}`)
      })

      if (!setParts.length) { skip++; continue }   // nothing to change

      await cx.query(
        `UPDATE "VolumeActual"
         SET ${setParts.join(', ')}
         WHERE date=$1 AND hour=$2`,
        params
      )
      upd++
    }
    await cx.query('COMMIT')
    console.log(`Done. inserted=${ins}, updated=${upd}, skipped=${skip}`)
  } catch (err) {
    await cx.query('ROLLBACK')
    throw err
  } finally {
    cx.release(); await pool.end()
  }
}

main().catch(e => { console.error('❌', e); process.exit(1) })
