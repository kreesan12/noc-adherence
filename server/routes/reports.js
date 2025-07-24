// server/routes/reports.js
import { Router } from 'express'
import dayjs      from '../utils/dayjs.js'

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
            actualTickets:   0,
            manualTickets:   0,
            autoDfa:         0,
            autoMnt:         0,
            autoOutage:      0,
            autoMntSolved:   0
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
            actualTickets:   0,
            manualTickets:   0,
            autoDfa:         0,
            autoMnt:         0,
            autoOutage:      0,
            autoMntSolved:   0
          }
        }
        byDate[d].actualCalls += (a.calls ?? 0)
        byDate[d].actualTickets += (a.tickets ?? 0)

        const autoDfa = a.autoDfaLogged      ?? 0
        const autoMnt = a.autoMntLogged      ?? 0
        const autoOut = a.autoOutageLinked   ?? 0
        const autoSolved = a.autoMntSolved   ?? 0
        const autoSum = autoDfa + autoMnt + autoOut + autoSolved

        byDate[d].manualTickets += (a.tickets ?? 0) - autoSum
        byDate[d].autoDfa       += autoDfa
        byDate[d].autoMnt       += autoMnt
        byDate[d].autoOutage    += autoOut
        byDate[d].autoMntSolved += autoSolved
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
            forecastTickets: 0,
            manualTickets:   0,
            autoDfa:         0,
            autoMnt:         0,
            autoOutage:      0
          }
        }
        byDate[d].forecastCalls   += f.expectedCalls
        byDate[d].forecastTickets += f.expectedTickets
        /* ── automation breakdown ───────────────────────────── */
        const autoDfa = f.autoDfaLogged     ?? 0
        const autoMnt = f.autoMntLogged     ?? 0
        const autoOut = f.autoOutageLinked  ?? 0
        const autoSolved = f.autoMntSolved  ?? 0
        const autoSum = autoDfa + autoMnt + autoOut + autoSolved
        
        byDate[d].manualTickets += f.expectedTickets - autoSum
        byDate[d].autoDfa       += autoDfa
        byDate[d].autoMnt       += autoMnt
        byDate[d].autoOutage    += autoOut
        byDate[d].autoMntSolved   += autoSolved 
        
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

      const hours = Array.from({ length: 24 }, (_, h) => {
        const fcHour = fcs.filter(f => dayjs(f.date).hour() === h)
        const acHour = acs.filter(a => dayjs(a.date).hour() === h)

        const autoDfa = acHour.reduce((s,a)=> s + (a.autoDfaLogged    ?? 0), 0)
        const autoMnt = acHour.reduce((s,a)=> s + (a.autoMntLogged    ?? 0), 0)
        const autoOut = acHour.reduce((s,a)=> s + (a.autoOutageLinked ?? 0), 0)
        const autoSolved = acHour.reduce((s,a)=> s + (a.autoMntSolved    ?? 0), 0)
        const autoSum    = autoDfa + autoMnt + autoOut + autoSolved

        return {
          hour: h,
          forecastCalls:   fcHour.reduce((s,f)=>s+f.expectedCalls  ,0),
          forecastTickets: fcHour.reduce((s,f)=>s+f.expectedTickets,0),
          actualCalls:     acHour.reduce((s,a)=> s + (a.calls   ?? 0), 0),
          actualTickets:   acHour.reduce((s,a)=> s + (a.tickets ?? 0), 0),
          manualTickets:   acHour.reduce((s,a)=> s + (a.tickets ?? 0), 0) - autoSum,
          autoSolved,
          autoDfa,
          autoMnt,
          autoOutage:      autoOut
        }
      })
      res.json(hours)
    } catch (err) {
      next(err)
    }
  })

  /* ─────────────────────────────────────────────────────────────┐
  * 4) Quick helper – default head-count range
  *     GET /api/reports/headcount/quick?gran=month|week
  *           • from = today – 6 months (start-of-month)
  *           • to   = end of next month
  *           • gran defaults to "month"
  *   Returns the same shape as /reports/headcount so the front-end
  *   can call it without choosing dates.
  * ─────────────────────────────────────────────────────────────*/
  r.get('/headcount/quick', async (req, res, next) => {
    try {
      const gran = req.query.gran === 'week' ? 'week' : 'month';           // default = month

      const from = dayjs().subtract(6, 'month').startOf('month')
                  .format('YYYY-MM-DD');   // e.g. 2025-01-01
      const to   = dayjs().add(1, 'month').endOf('month')
                  .format('YYYY-MM-DD');   // e.g. 2025-08-31

      // Re-use your existing headcount SQL with the same logic  
      const step = gran === 'week'
        ? "interval '1 week'"
        : "interval '1 month'";

      const fmt  = gran === 'week'
        ? "to_char(m.mon, 'IYYY-\"W\"IW')"      // 2025-W32
        : "to_char(m.mon, 'YYYY-MM')";          // 2025-03

      const raw = await prisma.$queryRawUnsafe(`
        WITH periods AS (
          SELECT generate_series($1::date, $2::date, ${step}) mon
        )
        SELECT
          t.name,
          ${fmt} AS period,
          COUNT(e.id) AS headcount,
          COUNT(v.id) FILTER (
            WHERE v.status IN (
              'OPEN','AWAITING_APPROVAL','APPROVED','INTERVIEWING','OFFER_SENT'
            )
          ) AS vacancies
        FROM periods m
        CROSS JOIN "Team" t
        LEFT JOIN "Engagement" e
          ON e."teamId" = t.id
        AND e."startDate" <= m.mon + ${step} - interval '1 day'
        AND (e."endDate" IS NULL OR e."endDate" >= m.mon)
        LEFT JOIN "Vacancy" v
          ON v."teamId" = t.id
        AND v."openFrom" <= m.mon + ${step} - interval '1 day'
        GROUP BY t.name, period
        ORDER BY t.name, period
      `, [from, to]);

      res.json(raw.map(r => ({
        name:       r.name,
        period:     r.period,
        headcount:  Number(r.headcount),
        vacancies:  Number(r.vacancies)
      })));
    } catch (err) {
      next(err);
    }
  });


  /* ─────────────────────────────────────────────────────────────┐
   * 5) Audit feed  (unchanged)
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
