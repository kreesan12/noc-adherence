// server/routes/auth.js
import { Router }  from 'express'
import jwt         from 'jsonwebtoken'
import { hashPassword, passwordMatches } from '../lib/loginUsers.js'

const SECRET = process.env.JWT_SECRET || 'devsecret'

/* -------------------------------------------------------------------------- */
/*  🔐  Shared token-verify middleware                                         */
/* -------------------------------------------------------------------------- */
export function verifyToken (req, res, next) {
  const token = req.headers.authorization?.split(' ')[1]
  if (!token) return res.status(401).json({ error:'missing token' })
  try {
    req.user = jwt.verify(token, SECRET)
    next()
  } catch { res.status(401).json({ error:'invalid token' }) }
}

/* -------------------------------------------------------------------------- */
/*  Factory that needs Prisma injected                                         */
/* -------------------------------------------------------------------------- */
export default function authRoutesFactory (prisma) {
  const r = Router()

  /* ------------ POST /api/login ------------ */
  r.post('/login', async (req, res) => {
    const { email , password } = req.body

    /* 1️⃣  look in Supervisor  then Manager */
    const sup = await prisma.supervisor.findUnique({ where:{ email } })
    const man = sup ? null : await prisma.manager.findUnique({ where:{ email } })
    const user   = sup ?? man

    if (!user)
      return res.status(401).json({ error:'bad credentials' })

    /* 2️⃣  pick the hashed column name */
    const storedPassword = sup ? user.hash : user.password

    if (!passwordMatches(password, storedPassword))
      return res.status(401).json({ error:'bad credentials' })

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

    /* 3️⃣  issue token */
    const token = jwt.sign(
      { id:user.id, name:user.fullName, role:user.role, kind: sup ? 'supervisor' : 'manager' },
      SECRET,
      { expiresIn:'8h' }
    )
    res.json({ token })
  })

  /* ------------ GET /api/me --------------- */
  r.get('/me', verifyToken, (req,res)=>res.json(req.user))

  r.verifyToken = verifyToken    // convenience re-export
  return r
}
