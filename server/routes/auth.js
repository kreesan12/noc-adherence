// server/routes/auth.js
import { Router } from 'express'
import bcrypt       from 'bcryptjs'
import jwt          from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'devsecret'

export default prisma => {
  const r = Router()

  /* ---------------------------- helper middleware --------------------------- */
  /**  Verifies Bearer token; attaches payload to req.user or 401’s. */
  function verifyToken (req, res, next) {
    const auth = req.headers.authorization?.split(' ')[1]
    try {
      req.user = jwt.verify(auth || '', SECRET)
      next()
    } catch {
      res.status(401).json({ error: 'invalid or missing token' })
    }
  }

  /* --------------------------------- login --------------------------------- */
  // POST /api/login { email, password }
  r.post('/login', async (req, res) => {
    const { email, password } = req.body
    const user = await prisma.supervisor.findUnique({ where: { email } })

    if (!user || !user.hash || !bcrypt.compareSync(password, user.hash)) {
      return res.status(401).json({ error: 'bad credentials' })
    }

    const token = jwt.sign(
      { id: user.id, name: user.fullName, role: user.role },
      SECRET,
      { expiresIn: '8h' }
    )
    res.json({ token })
  })

  /* ---------------------------------- me ----------------------------------- */
  // GET /api/me  – handy for the SPA to confirm & refresh session
  r.get('/me', verifyToken, (req, res) => {
    res.json(req.user)          // payload = { id, name, role, iat, exp }
  })

  // Export middleware so other route files can `verifyToken` too
  r.verifyToken = verifyToken
  return r
}
