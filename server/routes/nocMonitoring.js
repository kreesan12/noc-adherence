import { Router } from 'express'
import { verifyToken } from './auth.js'
import {
  getNocMonitoringConfigMeta,
  getNocMonitoringSnapshot,
  getNocMonitoringTier1PremisesMap,
  getNocMonitoringTelephonyPulse,
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

function parsePositiveInt(value, { min = 1, max = 500 } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

export default function nocMonitoringRoutes() {
  const r = Router()

  r.get('/current', verifyToken, async (req, res) => {
    const historyHours = parseHistoryHours(req.query.historyHours)
    const { snapshot, freshness, history } = await getNocMonitoringSnapshot({ autoRefresh: false, historyHours })
    res.json({
      snapshot,
      freshness,
      history,
      meta: getNocMonitoringConfigMeta()
    })
  })

  r.get('/telephony/current', verifyToken, async (req, res) => {
    const pulse = await getNocMonitoringTelephonyPulse()
    res.json({
      pulse,
      meta: {
        pollMsRecommended: 5000
      }
    })
  })

  r.get('/tier1-premises-map', verifyToken, async (req, res) => {
    const actor = actorFromUser(req.user)
    const clusterLimit = parsePositiveInt(req.query.clusterLimit, { min: 10, max: 300 })
    const payload = await getNocMonitoringTier1PremisesMap({ requestedBy: actor, clusterLimit })
    res.json(payload)
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
