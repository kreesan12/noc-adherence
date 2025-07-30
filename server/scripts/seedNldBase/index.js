#!/usr/bin/env node
// ------------------------------------------------------------
// Seed the Circuit + CircuitLevelHistory tables from the
// engineering workbook.
//
// Usage:
//   heroku run -- node scripts/seedNldBase/index.js 
// ------------------------------------------------------------
import xlsx from 'xlsx';
import pg   from 'pg';
import path from 'node:path';
import fs   from 'node:fs/promises';

/* ── CLI arg & file check ────────────────────────────────── */
const wbPath = process.argv[2];
if (!wbPath) { console.error('xlsx file required'); process.exit(1); }
if (!await fs.stat(wbPath).catch(() => null)) {
  console.error('file not found:', wbPath); process.exit(1);
}

/* ── Load workbook ───────────────────────────────────────── */
const wb   = xlsx.readFile(wbPath);

/* ── Postgres pool ───────────────────────────────────────── */
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const cx = await pool.connect();
await cx.query('BEGIN');

/* ── Helper: keep *last* row per circuit in each sheet ───── */
function lastRows(sheetName) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]);
  const m    = new Map();                         // key = Link Circuit
  for (const r of rows) m.set(r['Link Circuit'], { sheet: sheetName, ...r });
  return [...m.values()];                         // last occurrence wins
}

const circuits = [
  ...lastRows('EDFA'),
  ...lastRows('RAMAN')
];

/* ── Upsert each circuit ─────────────────────────────────── */
for (const r of circuits) {
  const circuitCode = (r['Link Circuit'] || '').trim();
  if (!circuitCode) {                             // skip junk / subtotal rows
    console.warn('⚠︎ skipped row with empty "Link Circuit"', r);
    continue;
  }

  const rxA = parseFloat(r['OSC RX Site A']  || r['RAMAN OSC RX Site A']);
  const rxB = parseFloat(r['OSC RX Site B']  || r['RAMAN OSC RX Site B']);
  const tech = r.sheet === 'EDFA' ? 'EDFA' : 'RAMAN';

  // upsert into Circuit
  const { rows: [{ id: circuitId }] } = await cx.query(
    `INSERT INTO "Circuit"
       (circuit_id, node_a, node_b, tech_type,
        current_rx_site_a, current_rx_site_b)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (circuit_id) DO UPDATE SET
       tech_type=$4,
       current_rx_site_a=$5,
       current_rx_site_b=$6
     RETURNING id`,
    [circuitCode, r['Node A'], r['Node B'], tech, rxA, rxB]
  );

  // write to history
  await cx.query(
    `INSERT INTO "CircuitLevelHistory"
       (circuit_id, rx_site_a, rx_site_b, reason, source)
     VALUES ($1,$2,$3,'initial import',$4)`,
    [circuitId, rxA, rxB, path.basename(wbPath)]
  );
}

await cx.query('COMMIT');
cx.release();
console.log(`Seeded ${circuits.length} circuits ✔︎`);
