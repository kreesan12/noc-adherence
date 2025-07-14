// server/routes/shifts.js
import { Router } from 'express';
import dayjs      from '../utils/dayjs.js'
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
          agent: {
            select: { id: true, fullName: true, phone: true, role: true }
          },
          attendance: {
            select: {
              status: true,
              lunchStart: true,
              lunchEnd: true,
              duty: { select: { name: true } }
            }
          }
        },
        orderBy: [{ shiftDate: 'asc' }, { startAt: 'asc' }]
      });

      const rows = shifts.map(s => ({
        id:        s.id,
        agentName: s.agent?.fullName ?? '—',
        team:      s.agent?.role     ?? '—',
        startAt:   s.startAt,
        endAt:     s.endAt,
        breakStart: s.breakStart,        // 🔹 new
        breakEnd:   s.breakEnd,          // 🔹 new
        attendance: s.attendance         // 🔹 passes through
      }));

      res.json(rows);
    });

    /* ──────────────────────────────────────────────────────────
    * 1)  AUTO-ALLOCATE SHIFTS  (reworked)
    * ────────────────────────────────────────────────────────── */
    /**
     * POST /api/shifts/allocate
     * body: {
     *   role: 'NOC-I',
     *   clearExisting: true,
     *   schedule: [
     *     {
     *       agentId:    64,
     *       startAt:    '2025-08-03T06:00:00.000Z',
     *       endAt:      '2025-08-03T15:00:00.000Z',
     *       breakStart: '2025-08-03T08:00:00.000Z',   // optional
     *       breakEnd:   '2025-08-03T09:00:00.000Z'    // optional
     *     }, …
     *   ]
     * }
     */
    r.post('/allocate', async (req, res) => {
      /* 0) basic validation – use zod so the caller gets a 400 early */
      const schema = z.object({
        role: z.string().min(1),
        clearExisting: z.boolean().optional().default(true),
        schedule: z
          .array(
            z.object({
              agentId: z.number().int(),
              startAt: z.string().datetime(),
              endAt: z.string().datetime(),
              breakStart: z.string().datetime().optional(),
              breakEnd: z.string().datetime().optional()
            })
          )
          .min(1)
      });

      const parsed = schema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ ok: false, error: parsed.error });
      }

      const { role, clearExisting, schedule } = parsed.data;

      try {
        /* 1) optional wipe of existing rows that overlap the range */
        if (clearExisting) {
          const minStart = dayjs(schedule[0].startAt).startOf('day').toDate();
          const maxEnd = dayjs(schedule[schedule.length - 1].endAt)
            .endOf('day')
            .toDate();

          await prisma.shift.deleteMany({
            where: {
              startAt: { gte: minStart, lte: maxEnd },
              agent: { role } // same team/role you’re inserting for
            }
          });
        }

        /* 2) normalise payload → DB rows */
        const rows = schedule.map(s => ({
          agentId: s.agentId,
          shiftDate: dayjs.utc(s.startAt).startOf('day').toDate(), // keep existing filters working
          startAt: new Date(s.startAt),
          endAt: new Date(s.endAt),
          breakStart: s.breakStart ? new Date(s.breakStart) : null,
          breakEnd: s.breakEnd ? new Date(s.breakEnd) : null,
          generatedBy: 'solver'
        }));

        /* 3) bulk insert (skipDuplicates in case caller retries) */
        await prisma.shift.createMany({ data: rows, skipDuplicates: true });

        return res.json({ ok: true, inserted: rows.length });
      } catch (err) {
        console.error('POST /shifts/allocate:', err);
        return res.status(500).json({ ok: false, error: 'Allocation failed' });
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

    /* ───────────────────────────────────────────────
  * SWAP RANGE – swap all shifts between A & B
  *  POST /api/shifts/swap-range
  *  body: { agentIdA, agentIdB, from:'YYYY-MM-DD', to:'YYYY-MM-DD' }
  * ─────────────────────────────────────────────── */
  r.post('/swap-range', async (req,res)=>{
    const { agentIdA, agentIdB, from, to } = req.body
    if(!agentIdA||!agentIdB||!from||!to) return res.status(400).json({error:'bad payload'})

    const range = {
      gte: dayjs(from).startOf('day').toDate(),
      lte: dayjs(to)  .endOf('day').toDate()
    }

    const [aShifts,bShifts] = await prisma.$transaction([
      prisma.shift.findMany({ where:{ agentId:agentIdA, shiftDate:range } }),
      prisma.shift.findMany({ where:{ agentId:agentIdB, shiftDate:range } })
    ])

    // map by shiftDate so we can swap 1-for-1
    const updates = []
    aShifts.forEach(a=>{
      const b = bShifts.find(x=>x.shiftDate.getTime()===a.shiftDate.getTime())
      if(b){
        updates.push(
          prisma.shift.update({ where:{id:a.id}, data:{ agentId:agentIdB, generatedBy:'swap-range'} }),
          prisma.shift.update({ where:{id:b.id}, data:{ agentId:agentIdA, generatedBy:'swap-range'} })
        )
      }
    })

    await prisma.$transaction(updates)

    await prisma.auditLog.create({
      data:{
        action:'SWAP_RANGE',
        actor:req.user?.email??'unknown',
        payload:req.body
      }
    })
    res.json({ok:true, swappedPairs:updates.length/2})
  })

  /* ───────────────────────────────────────────────
  * REASSIGN RANGE – move all shifts from A → B
  *  POST /api/shifts/reassign-range
  *  body: { fromAgentId, toAgentId, from:'YYYY-MM-DD', to:'YYYY-MM-DD', markLeave:true }
  * ─────────────────────────────────────────────── */
  r.post('/reassign-range', async (req,res)=>{
    const { fromAgentId, toAgentId, from:fromDay, to:toDay, markLeave } = req.body
    if(!fromAgentId||!toAgentId||!fromDay||!toDay) return res.status(400).json({error:'bad payload'})

    const shifts = await prisma.shift.findMany({
      where:{
        agentId:fromAgentId,
        shiftDate:{
          gte: dayjs(fromDay).startOf('day').toDate(),
          lte: dayjs(toDay)  .endOf('day').toDate()
        }
      }
    })

    const actions=[]
    for(const s of shifts){
      actions.push(
        prisma.shift.update({ where:{id:s.id}, data:{ agentId:toAgentId, generatedBy:'reassign-range'} })
      )
      if(markLeave){
        actions.push(
          prisma.leave.create({
            data:{
              agentId:fromAgentId,
              reason :'Annual leave (auto)',
              startsAt:s.startAt,
              endsAt  :s.endAt,
              createdBy:req.user?.email??'system'
            }
          })
        )
      }
    }
    await prisma.$transaction(actions)

    await prisma.auditLog.create({
      action :'REASSIGN_RANGE',
      actor  :req.user?.email??'unknown',
      payload:req.body
    })

    res.json({ok:true, movedShifts:shifts.length})
  })

  return r;
};
