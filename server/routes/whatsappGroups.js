import { Router } from 'express'
import prisma from '../lib/prisma.js'

export default function whatsappGroupsRouter() {
  const r = Router()

  r.get('/', async (req, res) => {
    const q = String(req.query.q || '').trim()
    const limit = Math.min(Math.max(Number(req.query.limit || 100) || 100, 1), 300)

    const rows = await prisma.whatsAppGroupDirectory.findMany({
      where: q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { jid: { contains: q, mode: 'insensitive' } }
            ]
          }
        : undefined,
      orderBy: [
        { name: 'asc' }
      ],
      take: limit
    })

    res.json({ rows })
  })

  return r
}
