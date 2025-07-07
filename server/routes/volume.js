// server/routes/volume.js
import { Router } from 'express'

export default prisma => {
  const r = Router()

  // POST /api/volume/forecast
  // body: { role, data: [{ date, hour, calls, tickets }] }
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
        expectedTickets: d.tickets,
      }))

      await prisma.volumeForecast.createMany({ data: payload })
      return res.json({ ok: true })
    } catch (err) {
      console.error('Error in POST /forecast:', err)
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to save forecast data', details: err.message })
    }
  })

  // POST /api/volume/actual
  // body: { role, data: [{ date, hour, calls, tickets }] }
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
        tickets: d.tickets,
      }))

      await prisma.volumeActual.createMany({ data: payload })
      return res.json({ ok: true })
    } catch (err) {
      console.error('Error in POST /actual:', err)
      return res
        .status(500)
        .json({ ok: false, error: 'Failed to save actual data', details: err.message })
    }
  })

  // router-level error handler: catches body-parser and syntax errors
  r.use((err, _req, res, next) => {
    console.error('Volume router error:', err)
    // Payload too large
    if (err.type === 'entity.too.large') {
      return res
        .status(413)
        .json({
          ok: false,
          error: 'Payload too large: please split upload or reduce file size',
        })
    }
    // Invalid JSON
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
      return res
        .status(400)
        .json({ ok: false, error: 'Invalid JSON', details: err.message })
    }
    // fallback to the global handler
    next(err)
  })

  return r
}
