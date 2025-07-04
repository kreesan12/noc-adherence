// server/routes/volume.js
import { Router } from 'express'
export default prisma => {
  const r = Router()

  // POST /api/volume/forecast
  // body: { role, data: [{ date, hour, calls, tickets }] }
  r.post('/forecast', async (req, res, next) => {
    try {
      const { role, data } = req.body
      const payload = data.map(d => ({
        role,
        date: new Date(d.date),
        hour: d.hour,
        expectedCalls:   d.calls,
        expectedTickets: d.tickets
      }))
      await prisma.volumeForecast.createMany({ data: payload })
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  // POST /api/volume/actual
  // body: { role, data: [{ date, hour, calls, tickets }] }
  r.post('/actual', async (req, res, next) => {
    try {
      const { role, data } = req.body
      const payload = data.map(d => ({
        role,
        date: new Date(d.date),
        hour: d.hour,
        calls:   d.calls,
        tickets: d.tickets
      }))
      await prisma.volumeActual.createMany({ data: payload })
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return r
}
