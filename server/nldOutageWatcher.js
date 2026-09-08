import dayjs from 'dayjs'
import {
  compactText,
  fetchJsonWithTimeout,
  formatAgeHours,
  formatAgeMinutes,
  formatPlural,
  formatTimestamp,
  isSolvedStatus,
  makeAuthHeader,
  makeTtlCache,
  zendeskAgentTicketLink
} from './lib/watcherUtils.js'
import { recordWatcherAlert } from './lib/watcherAlertLog.js'
import { getWhatsappWatcherConfig } from './lib/whatsappWatcherConfig.js'
import {
  buildTicketSummary as buildBackhaulSummary,
  fetchActiveBackhaulTickets,
  fetchRecentlyUpdatedBackhaulTickets
} from './backhaulWatcher.js'
import {
  buildSummary as buildMajorOutageSummary,
  fetchActiveMajorOutages,
  fetchRecentlyUpdatedMajorOutages,
  isMajorOutageTicket
} from './majorOutageWatcher.js'
import {
  buildOutageRouteIndex,
  findPartialClusters,
  findPartialNotLogged,
  normalizeRoute,
  transformPartialNldAlerts
} from './lib/nldEventUtils.js'

const CACHE_TTL_HOURS = Number(process.env.NLD_CACHE_TTL_HOURS || 72)
const CACHE_MAX_KEYS = Number(process.env.NLD_CACHE_MAX_KEYS || 5000)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[NLD WATCHER] Zendesk env vars missing; watcher will not run')
}

const TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000
const warnedRecent = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedBreach = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedDigest = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedPartialClusters = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedPartialNotLogged = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)

function isNldTicket(ticket) {
  return String(ticket.subject || '').toUpperCase().includes('NLD')
}

function cf(ticket, id) {
  const field = (ticket.custom_fields || []).find((item) => String(item.id) === String(id))
  const value = field?.value
  if (Array.isArray(value)) return value[0]
  return value ?? ''
}

function makeHeaders() {
  return {
    Authorization: makeAuthHeader(ZENDESK_EMAIL, ZENDESK_API_TOKEN),
    'Content-Type': 'application/json'
  }
}

async function fetchOutageTickets() {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', 'group:5160847905297 form:"Outage Capturing" status<solved')
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

async function fetchRecentlyUpdatedOutages(resolvedLookbackHours) {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `group:5160847905297 form:"Outage Capturing" updated>${resolvedLookbackHours}hours`
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

function enrichOutageTicket(ticket, now) {
  const created = dayjs(ticket.created_at)
  const updated = dayjs(ticket.updated_at)

  const ageMinutes = created.isValid() ? now.diff(created, 'minute', true) : NaN
  const ageHours = created.isValid() ? now.diff(created, 'hour', true) : NaN
  const totalHours = created.isValid() && updated.isValid()
    ? updated.diff(created, 'hour', true)
    : ageHours

  return {
    id: ticket.id,
    status: String(ticket.status || ''),
    subject: ticket.subject,
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    ageMinutes,
    ageHours,
    totalHours,
    subscriberImpact: Number(cf(ticket, 5552674828049)) || 0,
    nld: cf(ticket, 40137360073617) || '',
    lastUpdateNote: compactText(cf(ticket, 5352766585489) || '', 180),
    liquidRef: cf(ticket, 7657816716433) || '',
    liquidCircuit: cf(ticket, 8008871186961) || ''
  }
}

function formatLastUpdate(ticket) {
  return ticket.lastUpdateNote || formatTimestamp(ticket.updated_at)
}

function buildLiquidSummary(ticket) {
  const parts = []
  if (ticket.liquidRef) parts.push(`Ref ${ticket.liquidRef}`)
  if (ticket.liquidCircuit) parts.push(`Circuit ${ticket.liquidCircuit}`)
  return parts.join(' | ')
}

function buildRecentMsg(tickets, templates) {
  if (!tickets.length) return null

  const lines = [`${templates.recentTitle} | ${formatPlural(tickets.length, 'new item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(
      `#${ticket.id} | ${ticket.nld || 'Route unknown'} | ${ticket.subscriberImpact} subs | ${formatAgeMinutes(ticket.ageMinutes)} open`
    )
    if (ticket.subject) lines.push(`Subject: ${compactText(ticket.subject)}`)
    const liquid = buildLiquidSummary(ticket)
    if (liquid) lines.push(`Liquid: ${liquid}`)
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildBreachMsg(tickets, breachHours, templates) {
  if (!tickets.length) return null

  const lines = [`${templates.breachTitle} | ${breachHours}h | ${formatPlural(tickets.length, 'item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(
      `#${ticket.id} | ${ticket.nld || 'Route unknown'} | ${ticket.subscriberImpact} subs | ${formatAgeHours(ticket.ageHours)} open`
    )
    lines.push(`Last update: ${formatLastUpdate(ticket)}`)
    if (ticket.subject) lines.push(`Subject: ${compactText(ticket.subject)}`)
    const liquid = buildLiquidSummary(ticket)
    if (liquid) lines.push(`Liquid: ${liquid}`)
    if (templates.breachAction) lines.push(`Action: ${templates.breachAction}`)
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

export function getDigestWindow(now, intervalMinutes) {
  const intervalMs = Math.max(15, Number(intervalMinutes) || 60) * 60 * 1000
  const currentBucket = Math.floor(now.valueOf() / intervalMs)
  const completedBucket = currentBucket - 1

  return {
    bucket: completedBucket,
    startMs: completedBucket * intervalMs,
    endMs: currentBucket * intervalMs
  }
}

function buildAgeBuckets(openOutages, breachHours) {
  const buckets = { underOne: 0, oneToTwo: 0, twoToBreach: 0, breached: 0 }

  for (const outage of openOutages) {
    const age = Number(outage.ageHours)
    if (!Number.isFinite(age) || age < 1) buckets.underOne += 1
    else if (age < 2) buckets.oneToTwo += 1
    else if (age < breachHours) buckets.twoToBreach += 1
    else buckets.breached += 1
  }

  return buckets
}

function countBreachRows(rows, breachHours) {
  return rows.filter((row) => Number(row.ageHours) >= breachHours).length
}

function totalSubscriberImpact(rows) {
  return rows.reduce((sum, row) => sum + (Number(row.subscriberImpact) || 0), 0)
}

function asDigestLaneRows(rows, lane, getLabel) {
  return rows.map((row) => ({
    ...row,
    lane,
    laneLabel: getLabel(row),
    ageMinutes: Number(row.ageHours) * 60
  }))
}

async function collectOperationsDigestLanes(now, digestWindow, watcherConfig) {
  const backhaulConfig = watcherConfig.backhaul || {}
  const majorConfig = watcherConfig.majorOutage || {}
  const results = await Promise.allSettled([
    backhaulConfig.enabled !== false && backhaulConfig.tag
      ? fetchActiveBackhaulTickets(backhaulConfig.tag)
      : Promise.resolve([]),
    majorConfig.enabled !== false
      ? fetchActiveMajorOutages()
      : Promise.resolve([]),
    backhaulConfig.enabled !== false && backhaulConfig.tag
      ? fetchRecentlyUpdatedBackhaulTickets(backhaulConfig.tag, backhaulConfig.resolvedLookbackHours || 24)
      : Promise.resolve([]),
    majorConfig.enabled !== false
      ? fetchRecentlyUpdatedMajorOutages(majorConfig.resolvedLookbackHours || 24)
      : Promise.resolve([])
  ])
  const [activeBackhaul, activeMajorOutages, updatedBackhaul, updatedMajorOutages] = results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value
    const lane = ['backhaul open', 'major outage open', 'backhaul closures', 'major outage closures'][index]
    console.warn(`[NLD WATCHER] Digest ${lane} query failed; continuing with available lanes:`, result.reason?.message || result.reason)
    return []
  })
  const wasUpdatedInWindow = (ticket) => {
    const updatedAtMs = dayjs(ticket.updated_at).valueOf()
    return updatedAtMs >= digestWindow.startMs && updatedAtMs < digestWindow.endMs
  }

  return {
    backhaulOpen: activeBackhaul.map((ticket) => buildBackhaulSummary(ticket, now)),
    majorOutageOpen: activeMajorOutages
      .filter(isMajorOutageTicket)
      .map((ticket) => buildMajorOutageSummary(ticket, now)),
    backhaulResolved: updatedBackhaul
      .filter((ticket) => isSolvedStatus(ticket.status) && wasUpdatedInWindow(ticket))
      .map((ticket) => buildBackhaulSummary(ticket, now)),
    majorOutageResolved: updatedMajorOutages
      .filter((ticket) => isMajorOutageTicket(ticket) && isSolvedStatus(ticket.status) && wasUpdatedInWindow(ticket))
      .map((ticket) => buildMajorOutageSummary(ticket, now))
  }
}

export function buildDigestMsg({
  openOutages,
  resolvedOutages,
  clusters,
  notLogged,
  now,
  config,
  backhaulOpen = [],
  majorOutageOpen = [],
  backhaulResolved = [],
  majorOutageResolved = []
}) {
  const templates = config.templates || {}
  const breachHours = config.breachThresholdsHours[0] || 4
  const allOpen = [
    ...asDigestLaneRows(openOutages, 'NLD', (row) => row.nld || 'Route unknown'),
    ...asDigestLaneRows(backhaulOpen, 'Backhaul', (row) => row.subject || 'Backhaul ticket'),
    ...asDigestLaneRows(majorOutageOpen, 'Outage', (row) => row.region || row.subject || 'Major outage')
  ]
  const buckets = buildAgeBuckets(allOpen, breachHours)
  const cap = Math.max(1, Number(config.digestMaxItems) || 5)
  const oldest = [...allOpen]
    .sort((left, right) => (Number(right.ageMinutes) || 0) - (Number(left.ageMinutes) || 0))
    .slice(0, cap)
  const recentlyResolved = [...resolvedOutages]
    .sort((left, right) => String(right.updated_at || '').localeCompare(String(left.updated_at || '')))
    .slice(0, cap)

  const lines = [
    `${templates.digestTitle || 'NLD operations position'} | ${now.format('HH:mm')}`,
    '',
    `NLD: ${openOutages.length} open | ${totalSubscriberImpact(openOutages)} subs | ${countBreachRows(openOutages, breachHours)} over ${breachHours}h`,
    `Backhaul: ${backhaulOpen.length} open | ${countBreachRows(backhaulOpen, breachHours)} over ${breachHours}h | Major outage: ${majorOutageOpen.length} open | ${totalSubscriberImpact(majorOutageOpen)} subs | ${countBreachRows(majorOutageOpen, breachHours)} over ${breachHours}h`,
    `All live aging: <1h ${buckets.underOne} | 1-2h ${buckets.oneToTwo} | 2-${breachHours}h ${buckets.twoToBreach} | ${breachHours}h+ ${buckets.breached}`,
    `Partial pressure: ${clusters.length} cluster${clusters.length === 1 ? '' : 's'} | ${notLogged.length} not logged`,
    ''
  ]

  if (oldest.length) {
    lines.push('Oldest open')
    oldest.forEach((outage) => {
      const impact = Number(outage.subscriberImpact) ? ` | ${outage.subscriberImpact} subs` : ''
      lines.push(`${outage.lane} #${outage.id} | ${outage.laneLabel}${impact} | ${formatAgeHours(outage.ageHours)}`)
    })
    lines.push('')
  }

  const closureSummary = `NLD ${resolvedOutages.length} | Backhaul ${backhaulResolved.length} | Major outage ${majorOutageResolved.length}`
  if (recentlyResolved.length || backhaulResolved.length || majorOutageResolved.length) {
    lines.push(`${templates.resolvedTitle || 'NLD closures'} since last digest: ${closureSummary}`)
    recentlyResolved.forEach((outage) => {
      lines.push(`#${outage.id} | ${outage.nld || 'Route unknown'} | ${outage.subscriberImpact} subs | ${formatAgeHours(outage.totalHours)} total`)
    })
    lines.push('')
  }

  lines.push('Use the Ops Hub for the full live workbench and ticket links.')
  return lines.join('\n')
}

async function fetchPartialNldAlertsRaw() {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    'type:ticket tags:partial_nld_alert requester:"IRIS API" -tags:"partial_nld_alert_duplicate_solved"'
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

// Builds the same completed-window position used by the scheduled digest. It is
// exported for the admin-triggered run so manual tests use the production data path.
export async function buildCurrentNldOperationsDigest({ now = dayjs(), watcherConfig }) {
  const config = watcherConfig?.nld
  if (!config) throw new Error('NLD watcher configuration is unavailable.')

  const digestWindow = getDigestWindow(now, config.digestIntervalMinutes)
  const rawOutages = await fetchOutageTickets()
  const openOutages = rawOutages
    .filter(isNldTicket)
    .map((ticket) => enrichOutageTicket(ticket, now))

  const updatedOutages = await fetchRecentlyUpdatedOutages(config.resolvedLookbackHours)
  const resolvedOutages = updatedOutages
    .filter((ticket) => isNldTicket(ticket) && isSolvedStatus(ticket.status))
    .map((ticket) => enrichOutageTicket(ticket, now))
    .filter((ticket) => {
      const updatedAtMs = dayjs(ticket.updated_at).valueOf()
      return updatedAtMs >= digestWindow.startMs && updatedAtMs < digestWindow.endMs
    })

  const rawPartial = await fetchPartialNldAlertsRaw()
  const partialEvents = transformPartialNldAlerts(rawPartial, {
    partialLookbackHours: config.partialLookbackHours,
    zendeskSubdomain: ZENDESK_SUBDOMAIN
  })
  const clusters = findPartialClusters(partialEvents, {
    nowMs: now.valueOf(),
    clusterWindowHours: config.clusterWindowHours,
    clusterMinEvents: config.clusterMinEvents
  })
  const notLogged = findPartialNotLogged(partialEvents, buildOutageRouteIndex(openOutages), {
    partialNotLoggedMinutes: config.notLoggedMinutes
  })
  const operations = await collectOperationsDigestLanes(now, digestWindow, watcherConfig)

  return {
    message: buildDigestMsg({
      openOutages,
      resolvedOutages,
      clusters,
      notLogged,
      now,
      config,
      ...operations
    }),
    payload: {
      digestBucket: digestWindow.bucket,
      windowStart: new Date(digestWindow.startMs).toISOString(),
      windowEnd: new Date(digestWindow.endMs).toISOString(),
      openCount: openOutages.length,
      resolvedCount: resolvedOutages.length,
      backhaulOpenCount: operations.backhaulOpen.length,
      backhaulResolvedCount: operations.backhaulResolved.length,
      majorOutageOpenCount: operations.majorOutageOpen.length,
      majorOutageResolvedCount: operations.majorOutageResolved.length,
      partialClusters: clusters.length,
      partialNotLogged: notLogged.length
    }
  }
}

function buildPartialClusterMsg(clusters, { title, clusterWindowHours, action }) {
  if (!clusters.length) return null

  const lines = [`${title} | ${formatPlural(clusters.length, 'route')}`, '']

  clusters.forEach((cluster) => {
    const circuitCount = new Set(cluster.events.map((event) => event.circuit)).size
    lines.push(cluster.routeKey)
    lines.push(`Events: ${cluster.events.length} in ${clusterWindowHours}h | Unique circuits: ${circuitCount}`)
    lines.push(`Latest ticket: #${cluster.last.ticketId} | ${formatTimestamp(cluster.last.created_at)}`)
    if (action) lines.push(`Action: ${action}`)
    lines.push(`Link: ${cluster.last.ticketUrl}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildPartialNotLoggedMsg(events, { title, action }) {
  if (!events.length) return null

  const lines = [`${title} | ${formatPlural(events.length, 'active item')}`, '']

  events.forEach((event) => {
    lines.push(`#${event.ticketId} | ${event.eventGroup} | ${event.nldRoute || event.partialCircuit || 'Route unknown'}`)
    lines.push(`Age: ${formatAgeMinutes(event.ageMinutes)} | Circuit: ${event.circuit}`)
    if (action) lines.push(`Action: ${action}`)
    lines.push(`Link: ${event.ticketUrl}`)
    lines.push('')
  })

  return lines.join('\n')
}

let watcherStarted = false
let nextTimer = null
let lastDigestBucket = null
let whatsappUnavailableWarned = false

async function shouldSendAlert(cache, details) {
  if (cache.has(details.dedupeKey)) return false

  const persisted = await recordWatcherAlert(details)
  cache.add(details.dedupeKey)

  if (persisted === false) return false
  return true
}

function scheduleNext(run, delayMs) {
  clearTimeout(nextTimer)
  const wait = Math.max(30 * 1000, Number(delayMs) || 5 * 60 * 1000)
  nextTimer = setTimeout(run, wait)
  nextTimer.unref?.()
}

function describeGroups(groupIds) {
  if (!Array.isArray(groupIds) || !groupIds.length) return 'default group'
  return `${groupIds.length} group${groupIds.length === 1 ? '' : 's'} | ${groupIds.join(', ')}`
}

export function startNldOutageWatcher(sendSlaAlert, isWhatsAppReady = () => true) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[NLD WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  void getWhatsappWatcherConfig().then(({ nld }) => {
    const baseline = nld.breachThresholdsHours[0] || 4
    const groupLabel = describeGroups(nld.groupIds)
    console.log(
      `[NLD WATCHER] Starting - window ${nld.windowMinutes} min, immediate breach ${baseline} h, poll ${Math.round(nld.pollMs / 1000)}s, group ${groupLabel}`
    )
    console.log(`[NLD WATCHER] Aging tiers - ${nld.breachThresholdsHours.join(', ')} hours; digest ${nld.digestEnabled === false ? 'off' : `every ${nld.digestIntervalMinutes || 60}m`}`)
    console.log(
      `[NLD WATCHER] Partial - lookback ${nld.partialLookbackHours}h, cluster ${nld.clusterMinEvents} events / ${nld.clusterWindowHours}h, not-logged >= ${nld.notLoggedMinutes} min`
    )
    console.log(`[NLD WATCHER] Resolved lookback - ${nld.resolvedLookbackHours}h`)
  }).catch(() => {})
  console.log(`[NLD WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const run = async () => {
    let config
    let watcherConfig

    try {
      const stored = await getWhatsappWatcherConfig()
      watcherConfig = stored
      config = stored.nld
    } catch (error) {
      console.error('[NLD WATCHER] Config load failed:', error?.message || error)
      scheduleNext(run, 5 * 60 * 1000)
      return
    }

    if (!config.enabled) {
      scheduleNext(run, config.pollMs)
      return
    }

    if (!isWhatsAppReady()) {
      if (!whatsappUnavailableWarned) {
        console.warn('[NLD WATCHER] WhatsApp is not linked; deferring alert processing without recording dedupe state')
        whatsappUnavailableWarned = true
      }
      scheduleNext(run, config.pollMs)
      return
    }
    whatsappUnavailableWarned = false

    const sendNld = async (message, { mention = true } = {}) => {
      await sendSlaAlert(message, {
        ...(config.groupIds?.length ? { groupIds: config.groupIds } : {}),
        ...(mention && config.mentionJids?.length ? { mentionJids: config.mentionJids } : {})
      })
    }

    try {
      const now = dayjs()
      const rawOutages = await fetchOutageTickets()

      const recent = []
      const openOutages = []
      const immediateBreachHours = config.breachThresholdsHours[0] || 4
      const immediateBreaches = []
      const digestWindow = getDigestWindow(now, config.digestIntervalMinutes)

      for (const ticket of rawOutages) {
        if (!isNldTicket(ticket)) continue

        const outage = enrichOutageTicket(ticket, now)
        openOutages.push(outage)

        if (outage.ageMinutes >= 0 && outage.ageMinutes <= config.windowMinutes) {
          const key = `recent-${ticket.id}`
          if (await shouldSendAlert(warnedRecent, {
            dedupeKey: key,
            watcherKey: 'nld',
            alertType: 'recent',
            entityId: ticket.id,
            payload: { status: outage.status, updatedAt: outage.updated_at }
          })) {
            recent.push(outage)
          }
        }

        if (outage.ageMinutes > config.windowMinutes && outage.ageHours >= immediateBreachHours) {
          const key = `breach-${immediateBreachHours}-${ticket.id}`
          if (await shouldSendAlert(warnedBreach, {
            dedupeKey: key,
            watcherKey: 'nld',
            alertType: `breach_${immediateBreachHours}h`,
            entityId: ticket.id,
            payload: { status: outage.status, updatedAt: outage.updated_at }
          })) {
            immediateBreaches.push(outage)
          }
        }
      }

      const recentMsg = buildRecentMsg(recent, config.templates)
      if (recentMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD recent-outage alert')
        await sendNld(recentMsg)
      }

      const breachMessage = buildBreachMsg(immediateBreaches, immediateBreachHours, config.templates)
      if (breachMessage) {
        console.log(`[NLD WATCHER] Sending WhatsApp NLD BREACH ${immediateBreachHours}h alert`)
        await sendNld(breachMessage)
      }

      const updatedOutages = await fetchRecentlyUpdatedOutages(config.resolvedLookbackHours)
      const resolvedForDigest = []

      for (const ticket of updatedOutages) {
        if (!isNldTicket(ticket) || !isSolvedStatus(ticket.status)) continue

        const outage = enrichOutageTicket(ticket, now)
        const updatedAtMs = dayjs(outage.updated_at).valueOf()
        if (updatedAtMs >= digestWindow.startMs && updatedAtMs < digestWindow.endMs) {
          resolvedForDigest.push(outage)
        }
      }

      const outageIndex = buildOutageRouteIndex(openOutages)
      const rawPartial = await fetchPartialNldAlertsRaw()
      const partialEvents = transformPartialNldAlerts(rawPartial, {
        partialLookbackHours: config.partialLookbackHours,
        zendeskSubdomain: ZENDESK_SUBDOMAIN
      })

      const rawClusters = findPartialClusters(partialEvents, {
          nowMs: Date.now(),
          clusterWindowHours: config.clusterWindowHours,
          clusterMinEvents: config.clusterMinEvents
        })
      const clusters = []

      for (const cluster of rawClusters) {
        const dedupeKey = `partial-cluster:${normalizeRoute(cluster.routeKey)}:${cluster.last.ticketId}`
        const shouldSend = await shouldSendAlert(warnedPartialClusters, {
          dedupeKey,
          watcherKey: 'nld',
          alertType: 'partial_cluster',
          entityId: cluster.last.ticketId,
          payload: { route: cluster.routeKey, latestTicketId: cluster.last.ticketId }
        })
        if (shouldSend) clusters.push(cluster)
      }

      const clusterMsg = buildPartialClusterMsg(clusters, {
        title: config.templates.partialClusterTitle,
        clusterWindowHours: config.clusterWindowHours,
        action: config.templates.partialClusterAction
      })

      if (clusterMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD CLUSTER alert')
        await sendNld(clusterMsg)
      }

      const rawNotLogged = findPartialNotLogged(partialEvents, outageIndex, {
          partialNotLoggedMinutes: config.notLoggedMinutes
        })
      const notLogged = []

      for (const event of rawNotLogged) {
        const dedupeKey = `partial-not-logged:${event.ticketId}`
        const shouldSend = await shouldSendAlert(warnedPartialNotLogged, {
          dedupeKey,
          watcherKey: 'nld',
          alertType: 'partial_not_logged',
          entityId: event.ticketId,
          payload: { route: event.nldRoute || event.partialCircuit || '', circuit: event.circuit }
        })
        if (shouldSend) notLogged.push(event)
      }

      const notLoggedMsg = buildPartialNotLoggedMsg(notLogged, {
        title: config.templates.partialNotLoggedTitle,
        action: config.templates.partialNotLoggedAction
      })

      if (notLoggedMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD NOT-LOGGED alert')
        await sendNld(notLoggedMsg)
      }

      if (config.digestEnabled !== false) {
        if (lastDigestBucket == null) {
          lastDigestBucket = digestWindow.bucket
          console.log('[NLD WATCHER] Digest schedule primed; first NLD position update will send after the next completed interval')
        } else if (digestWindow.bucket > lastDigestBucket) {
          lastDigestBucket = digestWindow.bucket
          const operations = await collectOperationsDigestLanes(now, digestWindow, watcherConfig)
          const dedupeKey = `nld-digest-${digestWindow.bucket}`
          const shouldSend = await shouldSendAlert(warnedDigest, {
            dedupeKey,
            watcherKey: 'nld',
            alertType: 'digest',
            entityId: String(digestWindow.bucket),
            payload: {
              openCount: openOutages.length,
              resolvedCount: resolvedForDigest.length,
              backhaulOpenCount: operations.backhaulOpen.length,
              backhaulResolvedCount: operations.backhaulResolved.length,
              majorOutageOpenCount: operations.majorOutageOpen.length,
              majorOutageResolvedCount: operations.majorOutageResolved.length,
              partialClusters: rawClusters.length,
              partialNotLogged: rawNotLogged.length,
              windowStart: new Date(digestWindow.startMs).toISOString(),
              windowEnd: new Date(digestWindow.endMs).toISOString()
            }
          })

          if (shouldSend) {
            console.log('[NLD WATCHER] Sending scheduled WhatsApp NLD position digest')
            await sendNld(buildDigestMsg({
              openOutages,
              resolvedOutages: resolvedForDigest,
              clusters: rawClusters,
              notLogged: rawNotLogged,
              now,
              config,
              ...operations
            }), { mention: false })
          }
        }
      }
    } catch (error) {
      console.error('[NLD WATCHER] Tick error:', error?.message || error)
    } finally {
      scheduleNext(run, config.pollMs)
    }
  }

  void run()
}
