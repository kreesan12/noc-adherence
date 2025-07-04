// server/routes/volume.js
import { Router } from 'express'
export default prisma => {
  const r = Router()

  // POST /api/volume/forecast
  // body: { role, data:[{ dayOfWeek, hour, calls, tickets }] }
  r.post('/forecast', async (req, res, next) => {
    try {
      const { role, data } = req.body
      // upsert each entry with role
      const payload = data.map(d => ({
        ...d,
        role,
        expectedCalls: d.calls,
        expectedTickets: d.tickets
      }))
      await prisma.volumeForecast.createMany({ data: payload })
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  // POST /api/volume/actual
  r.post('/actual', async (req, res, next) => {
    try {
      const { role, data } = req.body
      const payload = data.map(d => ({
        ...d,
        role,
        calls:   d.calls,
        tickets: d.tickets,
        eventTime: new Date()  // or compute from dayOfWeek+hour
      }))
      await prisma.volumeActual.createMany({ data: payload })
      res.json({ ok: true })
    } catch (err) { next(err) }
  })

  return r
}
