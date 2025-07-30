#!/usr/bin/env node
// Seed circuits from the workbook supplied by engineering.
// Usage: heroku run -- node scripts/seedNldBase/index.js path/to/ADVA-OSC-Tracking.xlsx
import xlsx from 'xlsx'
import pg   from 'pg'
import path from 'node:path'
import fs   from 'node:fs/promises'

const wbPath = process.argv[2]
if (!wbPath) { console.error('xlsx file required'); process.exit(1) }
if (!await fs.stat(wbPath).catch(() => null)) {
  console.error('file not found:', wbPath); process.exit(1)
}

const wb       = xlsx.readFile(wbPath)
const pool     = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:{ rejectUnauthorized:false }
})
const cx = await pool.connect()
await cx.query('BEGIN')

function lastRows(sheetName) {
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[sheetName])
  const m    = new Map()
  for (const r of rows) m.set(r['Link Circuit'], { sheet:sheetName, ...r })
  return [...m.values()]            // last occurrence wins
}

const circuits = [...lastRows('EDFA'), ...lastRows('RAMAN')]

for (const r of circuits) {
  const rxA = parseFloat(r['OSC RX Site A'] || r['RAMAN OSC RX Site A'])
  const rxB = parseFloat(r['OSC RX Site B'] || r['RAMAN OSC RX Site B'])
  const sheetType = r.sheet === 'EDFA' ? 'EDFA' : 'RAMAN'

  // Upsert into Circuit
  const res = await cx.query(
    `INSERT INTO "Circuit"
       (circuit_id,node_a,node_b,tech_type,current_rx_site_a,current_rx_site_b)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (circuit_id) DO UPDATE SET
       tech_type=$4,current_rx_site_a=$5,current_rx_site_b=$6
     RETURNING id`,
    [r['Link Circuit'], r['Node A'], r['Node B'], sheetType, rxA, rxB]
  )
  const circuitId = res.rows[0].id

  // Add to history
  await cx.query(
    `INSERT INTO "CircuitLevelHistory"
       (circuit_id,rx_site_a,rx_site_b,reason,source)
     VALUES ($1,$2,$3,$4,$5)`,
    [circuitId, rxA, rxB, 'initial import', path.basename(wbPath)]
  )
}

await cx.query('COMMIT')
cx.release()
console.log(`Seeded ${circuits.length} circuits`)
