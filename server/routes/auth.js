import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

export default prisma => {
  const r = Router()

  // login
  r.post('/login', async (req, res) => {
    const { email, password } = req.body
    const user = await prisma.agent.findUnique({ where:{ email } })
    if (!user || !user.hash ||
        !bcrypt.compareSync(password, user.hash))
      return res.status(401).json({ error:'bad credentials' })
    const token = jwt.sign(
      { id:user.id, name:user.fullName, role:'supervisor' },
      process.env.JWT_SECRET, { expiresIn:'8h' })
    res.json({ token })
  })

  return r
}
