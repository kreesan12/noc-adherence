// server/routes/engineering.js
import { Router } from 'express'
import prisma from '../lib/prisma.js'

function requireEngineering(req,res,next){
  if (req.user?.role !== 'engineering')
    return res.status(403).json({error:'Engineering role required'})
  next()
}

const r = Router()

/* ---------- read endpoints (public) ---------------------- */
r.get('/circuits', async (_,res) => {
  const circuits = await prisma.circuit.findMany({
    select:{
     id:true,circuitId:true,nodeA:true,nodeB:true,techType:true,
     currentRxSiteA:true,currentRxSiteB:true,updatedAt:true,
     nldGroup:true,
      _count:{
        select:{
          levelHistory:{
            where:{ reason:{ not:'initial import' } }
          }
        }
      }
   },
    orderBy:[{ nldGroup:'asc' },{ circuitId:'asc' }]
  })
  res.json(circuits)
})

r.get('/circuit/:id', async (req,res) => {
  const id = +req.params.id
  const c = await prisma.circuit.findUnique({
    where:{ id },
    include:{
      levelHistory:{ orderBy:{ changedAt:'desc' }, take:20 },
      lightEvents :{ orderBy:{ eventDate:'desc'  }, take:20 }
    }
  })
  if (!c) return res.sendStatus(404)
  res.json(c)
})

/* ---------- write endpoints (engineering only) ----------- */
r.post('/circuit/:id', requireEngineering, async (req,res) => {
  const id = +req.params.id
  const { currentRxSiteA, currentRxSiteB, reason='manual edit' } = req.body
  const updated = await prisma.circuit.update({
    where:{ id },
    data :{
      currentRxSiteA,currentRxSiteB,
      levelHistory:{
        create:{
          rxSiteA:currentRxSiteA,
          rxSiteB:currentRxSiteB,
          reason,
          source:'web ui',
          changedById:req.user.id
        }
      }
    }
  })
  res.json(updated)
})

r.post('/circuit/:id/comment', requireEngineering, async (req,res)=>{
  const id = +req.params.id
  const { comment } = req.body
  await prisma.circuitLevelHistory.create({
    data:{
      circuitId:id, reason:comment, source:'comment',
      changedById:req.user.id
    }
  })
  res.sendStatus(201)
})

// NEW: PATCH endpoint to update mapping fields like nldGroup
r.patch('/circuit/:id', requireEngineering, async (req,res) => {
  const id = +req.params.id

  // Whitelist fields you allow to be patched
  const allowed = [
    'nldGroup',
    'nodeALat','nodeALon','nodeBLat','nodeBLon',
    'currentRxSiteA','currentRxSiteB' // optional: if included, we’ll log history
  ]

  const data = {}
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      data[k] = req.body[k]
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No allowed fields provided to update' })
  }

  const addHistory = (
    Object.prototype.hasOwnProperty.call(req.body, 'currentRxSiteA') ||
    Object.prototype.hasOwnProperty.call(req.body, 'currentRxSiteB')
  )

  try {
    const updated = await prisma.circuit.update({
      where: { id },
      data: {
        ...data,
        ...(addHistory ? {
          levelHistory: {
            create: {
              rxSiteA: req.body.currentRxSiteA ?? undefined,
              rxSiteB: req.body.currentRxSiteB ?? undefined,
              reason: req.body.reason ?? 'manual edit (PATCH)',
              source: 'web ui',
              changedById: req.user.id
            }
          }
        } : {})
      },
      select: {
        id:true, circuitId:true, nldGroup:true,
        nodeALat:true,nodeALon:true,nodeBLat:true,nodeBLon:true,
        currentRxSiteA:true,currentRxSiteB:true, updatedAt:true
      }
    })
    res.json(updated)
  } catch (e) {
    // Prisma "record not found"
    if (e?.code === 'P2025') {
      return res.status(404).json({ error: 'Circuit not found' })
    }
    console.error(e)
    res.status(500).json({ error: 'Unexpected error' })
  }
})

export default r
