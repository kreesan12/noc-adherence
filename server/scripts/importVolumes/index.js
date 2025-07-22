/**
 * scripts/importVolumes/index.js
 * ------------------------------------------------------------
 * 1.  Pull yesterday’s Explore “hourly workload” e-mail from Gmail
 * 2.  Accept either raw CSVs or a ZIP containing multiple CSVs
 * 3.  Parse
 *       • T1 - hourly workload (DB extract)……………… date | hour | priority1 | autoDfa | autoMnt | autoOutage
 *       • T1 - hourly workload updates - total…… date | hour | tickets
 * 4.  UPSERT into dbo.VolumeActual  (key = date + hour)
 *       Columns: role | date | hour | priority1 | auto_dfa_logged |
 *                auto_mnt_logged | auto_outage_linked | tickets
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

// ─── 2. download yesterday’s attachments (CSV / ZIP) ───────
async function downloadCsvs(gmail) {
  const y = dayjs().subtract(1, 'day').format('YYYY/MM/DD');

  const query =
    `subject:"Your delivery of T1 - hourly workload P1" after:${y}`;

  const { data: { messages } } = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 1,
  });
  if (!messages?.length) throw new Error('No matching e-mail yet');

  const { data: msg } = await gmail.users.messages.get({
    userId: 'me',
    id: messages[0].id,
  });

  const parts = msg.payload.parts?.filter(
    p => /\.csv$|\.zip$/i.test(p.filename),
  ) ?? [];
  if (!parts.length) throw new Error('No CSV or ZIP attachment found');

  const csvMap = new Map();          // filename => csv text

  // helper: fetch attachment binary
  async function fetchAttachment(part) {
    const { data: { data: b64 } } =
      await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId: msg.id,
        id: part.body.attachmentId,
      });
    return Buffer.from(b64, 'base64');
  }

  for (const part of parts) {
    const bin = await fetchAttachment(part);

    if (part.filename.toLowerCase().endsWith('.zip')) {
      const zip = new AdmZip(bin);
      zip.getEntries()
        .filter(e => e.entryName.toLowerCase().endsWith('.csv'))
        .forEach(e =>
          csvMap.set(e.entryName, e.getData().toString('utf8')),
        );
    } else {
      csvMap.set(part.filename, bin.toString('utf8'));
    }
  }

  return csvMap;                     // Map<string, string>
}

// ─── 3. upsert into dbo.VolumeActual ────────────────────────
async function upsert(csvMap) {
  // identify files (fallback to first / second in map if names vary)
  const mainName    =
    [...csvMap.keys()].find(n => /hourly workload[^u].*\.csv/i.test(n))
    ?? [...csvMap.keys()][0];

  const updatesName =
    [...csvMap.keys()].find(n => /updates.*\.csv/i.test(n))
    ?? [...csvMap.keys()][1];

  if (!mainName) throw new Error('Could not locate primary workload CSV');
  if (!updatesName) console.warn('⚠️  No “updates” CSV found – tickets left null');

  const mainRows    = parse(csvMap.get(mainName),    { columns: true, skip_empty_lines: true });
  const updatesRows = updatesName
    ? parse(csvMap.get(updatesName), { columns: true, skip_empty_lines: true })
    : [];

  // map date+hour → tickets
  const ticketMap = new Map();
  for (const r of updatesRows) {
    const iso = dayjs(r.date, ['M/D/YYYY', 'YYYY-MM-DD'])
      .format('YYYY-MM-DD');
    ticketMap.set(`${iso}|${Number(r.hour)}`, Number(r.tickets));
  }

  const pool = new pg.Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },   // Heroku wildcard cert
  });
  const cx = await pool.connect();

  /* Ensure UNIQUE index exists:
     CREATE UNIQUE INDEX volumeactual_uk ON "VolumeActual"(date, hour);
  */

  const sql = `
    INSERT INTO "VolumeActual" (
      role,
      date,
      hour,
      priority1,
      auto_dfa_logged,
      auto_mnt_logged,
      auto_outage_linked,
      tickets
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    ON CONFLICT (date, hour)
    DO UPDATE SET
      priority1          = EXCLUDED.priority1,
      auto_dfa_logged    = EXCLUDED.auto_dfa_logged,
      auto_mnt_logged    = EXCLUDED.auto_mnt_logged,
      auto_outage_linked = EXCLUDED.auto_outage_linked,
      tickets            = COALESCE(EXCLUDED.tickets, "VolumeActual".tickets);
  `;

  try {
    await cx.query('BEGIN');

    for (const r of mainRows) {
      const isoDate = dayjs(r.date, ['M/D/YYYY', 'YYYY-MM-DD'])
        .format('YYYY-MM-DD');
      const hour    = Number(r.hour);
      const tKey    = `${isoDate}|${hour}`;
      const tickets = ticketMap.get(tKey) ?? null;   // preserve null if no match

      await cx.query(sql, [
        'NOC Tier 1',                     // role – adjust if needed
        isoDate,
        hour,
        Number(r.priority1),
        Number(r.autoDfa    ?? 0),
        Number(r.autoMnt    ?? 0),
        Number(r.autoOutage ?? 0),
        tickets,
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
    const gmail  = await gmailClient();
    const csvMap = await downloadCsvs(gmail);
    await upsert(csvMap);

    console.log(
      'Imported workload for',
      dayjs().subtract(1, 'day').format('YYYY-MM-DD'),
    );
  } catch (err) {
    console.error('Import failed:', err.message);
    process.exitCode = 1;
  }
})();
