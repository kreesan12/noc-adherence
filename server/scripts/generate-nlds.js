// server/scripts/generate-nlds.js
import pg from 'pg';
import fs from 'node:fs/promises';
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl:{rejectUnauthorized:false} });

const { rows } = await pool.query(`
  SELECT circuit_id      AS "circuitId",
         nld_group       AS "nldGroup",
         node_a_name     AS "nodeAName",
         node_a_lat      AS "nodeALat",
         node_a_lon      AS "nodeALon",
         node_b_name     AS "nodeBName",
         node_b_lat      AS "nodeBLat",
         node_b_lon      AS "nodeBLon"
    FROM "Circuit"
  ORDER BY nld_group, circuit_id;
`);

const spans = rows.map(r => ({
  nldGroup : r.nldGroup,
  circuitId: r.circuitId,
  nodeA    : { name:r.nodeAName, lat:r.nodeALat, lon:r.nodeALon },
  nodeB    : { name:r.nodeBName, lat:r.nodeBLat, lon:r.nodeBLon }
}));

const outPath = new URL('../src/data/nlds.json', import.meta.url);
await fs.mkdir(new URL('../src/data', import.meta.url), { recursive:true });
await fs.writeFile(outPath, JSON.stringify(spans, null, 2));
console.log(`✅  nlds.json generated (${spans.length} spans)`);
await pool.end();
