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

function normalizeIdList(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function formatActor(reqUser) {
  return String(
    reqUser?.email ||
    reqUser?.fullName ||
    reqUser?.name ||
    reqUser?.id ||
    'admin'
  ).trim()
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

    const actor = formatActor(req.user)
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

    const hasOverrideGroupIds = Array.isArray(req.body?.targetGroupIds)
    const hasOverrideMentionJids = Array.isArray(req.body?.mentionJids)
    const overrideGroupIds = normalizeIdList(req.body?.targetGroupIds)
    const overrideMentionJids = normalizeIdList(req.body?.mentionJids)

    const groupIds = hasOverrideGroupIds
      ? overrideGroupIds
      : Array.isArray(section.groupIds)
        ? normalizeIdList(section.groupIds)
        : []

    const mentionJids = hasOverrideMentionJids
      ? overrideMentionJids
      : Array.isArray(section.mentionJids)
        ? normalizeIdList(section.mentionJids)
        : []

    const requestedBy = formatActor(req.user)
    const message = buildWatcherTestMessage({
      watcherKey,
      requestedBy,
      groupIds,
      mentionJids
    })

    const row = await prisma.watcherDispatchRequest.create({
      data: {
        watcherKey,
        dispatchType: 'test',
        targetGroupIds: groupIds,
        mentionJids,
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
        mentionJids,
        status: row.status
      }
    })
  })

  return r
}
