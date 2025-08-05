// server/routes/nlds.js
import { Router } from 'express'
import prisma from '../lib/prisma.js'
const r = Router()

r.get('/nlds.json', async (_,res) => {
  const spans = await prisma.circuit.findMany({
    select:{
      circuitId:true, nldGroup:true,
      nodeA:{ select:{ name:true, lat:true, lon:true }},
      nodeB:{ select:{ name:true, lat:true, lon:true }}
    },
    orderBy:[{ nldGroup:'asc' },{ circuitId:'asc' }]
  })
  res.json(spans)
})

export default r
