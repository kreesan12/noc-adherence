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
const warnedResolved = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
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

function buildResolvedMsg(tickets, templates) {
  if (!tickets.length) return null

  const lines = [`${templates.resolvedTitle} | ${formatPlural(tickets.length, 'cleared item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(
      `#${ticket.id} | ${ticket.nld || 'Route unknown'} | ${ticket.subscriberImpact} subs | ${formatAgeHours(ticket.totalHours)} total`
    )
    lines.push(`Last update: ${formatLastUpdate(ticket)}`)
    if (ticket.subject) lines.push(`Subject: ${compactText(ticket.subject)}`)
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

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

export function startNldOutageWatcher(sendSlaAlert) {
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
      `[NLD WATCHER] Starting - window ${nld.windowMinutes} min, breach baseline ${baseline} h, poll ${Math.round(nld.pollMs / 1000)}s, group ${groupLabel}`
    )
    console.log(`[NLD WATCHER] Breach tiers - ${nld.breachThresholdsHours.join(', ')} hours`)
    console.log(
      `[NLD WATCHER] Partial - lookback ${nld.partialLookbackHours}h, cluster ${nld.clusterMinEvents} events / ${nld.clusterWindowHours}h, not-logged >= ${nld.notLoggedMinutes} min`
    )
    console.log(`[NLD WATCHER] Resolved lookback - ${nld.resolvedLookbackHours}h`)
  }).catch(() => {})
  console.log(`[NLD WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const run = async () => {
    let config

    try {
      const stored = await getWhatsappWatcherConfig()
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

    const sendNld = async (message) => {
      await sendSlaAlert(message, {
        ...(config.groupIds?.length ? { groupIds: config.groupIds } : {}),
        ...(config.mentionJids?.length ? { mentionJids: config.mentionJids } : {})
      })
    }

    try {
      const now = dayjs()
      const rawOutages = await fetchOutageTickets()

      const recent = []
      const openOutages = []
      const breachesByThreshold = new Map()
      config.breachThresholdsHours.forEach((threshold) => breachesByThreshold.set(threshold, []))

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

        if (outage.ageMinutes > config.windowMinutes) {
          for (const threshold of config.breachThresholdsHours) {
            if (outage.ageHours >= threshold) {
              const key = `breach-${threshold}-${ticket.id}`
              if (await shouldSendAlert(warnedBreach, {
                dedupeKey: key,
                watcherKey: 'nld',
                alertType: `breach_${threshold}h`,
                entityId: ticket.id,
                payload: { status: outage.status, updatedAt: outage.updated_at }
              })) {
                breachesByThreshold.get(threshold).push(outage)
              }
            }
          }
        }
      }

      const recentMsg = buildRecentMsg(recent, config.templates)
      if (recentMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD recent-outage alert')
        await sendNld(recentMsg)
      }

      for (const threshold of config.breachThresholdsHours) {
        const message = buildBreachMsg(breachesByThreshold.get(threshold) || [], threshold, config.templates)
        if (message) {
          console.log(`[NLD WATCHER] Sending WhatsApp NLD BREACH ${threshold}h alert`)
          await sendNld(message)
        }
      }

      const updatedOutages = await fetchRecentlyUpdatedOutages(config.resolvedLookbackHours)
      const resolved = []

      for (const ticket of updatedOutages) {
        if (!isNldTicket(ticket) || !isSolvedStatus(ticket.status)) continue

        const outage = enrichOutageTicket(ticket, now)
        const key = `resolved-${ticket.id}-solved`
        const shouldSend = await shouldSendAlert(warnedResolved, {
          dedupeKey: key,
          watcherKey: 'nld',
          alertType: 'resolved',
          entityId: ticket.id,
          payload: { status: outage.status, updatedAt: outage.updated_at }
        })
        if (!shouldSend) continue
        resolved.push(outage)
      }

      const resolvedMsg = buildResolvedMsg(resolved, config.templates)
      if (resolvedMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD resolved alert')
        await sendNld(resolvedMsg)
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
    } catch (error) {
      console.error('[NLD WATCHER] Tick error:', error?.message || error)
    } finally {
      scheduleNext(run, config.pollMs)
    }
  }

  void run()
}
