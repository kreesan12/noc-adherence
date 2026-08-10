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

function parseHistoryHours(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(24 * 14, Math.max(6, Math.round(parsed)))
}

export default function nocMonitoringRoutes() {
  const r = Router()

  r.get('/current', verifyToken, async (req, res) => {
    const historyHours = parseHistoryHours(req.query.historyHours)
    const { snapshot, freshness, history } = await getNocMonitoringSnapshot({ historyHours })
    res.json({
      snapshot,
      freshness,
      history,
      meta: getNocMonitoringConfigMeta()
    })
  })

  r.post('/refresh', verifyToken, async (req, res) => {
    const actor = actorFromUser(req.user)
    const historyHours = parseHistoryHours(req.query.historyHours)
    const { snapshot, freshness, history } = await refreshNocMonitoringSnapshot(actor, { historyHours })
    res.json({
      snapshot,
      freshness,
      history,
      meta: getNocMonitoringConfigMeta()
    })
  })

  return r
}
