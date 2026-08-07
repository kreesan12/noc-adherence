import { Router } from 'express'
import { z } from 'zod'
import { hashPassword } from '../lib/loginUsers.js'
import { detachManagerReferences } from '../lib/loginUserLifecycle.js'

const createSchema = z.object({
  fullName: z.string().trim().min(2),
  email: z.string().trim().email(),
  password: z.string().trim().min(8),
  role: z.enum(['manager', 'engineering']).default('manager')
})

export default function managersRouter (prisma) {
  const r = Router()

  r.get('/', async (_req, res) => {
    const rows = await prisma.manager.findMany({
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        lastLogin: true
      },
      orderBy: [{ fullName: 'asc' }, { email: 'asc' }]
    })
    res.json(rows)
  })

  r.post('/', async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403)

    const parsed = createSchema.parse(req.body || {})
    const email = parsed.email.trim().toLowerCase()

    const row = await prisma.manager.create({
      data: {
        fullName: parsed.fullName.trim(),
        email,
        password: hashPassword(parsed.password),
        role: parsed.role
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        createdAt: true,
        lastLogin: true
      }
    })

    res.status(201).json(row)
  })

  r.delete('/:id', async (req, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403)

    const id = Number(req.params.id)
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid manager id' })

    await prisma.$transaction(async (tx) => {
      await detachManagerReferences(tx, id)
      await tx.manager.delete({ where: { id } })
    })
    res.status(204).end()
  })

  return r
}
