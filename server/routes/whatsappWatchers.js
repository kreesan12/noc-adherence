import { Router } from 'express'
import prisma from '../lib/prisma.js'

import {
  getWhatsappWatcherConfig,
  getWhatsappWatcherConfigDefaults,
  saveWhatsappWatcherConfig,
  WHATSAPP_WATCHER_CONFIG_META
} from '../lib/whatsappWatcherConfig.js'

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

  return r
}
