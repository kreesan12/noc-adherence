import { Router } from 'express'
import bcrypt from 'bcryptjs'

export default prisma => {
  const r = Router()

  // GET /api/supervisors
  r.get('/', async (req, res, next) => {
    try {
      const supervisors = await prisma.supervisor.findMany({
        select: { id: true, fullName: true, email: true, role: true }
      })
      res.json(supervisors)
    } catch (err) { next(err) }
  })

  // POST /api/supervisors { fullName, email, password }
  r.post('/', async (req, res, next) => {
    try {
      const { fullName, email, password } = req.body
      if (!fullName || !email || !password) {
        return res.status(400).json({ error: 'fullName, email & password are required' })
      }
      const hash = bcrypt.hashSync(password, 10)
      const sup  = await prisma.supervisor.create({
        data: { fullName, email, hash }
      })
      // don't send the hash back
      res.status(201).json({
        id: sup.id,
        fullName: sup.fullName,
        email: sup.email,
        role: sup.role
      })
    } catch (err) {
      // unique‐email violation will come through here
      next(err)
    }
  })

  return r
}
