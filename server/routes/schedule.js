// server/routes/schedule.js
import { Router } from 'express'
import dayjs      from '../utils/dayjs.js'
import { autoAssignRotations } from '../utils/scheduler.js'

export default prisma => {
  const r = Router()

  // ─── Day view ────────────────────────────────────────────────
  // GET /api/schedule?date=YYYY-MM-DD
  // OR  GET /api/schedule?week=YYYY-MM-DD  (Monday)
  r.get('/', async (req, res, next) => {
    try {
      const { week, date, team } = req.query;

      // reusable piece: add role filter when team is supplied
      const roleFilter = team?.trim()
        ? { agent: { is: { role: team.trim() } } }
        : {};

      if (week) {
        const start = new Date(req.query.week)
        const end   = new Date(start)
        end.setDate(end.getDate() + 6)
        const shifts = await prisma.shift.findMany({
          where: {
                    shiftDate: { gte: start, lte: end },
                    ...roleFilter
                  },
          include: {
            agent: true,
            attendance: { include: { duty: true } }
          }
        })
        return res.json(shifts)
      }

      const dateObj = new Date(date);
      const shifts = await prisma.shift.findMany({
        where: { shiftDate: dateObj, ...roleFilter },
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
  // body: { forecast, windowDays?, shiftLength? }

  r.post('/auto-assign', (req, res, next) => {
  try {
    const { forecast, weeks = 3, shiftLength = 9, topN = 5 } = req.body
    if (!Array.isArray(forecast) || forecast.length === 0) {
      return res.status(400).json({ error: 'Missing or empty `forecast`' })
    }
    const { bestStartHours, solution } = autoAssignRotations(
      forecast,
      { weeks, shiftLength, topN }
    )
    return res.json({ bestStartHours, solution })
  } catch (err) {
    next(err)
  }
})


  return r
}
