// server/routes/erlang.js
import { Router } from 'express'
import dayjs from 'dayjs' 
import { requiredAgents } from '../utils/erlang.js'

export default prisma => {
  const r = Router()

  // POST /api/erlang/staff
  // body: { callsPerHour, ahtSeconds, serviceLevel, thresholdSeconds, shrinkage }
  r.post('/staff', (req, res, next) => {
    try {
      const { callsPerHour, ahtSeconds, serviceLevel, thresholdSeconds, shrinkage } = req.body
      const agents = requiredAgents({ callsPerHour, ahtSeconds, targetServiceLevel: serviceLevel, serviceThresholdSeconds: thresholdSeconds, shrinkage })
      res.json({ requiredAgents: agents })
    } catch (err) {
      next(err)
    }
  })

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

      // 1) figure date window
      const start = dayjs(date).startOf('day').toDate()
      const end   = dayjs(date).endOf('day')  .toDate()

      // 2) pull all actuals for that role + day
      const actuals = await prisma.volumeActual.findMany({
        where: { role, date: { gte: start, lte: end } }
      })

      // 3) group into 0–23 slots
      const hours = Array.from({ length: 24 }, (_, h) => {
        const slice = actuals.filter(a => a.hour === h)
        const calls   = slice.reduce((sum, a) => sum + a.calls,   0)
        const tickets = slice.reduce((sum, a) => sum + a.tickets, 0)
        return { hour: h, calls, tickets }
      })

      // 4) compute required agents per hour
      const staffing = hours.map(({ hour, calls, tickets }) => {
        const callAgents   = requiredAgents({
          callsPerHour: calls,
          ahtSeconds:   callAhtSeconds,
          targetServiceLevel:   serviceLevel,
          serviceThresholdSeconds: thresholdSeconds,
          shrinkage
        })
        const ticketAgents = requiredAgents({
          callsPerHour: tickets,
          ahtSeconds:   ticketAhtSeconds,
          targetServiceLevel:   serviceLevel,
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

      return res.json(staffing)
    } catch (err) {
      next(err)
    }
  })

  return r
}
