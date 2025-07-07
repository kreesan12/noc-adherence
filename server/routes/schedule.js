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
      const { forecast, windowDays = 5, shiftLength = 9 } = req.body

      // ① validate
      if (!Array.isArray(forecast) || forecast.length === 0) {
        return res
          .status(400)
          .json({ error: 'Missing or empty `forecast` in request body' })
      }

      // ② build remaining‐need map
      const needs = {}
      for (const day of forecast) {
        if (!Array.isArray(day.staffing)) continue
        for (const { hour, requiredAgents } of day.staffing) {
          needs[`${day.date}|${hour}`] = requiredAgents
        }
      }

      // ③ generate all candidate 5-day/shiftLength blocks
      const dates = forecast.map(d => d.date)
      const dateSet = new Set(dates)
      const candidates = []

      for (const startDate of dates) {
        // only consider a block if you can fit `windowDays` into your range
        const window = Array.from({ length: windowDays }, (_, i) =>
          dayjs(startDate).add(i, 'day').format('YYYY-MM-DD')
        )
        if (!window.every(d => dateSet.has(d))) continue

        for (let startHour = 0; startHour <= 24 - shiftLength; startHour++) {
          const cover = []
          for (const d of window) {
            for (let h = startHour; h < startHour + shiftLength; h++) {
              cover.push(`${d}|${h}`)
            }
          }
          candidates.push({ startDate, startHour, length: shiftLength, cover })
        }
      }

      // ④ greedy cover: pick the block with the highest single‐hour unmet need
      const solution = []
      while (true) {
        let best = null
        let bestScore = 0

        for (const c of candidates) {
          // score = max remaining need in its cover
          const score = Math.max(0, ...c.cover.map(k => needs[k] || 0))
          if (score > bestScore) {
            best = c
            bestScore = score
          }
        }

        if (!best || bestScore === 0) break

        // assign exactly `bestScore` staff to this block
        solution.push({
          startDate: best.startDate,
          startHour: best.startHour,
          length:    best.length,
          count:     bestScore
        })

        // subtract that many from every hour it covers
        for (const key of best.cover) {
          needs[key] = Math.max(0, (needs[key] || 0) - bestScore)
        }
      }

      return res.json(solution)
    } catch (err) {
      next(err)
    }
  })


  return r
}
