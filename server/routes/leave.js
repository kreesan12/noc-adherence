import { Router } from 'express'
import dayjs      from '../utils/dayjs.js'
export default prisma=>{
  const r=Router()

  r.post('/', async(req,res)=>{
    const { agentId, reason, startsAt, endsAt } = req.body
    if(!agentId||!startsAt||!endsAt) return res.status(400).json({error:'bad payload'})
    const leave = await prisma.leave.create({
      data:{
        agentId,
        reason:reason||'planned',
        startsAt:new Date(startsAt),
        endsAt  :new Date(endsAt),
        createdBy:req.user?.email??'system'
      }
    })
    res.json(leave)
  })

  r.get('/', async(req,res)=>{
    const { from, to, agentId } = req.query
    const where = {
      ...(agentId && {agentId:Number(agentId)}),
      ...(from&&to && { startsAt:{ gte:dayjs(from).toDate() }, endsAt:{ lte:dayjs(to).toDate() } })
    }
    const data = await prisma.leave.findMany({
    where,
    include: { agent: true }
    })
    res.json(data)
  })

  return r
}
