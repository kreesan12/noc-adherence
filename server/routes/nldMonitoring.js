import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'
import { syncStagedZendeskTickets } from '../lib/nldTicketStaging.js'

const r = Router()

function requireEngineering(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase()
  if (!['engineering', 'admin', 'manager'].includes(role)) {
    return res.status(403).json({ error: 'Engineering, admin, or manager role required' })
  }
  next()
}

function toTake(value, fallback = 100, max = 500) {
  return Math.min(Math.max(Number(value) || fallback, 1), max)
}

r.get('/engineering/blank-rx-issues', verifyToken, requireEngineering, async (req, res) => {
  const q = String(req.query.q || '').trim()
  const skip = Math.max(Number(req.query.skip) || 0, 0)
  const take = toTake(req.query.take, 100, 500)

  const where = q ? {
    OR: [
      { parsedCode: { contains: q, mode: 'insensitive' } },
      { mnemonic: { contains: q, mode: 'insensitive' } },
      { routerName: { contains: q, mode: 'insensitive' } },
      { circuit: { circuitId: { contains: q, mode: 'insensitive' } } },
      { circuit: { nodeA: { contains: q, mode: 'insensitive' } } },
      { circuit: { nodeB: { contains: q, mode: 'insensitive' } } },
      { circuit: { nldGroup: { contains: q, mode: 'insensitive' } } }
    ]
  } : undefined

  const [items, total] = await Promise.all([
    prisma.blankDailyLightIssue.findMany({
      where,
      orderBy: [{ sampleTime: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
      include: {
        circuit: {
          select: {
            id: true,
            circuitId: true,
            nodeA: true,
            nodeB: true,
            nldGroup: true
          }
        }
      }
    }),
    prisma.blankDailyLightIssue.count({ where })
  ])

  res.json({ items, total })
})

r.post('/engineering/staged-zendesk-tickets/sync', verifyToken, requireEngineering, async (_req, res) => {
  const summary = await syncStagedZendeskTickets(prisma)
  res.json(summary)
})

r.get('/engineering/staged-zendesk-tickets', verifyToken, requireEngineering, async (req, res) => {
  const q = String(req.query.q || '').trim()
  const priority = String(req.query.priority || '').trim().toLowerCase()
  const status = String(req.query.status || '').trim().toUpperCase()
  const skip = Math.max(Number(req.query.skip) || 0, 0)
  const take = toTake(req.query.take, 100, 500)

  const and = []

  if (priority) and.push({ priority })
  if (status) and.push({ status })
  if (q) {
    and.push({
      OR: [
        { reference: { contains: q, mode: 'insensitive' } },
        { subject: { contains: q, mode: 'insensitive' } },
        { circuit: { circuitId: { contains: q, mode: 'insensitive' } } },
        { circuit: { nodeA: { contains: q, mode: 'insensitive' } } },
        { circuit: { nodeB: { contains: q, mode: 'insensitive' } } },
        { circuit: { nldGroup: { contains: q, mode: 'insensitive' } } }
      ]
    })
  }

  const where = and.length ? { AND: and } : undefined

  const [items, total] = await Promise.all([
    prisma.stagedZendeskTicket.findMany({
      where,
      orderBy: [{ priority: 'asc' }, { updatedAt: 'desc' }],
      skip,
      take,
      include: {
        circuit: {
          select: {
            id: true,
            circuitId: true,
            nodeA: true,
            nodeB: true,
            nldGroup: true
          }
        },
        comments: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    }),
    prisma.stagedZendeskTicket.count({ where })
  ])

  res.json({ items, total })
})

export default r
