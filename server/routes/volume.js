// server/routes/volume.js
import { Router } from 'express'
import dayjs      from '../utils/dayjs.js'

export default prisma => {
  const r = Router()

  /* ----------------------------------------------------------- *
   * 1)  Upload forecast CSV
   * ----------------------------------------------------------- */
  r.post('/forecast', async (req, res) => {
    try {
      const { role, data } = req.body
      if (!Array.isArray(data))
        return res.status(400).json({ ok:false, error:'data must be an array' })

      const rows = data.map(d => ({
        role,
        date:            new Date(d.date),
        hour:            d.hour,
        expectedCalls:   d.calls,
        expectedTickets: d.tickets
      }))
      await prisma.volumeForecast.createMany({ data: rows })
      return res.json({ ok:true })
    } catch (err) {
      console.error('Error POST /forecast:', err)
      return res.status(500).json({ ok:false, error:err.message })
    }
  })

  /* ----------------------------------------------------------- *
   * 2)  Upload actual CSV
   * ----------------------------------------------------------- */
  r.post('/actual', async (req, res) => {
    try {
      const { role, data } = req.body
      if (!Array.isArray(data))
        return res.status(400).json({ ok:false, error:'data must be an array' })

      const rows = data.map(d => ({
        role,
        date:    new Date(d.date),
        hour:    d.hour,
        calls:   d.calls,
        tickets: d.tickets,
        priority1:           d.priority1,
        autoDfaLogged:       d.autoDfa,
        autoMntLogged:       d.autoMnt,
        autoOutageLinked:    d.autoOutage,
        autoMntSolved:       d.auto_mnt_solved
      }))
      await prisma.volumeActual.createMany({ data: rows })
      return res.json({ ok:true })
    } catch (err) {
      console.error('Error POST /actual:', err)
      return res.status(500).json({ ok:false, error:err.message })
    }
  })

  /* ----------------------------------------------------------- *
   * 3)  Build forecast from historical actuals
   *     body: { role, lookBackMonths, horizonMonths, overwrite }
   * ----------------------------------------------------------- */
  r.post('/build-forecast', async (req, res) => {
    try {
      const {
        role,
        lookBackMonths = 6,
        horizonMonths  = 6,
        overwrite      = false
      } = req.body

      if (!role) {
        return res.status(400).json({ ok:false, error:'Missing role' })
      }

      /* 3-A) fetch history */
      const histStart = dayjs().subtract(lookBackMonths, 'month').startOf('day').toDate()
      const histEnd   = dayjs().subtract(1, 'day').endOf('day')              .toDate()

      const history = await prisma.volumeActual.findMany({
        where: {
          role,
          date: { gte: histStart, lte: histEnd }
        }
      })

      if (!history.length) {
        return res.status(400).json({ ok:false, error:'No historical data found' })
      }

      /* 3-B) averages by (dow,hour) */
      const bucket = {}                       // key = `${dow}|${hour}`
      history.forEach(r => {
        const dow  = dayjs(r.date).day()      // 0-6
        const key  = `${dow}|${r.hour}`
        const obj = bucket[key] || {
          calls:0, tickets:0,
          autoDfa:0, autoMnt:0, autoOut:0,
          n:0, autoMntSolved: 0
        }
        obj.calls    += (r.calls             ?? 0)
        obj.tickets  += (r.tickets           ?? 0)
        obj.autoDfa  += (r.autoDfaLogged     ?? 0)
        obj.autoMnt  += (r.autoMntLogged     ?? 0)
        obj.autoOut  += (r.autoOutageLinked  ?? 0)
        obj.autoMntSolved += (r.autoMntSolved ?? 0)
        obj.n        += 1
        bucket[key]   = obj
      })
      Object.values(bucket).forEach(b => {
        b.calls   = Math.round(b.calls   / b.n)
        b.tickets = Math.round(b.tickets / b.n)
        b.autoDfa  = Math.round(b.autoDfa  / b.n)
        b.autoMnt  = Math.round(b.autoMnt  / b.n)
        b.autoOut  = Math.round(b.autoOut  / b.n)
        b.autoMntSolved  = Math.round(autoMntSolved  / b.n)
      })

      /* 3-C) generate future rows */
      const startF  = dayjs().startOf('day')                // today
      const endF    = dayjs().add(horizonMonths,'month').endOf('day')
      const payload = []

      let cursor = startF
      while (cursor.isSameOrBefore(endF, 'day')) {
        const dow = cursor.day()
        for (let h = 0; h < 24; h++) {
          const b = bucket[`${dow}|${h}`]
          if (b) {
            payload.push({
              role,
              date:            cursor.toDate(),
              hour:            h,
              expectedCalls:   b.calls,
              expectedTickets: b.tickets,
              priority1:       0,          // keep if you plan to forecast this
              autoDfaLogged:   b.autoDfa,
              autoMntLogged:   b.autoMnt,
              autoOutageLinked:b.autoOut,
              autoMntSolved:   b.autoMntSolved
            })
          }
        }
        cursor = cursor.add(1, 'day')
      }

      /* 3-D) optional overwrite */
      if (overwrite) {
        await prisma.volumeForecast.deleteMany({
          where: {
            role,
            date: { gte: startF.toDate(), lte: endF.toDate() }
          }
        })
      }

      /* 3-E) insert */
      if (payload.length) {
        await prisma.volumeForecast.createMany({
          data: payload,
          skipDuplicates: true
        })
      }

      return res.json({ ok:true, inserted: payload.length })
    } catch (err) {
      console.error('Error POST /build-forecast:', err)
      return res.status(500).json({ ok:false, error:err.message })
    }
  })

  /* ----------------------------------------------------------- *
   * 4)  Router-level error handler
   * ----------------------------------------------------------- */
  r.use((err, _req, res, next) => {
    console.error('Volume router error:', err)
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ ok:false, error:'Payload too large' })
    }
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res.status(400).json({ ok:false, error:'Invalid JSON' })
    }
    next(err)
  })

  return r
}
