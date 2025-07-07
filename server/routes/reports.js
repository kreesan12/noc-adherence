// server/routes/reports.js
import { Router } from 'express'
import dayjs from 'dayjs'

export default prisma => {
  const r = Router()

  // ─── 1) Staffing / occupancy report ──────────────────────────────
  r.get('/staffing', async (req, res, next) => {
    try {
      const date  = dayjs(req.query.date)
      const start = date.startOf('day').toDate()
      const end   = date.endOf('day').toDate()

      // get heads per hour
      const shifts = await prisma.shift.findMany({
        where: { shiftDate: { equals: start } },
        include: { attendance: true }
      })
      const heads = Array.from({ length: 24 }, (_, h) =>
        shifts.filter(s => {
          const st = dayjs(s.startAt).hour()
          const en = dayjs(s.endAt).hour()
          return h >= st && h <= en && s.attendance?.status !== 'no_show'
        }).length
      )

      // volumes for this day & role (optional filter)
      const fc = await prisma.volumeForecast.findMany({
        where: {
          date: { gte: start, lte: end },
          role: req.query.role || undefined
        }
      })
      const ac = await prisma.volumeActual.findMany({
        where: {
          date: { gte: start, lte: end },
          role: req.query.role || undefined
        }
      })

      const data = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        forecastCalls:
          fc.filter(f => dayjs(f.date).hour() === h)
            .reduce((sum, f) => sum + f.expectedCalls, 0),
        actualCalls:
          ac.filter(a => dayjs(a.date).hour() === h)
            .reduce((sum, a) => sum + a.calls, 0),
        staffedHeads: heads[h]
      }))

      res.json(data)
    } catch (err) {
      next(err)
    }
  })

// ─── 2) Daily volume report ──────────────────────────────────────
// GET /api/reports/volume?role=NOC-I&start=YYYY-MM-DD&end=YYYY-MM-DD
r.get('/volume', async (req, res, next) => {
  try {
    const { role, start, end } = req.query

    if (!role || !start || !end) {
      return res
        .status(400)
        .json({ error: 'Missing required query params: role, start, end' })
    }

    // parse the requested window
    const startDate = dayjs(start).startOf('day').toDate()
    const endDate   = dayjs(end)  .endOf('day')  .toDate()

    // fetch just this window
    const [fcs, acs] = await Promise.all([
      prisma.volumeForecast.findMany({
        where: { role, date: { gte: startDate, lte: endDate } }
      }),
      prisma.volumeActual.findMany({
        where: { role, date: { gte: startDate, lte: endDate } }
      })
    ])

    // roll up per calendar date
    const byDate = {}
    fcs.forEach(f => {
      const d = dayjs(f.date).format('YYYY-MM-DD')
      if (!byDate[d]) {
        byDate[d] = {
          date:            d,
          forecastCalls:   0,
          forecastTickets: 0,
          actualCalls:     0,
          actualTickets:   0
        }
      }
      byDate[d].forecastCalls   += f.expectedCalls
      byDate[d].forecastTickets += f.expectedTickets
    })
    acs.forEach(a => {
      const d = dayjs(a.date).format('YYYY-MM-DD')
      if (!byDate[d]) {
        byDate[d] = {
          date:            d,
          forecastCalls:   0,
          forecastTickets: 0,
          actualCalls:     0,
          actualTickets:   0
        }
      }
      byDate[d].actualCalls   += a.calls
      byDate[d].actualTickets += a.tickets
    })

    // send back a sorted array
    res.json(
      Object.values(byDate)
        .sort((a, b) => a.date.localeCompare(b.date))
    )
  } catch (err) {
    next(err)
  }
})


  // ─── 3) Hourly drilldown ─────────────────────────────────────────
  // GET /api/reports/volume/hourly?role=NOC-I&date=2025-07-04
  r.get('/volume/hourly', async (req, res, next) => {
    try {
      const { role, date } = req.query
      const start = dayjs(date).startOf('day').toDate()
      const end   = dayjs(date).endOf('day').toDate()

      const [fcs, acs] = await Promise.all([
        prisma.volumeForecast.findMany({
          where: { role, date: { gte: start, lte: end } }
        }),
        prisma.volumeActual.findMany({
          where: { role, date: { gte: start, lte: end } }
        })
      ])

      const hours = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        forecastCalls:
          fcs.filter(f => dayjs(f.date).hour() === h)
            .reduce((sum, f) => sum + f.expectedCalls, 0),
        actualCalls:
          acs.filter(a => dayjs(a.date).hour() === h)
            .reduce((sum, a) => sum + a.calls, 0)
      }))

      res.json(hours)
    } catch (err) {
      next(err)
    }
  })

  // ─── 4) Audit feed ────────────────────────────────────────────────
  r.get('/audit', async (req, res, next) => {
    try {
      const since = new Date(
        req.query.since || Date.now() - 24 * 60 * 60 * 1000
      )
      const log = await prisma.auditLog.findMany({
        where: { ts: { gte: since } },
        orderBy: { ts: 'desc' }
      })
      res.json(log)
    } catch (err) {
      next(err)
    }
  })

  return r
}
