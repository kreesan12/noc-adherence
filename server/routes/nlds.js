// server/routes/nlds.js  – raw SQL version
import { Router } from 'express';
import prisma from '../lib/prisma.js';

const r = Router();

r.get('/nlds.json', async (_req, res) => {
  const rows = await prisma.$queryRaw`
    SELECT
      c."circuit_id" AS "circuitId",
      c."nld_group"  AS "nldGroup",
      na.name  AS "nodeAName", na.lat AS "nodeALat", na.lon AS "nodeALon",
      nb.name  AS "nodeBName", nb.lat AS "nodeBLat", nb.lon AS "nodeBLon"
    FROM "Circuit" c
    JOIN "Node" na ON na.id = c.node_a_id
    JOIN "Node" nb ON nb.id = c.node_b_id
    ORDER BY c."nld_group", c."circuit_id";
  `;

  res.json(rows.map(r => ({
    circuitId: r.circuitId,
    nldGroup : r.nldGroup,
    nodeA: { name: r.nodeAName, lat: r.nodeALat, lon: r.nodeALon },
    nodeB: { name: r.nodeBName, lat: r.nodeBLat, lon: r.nodeBLon },
  })));
});

export default r;
