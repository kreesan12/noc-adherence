/**
 * Usage (local or Heroku one-off):
 *   node scripts/importMntAuto.js path/to/T1-hourly-workload-mnt-auto.csv
 *
 * The CSV must have headers:  date , hour , auto_mnt_solved
 * Columns that are blank / NaN are ignored (no update).
 */
import fs            from 'fs';
import { parse }     from 'csv-parse/sync';
import pg            from 'pg';
import dayjs         from 'dayjs';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) { console.error('Set DATABASE_URL'); process.exit(1); }

// ────────────────────────────────────────────────────────────
// helper – safe number (returns undefined for blank / NaN)
const n = v => { const x = Number(v); return isNaN(x) ? undefined : x; };

function loadCsv(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`CSV not found: ${filePath}`);
  return parse(fs.readFileSync(filePath, 'utf8'), {
    columns: true, skip_empty_lines: true, trim: true
  }).map(r => ({
    date : dayjs(r.date, ['M/D/YYYY', 'YYYY-MM-DD']).format('YYYY-MM-DD'),
    hour : +r.hour,
    val  : n(r.auto_mnt_solved)
  })).filter(r => r.val !== undefined);             // keep only rows with a value
}

async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) { console.error('Specify the mnt-auto CSV'); process.exit(1); }

  const rows = loadCsv(csvPath);
  console.log(`Loaded ${rows.length} rows with auto_mnt_solved`);

  const pool = new pg.Pool({ connectionString: DATABASE_URL,
                              ssl:{ rejectUnauthorized:false }});
  const cx   = await pool.connect();
  let upd = 0, ins = 0;

  try {
    await cx.query('BEGIN');

    for (const r of rows) {
      // update if the row exists and value differs
      const { rows: cur } = await cx.query(
        `SELECT "autoMntSolved"
           FROM "VolumeActual"
          WHERE date=$1 AND hour=$2`,
        [r.date, r.hour]
      );

      if (cur.length) {
        if (cur[0].autoMntSolved !== r.val) {
          await cx.query(
            `UPDATE "VolumeActual"
                SET "autoMntSolved" = $3
              WHERE date=$1 AND hour=$2`,
            [r.date, r.hour, r.val]
          );
          upd++;
        }
      } else {
        // insert minimal row so data isn’t lost
        await cx.query(
          `INSERT INTO "VolumeActual"
             (role,date,hour,priority1,auto_dfa_logged,
              auto_mnt_logged,auto_outage_linked,
              tickets,"autoMntSolved")
           VALUES ($1,$2,$3,0,0,0,0,0,$4)`,
          ['NOC Tier 1', r.date, r.hour, r.val]
        );
        ins++;
      }
    }

    await cx.query('COMMIT');
    console.log(`Finished. updated=${upd}, inserted=${ins}`);
  } catch (e) {
    await cx.query('ROLLBACK');
    throw e;
  } finally {
    cx.release();
    await pool.end();
  }
}

main().catch(e => { console.error('❌', e); process.exit(1); });
