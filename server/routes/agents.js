// server/routes/agents.js
import { Router } from 'express'
import { z }     from 'zod'

export default prisma => {
  const r = Router()

  // ⚙️ validation
  const AgentSchema = z.object({
    fullName:   z.string().min(2),
    email:      z.string().email(),
    role:       z.enum(['NOC-I','NOC-II','NOC-III']),
    standby:    z.boolean().optional().default(false)
  })

  // list (optional – nice for the UI)
  r.get('/', async (_req,res) => {
    const agents = await prisma.agent.findMany({ orderBy:{ id:'asc' } })
    res.json(agents)
  })

  // create
  r.post('/', async (req,res) => {
    const data = AgentSchema.parse(req.body)
    const exists = await prisma.agent.findUnique({ where:{ email:data.email } })
    if (exists) return res.status(400).json({ error:'email already in use' })

    const agent = await prisma.agent.create({
      data:{
        fullName:   data.fullName,
        email:      data.email,
        role:       data.role,
        standbyFlag:data.standby
      }
    })
    res.status(201).json(agent)
  })

  return r
}
