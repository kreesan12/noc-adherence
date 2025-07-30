import { Router } from 'express'
import prisma     from '../db.js'      // your Prisma / pg instance

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
      currentRxSiteA:true,currentRxSiteB:true,updatedAt:true
    }, orderBy:{ circuitId:'asc' }
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

export default r
