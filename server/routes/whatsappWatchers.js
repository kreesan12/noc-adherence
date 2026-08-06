import { Router } from 'express'
import prisma from '../lib/prisma.js'

import {
  getWhatsappWatcherConfig,
  getWhatsappWatcherConfigDefaults,
  saveWhatsappWatcherConfig,
  WHATSAPP_WATCHER_CONFIG_META
} from '../lib/whatsappWatcherConfig.js'
import { buildWatcherTestMessage } from '../watcherDispatchWorker.js'

const WATCHER_SECTION_MAP = {
  nld: 'nld',
  backhaul: 'backhaul',
  major_outage: 'majorOutage',
  vip: 'vip'
}

export default function whatsappWatchersRouter() {
  const r = Router()

  r.get('/', async (_req, res) => {
    const config = await getWhatsappWatcherConfig({ forceFresh: true })
    res.json({
      config,
      defaults: getWhatsappWatcherConfigDefaults(),
      meta: WHATSAPP_WATCHER_CONFIG_META
    })
  })

  r.put('/', async (req, res) => {
    const payload = req.body?.config ?? req.body
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'A watcher config object is required.' })
    }

    const actor = req.user?.email || req.user?.fullName || req.user?.id || 'admin'
    const config = await saveWhatsappWatcherConfig(payload, actor)
    res.json({
      config,
      meta: WHATSAPP_WATCHER_CONFIG_META
    })
  })

  r.get('/history', async (req, res) => {
    const watcherKey = String(req.query.watcherKey || '').trim().toLowerCase()
    const limit = Math.min(Math.max(Number(req.query.limit || 50) || 50, 1), 200)

    const rows = await prisma.watcherAlertLog.findMany({
      where: watcherKey ? { watcherKey } : undefined,
      orderBy: { sentAt: 'desc' },
      take: limit
    })

    res.json({
      rows
    })
  })

  r.post('/test', async (req, res) => {
    const watcherKey = String(req.body?.watcherKey || '').trim().toLowerCase()
    const sectionKey = WATCHER_SECTION_MAP[watcherKey]

    if (!sectionKey) {
      return res.status(400).json({ error: 'A valid watcher key is required.' })
    }

    const config = await getWhatsappWatcherConfig({ forceFresh: true })
    const section = config?.[sectionKey]
    if (!section) {
      return res.status(400).json({ error: 'Watcher config section not found.' })
    }

    const groupIds = Array.isArray(section.groupIds)
      ? [...new Set(section.groupIds.map((value) => String(value || '').trim()).filter(Boolean))]
      : []

    const requestedBy = req.user?.email || req.user?.fullName || req.user?.id || 'admin'
    const message = buildWatcherTestMessage({
      watcherKey,
      requestedBy,
      groupIds
    })

    const row = await prisma.watcherDispatchRequest.create({
      data: {
        watcherKey,
        dispatchType: 'test',
        targetGroupIds: groupIds,
        message,
        requestedBy,
        status: 'pending'
      }
    })

    res.json({
      ok: true,
      queued: {
        id: row.id,
        watcherKey,
        targetGroupIds: groupIds,
        status: row.status
      }
    })
  })

  return r
}
