// server/routes/reports.js
import { Router } from 'express'
import dayjs from 'dayjs'

export default prisma => {
  const r = Router()

  /* ─────────────────────────────────────────────────────────────┐
   * 1) Staffing / occupancy report  (unchanged)
   * ─────────────────────────────────────────────────────────────*/
  r.get('/staffing', async (req, res, next) => {
    try {
      const date  = dayjs(req.query.date)
      const start = date.startOf('day').toDate()
      const end   = date.endOf('day').toDate()

      // heads per hour
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

      // volume
      const fc = await prisma.volumeForecast.findMany({
        where: { date: { gte: start, lte: end }, role: req.query.role || undefined }
      })
      const ac = await prisma.volumeActual.findMany({
        where: { date: { gte: start, lte: end }, role: req.query.role || undefined }
      })

      const data = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        forecastCalls:
          fc.filter(f => dayjs(f.date).hour() === h)
            .reduce((s, f) => s + f.expectedCalls, 0),
        actualCalls:
          ac.filter(a => dayjs(a.date).hour() === h)
            .reduce((s, a) => s + a.calls, 0),
        staffedHeads: heads[h]
      }))

      res.json(data)
    } catch (err) {
      next(err)
    }
  })

  /* ─────────────────────────────────────────────────────────────┐
   * 2-A) Daily volume (actual + forecast)  (unchanged)
   * ─────────────────────────────────────────────────────────────*/
  // GET /api/reports/volume?role=…&start=YYYY-MM-DD&end=YYYY-MM-DD
  r.get('/volume', async (req, res, next) => {
    try {
      const { role, start, end } = req.query
      if (!role || !start || !end) {
        return res.status(400).json({ error: 'Missing required query params: role, start, end' })
      }

      const startDate = dayjs(start).startOf('day').toDate()
      const endDate   = dayjs(end)  .endOf('day').toDate()

      const [fcs, acs] = await Promise.all([
        prisma.volumeForecast.findMany({ where: { role, date: { gte: startDate, lte: endDate } } }),
        prisma.volumeActual.findMany({  where: { role, date: { gte: startDate, lte: endDate } } })
      ])

      const byDate = {}
      fcs.forEach(f => {
        const d = dayjs(f.date).format('YYYY-MM-DD')
        if (!byDate[d]) {
          byDate[d] = {
            date: d,
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
            date: d,
            forecastCalls:   0,
            forecastTickets: 0,
            actualCalls:     0,
            actualTickets:   0
          }
        }
        byDate[d].actualCalls   += a.calls
        byDate[d].actualTickets += a.tickets
      })

      res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
    } catch (err) {
      next(err)
    }
  })

  /* ─────────────────────────────────────────────────────────────┐
   * 2-B) NEW ➜ Daily *forecast-only* endpoint
   *       GET /api/reports/volume/forecast?role=…&start=…&end=…
   * ─────────────────────────────────────────────────────────────*/
  r.get('/volume/forecast', async (req, res, next) => {
    try {
      const { role, start, end } = req.query
      if (!role || !start || !end) {
        return res.status(400).json({ error: 'Missing required query params: role, start, end' })
      }

      const startDate = dayjs(start).startOf('day').toDate()
      const endDate   = dayjs(end)  .endOf('day').toDate()

      const fcs = await prisma.volumeForecast.findMany({
        where: { role, date: { gte: startDate, lte: endDate } }
      })

      const byDate = {}
      fcs.forEach(f => {
        const d = dayjs(f.date).format('YYYY-MM-DD')
        if (!byDate[d]) {
          byDate[d] = {
            date: d,
            forecastCalls:   0,
            forecastTickets: 0
          }
        }
        byDate[d].forecastCalls   += f.expectedCalls
        byDate[d].forecastTickets += f.expectedTickets
      })

      res.json(Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
    } catch (err) {
      next(err)
    }
  })

  /* ─────────────────────────────────────────────────────────────┐
   * 3) Hourly drill-down (now returns tickets too)  ★ CHANGED ★
   * ─────────────────────────────────────────────────────────────*/
  // GET /api/reports/volume/hourly?role=…&date=YYYY-MM-DD
  r.get('/volume/hourly', async (req, res, next) => {
    try {
      const { role, date } = req.query
      const start = dayjs(date).startOf('day').toDate()
      const end   = dayjs(date).endOf('day').toDate()

      const [fcs, acs] = await Promise.all([
        prisma.volumeForecast.findMany({ where: { role, date: { gte: start, lte: end } } }),
        prisma.volumeActual.findMany({  where: { role, date: { gte: start, lte: end } } })
      ])

      const hours = Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        forecastCalls:
          fcs.filter(f => dayjs(f.date).hour() === h)
             .reduce((s, f) => s + f.expectedCalls, 0),
        forecastTickets:
          fcs.filter(f => dayjs(f.date).hour() === h)
             .reduce((s, f) => s + f.expectedTickets, 0),
        actualCalls:
          acs.filter(a => dayjs(a.date).hour() === h)
             .reduce((s, a) => s + a.calls, 0),
        actualTickets:
          acs.filter(a => dayjs(a.date).hour() === h)
             .reduce((s, a) => s + a.tickets, 0)
      }))

      res.json(hours)
    } catch (err) {
      next(err)
    }
  })

  /* ─────────────────────────────────────────────────────────────┐
   * 4) Audit feed  (unchanged)
   * ─────────────────────────────────────────────────────────────*/
  r.get('/audit', async (req, res, next) => {
    try {
      const since = new Date(req.query.since || Date.now() - 86_400_000)
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
