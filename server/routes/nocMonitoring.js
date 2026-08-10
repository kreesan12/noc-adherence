import { Router } from 'express'
import { verifyToken } from './auth.js'
import {
  getNocMonitoringConfigMeta,
  getNocMonitoringSnapshot,
  refreshNocMonitoringSnapshot
} from '../lib/nocMonitoring.js'

function actorFromUser(user) {
  return String(
    user?.email ||
    user?.fullName ||
    user?.name ||
    user?.id ||
    'ops-hub-user'
  ).trim()
}

export default function nocMonitoringRoutes() {
  const r = Router()

  r.get('/current', verifyToken, async (_req, res) => {
    const { snapshot, freshness } = await getNocMonitoringSnapshot()
    res.json({
      snapshot,
      freshness,
      meta: getNocMonitoringConfigMeta()
    })
  })

  r.post('/refresh', verifyToken, async (req, res) => {
    const actor = actorFromUser(req.user)
    const { snapshot, freshness } = await refreshNocMonitoringSnapshot(actor)
    res.json({
      snapshot,
      freshness,
      meta: getNocMonitoringConfigMeta()
    })
  })

  return r
}
