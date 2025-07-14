// server/routes/shifts.js
import { Router } from 'express';
import dayjs      from 'dayjs';
import { z }      from 'zod';          // already in deps from prev step

export default prisma => {
  const r = Router();


  /* ──────────────────────────────────────────────────────────
   * LIST /api/shifts?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
   *                    [&team=NOC-I] [&agentId=12]
   * ────────────────────────────────────────────────────────── */
    r.get('/', async (req, res) => {
      // ⬇︎  removed the “as { … }”
      const { startDate, endDate, team, agentId } = req.query;

      if (!startDate || !endDate) {
        return res.status(400).json({ error: 'startDate & endDate required' });
      }

      const where = {
        shiftDate: {
          gte: dayjs(startDate).startOf('day').toDate(),
          lte: dayjs(endDate).endOf('day').toDate()
        }
      };
      if (agentId) where.agentId = Number(agentId);
      if (team)    where.agent   = { is: { role: team } };

      const shifts = await prisma.shift.findMany({
        where,
        include: {
          agent: { select: { id: true, fullName: true, role: true } }
        },
        orderBy: [{ shiftDate: 'asc' }, { startAt: 'asc' }]
      });

      const rows = shifts.map(s => ({
        id:        s.id,
        agentName: s.agent?.fullName ?? '—',
        team:      s.agent?.role     ?? '—',
        startAt:   s.startAt,
        endAt:     s.endAt
      }));

      res.json(rows);
    });

  /* ──────────────────────────────────────────────────────────
   * 1)  AUTO-ALLOCATE SHIFTS  (Feature 1, unchanged)
   * ────────────────────────────────────────────────────────── */
  /**
   * POST /api/shifts/allocate
   * body: {
   *   role: 'NOC-I',
   *   schedule:[{ day:'2025-10-01', hour:0, breakHour:4, index:1 }, …],
   *   clearExisting:true
   * }
   */
  r.post('/allocate', async (req, res) => {
    try {
      const { role, schedule, clearExisting = true } = req.body;
      if (!role || !Array.isArray(schedule) || !schedule.length) {
        return res.status(400).json({ ok:false, error:'Invalid payload' });
      }

      /* 1) agents of that role */
      const agents = await prisma.agent.findMany({
        where:{ role, standbyFlag:false }
      });
      if (!agents.length) {
        return res.status(400).json({ ok:false, error:'No agents found for role' });
      }

      /* 2) optionally wipe */
      const minDay = dayjs(schedule[0].day).startOf('day').toDate();
      const maxDay = dayjs(schedule[schedule.length - 1].day).endOf('day').toDate();
      if (clearExisting) {
        await prisma.shift.deleteMany({
          where:{
            shiftDate:{ gte:minDay, lte:maxDay },
            agent:{ role }
          }
        });
      }

      /* 3) round-robin assign */
      const shuffled = agents.sort(() => Math.random() - 0.5);
      const shifts   = [];

      schedule.forEach((s,i) => {
        const agent   = shuffled[i % shuffled.length];
        const startAt = dayjs(`${s.day} ${s.hour}:00`).toDate();
        const endAt   = dayjs(startAt).add(9,'hour').toDate();
        const breakStart = dayjs(`${s.day} ${s.breakHour}:00`).toDate();
        const breakEnd   = dayjs(breakStart).add(1,'hour').toDate();

        shifts.push({
          agentId: agent.id,
          shiftDate: dayjs(s.day).startOf('day').toDate(),
          startAt,
          endAt,
          breakStart,
          breakEnd,
          generatedBy: 'solver'                // <───────── NEW
        });
      });

      /* 4) bulk insert */
      const batch = 500;
      for (let i=0;i<shifts.length;i+=batch) {
        await prisma.shift.createMany({
          data: shifts.slice(i,i+batch),
          skipDuplicates:true
        });
      }

      return res.json({ ok:true, inserted:shifts.length });
    } catch (err) {
      console.error('POST /shifts/allocate:', err);
      return res.status(500).json({ ok:false, error:err.message });
    }
  });

  /* ──────────────────────────────────────────────────────────
   * 2)  MANUAL EDIT  (Feature 2)
   * ────────────────────────────────────────────────────────── */
  r.patch('/:id', async (req, res) => {
    const id = Number(req.params.id);

    const schema = z.object({
      startAt:    z.string().datetime(),
      endAt:      z.string().datetime(),
      breakStart: z.string().datetime().optional()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error);

    const { startAt, endAt, breakStart } = parsed.data;

    try {
      const updated = await prisma.shift.update({
        where:{ id },
        data:{
          startAt:    new Date(startAt),
          endAt:      new Date(endAt),
          breakStart: breakStart ? new Date(breakStart) : null,
          generatedBy:'manual'
        }
      });
      res.json(updated);
    } catch (err) {
      console.error('PATCH /shifts/:id:', err);
      res.status(500).json({ error:'Update failed' });
    }
  });

  /* ──────────────────────────────────────────────────────────
   * 3)  SWAP TWO SHIFTS  (Feature 2)
   * ────────────────────────────────────────────────────────── */
  r.post('/swap', async (req, res) => {
    const schema = z.object({
      shiftIdA: z.number().int(),
      shiftIdB: z.number().int()
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(parsed.error);
    const { shiftIdA, shiftIdB } = parsed.data;

    try {
      const [a,b] = await prisma.$transaction([
        prisma.shift.findUnique({ where:{ id:shiftIdA } }),
        prisma.shift.findUnique({ where:{ id:shiftIdB } })
      ]);
      if (!a || !b) return res.status(404).json({ error:'Shift not found' });

      await prisma.$transaction([
        prisma.shift.update({
          where:{ id:shiftIdA },
          data:{ agentId:b.agentId, generatedBy:'manual' }
        }),
        prisma.shift.update({
          where:{ id:shiftIdB },
          data:{ agentId:a.agentId, generatedBy:'manual' }
        })
      ]);

      res.json({ ok:true });
    } catch (err) {
      console.error('POST /shifts/swap:', err);
      res.status(500).json({ error:'Swap failed' });
    }
  });

  return r;
};
