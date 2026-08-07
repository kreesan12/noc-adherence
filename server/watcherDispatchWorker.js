import dayjs from 'dayjs'
import prisma from './lib/prisma.js'
import { recordWatcherAlert } from './lib/watcherAlertLog.js'

const POLL_MS = Math.max(5000, Number(process.env.WATCHER_DISPATCH_POLL_MS || 15000))
const MAX_BATCH = Math.min(Math.max(Number(process.env.WATCHER_DISPATCH_BATCH_SIZE || 10), 1), 50)

let workerStarted = false
let nextTimer = null

async function claimPendingRequests() {
  const rows = await prisma.watcherDispatchRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: MAX_BATCH
  })

  const claimed = []

  for (const row of rows) {
    const result = await prisma.watcherDispatchRequest.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: 'processing' }
    })
    if (result.count > 0) claimed.push(row)
  }

  return claimed
}

function normalizeGroupIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function normalizeMentionIds(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || '').trim()).filter(Boolean))]
}

function compactWatcherLabel(key) {
  switch (String(key || '').toLowerCase()) {
    case 'nld':
      return 'NLD'
    case 'backhaul':
      return 'Backhaul'
    case 'major_outage':
      return 'Major Outage'
    case 'vip':
      return 'VIP'
    default:
      return String(key || 'Watcher')
  }
}

function buildPayload(row, groups, result, error = null) {
  const mentionTargets = normalizeMentionIds(row.mentionJids)
  return {
    dispatchType: row.dispatchType,
    requestedBy: row.requestedBy || '',
    targetGroupCount: groups.length,
    targetGroups: groups,
    mentionTargetCount: mentionTargets.length,
    mentionTargets,
    sentGroups: result?.sent || [],
    failedGroups: result?.failed || [],
    error: error ? String(error?.message || error) : ''
  }
}

export function startWatcherDispatchWorker(sendSlaAlert) {
  if (workerStarted) return
  workerStarted = true

  console.log(`[WATCHER DISPATCH] Starting - poll ${Math.round(POLL_MS / 1000)}s, batch ${MAX_BATCH}`)

  function scheduleNext(run) {
    clearTimeout(nextTimer)
    nextTimer = setTimeout(run, POLL_MS)
    nextTimer.unref?.()
  }

  async function processRow(row) {
    const groups = normalizeGroupIds(row.targetGroupIds)
    const mentionJids = normalizeMentionIds(row.mentionJids)

    try {
      const result = await sendSlaAlert(row.message, {
        ...(groups.length ? { groupIds: groups } : {}),
        ...(mentionJids.length ? { mentionJids } : {})
      })
      await prisma.watcherDispatchRequest.update({
        where: { id: row.id },
        data: {
          status: 'sent',
          processedAt: new Date(),
          result: buildPayload(row, groups, result)
        }
      })

      await recordWatcherAlert({
        dedupeKey: `dispatch-request:${row.id}`,
        watcherKey: row.watcherKey,
        alertType: 'test_dispatch',
        entityId: row.id,
        payload: buildPayload(row, groups, result)
      })

      console.log(
        `[WATCHER DISPATCH] Sent ${row.dispatchType} for ${compactWatcherLabel(row.watcherKey)} to ${result?.sent?.length || 0} group(s) with ${mentionJids.length} mention target(s)`
      )
    } catch (error) {
      await prisma.watcherDispatchRequest.update({
        where: { id: row.id },
        data: {
          status: 'failed',
          processedAt: new Date(),
          result: buildPayload(row, groups, null, error)
        }
      })
      console.error(
        `[WATCHER DISPATCH] Failed ${row.dispatchType} for ${compactWatcherLabel(row.watcherKey)} request ${row.id}:`,
        error?.message || error
      )
    }
  }

  async function run() {
    const rows = await claimPendingRequests()
    for (const row of rows) {
      await processRow(row)
    }
  }

  async function tick() {
    try {
      await run()
    } catch (error) {
      console.error('[WATCHER DISPATCH] Tick error:', error?.message || error)
    } finally {
      scheduleNext(tick)
    }
  }

  void tick()
}

export function buildWatcherTestMessage({ watcherKey, requestedBy, groupIds = [], mentionJids = [] }) {
  const timestamp = dayjs().format('YYYY-MM-DD HH:mm:ss')
  const label = compactWatcherLabel(watcherKey)
  const targetText = groupIds.length ? `${groupIds.length} configured group(s)` : 'default WhatsApp group'
  const mentionText = mentionJids.length ? `${mentionJids.length} mention target(s)` : 'no mention targets configured'

  return [
    `${label} watcher test`,
    '',
    'This is a manual routing test from Frogfoot Ops Hub.',
    `Requested by: ${requestedBy || 'admin'}`,
    `Requested at: ${timestamp}`,
    `Target route: ${targetText}`,
    `Mentions: ${mentionText}`
  ].join('\n')
}
