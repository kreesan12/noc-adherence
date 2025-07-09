// server/routes/volume.js
import { Router } from 'express'
import dayjs       from 'dayjs'

export default prisma => {
  const r = Router()

  /* ──────────────────────────────────────────────────────────────
   *  🔎  Helpers
   * ──────────────────────────────────────────────────────────── */

  // pull the last N months of actual rows for a role
  async function loadActualSlice (role, monthsBack) {
    const from = dayjs()
      .subtract(monthsBack, 'month')
      .startOf('day')
      .toDate()

    return prisma.volumeActual.findMany({
      where: { role, date: { gte: from } }
    })
  }

  // very‐simple seasonal-naïve forecast: average by (weekday,hour)
  // feel free to replace with a more sophisticated model later
  function buildForecastRows (actualRows, horizonMonths, role) {
    /** aggregate by weekday|hour */
    const buckets = {} // { "2|14": { cSum, tSum, n } }
    actualRows.forEach(r => {
      const wd  = dayjs(r.date).day()       // 0-6
      const key = `${wd}|${r.hour}`         // e.g. "2|14"
      if (!buckets[key]) buckets[key] = { cSum: 0, tSum: 0, n: 0 }
      buckets[key].cSum += r.calls
      buckets[key].tSum += r.tickets
      buckets[key].n    += 1
    })

    /** average per bucket */
    const avgByKey = Object.fromEntries(
      Object.entries(buckets).map(([k, { cSum, tSum, n }]) => [
        k,
        { calls: Math.round(cSum / n), tickets: Math.round(tSum / n) }
      ])
    )

    /** explode into hourly rows for the horizon */
    const rows = []
    const horizonEnd = dayjs()
      .add(horizonMonths, 'month')
      .endOf('month')

    let cursor = dayjs().startOf('day')
    while (cursor.isSameOrBefore(horizonEnd, 'day')) {
      const wd = cursor.day()
      for (let h = 0; h < 24; h++) {
        const base = avgByKey[`${wd}|${h}`] || { calls: 0, tickets: 0 }
        rows.push({
          role,
          date:           cursor.toDate(),
          hour:           h,
          expectedCalls:   base.calls,
          expectedTickets: base.tickets
        })
      }
      cursor = cursor.add(1, 'day')
    }
    return rows
  }

  /* ──────────────────────────────────────────────────────────────
   *  📥  Upload forecast CSV rows
   *      body: { role, data:[{date,hour,calls,tickets}] }
   * ──────────────────────────────────────────────────────────── */
  r.post('/forecast', async (req, res) => {
    try {
      const { role, data } = req.body
      if (!Array.isArray(data)) {
        return res
          .status(400)
          .json({ ok: false, error: 'Invalid payload: data must be an array' })
      }

      const payload = data.map(d => ({
        role,
        date: new Date(d.date),
        hour: d.hour,
        expectedCalls:   d.calls,
        expectedTickets: d.tickets
      }))

      await prisma.volumeForecast.createMany({ data: payload })
      return res.json({ ok: true })
    } catch (err) {
      console.error('Error in POST /volume/forecast:', err)
      return res
        .status(500)
        .json({
          ok: false,
          error: 'Failed to save forecast data',
          details: err.message
        })
    }
  })

  /* ──────────────────────────────────────────────────────────────
   *  📥  Upload actual CSV rows
   *      body: { role, data:[{date,hour,calls,tickets}] }
   * ──────────────────────────────────────────────────────────── */
  r.post('/actual', async (req, res) => {
    try {
      const { role, data } = req.body
      if (!Array.isArray(data)) {
        return res
          .status(400)
          .json({ ok: false, error: 'Invalid payload: data must be an array' })
      }

      const payload = data.map(d => ({
        role,
        date: new Date(d.date),
        hour: d.hour,
        calls:   d.calls,
        tickets: d.tickets
      }))

      await prisma.volumeActual.createMany({ data: payload })
      return res.json({ ok: true })
    } catch (err) {
      console.error('Error in POST /volume/actual:', err)
      return res
        .status(500)
        .json({
          ok: false,
          error: 'Failed to save actual data',
          details: err.message
        })
    }
  })

  /* ──────────────────────────────────────────────────────────────
   *  🔮  Auto-generate forecast
   *      POST /api/volume/forecast/generate
   *      body: {
   *        role,
   *        lookBackMonths: 6,
   *        horizonMonths:  6,
   *        overwrite:      false
   *      }
   * ──────────────────────────────────────────────────────────── */
  r.post('/forecast/generate', async (req, res, next) => {
    try {
      const {
        role,
        lookBackMonths = 6,
        horizonMonths  = 6,
        overwrite      = false
      } = req.body

      if (!role) {
        return res.status(400).json({ error: '`role` is required' })
      }

      const actualRows = await loadActualSlice(role, lookBackMonths)
      if (!actualRows.length) {
        return res
          .status(400)
          .json({ error: 'Not enough actual data for the requested look-back window' })
      }

      const rows = buildForecastRows(actualRows, horizonMonths, role)

      if (overwrite) {
        // wipe any future forecast rows for this role from today onwards
        await prisma.volumeForecast.deleteMany({
          where: {
            role,
            date: { gte: dayjs().startOf('day').toDate() }
          }
        })
      }

      await prisma.volumeForecast.createMany({ data: rows })
      res.json({ ok: true, inserted: rows.length })
    } catch (err) {
      next(err)
    }
  })

  /* ──────────────────────────────────────────────────────────────
   *  🚑  Router-level error handler
   * ──────────────────────────────────────────────────────────── */
  r.use((err, _req, res, _next) => {
    console.error('Volume router error:', err)

    // large payloads (multer / body-parser)
    if (err.type === 'entity.too.large') {
      return res.status(413).json({
        ok: false,
        error: 'Payload too large – please split the file or compress it'
      })
    }

    // bad JSON
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid JSON',
        details: err.message
      })
    }

    // fallback
    res.status(500).json({ ok: false, error: err.message })
  })

  return r
}
