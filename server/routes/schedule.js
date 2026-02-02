// server/routes/schedule.js
import { Router } from 'express'
import dayjs from '../utils/dayjs.js'
import { autoAssignRotations } from '../utils/shiftSolverWaterfallTemplate.js'


export default prisma => {
  const r = Router()

  // ─── Day view ────────────────────────────────────────────────
  // GET /api/schedule?date=YYYY-MM-DD
  // OR  GET /api/schedule?week=YYYY-MM-DD  (Monday)
  r.get('/', async (req, res, next) => {
    try {
      const { week, date, team } = req.query

      const roleFilter = team?.trim()
        ? { agent: { is: { role: team.trim() } } }
        : {}

      if (week) {
        const start = new Date(req.query.week)
        const end = new Date(start)
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

      const dateObj = new Date(date)
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
        where: { shiftId },
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
  // POST /api/schedule/auto-assign
  //
  // body:
  // {
  //   forecast: [...],
  //   weeks?: 3,
  //   shiftLength?: 9,
  //   topN?: 5,
  //   maxStaff?: number,
  //
  //   exact?: boolean,           // true = branch+bound exact optimizer
  //   timeLimitMs?: number,      // 0 = no limit (can run for hours)
  //   greedyRestarts?: number,   // better upper bound for exact
  //   exactLogEvery?: number,    // console logging cadence
  //   startHours?: number[],     // default 0..15 (midnight to 3pm)
  //   splitSize?: number         // how many heads per identical block in output
  // }
  r.post('/auto-assign', async (req, res, next) => {
    try {
      // Disable Node request timeouts (still subject to proxy/load balancer limits)
      req.setTimeout(0)
      res.setTimeout(0)

      const {
        forecast,
        weeks = 3,
        shiftLength = 9
      } = req.body || {}

      if (!Array.isArray(forecast) || forecast.length === 0) {
        return res.status(400).json({ error: 'Missing or empty `forecast`' })
      }

      const result = autoAssignRotations(forecast, {
        weeks: Number(weeks || 3),
        shiftLength: Number(shiftLength || 9)
      })

      const { bestStartHours, solution, plan, meta } = result
      return res.json({ bestStartHours, solution, plan, meta })

    } catch (err) {
      next(err)
    }
  })

  return r
}
