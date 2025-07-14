// server/routes/agents.js
import { Router } from 'express';
import { z }      from 'zod';
import { ROLES } from '../lib/roles.js';

export default prisma => {
  const r = Router();

  /* ────────────────────────
   * Validation schema
   * ──────────────────────── */
  const AgentSchema = z.object({
    fullName: z.string().min(2),
    email:    z.string().email(),
    role:     z.enum(ROLES),
    standby:  z.boolean().optional().default(false)
  });

  /* ────────────────────────
   * GET /api/agents
   *   ?role=NOC-I
   *   ?includeStandby=true
   * ──────────────────────── */
  r.get('/', async (req, res) => {
    const { role, includeStandby } = req.query;

    const where = {};
    if (role)         where.role        = role;         // filter by role if supplied
    if (!includeStandby) where.standbyFlag = false;     // hide standby by default

    const agents = await prisma.agent.findMany({
      where,
      orderBy: { fullName: 'asc' },
      select: {
        id:         true,
        fullName:   true,
        email:      true,
        role:       true,
        standbyFlag:true
      }
    });

    res.json(agents);
  });

  /* ────────────────────────
   * POST /api/agents
   * ──────────────────────── */
  r.post('/', async (req, res) => {
    const data = AgentSchema.parse(req.body);

    const exists = await prisma.agent.findUnique({
      where: { email: data.email }
    });
    if (exists) {
      return res.status(400).json({ error: 'email already in use' });
    }

    const agent = await prisma.agent.create({
      data: {
        fullName:    data.fullName,
        email:       data.email,
        role:        data.role,
        standbyFlag: data.standby
      }
    });

    res.status(201).json(agent);
  });

  return r;
};
