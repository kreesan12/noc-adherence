import { Router } from 'express'
import { z } from 'zod'
import dayjs from 'dayjs'

/*
  This router is mounted at:
    app.use('/api/overtime', verifyToken, overtimeRoutes(prisma))

  IMPORTANT:
  Do not call endpoints with '/api' prefix in the frontend when using your axios api instance.
  Frontend should call: api.get('/overtime/period/current')
*/

function isSupervisor(user) {
  return user?.role === 'supervisor' || user?.role === 'admin'
}

function isManager(user) {
  // adjust if your verifyToken sets something different
  return user?.role === 'manager' || user?.role === 'admin'
}

function assertWithinLast7Days(workDateIso) {
  const d = dayjs(workDateIso)
  if (!d.isValid()) throw new Error('Invalid workDate')
  const min = dayjs().startOf('day').subtract(7, 'day')
  if (d.isBefore(min)) throw new Error('Manual overtime can only be captured within the last 7 days.')
}

function calcHoursBetween(startAt, endAt, breakStart, breakEnd) {
  const s = dayjs(startAt)
  const e = dayjs(endAt)
  if (!s.isValid() || !e.isValid()) return 0
  let mins = e.diff(s, 'minute')
  if (breakStart && breakEnd) {
    const bs = dayjs(breakStart)
    const be = dayjs(breakEnd)
    if (bs.isValid() && be.isValid()) mins -= be.diff(bs, 'minute')
  }
  if (mins < 0) mins = 0
  return Math.round((mins / 60) * 100) / 100
}

function periodForDate(d) {
  const dt = dayjs(d)
  const start = dt.date() >= 15 ? dt.date(15) : dt.subtract(1, 'month').date(15)
  const end = start.add(1, 'month').date(14)

  const startMon = start.format('MMM').toUpperCase()
  const endMon = end.format('MMM').toUpperCase()
  const year = end.format('YYYY')
  const key = `${startMon}-${endMon}-${year}`

  return {
    key,
    label: key,
    startDate: start.startOf('day').toDate(),
    endDate: end.endOf('day').toDate(),
  }
}

async function ensurePeriod(prisma, d) {
  const p = periodForDate(d)

  const existing = await prisma.overtimePeriod.findFirst({
    where: {
      key: p.key
    }
  })

  if (existing) return existing

  return prisma.overtimePeriod.create({
    data: {
      key: p.key,
      label: p.label,
      startDate: p.startDate,
      endDate: p.endDate
    }
  })
}

async function getHolidaySet(prisma) {
  const holidays = await prisma.publicHoliday.findMany({
    where: { isActive: true },
    select: { date: true }
  })
  return new Set(holidays.map(h => dayjs(h.date).format('YYYY-MM-DD')))
}

function dayTypeAndRates(workDateIso, holidaySet) {
  const d = dayjs(workDateIso)
  const iso = d.format('YYYY-MM-DD')
  const isHoliday = holidaySet.has(iso)
  const isSunday = d.day() === 0

  // Fixed overtime rules
  const fixedRate = isHoliday ? 1.0 : (isSunday ? 0.5 : 0)

  // Manual overtime rules
  const manualRate = (isHoliday || isSunday) ? 2.0 : 1.5

  return { isHoliday, isSunday, fixedRate, manualRate }
}

export default prisma => {
  const r = Router()

  /* -----------------------------------------------------------
     PERIODS
  ----------------------------------------------------------- */

  // GET /api/overtime/period/current
  r.get('/period/current', async (req, res) => {
    const period = await ensurePeriod(prisma, new Date())
    res.json(period)
  })

  // POST /api/overtime/period/ensure  { date?: 'YYYY-MM-DD' }
  r.post('/period/ensure', async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const Body = z.object({ date: z.string().optional() })
    const { date } = Body.parse(req.body || {})
    const d = date ? dayjs(date).toDate() : new Date()

    const period = await ensurePeriod(prisma, d)
    res.json(period)
  })

  // GET /api/overtime/periods
  r.get('/periods', async (_req, res) => {
    const rows = await prisma.overtimePeriod.findMany({ orderBy: { startDate: 'desc' } })
    res.json(rows)
  })

  /* -----------------------------------------------------------
     HOLIDAYS
  ----------------------------------------------------------- */

  // GET /api/overtime/holidays
  r.get('/holidays', async (_req, res) => {
    const rows = await prisma.publicHoliday.findMany({
      orderBy: { date: 'asc' }
    })
    res.json(rows)
  })

  // POST /api/overtime/holidays  { date:'YYYY-MM-DD', name?:string, isActive?:boolean }
  r.post('/holidays', async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const Schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      name: z.string().optional(),
      isActive: z.boolean().optional()
    })
    const data = Schema.parse(req.body)

    const row = await prisma.publicHoliday.upsert({
      where: { date: new Date(data.date) },
      update: { name: data.name ?? undefined, isActive: data.isActive ?? true },
      create: { date: new Date(data.date), name: data.name ?? null, isActive: data.isActive ?? true }
    })

    res.json(row)
  })

  /* -----------------------------------------------------------
     ENTRIES LIST
  ----------------------------------------------------------- */

  // GET /api/overtime/entries?periodId=1&agentId=2&status=...&supervisorId=...
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

  /* -----------------------------------------------------------
     MANUAL CAPTURE
     Rule: only allow last 7 days
     Rate: 1.5 normal, 2.0 if Sunday or public holiday
  ----------------------------------------------------------- */

  const ManualCreate = z.object({
    workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startAt: z.string(),
    endAt: z.string(),
    breakStart: z.string().optional(),
    breakEnd: z.string().optional(),
    reason: z.string().optional(),
    notes: z.string().optional(),

    // optional override if supervisor captures on behalf of an agent
    agentId: z.number().int().optional(),
    periodId: z.number().int().optional()
  })

  // POST /api/overtime/manual
  r.post('/manual', async (req, res) => {
    const data = ManualCreate.parse(req.body)

    // who is the entry for
    let agentId = req.user?.id
    if (data.agentId) {
      // Only supervisor can capture for someone else
      if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })
      agentId = data.agentId
    }

    assertWithinLast7Days(data.workDate)

    const period = data.periodId
      ? await prisma.overtimePeriod.findUnique({ where: { id: data.periodId } })
      : await ensurePeriod(prisma, data.workDate)

    if (!period) return res.status(404).json({ error: 'Period not found' })

    const holidaySet = await getHolidaySet(prisma)
    const { manualRate } = dayTypeAndRates(data.workDate, holidaySet)

    const totalHours = calcHoursBetween(
      data.startAt,
      data.endAt,
      data.breakStart,
      data.breakEnd
    )

    const entry = await prisma.overtimeEntry.create({
      data: {
        periodId: period.id,
        agentId,
        source: 'MANUAL',
        status: 'SUBMITTED',
        workDate: new Date(data.workDate),
        startAt: new Date(data.startAt),
        endAt: new Date(data.endAt),
        totalHours,
        rate: manualRate,
        reason: data.reason ?? null,
        notes: data.notes ?? null,
        createdByAgentId: req.user?.id ?? null
      }
    })

    res.status(201).json(entry)
  })

  /* -----------------------------------------------------------
     FIXED OVERTIME GENERATION
     From roster shifts:
       Sunday shift rate 0.5
       Public holiday shift rate 1.0
     Fields: date, day, start hour, end hour, total hours, rate
  ----------------------------------------------------------- */

  // POST /api/overtime/period/:periodId/generate-fixed
  r.post('/period/:periodId/generate-fixed', async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const periodId = Number(req.params.periodId)
    const period = await prisma.overtimePeriod.findUnique({ where: { id: periodId } })
    if (!period) return res.status(404).json({ error: 'Period not found' })

    const holidaySet = await getHolidaySet(prisma)

    // Pull shifts inside the period
    const shifts = await prisma.shift.findMany({
      where: {
        shiftDate: {
          gte: period.startDate,
          lte: period.endDate
        },
        agentId: { not: null }
      },
      include: {
        agent: { select: { id: true, supervisorId: true } }
      }
    })

    // Only generate for agents under this supervisor unless admin
    const allowedShifts = isSupervisor(req.user) && req.user.role !== 'admin'
      ? shifts.filter(s => s.agent?.supervisorId === req.user.id)
      : shifts

    // For each shift, decide if it is Sunday or holiday
    let created = 0
    let skipped = 0

    for (const sh of allowedShifts) {
      const workDateIso = dayjs(sh.shiftDate).format('YYYY-MM-DD')
      const { fixedRate } = dayTypeAndRates(workDateIso, holidaySet)

      // only Sunday or holiday qualify for FIXED
      if (!fixedRate || fixedRate <= 0) {
        skipped++
        continue
      }

      const totalHours = calcHoursBetween(sh.startAt, sh.endAt, sh.breakStart, sh.breakEnd)

      // prevent duplicates for same shift window
      const exists = await prisma.overtimeEntry.findFirst({
        where: {
          periodId: period.id,
          agentId: sh.agentId,
          source: 'FIXED',
          workDate: new Date(workDateIso),
          startAt: sh.startAt,
          endAt: sh.endAt
        }
      })

      if (exists) {
        skipped++
        continue
      }

      await prisma.overtimeEntry.create({
        data: {
          periodId: period.id,
          agentId: sh.agentId,
          source: 'FIXED',
          status: 'SUBMITTED',
          workDate: new Date(workDateIso),
          startAt: sh.startAt,
          endAt: sh.endAt,
          totalHours,
          rate: fixedRate,
          supervisorId: req.user.id,
          createdByAgentId: req.user.id
        }
      })

      created++
    }

    res.json({ ok: true, created, skipped })
  })

  /* -----------------------------------------------------------
     SUPERVISOR VIEW AND ACTIONS
  ----------------------------------------------------------- */

  // GET /api/overtime/period/:periodId/supervisor
  r.get('/period/:periodId/supervisor', async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const periodId = Number(req.params.periodId)
    const supervisorId = req.user.id

    const agents = await prisma.agent.findMany({
      where: { supervisorId },
      select: { id: true }
    })
    const agentIds = agents.map(a => a.id)

    const entries = await prisma.overtimeEntry.findMany({
      where: {
        periodId,
        agentId: { in: agentIds }
      },
      include: { agent: true },
      orderBy: [{ agentId: 'asc' }, { workDate: 'asc' }, { startAt: 'asc' }]
    })

    res.json(entries)
  })

  // PATCH /api/overtime/entries/:id  (supervisor edit)
  // If supervisor edits, force manager re approval
  r.patch('/entries/:id', async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const id = Number(req.params.id)
    const EditSchema = z.object({
      workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      startAt: z.string().optional(),
      endAt: z.string().optional(),
      totalHours: z.number().optional(),
      rate: z.number().optional(),
      notes: z.string().nullable().optional(),
      reason: z.string().nullable().optional(),
      editReason: z.string().optional()
    })

    const data = EditSchema.parse(req.body || {})

    const payload = { ...data }
    delete payload.editReason

    if (data.workDate) payload.workDate = new Date(data.workDate)
    if (data.startAt) payload.startAt = new Date(data.startAt)
    if (data.endAt) payload.endAt = new Date(data.endAt)

    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        ...payload,
        supervisorId: req.user.id,
        editedRequiresManager: true,
        status: 'SUPERVISOR_APPROVED',
        supervisorApprovedAt: new Date()
      }
    })

    res.json(updated)
  })

  // POST /api/overtime/entries/:id/supervisor-approve
  r.post('/entries/:id/supervisor-approve', async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const id = Number(req.params.id)
    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        supervisorId: req.user.id,
        status: 'SUPERVISOR_APPROVED',
        supervisorApprovedAt: new Date()
      }
    })
    res.json(updated)
  })

  // POST /api/overtime/entries/:id/reject
  r.post('/entries/:id/reject', async (req, res) => {
    if (!isSupervisor(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const id = Number(req.params.id)
    const Body = z.object({ notes: z.string().optional() })
    const { notes } = Body.parse(req.body || {})

    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        status: 'REJECTED',
        notes: notes || 'Rejected'
      }
    })
    res.json(updated)
  })

  /* -----------------------------------------------------------
     MANAGER VIEW AND ACTIONS
  ----------------------------------------------------------- */

  // GET /api/overtime/period/:periodId/manager
  r.get('/period/:periodId/manager', async (req, res) => {
    if (!isManager(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const periodId = Number(req.params.periodId)

    const entries = await prisma.overtimeEntry.findMany({
      where: {
        periodId,
        status: 'SUPERVISOR_APPROVED'
      },
      include: { agent: true },
      orderBy: [{ agentId: 'asc' }, { workDate: 'asc' }, { startAt: 'asc' }]
    })

    res.json(entries)
  })

  // POST /api/overtime/entries/:id/manager-approve
  r.post('/entries/:id/manager-approve', async (req, res) => {
    if (!isManager(req.user)) return res.status(403).json({ error: 'Forbidden' })

    const id = Number(req.params.id)

    const updated = await prisma.overtimeEntry.update({
      where: { id },
      data: {
        managerId: req.user.id,
        status: 'MANAGER_APPROVED',
        managerApprovedAt: new Date()
      }
    })

    res.json(updated)
  })

  /* -----------------------------------------------------------
     SIGNATURE STORAGE
     One stored signature per supervisor or manager
  ----------------------------------------------------------- */

  // GET /api/overtime/signature/me
  r.get('/signature/me', async (req, res) => {
    const user = req.user
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const where = isManager(user)
      ? { managerId: user.id }
      : { supervisorId: user.id }

    const sig = await prisma.storedSignature.findUnique({ where })
    res.json(sig || null)
  })

  // PUT /api/overtime/signature/me  { dataUrl: string }
  r.put('/signature/me', async (req, res) => {
    const user = req.user
    if (!user) return res.status(401).json({ error: 'Unauthorized' })

    const Body = z.object({ dataUrl: z.string().min(10) })
    const { dataUrl } = Body.parse(req.body || {})

    const isMgr = isManager(user)

    const where = isMgr
      ? { managerId: user.id }
      : { supervisorId: user.id }

    const data = isMgr
      ? { managerId: user.id, supervisorId: null, dataUrl }
      : { supervisorId: user.id, managerId: null, dataUrl }

    const saved = await prisma.storedSignature.upsert({
      where,
      update: { dataUrl },
      create: data
    })

    res.json(saved)
  })

  return r
}
