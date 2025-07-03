// server/routes/auth.js
import { Router } from 'express'
import bcrypt      from 'bcryptjs'
import jwt         from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'devsecret'

/* -------------------------------------------------------------------------- */
/*  🔐  Helper middleware – reusable in any route file                         */
/* -------------------------------------------------------------------------- */
export function verifyToken (req, res, next) {
  const auth = req.headers.authorization?.split(' ')[1] || ''
  try {
    req.user = jwt.verify(auth, SECRET)   // payload → req.user
    next()
  } catch {
    res.status(401).json({ error:'invalid or missing token' })
  }
}

/* -------------------------------------------------------------------------- */
/*  Main auth router (/api/login, /api/me)                                    */
/* -------------------------------------------------------------------------- */
export default function authRoutesFactory (prisma) {
  const r = Router()

  /* ---------- POST /api/login ---------- */
  r.post('/login', async (req, res) => {
    const { email , password } = req.body
    const user = await prisma.supervisor.findUnique({ where:{ email } })

    if (!user || !user.hash || !bcrypt.compareSync(password, user.hash))
      return res.status(401).json({ error:'bad credentials' })

    const token = jwt.sign(
      { id:user.id, name:user.fullName, role:user.role },
      SECRET,
      { expiresIn:'8h' }
    )
    res.json({ token })
  })

  /* ---------- GET /api/me ---------- */
  r.get('/me', verifyToken, (req,res) => res.json(req.user))

  /* also expose middleware via router for convenience */
  r.verifyToken = verifyToken
  return r
}
