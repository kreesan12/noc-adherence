// server/routes/schedule.js
import { Router } from 'express'
import dayjs from 'dayjs'                    // ← make sure dayjs is imported
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
  // body: { forecast, windowDays?, shiftLength? }
  r.post('/assign', (req, res, next) => {
    try {
      const { forecast, windowDays = 5, shiftLength = 9 } = req.body

      // ① validate
      if (!Array.isArray(forecast) || forecast.length === 0) {
        return res
          .status(400)
          .json({ error: 'Missing or empty `forecast` in request body' })
      }

      // ② delegate to your helper
      const solution = assignShifts(forecast, { windowDays, shiftLength })
      return res.json(solution)
    } catch (err) {
      next(err)
    }
  })


  return r
}
