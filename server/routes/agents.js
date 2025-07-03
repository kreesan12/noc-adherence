// server/routes/agents.js
import { Router } from 'express'
import bcrypt     from 'bcryptjs'

export default prisma => {
  const r = Router()

  // 1) list
  r.get('/', async (_req, res) => {
    const agents = await prisma.agent.findMany({ orderBy: { id: 'asc' } })
    res.json(agents)
  })

  // 2) create
  r.post('/', async (req, res) => {
    const { fullName, email, password = 'Password!23', role, phone } = req.body

    const exists = await prisma.agent.findUnique({ where: { email } })
    if (exists) return res.status(409).json({ error: 'Email already exists' })

    const agent = await prisma.agent.create({
      data: {
        fullName,
        email,
        phone,
        role,
        hash: bcrypt.hashSync(password, 10),
        standbyFlag: false
      }
    })
    res.status(201).json(agent)
  })

  return r
}
