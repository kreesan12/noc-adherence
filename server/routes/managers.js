// server/routes/managers.js
import { Router } from 'express'
export default function managersRouter (prisma) {
  const r = Router()

  // list
  r.get('/', async (_,res)=> res.json(await prisma.manager.findMany()))

  // create (only admins)
  r.post('/', async (req,res)=>{
    if (req.user.role !== 'admin') return res.sendStatus(403)
    const { fullName,email,password,role='manager' } = req.body
    const row = await prisma.manager.create({ data:{ fullName,email,password,role } })
    res.status(201).json(row)
  })

  // other CRUD as needed…
  return r
}
