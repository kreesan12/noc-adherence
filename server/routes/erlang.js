// server/routes/erlang.js
import { Router } from 'express'
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

  return r
}
