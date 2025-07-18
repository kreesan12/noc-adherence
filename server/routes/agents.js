/* server/routes/agents.js ---------------------------------------- */
import { Router } from 'express'
import { z }      from 'zod'
import { ROLES }  from '../lib/roles.js'

export default prisma => {
  const r = Router()

  /* ───────────────────────── 1. Schema  ───────────────────────── */
  const Base = z.object({
    fullName: z.string().min(2),
    email:    z.string().email(),
    role:     z.enum(ROLES),
    standby:  z.boolean().optional().default(false),

    /* HR metadata (all optional) */
    startDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
                      .optional(),                    // yyyy-mm-dd
    employeeNo:   z.string().max(30).optional(),
    idNumber:         z.string().max(30).optional(),
    phoneMobile:      z.string().max(30).optional(),
    phoneAlt:         z.string().max(30).optional(),
    physicalAddress:  z.string().max(200).optional(),
    province:         z.string().max(60).optional(),

    /* supervisor FK may be null */
    supervisorId: z.number().int().nullable().optional()
  })

  const CreateSchema = Base                 // all required + optional HR
  const UpdateSchema = Base.partial()       // every field optional
  /* ─────────────────────────────────────────────────────────────── */

  /* ───── 2. LIST  GET /api/agents ─────────────────────────────── */
  r.get('/', async (req, res) => {
    const { role, includeStandby, supervisorId } = req.query

    const where = {}
    if (role)             where.role        = role
    if (!includeStandby)  where.standbyFlag = false
    if (supervisorId)     where.supervisorId = Number(supervisorId)

    const agents = await prisma.agent.findMany({
      where,
      orderBy: { fullName: 'asc' },
      select: {
        id: true, fullName: true, email: true, role: true, standbyFlag: true,

        /* HR fields exposed to Workforce / Admin UIs */
        employeeNo:      true,
        startDate:       true,
        idNumber:        true,
        phoneMobile:     true,
        phoneAlt:        true,
        physicalAddress: true,
        province:        true,

        supervisorId: true,
        supervisor:   { select:{ fullName:true } }
      }
    })

    res.json(agents)
  })

  /* ───── 3. CREATE  POST /api/agents ──────────────────────────── */
  r.post('/', async (req, res) => {
    const data = CreateSchema.parse(req.body)

    /* uniqueness checks */
    if (await prisma.agent.findUnique({ where:{ email:data.email } }))
      return res.status(400).json({ error:'email already in use' })

    if (data.employeeNo &&
        await prisma.agent.findFirst({ where:{ employeeNo:data.employeeNo } }))
      return res.status(400).json({ error:'employee # already exists' })

    const agent = await prisma.agent.create({
      data: {
        fullName:        data.fullName,
        email:           data.email,
        role:            data.role,
        standbyFlag:     data.standby,
        supervisorId:    data.supervisorId ?? null,

        /* HR meta */
        startDate:       data.startDate      ? new Date(data.startDate) : null,
        employeeNo:      data.employeeNo ?? null,
        idNumber:        data.idNumber       ?? null,
        phoneMobile:     data.phoneMobile    ?? null,
        phoneAlt:        data.phoneAlt       ?? null,
        physicalAddress: data.physicalAddress?? null,
        province:        data.province       ?? null
      }
    })

    res.status(201).json(agent)
  })

  /* ───── 4. UPDATE  PATCH /api/agents/:id ─────────────────────── */
  r.patch('/:id', async (req, res) => {
    const id   = Number(req.params.id)
    const data = UpdateSchema.parse(req.body)

    /* uniqueness checks if e-mail / employee # are changing */
    if (data.email &&
        await prisma.agent.findFirst({ where:{ email:data.email, NOT:{ id } } }))
      return res.status(400).json({ error:'email already in use' })

    if (data.employeeNo &&
        await prisma.agent.findFirst({
          where:{ employeeNo:data.employeeNo, NOT:{ id } }
        }))
      return res.status(400).json({ error:'employee # already exists' })

    /* map date-string → Date */
    const payload = { ...data }
    if (data.startDate) payload.startDate = new Date(data.startDate)

    const updated = await prisma.agent.update({ where:{ id }, data:payload })
    res.json(updated)
  })

  /* ───── 5. ASSIGN / CLEAR SUPERVISOR  ──────────────────────────
       PATCH /api/agents/:id/supervisor     { supervisorId: 123 | null } */
  r.patch('/:id/supervisor', async (req, res) => {
    const id = Number(req.params.id)
    const { supervisorId } = req.body         // may be null
    await prisma.agent.update({
      where:{ id },
      data :{ supervisorId }
    })
    res.json({ ok:true })
  })

  return r
}
