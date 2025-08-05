// server/routes/nlds.js  – raw SQL version
import { Router } from 'express';
import prisma from '../lib/prisma.js';

const r = Router();

r.get('/nlds.json', async (_req, res) => {
  const spans = await prisma.circuit.findMany({
    select: {
      circuitId: true,
      nldGroup : true,
      nodeA    : true,
      nodeB    : true,
      nodeALat : true,
      nodeALon : true,
      nodeBLat : true,
      nodeBLon : true,
    },
    orderBy: [{ nldGroup: 'asc' }, { circuitId: 'asc' }],
  });

  res.json(spans.map(s => ({
    circuitId: s.circuitId,
    nldGroup : s.nldGroup,
    nodeA: { name: s.nodeA, lat: s.nodeALat, lon: s.nodeALon },
    nodeB: { name: s.nodeB, lat: s.nodeBLat, lon: s.nodeBLon },
  })));
});


export default r;
