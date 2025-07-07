// server/routes/erlang.js
import { Router } from 'express'
import dayjs from 'dayjs'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'   // ← import the plugin
import { requiredAgents, computeDayStaffing } from '../utils/erlang.js'
import { generateShifts } from '../utils/scheduler.js'

dayjs.extend(isSameOrBefore)                              // ← activate it

export default prisma => {
  const r = Router()

  // ─── 1) Single staffing calc ────────────────────────────────────
  r.post('/staff', (req, res, next) => {
    try {
      const {
        callsPerHour,
        ahtSeconds,
        serviceLevel,
        thresholdSeconds,
        shrinkage
      } = req.body

      const agents = requiredAgents({
        callsPerHour,
        ahtSeconds,
        targetServiceLevel:     serviceLevel,
        serviceThresholdSeconds: thresholdSeconds,
        shrinkage
      })

      res.json({ requiredAgents: agents })
    } catch (err) {
      next(err)
    }
  })

  // ─── 2) One-day bulk staffing ──────────────────────────────────────
  r.post('/staff/bulk', async (req, res, next) => {
    try {
      const {
        role,
        date,
        callAhtSeconds,
        ticketAhtSeconds,
        serviceLevel,
        thresholdSeconds,
        shrinkage
      } = req.body

      const start = dayjs(date).startOf('day').toDate()
      const end   = dayjs(date).endOf('day')  .toDate()

      const actuals = await prisma.volumeActual.findMany({
        where: { role, date: { gte: start, lte: end } }
      })

      const hours = Array.from({ length: 24 }, (_, h) => {
        const slice   = actuals.filter(a => a.hour === h)
        const calls   = slice.reduce((sum, a) => sum + a.calls,   0)
        const tickets = slice.reduce((sum, a) => sum + a.tickets, 0)
        return { hour: h, calls, tickets }
      })

      const staffing = hours.map(({ hour, calls, tickets }) => {
        const callAgents   = requiredAgents({
          callsPerHour:          calls,
          ahtSeconds:            callAhtSeconds,
          targetServiceLevel:    serviceLevel,
          serviceThresholdSeconds: thresholdSeconds,
          shrinkage
        })
        const ticketAgents = requiredAgents({
          callsPerHour:          tickets,
          ahtSeconds:            ticketAhtSeconds,
          targetServiceLevel:    serviceLevel,
          serviceThresholdSeconds: thresholdSeconds,
          shrinkage
        })
        return {
          hour,
          calls,
          tickets,
          requiredAgents: callAgents + ticketAgents
        }
      })

      res.json(staffing)
    } catch (err) {
      next(err)
    }
  })

  // ─── 3) Multi-day forecast ───────────────────────────────────────
  r.post('/staff/bulk-range', async (req, res, next) => {
    try {
      const {
        role,
        start, end,
        callAhtSeconds,
        ticketAhtSeconds,
        serviceLevel,
        thresholdSeconds,
        shrinkage
      } = req.body

      const days = []
      let cursor = dayjs(start)

      // now isSameOrBefore works as expected
      while (cursor.isSameOrBefore(dayjs(end))) {
        const date     = cursor.format('YYYY-MM-DD')
        const staffing = await computeDayStaffing({
          prisma,
          role,
          date,
          callAhtSeconds,
          ticketAhtSeconds,
          serviceLevel,
          thresholdSeconds,
          shrinkage
        })
        days.push({ date, staffing })
        cursor = cursor.add(1, 'day')
      }

      res.json(days)
    } catch (err) {
      next(err)
    }
  })

  // ─── 4) Shift-schedule generator ─────────────────────────────────
  r.post('/staff/schedule', (req, res, next) => {
    try {
      const { staffing, shiftLength = 8 } = req.body
      const shifts = generateShifts(staffing, shiftLength)
      res.json(shifts)
    } catch (err) {
      next(err)
    }
  })

  return r
}
