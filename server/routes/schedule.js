// server/routes/schedule.js
import { Router } from 'express'
import { assignShifts } from '../utils/scheduler.js'

export default prisma => {
  const r = Router()

  // ─── Day view ────────────────────────────────────────────────
  // GET /api/schedule?date=YYYY-MM-DD
  // OR  GET /api/schedule?week=YYYY-MM-DD  (Monday)
  r.get('/', async (req, res, next) => {
    try {
      if (req.query.week) {
        const start = new Date(req.query.week)
        const end   = new Date(start)
        end.setDate(end.getDate() + 6)
        const shifts = await prisma.shift.findMany({
          where: { shiftDate: { gte: start, lte: end } },
          include: {
            agent: true,
            attendance: { include: { duty: true } }
          }
        })
        return res.json(shifts)
      }

      const date = new Date(req.query.date)
      const shifts = await prisma.shift.findMany({
        where: { shiftDate: date },
        include: {
          agent: true,
          attendance: { include: { duty: true } }
        }
      })
      res.json(shifts)
    } catch (err) {
      next(err)
    }
  })

  // ─── Update attendance ──────────────────────────────────────
  // PATCH /api/schedule/:shiftId
  r.patch('/:shiftId', async (req, res, next) => {
    try {
      const shiftId = Number(req.params.shiftId)
      const payload = req.body
      const updated = await prisma.attendanceLog.upsert({
        where:  { shiftId },
        update: payload,
        create: { shiftId, ...payload }
      })
      await res.audit('update_attendance', 'AttendanceLog', updated.id, payload)
      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  // ─── Auto-assign shifts to employees ─────────────────────────
  // POST /api/schedule/assign
  // body: { shiftBlocks: [{ startHour, length }, …] }
  r.post('/assign', (req, res, next) => {
    try {
      const { shiftBlocks } = req.body
      const employees = assignShifts(shiftBlocks, {
        shiftLength:    9,
        lunchBreak:     1,
        maxWeeklyHours: 45,
        minRestHours:   48
      })
      res.json(employees)
    } catch (err) {
      next(err)
    }
  })

  return r
}
