import { Router } from 'express'
import { z } from 'zod'

export default prisma => {
  const r = Router()

  // GET /api/overtime/periods
  r.get('/periods', async (req, res) => {
    const rows = await prisma.overtimePeriod.findMany({ orderBy: { startDate: 'desc' } })
    res.json(rows)
  })

  // GET /api/overtime/entries?periodId=1&agentId=2&status=...
  r.get('/entries', async (req, res) => {
    const periodId = req.query.periodId ? Number(req.query.periodId) : undefined
    const agentId = req.query.agentId ? Number(req.query.agentId) : undefined
    const status = req.query.status || undefined
    const supervisorId = req.query.supervisorId ? Number(req.query.supervisorId) : undefined

    const where = {}
    if (periodId) where.periodId = periodId
    if (agentId) where.agentId = agentId
    if (status) where.status = status
    if (supervisorId) where.supervisorId = supervisorId

    const rows = await prisma.overtimeEntry.findMany({
      where,
      orderBy: [{ workDate: 'asc' }, { startAt: 'asc' }],
      include: { agent: { select: { id: true, fullName: true } } }
    })

    res.json(rows)
  })

  // POST /api/overtime/entries/manual
  const ManualCreate = z.object({
    periodId: z.number().int(),
    agentId: z.number().int(),
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startAt: z.string(),
    endAt: z.string(),
    totalHours: z.number(),
    reason: z.string().optional(),
    notes: z.string().optional(),
    createdByAgentId: z.number().int().optional()
  })

  r.post('/entries/manual', async (req, res) => {
    const data = ManualCreate.parse(req.body)

    // Rate calculation can be server side, but your rules require day type.
    // For now assume caller sends correct totalHours and server sets base manual rate 1.5.
    const rate = 1.5

    const row = await prisma.overtimeEntry.create({
      data: {
        periodId: data.periodId,
        agentId: data.agentId,
        source: 'MANUAL',
        status: 'DRAFT',
        workDate: new Date(data.workDate),
        startAt: new Date(data.startAt),
        endAt: new Date(data.endAt),
        totalHours: data.totalHours,
        rate,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
        createdByAgentId: data.createdByAgentId ?? null
      }
    })

    res.status(201).json(row)
  })

  // PATCH /api/overtime/entries/:id
  const EditSchema = z.object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    startAt: z.string().optional(),
    endAt: z.string().optional(),
    totalHours: z.number().optional(),
    rate: z.number().optional(),
    notes: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    editedRequiresManager: z.boolean().optional()
  })

  r.patch('/entries/:id', async (req, res) => {
    const id = Number(req.params.id)
    const data = EditSchema.parse(req.body)

    const payload = { ...data }
    if (data.workDate) payload.workDate = new Date(data.workDate)
    if (data.startAt) payload.startAt = new Date(data.startAt)
    if (data.endAt) payload.endAt = new Date(data.endAt)

    const updated = await prisma.overtimeEntry.update({ where: { id }, data: payload })
    res.json(updated)
  })

  // Workflow endpoints
  r.post('/entries/:id/submit', async (req, res) => {
    const id = Number(req.params.id)
    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: { status: 'SUBMITTED' }
    })
    res.json(updated)
  })

  r.post('/entries/:id/supervisor-approve', async (req, res) => {
    const id = Number(req.params.id)
    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: { status: 'SUPERVISOR_APPROVED', supervisorApprovedAt: new Date() }
    })
    res.json(updated)
  })

  r.post('/entries/:id/manager-approve', async (req, res) => {
    const id = Number(req.params.id)
    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: { status: 'MANAGER_APPROVED', managerApprovedAt: new Date() }
    })
    res.json(updated)
  })

  r.post('/entries/:id/reject', async (req, res) => {
    const id = Number(req.params.id)
    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: { status: 'REJECTED' }
    })
    res.json(updated)
  })

  return r
}
