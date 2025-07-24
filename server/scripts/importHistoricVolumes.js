/**
 * scripts/importHistoricVolumes.js
 * ------------------------------------------------------------------
 * Usage:
 *   node scripts/importHistoricVolumes.js \
 *     path/to/T1-hourly-workload.csv \
 *     path/to/T1-hourly-workload-updates.csv \
 *     path/to/T1-hourly-workload-mnt-auto.csv
 *
 * Expects DATABASE_URL env-var.
 */
import fs    from 'fs';
import pg    from 'pg';
import dayjs from 'dayjs';
import { parse } from 'csv-parse/sync';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) {
  console.error('ERROR: set DATABASE_URL'); process.exit(1);
}

/* ───────────────────────── helpers ───────────────────────────── */
// Helper ──────────────────────────────────────────────────────────
// args[0] = main   (hourly workload)
// args[1] = updates
// args[2] = mnt-auto
function loadCsvs ([ mainPath, updPath, mntPath ]) {
  if (!mainPath || !updPath || !mntPath) {
    throw new Error('Need three CSV paths: main, updates, mnt-auto')
  }
  // verify they exist inside the dyno
  [mainPath, updPath, mntPath].forEach(p => {
    if (!fs.existsSync(p)) throw new Error(`File not found: ${p}`)
  })

  const parserOpts = {
    columns: h => h.trim(),
    skip_empty_lines: true,
    trim: true
  }

  const mainRows = parse(fs.readFileSync(mainPath, 'utf8'), parserOpts)
  const updRows  = parse(fs.readFileSync(updPath , 'utf8'), parserOpts)
  const mntRows  = parse(fs.readFileSync(mntPath , 'utf8'), parserOpts)

  /* ---------- build the lookup maps exactly as before ---------- */
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

  /* ---------- merge into one map keyed by date|hour ------------ */
  const recordMap = new Map()
  mainRows.forEach(r => {
    const date = dayjs(r.date, ['M/D/YYYY','YYYY-MM-DD']).format('YYYY-MM-DD')
    const hour = +r.hour
    const key  = `${date}|${hour}`

    recordMap.set(key, {
      date,
      hour,
      priority1        : +r.priority1,
      autoDfaLogged    : +r.autoDfa    || 0,
      autoMntLogged    : +r.autoMnt    || 0,
      autoOutageLinked : +r.autoOutage || 0,
      tickets          : ticketsMap.get(key)   ?? null,
      autoMntSolved    : mntSolvedMap.get(key) ?? null
    })
  })

  return recordMap
}

/* ───────────────────────── main import ──────────────────────── */
async function main() {
  const args = process.argv.slice(2);
  if (args.length!==3) {
    console.error('Usage: node importHistoricVolumes.js main.csv updates.csv mnt-auto.csv');
    process.exit(1);
  }

  const rows = loadCsvs(args);
  console.log(`Loaded ${rows.size} distinct (date,hour) rows`);

  const pool = new pg.Pool({ connectionString: DATABASE_URL,
                             ssl:{rejectUnauthorized:false} });
  const cx   = await pool.connect();
  let ins=0, upd=0, skip=0;

  try {
    await cx.query('BEGIN');

    for (const r of rows.values()) {
      const { rows:exist } = await cx.query(
        `SELECT tickets FROM "VolumeActual"
         WHERE date=$1 AND hour=$2`, [r.date,r.hour]);

      if (!exist.length) {
        /* INSERT – coerce tickets null→0 */
        await cx.query(`
          INSERT INTO "VolumeActual"
            (role,date,hour,priority1,auto_dfa_logged,
             auto_mnt_logged,auto_outage_linked,tickets,"autoMntSolved")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          ['NOC Tier 1', r.date,r.hour,
           r.priority1, r.autoDfaLogged,r.autoMntLogged,r.autoOutageLinked,
           (r.tickets??0), r.autoMntSolved]);
        ins++; continue;
      }

      /* UPDATE — only change tickets if new value is not null */
      const newTickets = (r.tickets===null || isNaN(r.tickets))
                          ? exist[0].tickets   // keep old
                          : r.tickets;

      /* detect no-change */
      if (exist[0].tickets===newTickets &&
          exist[0].priority1      === r.priority1 &&
          exist[0].auto_dfa_logged=== r.autoDfaLogged &&
          exist[0].auto_mnt_logged=== r.autoMntLogged &&
          exist[0].auto_outage_linked === r.autoOutageLinked &&
          exist[0].autoMntSolved  === r.autoMntSolved) { skip++; continue; }

      await cx.query(`
        UPDATE "VolumeActual" SET
          priority1          = $3,
          auto_dfa_logged    = $4,
          auto_mnt_logged    = $5,
          auto_outage_linked = $6,
          tickets            = $7,
          "autoMntSolved"    = $8
        WHERE date=$1 AND hour=$2`,
        [r.date,r.hour,
         r.priority1,r.autoDfaLogged,r.autoMntLogged,r.autoOutageLinked,
         newTickets,r.autoMntSolved]);
      upd++;
    }

    await cx.query('COMMIT');
    console.log(`Done. inserted=${ins}, updated=${upd}, skipped=${skip}`);
  } catch(e){
    await cx.query('ROLLBACK'); throw e;
  } finally { cx.release(); await pool.end(); }
}

main().catch(e=>{console.error(e); process.exit(1);});
