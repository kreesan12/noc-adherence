// server/routes/shifts.js
import { Router } from 'express';
import dayjs      from 'dayjs';

export default prisma => {
  const r = Router();

  /**
   * POST /api/shifts/allocate
   * body: {
   *   role: 'NOC-I',
   *   schedule: [
   *     { day:'2025-10-01', hour:0,  breakHour:4, index:1 },
   *     { day:'2025-10-01', hour:0,  breakHour:3, index:2 },
   *     ...
   *   ],
   *   clearExisting: boolean   // optional (default = true)
   * }
   *
   * index = the synthetic employee number produced by StaffingPage
   *         (1-based).  We’ll map them onto real agents.
   */
  r.post('/allocate', async (req, res) => {
    try {
      const { role, schedule, clearExisting = true } = req.body;
      if (!role || !Array.isArray(schedule) || !schedule.length) {
        return res.status(400).json({ ok:false, error:'Invalid payload' });
      }

      /* ---------- 1)  Get all active agents for this role ---------- */
      const agents = await prisma.agent.findMany({
        where: { role, standbyFlag:false }
      });
      if (!agents.length) {
        return res.status(400).json({ ok:false, error:'No agents found for role' });
      }

      /* ---------- 2)  Optionally wipe existing shifts in window ---- */
      const minDay = dayjs(schedule[0].day).startOf('day').toDate();
      const maxDay = dayjs(schedule[schedule.length - 1].day).endOf('day').toDate();

      if (clearExisting) {
        await prisma.shift.deleteMany({
          where: {
            shiftDate: { gte:minDay, lte:maxDay },
            agent:     { role }
          }
        });
      }

      /* ---------- 3)  Shuffle agents, assign round-robin ----------- */
      const shuffled = agents.sort(() => Math.random() - 0.5);
      const shifts   = [];

      schedule.forEach((s, i) => {
        const agent   = shuffled[i % shuffled.length];
        const startAt = dayjs(`${s.day} ${s.hour}:00`).toDate();
        const endAt   = dayjs(startAt).add(9, 'hour').toDate();      // 9-h shift

        const breakStart = dayjs(`${s.day} ${s.breakHour}:00`).toDate();
        const breakEnd   = dayjs(breakStart).add(1, 'hour').toDate();

        shifts.push({
          agentId:    agent.id,          // ← real agent
          shiftDate:  dayjs(s.day).startOf('day').toDate(),
          startAt,
          endAt,
          breakStart,
          breakEnd
        });
      });

      /* ---------- 4)  Bulk insert ---------------------------------- */
      // chunk into smaller batches (Postgres parameter limit safeguard)
      const batchSize = 500;
      for (let i = 0; i < shifts.length; i += batchSize) {
        await prisma.shift.createMany({
          data: shifts.slice(i, i + batchSize),
          skipDuplicates: true
        });
      }

      return res.json({ ok:true, inserted:shifts.length });
    } catch (err) {
      console.error('POST /shifts/allocate:', err);
      return res.status(500).json({ ok:false, error:err.message });
    }
  });

  return r;
};
