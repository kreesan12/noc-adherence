// server/routes/techAuth.js
import { Router } from 'express'
import jwt from 'jsonwebtoken'

const SECRET = process.env.JWT_SECRET || 'devsecret'

export default function techAuthRoutes(prisma) {
  const r = Router()

  r.post('/tech/login', async (req, res) => {
    const { phone, pin } = req.body || {}
    if (!phone) return res.status(400).json({ error: 'phone is required' })
    if (!pin) return res.status(400).json({ error: 'pin is required' })

    const expected = process.env.TECH_SHARED_PIN || '1234'
    if (String(pin) !== String(expected)) {
      return res.status(401).json({ error: 'bad credentials' })
    }

    const tech = await prisma.technician.findFirst({
      where: { phone: String(phone), isActive: true }
    })

    if (!tech) return res.status(401).json({ error: 'unknown technician' })

    const token = jwt.sign(
      { id: tech.id, name: tech.name, role: 'tech' },
      SECRET,
      { expiresIn: '30d' }
    )

    res.json({ token, tech: { id: tech.id, name: tech.name } })
  })

  return r
}
