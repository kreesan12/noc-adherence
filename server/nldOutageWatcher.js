import dayjs from 'dayjs'
import {
  compactText,
  fetchJsonWithTimeout,
  formatAgeHours,
  formatAgeMinutes,
  formatPlural,
  formatTimestamp,
  isResolvedStatus,
  makeAuthHeader,
  makeTtlCache,
  parseHourThresholds,
  zendeskAgentTicketLink
} from './lib/watcherUtils.js'

const OUTAGE_WINDOW_MINUTES = Number(process.env.NLD_WINDOW_MINUTES || 60)
const BREACH_HOURS = Number(process.env.NLD_BREACH_HOURS || 4)
const POLL_INTERVAL_MS = Number(process.env.NLD_POLL_MS || 5 * 60 * 1000)

const PARTIAL_LOOKBACK_HOURS = Number(process.env.NLD_PARTIAL_LOOKBACK_HOURS || 24)
const CLUSTER_WINDOW_HOURS = Number(process.env.NLD_CLUSTER_WINDOW_HOURS || 3)
const CLUSTER_MIN_EVENTS = Number(process.env.NLD_CLUSTER_MIN_EVENTS || 3)
const PARTIAL_NOT_LOGGED_MINUTES = Number(process.env.NLD_NOT_LOGGED_MINUTES || 30)
const RESOLVED_LOOKBACK_HOURS = Number(process.env.NLD_RESOLVED_LOOKBACK_HOURS || 24)

const BREACH_THRESHOLDS_HOURS = parseHourThresholds(
  process.env.NLD_BREACH_THRESHOLDS_HOURS,
  [4, 8, 12, 24]
)

const CACHE_TTL_HOURS = Number(process.env.NLD_CACHE_TTL_HOURS || 72)
const CACHE_MAX_KEYS = Number(process.env.NLD_CACHE_MAX_KEYS || 5000)

const NLD_GROUP_ID = process.env.WHATSAPP_NLD_GROUP_ID || null

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

const partialNotLoggedBuckets = new Map()

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

async function fetchRecentlyUpdatedOutages() {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `group:5160847905297 form:"Outage Capturing" updated>${RESOLVED_LOOKBACK_HOURS}hours`
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

function normalizeRoute(value) {
  if (!value) return ''
  return String(value)
    .toLowerCase()
    .replace(/\bnld\s*3\s*\/\s*4\b/g, 'nld3/4')
    .replace(/\s*<+\s*-+\s*>?\s*/g, ' <> ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isIgnorableNld(value) {
  const normalized = normalizeRoute(value)
  if (!normalized) return true
  if (normalized === 'other') return true
  if (normalized === 'dfa nld') return true
  return false
}

function getEventRouteKey(event) {
  const rawKey = event?.nldRoute || event?.partialCircuit || ''
  if (isIgnorableNld(rawKey)) return ''
  return rawKey
}

function expandNld3_4Variants(normalized) {
  const variants = new Set([normalized])
  if (/\bnld3\/4\b/.test(normalized)) {
    variants.add(normalized.replace(/\bnld3\/4\b/g, 'nld3'))
    variants.add(normalized.replace(/\bnld3\/4\b/g, 'nld4'))
  }
  return Array.from(variants)
}

function buildOutageRouteIndex(outages) {
  return outages.map((item) => ({
    ticketId: item.id,
    nldNorm: normalizeRoute(item.nld || ''),
    subjectNorm: normalizeRoute(item.subject || '')
  }))
}

function hasMatchingOutageForEvent(event, outageIndex) {
  const eventKey = getEventRouteKey(event)
  const eventNorm = normalizeRoute(eventKey)
  if (!eventNorm) return false

  const variants = expandNld3_4Variants(eventNorm)

  for (const outage of outageIndex) {
    for (const variant of variants) {
      if (outage.nldNorm && (outage.nldNorm.includes(variant) || variant.includes(outage.nldNorm))) {
        return true
      }
      if (outage.subjectNorm && (outage.subjectNorm.includes(variant) || variant.includes(outage.subjectNorm))) {
        return true
      }
    }
  }

  return false
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
    liquidRef: cf(ticket, 7657816716433) || '',
    liquidCircuit: cf(ticket, 8008871186961) || ''
  }
}

function buildLiquidSummary(ticket) {
  const parts = []
  if (ticket.liquidRef) parts.push(`Ref ${ticket.liquidRef}`)
  if (ticket.liquidCircuit) parts.push(`Circuit ${ticket.liquidCircuit}`)
  return parts.join(' | ')
}

function buildRecentMsg(tickets) {
  if (!tickets.length) return null

  const lines = [`NLD outage logged | ${formatPlural(tickets.length, 'new item')}`, '']

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

function buildBreachMsg(tickets, breachHours) {
  if (!tickets.length) return null

  const lines = [`NLD outage aging breach | ${breachHours}h | ${formatPlural(tickets.length, 'item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(
      `#${ticket.id} | ${ticket.nld || 'Route unknown'} | ${ticket.subscriberImpact} subs | ${formatAgeHours(ticket.ageHours)} open`
    )
    lines.push(`Last update: ${formatTimestamp(ticket.updated_at)}`)
    if (ticket.subject) lines.push(`Subject: ${compactText(ticket.subject)}`)
    const liquid = buildLiquidSummary(ticket)
    if (liquid) lines.push(`Liquid: ${liquid}`)
    lines.push('Action: escalate and request outage update')
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildResolvedMsg(tickets) {
  if (!tickets.length) return null

  const lines = [`NLD outage resolved | ${formatPlural(tickets.length, 'cleared item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(
      `#${ticket.id} | ${ticket.nld || 'Route unknown'} | ${ticket.subscriberImpact} subs | ${formatAgeHours(ticket.totalHours)} total`
    )
    lines.push(`Last update: ${formatTimestamp(ticket.updated_at)}`)
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

function transformPartialNldAlerts(results) {
  const nowMs = Date.now()
  const cutoffMs = nowMs - PARTIAL_LOOKBACK_HOURS * 60 * 60 * 1000
  const events = []

  for (const ticket of results) {
    const createdMs = Date.parse(ticket.created_at)
    if (Number.isNaN(createdMs) || createdMs < cutoffMs) continue

    const subject = ticket.subject || ''
    const parts = subject.split('|')
    const raw = (parts[0] || '').trim()
    const route = (parts[1] || '').trim()

    let partial = 'none'
    if (parts[2]) {
      partial = parts[2]
        .trim()
        .replace(/\s*<>\s*/g, ' <-> ')
        .replace(/\s{2,}/g, ' ')
    }

    const idx = subject.indexOf('circuit=')
    let circuits = ['unknown']
    if (idx >= 0) {
      const values = subject
        .slice(idx + 'circuit='.length)
        .split('&')
        .map((item) => item.trim())
        .filter(Boolean)
      if (values.length) circuits = values
    }

    const tags = ticket.tags || []
    const cleared = tags.includes('iris_alert_clear')
    const ageMs = nowMs - createdMs
    const ageHours = ageMs / (60 * 60 * 1000)
    const ageMinutes = ageMs / (60 * 1000)

    let eventGroup = 'Other'
    if (raw === 'NLD Down') eventGroup = 'NLD Down'
    else if (raw === 'NLD Flap') eventGroup = 'NLD Flap'

    circuits.forEach((circuit) => {
      const routeKey = route || partial || ''
      if (isIgnorableNld(routeKey)) return

      events.push({
        ticketId: ticket.id,
        ticketUrl: zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id),
        eventGroup,
        nldRoute: route,
        partialCircuit: partial,
        circuit: String(circuit || 'unknown'),
        created_at: ticket.created_at,
        createdMs,
        ageHours,
        ageMinutes,
        isCleared: cleared
      })
    })
  }

  return events
}

function findPartialClusters(events, { nowMs = Date.now() } = {}) {
  const windowMs = CLUSTER_WINDOW_HOURS * 60 * 60 * 1000
  const cutoffMs = nowMs - windowMs
  const recent = events.filter((event) => event.createdMs >= cutoffMs)
  const grouped = new Map()

  for (const event of recent) {
    const routeKey = getEventRouteKey(event)
    if (!routeKey) continue
    if (!grouped.has(routeKey)) grouped.set(routeKey, [])
    grouped.get(routeKey).push({ ...event, routeKey })
  }

  const clusters = []

  for (const [routeKey, items] of grouped.entries()) {
    if (items.length < CLUSTER_MIN_EVENTS) continue

    const sorted = [...items].sort((a, b) => a.createdMs - b.createdMs)
    const last = sorted[sorted.length - 1]
    const key = `partial-cluster:${normalizeRoute(routeKey)}:${last.ticketId}`

    if (!warnedPartialClusters.has(key)) {
      warnedPartialClusters.add(key)
      clusters.push({ routeKey, events: sorted, last })
    }
  }

  return clusters
}

function buildPartialClusterMsg(clusters) {
  if (!clusters.length) return null

  const lines = [`Partial NLD cluster detected | ${formatPlural(clusters.length, 'route')}`, '']

  clusters.forEach((cluster) => {
    const circuitCount = new Set(cluster.events.map((event) => event.circuit)).size
    lines.push(cluster.routeKey)
    lines.push(`Events: ${cluster.events.length} in ${CLUSTER_WINDOW_HOURS}h | Unique circuits: ${circuitCount}`)
    lines.push(`Latest ticket: #${cluster.last.ticketId} | ${formatTimestamp(cluster.last.created_at)}`)
    lines.push('Action: validate common cause and log or link outage if needed')
    lines.push(`Link: ${cluster.last.ticketUrl}`)
    lines.push('')
  })

  return lines.join('\n')
}

function findPartialNotLogged(events, outageIndex) {
  const affected = []

  for (const event of events) {
    if (event.isCleared) continue
    if (event.ageMinutes < PARTIAL_NOT_LOGGED_MINUTES) continue
    if (!getEventRouteKey(event)) continue
    if (hasMatchingOutageForEvent(event, outageIndex)) continue

    const bucket = Math.floor(event.ageMinutes / PARTIAL_NOT_LOGGED_MINUTES)
    if (bucket < 1) continue

    const key = String(event.ticketId)
    const lastBucket = partialNotLoggedBuckets.get(key) || 0
    if (bucket <= lastBucket) continue

    partialNotLoggedBuckets.set(key, bucket)
    affected.push({ ...event, bucket })
  }

  if (partialNotLoggedBuckets.size > CACHE_MAX_KEYS) {
    const keys = Array.from(partialNotLoggedBuckets.keys())
    for (let index = 0; index < keys.length - CACHE_MAX_KEYS; index += 1) {
      partialNotLoggedBuckets.delete(keys[index])
    }
  }

  return affected
}

function buildPartialNotLoggedMsg(events) {
  if (!events.length) return null

  const lines = [`Partial NLD not linked to outage | ${formatPlural(events.length, 'active item')}`, '']

  events.forEach((event) => {
    lines.push(`#${event.ticketId} | ${event.eventGroup} | ${event.nldRoute || event.partialCircuit || 'Route unknown'}`)
    lines.push(`Age: ${formatAgeMinutes(event.ageMinutes)} | Circuit: ${event.circuit}`)
    lines.push('Action: log outage or link to existing outage')
    lines.push(`Link: ${event.ticketUrl}`)
    lines.push('')
  })

  return lines.join('\n')
}

let watcherStarted = false

export function startNldOutageWatcher(sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[NLD WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  const groupLabel = NLD_GROUP_ID ? `override ${NLD_GROUP_ID}` : 'default group'
  console.log(
    `[NLD WATCHER] Starting - window ${OUTAGE_WINDOW_MINUTES} min, breach baseline ${BREACH_HOURS} h, poll ${Math.round(POLL_INTERVAL_MS / 1000)}s, group ${groupLabel}`
  )
  console.log(`[NLD WATCHER] Breach tiers - ${BREACH_THRESHOLDS_HOURS.join(', ')} hours`)
  console.log(
    `[NLD WATCHER] Partial - lookback ${PARTIAL_LOOKBACK_HOURS}h, cluster ${CLUSTER_MIN_EVENTS} events / ${CLUSTER_WINDOW_HOURS}h, not-logged >= ${PARTIAL_NOT_LOGGED_MINUTES} min`
  )
  console.log(`[NLD WATCHER] Resolved lookback - ${RESOLVED_LOOKBACK_HOURS}h`)
  console.log(`[NLD WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const sendNld = async (message) => {
    await sendSlaAlert(message, NLD_GROUP_ID ? { groupId: NLD_GROUP_ID } : {})
  }

  const tick = async () => {
    try {
      const now = dayjs()
      const rawOutages = await fetchOutageTickets()

      const recent = []
      const openOutages = []
      const breachesByThreshold = new Map()
      BREACH_THRESHOLDS_HOURS.forEach((threshold) => breachesByThreshold.set(threshold, []))

      for (const ticket of rawOutages) {
        if (!isNldTicket(ticket)) continue

        const outage = enrichOutageTicket(ticket, now)
        openOutages.push(outage)

        if (outage.ageMinutes >= 0 && outage.ageMinutes <= OUTAGE_WINDOW_MINUTES) {
          const key = `recent-${ticket.id}`
          if (!warnedRecent.has(key)) {
            warnedRecent.add(key)
            recent.push(outage)
          }
        }

        if (outage.ageMinutes > OUTAGE_WINDOW_MINUTES) {
          for (const threshold of BREACH_THRESHOLDS_HOURS) {
            if (outage.ageHours >= threshold) {
              const key = `breach-${threshold}-${ticket.id}`
              if (!warnedBreach.has(key)) {
                warnedBreach.add(key)
                breachesByThreshold.get(threshold).push(outage)
              }
            }
          }
        }
      }

      const recentMsg = buildRecentMsg(recent)
      if (recentMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD recent-outage alert')
        await sendNld(recentMsg)
      }

      for (const threshold of BREACH_THRESHOLDS_HOURS) {
        const message = buildBreachMsg(breachesByThreshold.get(threshold) || [], threshold)
        if (message) {
          console.log(`[NLD WATCHER] Sending WhatsApp NLD BREACH ${threshold}h alert`)
          await sendNld(message)
        }
      }

      const updatedOutages = await fetchRecentlyUpdatedOutages()
      const resolved = []

      for (const ticket of updatedOutages) {
        if (!isNldTicket(ticket) || !isResolvedStatus(ticket.status)) continue

        const outage = enrichOutageTicket(ticket, now)
        const key = `resolved-${ticket.id}-${ticket.status}-${ticket.updated_at}`
        if (warnedResolved.has(key)) continue
        warnedResolved.add(key)
        resolved.push(outage)
      }

      const resolvedMsg = buildResolvedMsg(resolved)
      if (resolvedMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD resolved alert')
        await sendNld(resolvedMsg)
      }

      const outageIndex = buildOutageRouteIndex(openOutages)
      const rawPartial = await fetchPartialNldAlertsRaw()
      const partialEvents = transformPartialNldAlerts(rawPartial)

      const clusterMsg = buildPartialClusterMsg(findPartialClusters(partialEvents, { nowMs: Date.now() }))
      if (clusterMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD CLUSTER alert')
        await sendNld(clusterMsg)
      }

      const notLoggedMsg = buildPartialNotLoggedMsg(findPartialNotLogged(partialEvents, outageIndex))
      if (notLoggedMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD NOT-LOGGED alert')
        await sendNld(notLoggedMsg)
      }
    } catch (error) {
      console.error('[NLD WATCHER] Tick error:', error?.message || error)
    }
  }

  tick()

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  interval.unref?.()
}
