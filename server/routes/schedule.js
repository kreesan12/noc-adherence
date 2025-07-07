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

      // 1) build a map of remaining needs: { "YYYY-MM-DD|HH": units }
      const needs = {}
      forecast.forEach(day => {
        day.staffing.forEach(({hour, requiredAgents}) => {
          needs[`${day.date}|${hour}`] = requiredAgents
        })
      })

      // 2) generate all *candidate* 5-day blocks
      //    candidates: { startDate, startHour, coverCells: [ "YYYY-MM-DD|HH", ... ] }
      const candidates = []
      const dates = forecast.map(d => d.date)
      const dateSet = new Set(dates)
      for (let d of dates) {
        for (let h = 0; h <= 24 - shiftLength; h++) {
          // ensure the 5-day window fits in your forecast range
          const window = Array.from({length: windowDays}, (_, i) => dayjs(d).add(i,'day').format('YYYY-MM-DD'))
          if (!window.every(dd => dateSet.has(dd))) continue

          // collect covered cells
          const cells = []
          window.forEach(dd => {
            for (let hh = h; hh < h + shiftLength; hh++) {
              cells.push(`${dd}|${hh}`)
            }
          })

          candidates.push({ startDate: d, startHour: h, cover: cells })
        }
      }

      // 3) greedy cover: at each step pick the block whose *max* coverage need is highest
      const solution = []
      while (true) {
        let best = null, bestScore = 0

        for (let c of candidates) {
          // score = maximum remaining need over its cells
          const score = Math.max(0, ...c.cover.map(key => needs[key] || 0))
          if (score > bestScore) {
            best = c
            bestScore = score
          }
        }

        if (!best || bestScore === 0) break

        // assign exactly bestScore employees to this block
        solution.push({
          startDate:   best.startDate,
          startHour:   best.startHour,
          length:      shiftLength,
          count:       bestScore
        })

        // subtract that many from each covered cell
        best.cover.forEach(key => {
          needs[key] = Math.max(0, (needs[key] || 0) - bestScore)
        })
      }

      return res.json(solution)
    } catch (err) {
      next(err)
    }
  })


  return r
}
