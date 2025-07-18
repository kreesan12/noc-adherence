/* server/routes/agents.js ----------------------------------------- */
import { Router } from 'express'
import { z }      from 'zod'
import { ROLES }  from '../lib/roles.js'
import dayjs      from 'dayjs'

export default prisma => {
  const r = Router()

  /* ────────────────────────────────────────────────────────────────
   * 1)  Validation schema
   *     – fullName, email & role are required
   *     – everything else is optional so you can fill it later
   * ─────────────────────────────────────────────────────────────── */
  const BaseSchema = z.object({
    fullName: z.string().min(2),
    email:    z.string().email(),
    role:     z.enum(ROLES),
    standby:  z.boolean().optional().default(false),

    /* new HR fields  */
    startDate:        z.string().date('YYYY-MM-DD').optional(),
    employeeNumber:   z.string().max(30).optional(),
    idNumber:         z.string().max(30).optional(),
    phoneMobile:      z.string().max(30).optional(),
    phoneAlt:         z.string().max(30).optional(),
    physicalAddress:  z.string().max(200).optional(),
    province:         z.string().max(60).optional()
  })

  /* create    = whole schema
     update    = all fields optional */
  const CreateSchema = BaseSchema
  const UpdateSchema = BaseSchema.partial()

  /* ────────────────────────────────────────────────────────────────
   * 2)  GET /api/agents
   *     ?role=NOC-I
   *     ?includeStandby=true
   * ─────────────────────────────────────────────────────────────── */
  r.get('/', async (req, res) => {
    const { role, includeStandby, supervisorId } = req.query;

    const where = {}
    if (role)            where.role        = role;
    if (!includeStandby) where.standbyFlag = false;
    if (supervisorId)   where.supervisorId = Number(supervisorId);

    const agents = await prisma.agent.findMany({
      where,
      orderBy: { fullName: 'asc' },
      select : {
        id: true, fullName: true, email: true, role: true, standbyFlag:true, 
        supervisorId:true, 
        supervisor:  { select:{ fullName:true }},

        /* HR fields so Workforce page shows correct head-count */
        startDate:       true,
        employeeNumber:  true,
        idNumber:        true,
        phoneMobile:     true,
        phoneAlt:        true,
        physicalAddress: true,
        province:        true
      }
    })

    res.json(agents)
  })

  /* ────────────────────────────────────────────────────────────────
   * 3)  POST /api/agents         (create)
   * ─────────────────────────────────────────────────────────────── */
  r.post('/', async (req, res) => {
    const data = CreateSchema.parse(req.body)

    /* uniqueness checks */
    if (await prisma.agent.findUnique({ where:{ email:data.email } })) {
      return res.status(400).json({ error:'email already in use' })
    }
    if (data.employeeNumber &&
        await prisma.agent.findFirst({ where:{ employeeNumber:data.employeeNumber } }))
    {
      return res.status(400).json({ error:'employee # already exists' })
    }

    const agent = await prisma.agent.create({
      data: {
        fullName:        data.fullName,
        email:           data.email,
        role:            data.role,
        standbyFlag:     data.standby,

        /* optional HR fields */
        startDate:       data.startDate ? new Date(data.startDate) : null,
        employeeNumber:  data.employeeNumber ?? null,
        idNumber:        data.idNumber       ?? null,
        phoneMobile:     data.phoneMobile    ?? null,
        phoneAlt:        data.phoneAlt       ?? null,
        physicalAddress: data.physicalAddress?? null,
        province:        data.province       ?? null
      }
    })

    res.status(201).json(agent)
  })

  /* ────────────────────────────────────────────────────────────────
   * 4)  PATCH /api/agents/:id     (update)
   * ─────────────────────────────────────────────────────────────── */
  r.patch('/:id', async (req, res) => {
    const id   = Number(req.params.id)
    const data = UpdateSchema.parse(req.body)

    /* email & employee # uniqueness checks if they are being changed */
    if (data.email &&
        await prisma.agent.findFirst({ where:{ email:data.email, NOT:{ id } } }))
    {
      return res.status(400).json({ error:'email already in use' })
    }
    if (data.employeeNumber &&
        await prisma.agent.findFirst({
          where:{ employeeNumber:data.employeeNumber, NOT:{ id } }
        }))
    {
      return res.status(400).json({ error:'employee # already exists' })
    }

    /* convert startDate string → Date */
    const payload = { ...data }
    if (data.startDate) payload.startDate = new Date(data.startDate)

    const updated = await prisma.agent.update({
      where:{ id },
      data : payload
    })

    res.json(updated)
  })

  /* ───────── PATCH /api/agents/:id/supervisor ───────── */
  r.patch('/:id/supervisor', async (req, res) => {
    const id = Number(req.params.id)
    const { supervisorId } = req.body            // may be null to un-assign

    await prisma.agent.update({
      where:{ id },
      data :{ supervisorId }
    })
    res.json({ ok:true })
  })

  return r
}
