import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const r = Router()

// GET /nodes.json?q=isa
r.get('/nodes.json', async (req, res, next) => {
  try {
    const q = (req.query.q || '').toString().trim()
    const take = Math.min(Number(req.query.take || 30), 100)

    const where = q
      ? { OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { code: { contains: q, mode: 'insensitive' } },
        ] }
      : {}

    const nodes = await prisma.node.findMany({
      where,
      select: { code: true, name: true, nldGroup: true, lat: true, lon: true },
      orderBy: [{ name: 'asc' }],
      take,
    })
    res.json(nodes)
  } catch (e) { next(e) }
})

export default r
