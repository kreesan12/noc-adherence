/**
 * scripts/importVolumes/index.js
 * ------------------------------------------------------------
 * 1.  Pull yesterday’s Explore “hourly workload” e-mail from Gmail
 * 2.  Accept either a raw CSV or a ZIP containing one CSV
 * 3.  Parse columns  date | hour | priority1 | autoDfa | autoMnt | autoOutage
 * 4.  UPSERT into dbo.VolumeActual  (key = date + hour)
 * ------------------------------------------------------------
 */
import { google } from 'googleapis';
import { parse } from 'csv-parse/sync';
import AdmZip from 'adm-zip';
import pg from 'pg';
import dayjs from 'dayjs';

// ─── environment ────────────────────────────────────────────
const {
  CLIENT_ID,
  CLIENT_SECRET,
  REFRESH_TOKEN,
  DATABASE_URL,
} = process.env;

// ─── 1. gmail helper (refresh-token auth) ───────────────────
async function gmailClient() {
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  auth.setCredentials({ refresh_token: REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth });
}

// ─── 2. download yesterday’s attachment (CSV or ZIP) ────────
async function downloadCsv(gmail) {
  const y      = dayjs().subtract(1, 'day').format('YYYY/MM/DD');
  /* Gmail query:
     • after: filters to messages received yesterday or later
     • subject: matches the exact daily report subject (ignore the “Fw:” prefix;
       Gmail still finds it)
  */
  const search = `subject:"Your delivery of T1 - hourly workload P1" after:${y}`;

  const { data: { messages } } = await gmail.users.messages.list({
    userId: 'me',
    q: search,
    maxResults: 1,
  });
  if (!messages?.length) throw new Error('No matching e-mail yet');

  const { data: msg } = await gmail.users.messages.get({
    userId: 'me',
    id: messages[0].id,
  });

  const part = msg.payload.parts.find(p => /\.csv$|\.zip$/i.test(p.filename));
  if (!part) throw new Error('No CSV or ZIP attachment found');

  const { data: { data: b64 } } = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: msg.id,
    id: part.body.attachmentId,
  });

  const bin = Buffer.from(b64, 'base64');

  // unzip if needed
  let csvText;
  if (part.filename.toLowerCase().endsWith('.zip')) {
    const zip   = new AdmZip(bin);
    const entry = zip.getEntries().find(e => e.entryName.endsWith('.csv'));
    if (!entry) throw new Error('ZIP contained no *.csv');
    csvText = entry.getData().toString('utf8');
  } else {
    csvText = bin.toString('utf8');
  }

  return csvText;
}

// ─── 3. upsert into dbo.VolumeActual ────────────────────────
async function upsert(csv) {
  const rows  = parse(csv, { columns: true, skip_empty_lines: true });
  const pool  = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }     // Heroku: accept their wildcard cert
  });
  const cx    = await pool.connect();

  /*  !! make sure you have a UNIQUE index !!
      CREATE UNIQUE INDEX volumeactual_uk
      ON "VolumeActual"(date, hour);
  */

  const sql = `
    INSERT INTO "VolumeActual" (
      role,
      date,
      hour,
      priority1,
      auto_dfa_logged,
      auto_mnt_logged,
      auto_outage_linked
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (date, hour)
    DO UPDATE SET
      priority1          = EXCLUDED.priority1,
      auto_dfa_logged    = EXCLUDED.auto_dfa_logged,
      auto_mnt_logged    = EXCLUDED.auto_mnt_logged,
      auto_outage_linked = EXCLUDED.auto_outage_linked;
  `;

  try {
    await cx.query('BEGIN');

    for (const r of rows) {
      const isoDate = dayjs(r.date, ['M/D/YYYY', 'YYYY-MM-DD'])
        .format('YYYY-MM-DD');            // normalise 7/20/2025 → 2025-07-20

      await cx.query(sql, [
        'NOC',                            // role  – constant, adjust if needed
        isoDate,
        Number(r.hour),
        Number(r.priority1),
        Number(r.autoDfa       ?? 0),
        Number(r.autoMnt       ?? 0),
        Number(r.autoOutage    ?? 0),
      ]);
    }

    await cx.query('COMMIT');
  } catch (err) {
    await cx.query('ROLLBACK');
    throw err;
  } finally {
    cx.release();
  }
}

// ─── 4. main ────────────────────────────────────────────────
(async () => {
  try {
    const gmail = await gmailClient();
    const csv   = await downloadCsv(gmail);
    await upsert(csv);

    console.log(
      'Imported workload for',
      dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
    );
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  }
})();
