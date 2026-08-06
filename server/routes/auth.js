// server/routes/auth.js
import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { hashPassword, passwordMatches } from '../lib/loginUsers.js'
import { getJwtSecret } from '../lib/jwtSecret.js'

export function verifyToken(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error: 'missing token' })

  try {
    req.user = jwt.verify(token, getJwtSecret())
    next()
  } catch {
    res.status(401).json({ error: 'invalid token' })
  }
}

export default function authRoutesFactory(prisma) {
  const r = Router()

  r.post('/login', async (req, res) => {
    const { email, password } = req.body

    const sup = await prisma.supervisor.findUnique({ where: { email } })
    const man = sup ? null : await prisma.manager.findUnique({ where: { email } })
    const user = sup ?? man

    if (!user) {
      return res.status(401).json({ error: 'bad credentials' })
    }

    const storedPassword = sup ? user.hash : user.password

    if (!passwordMatches(password, storedPassword)) {
      return res.status(401).json({ error: 'bad credentials' })
    }

    if (!sup) {
      const nextPasswordValue = storedPassword === password
        ? hashPassword(password)
        : storedPassword

      await prisma.manager.update({
        where: { id: user.id },
        data: {
          password: nextPasswordValue,
          lastLogin: new Date()
        }
      })
    }

    const token = jwt.sign(
      { id: user.id, name: user.fullName, role: user.role, kind: sup ? 'supervisor' : 'manager' },
      getJwtSecret(),
      { expiresIn: '8h' }
    )

    res.json({ token })
  })

  r.get('/me', verifyToken, (req, res) => res.json(req.user))

  r.verifyToken = verifyToken
  return r
}
