import { zendeskAgentTicketLink } from './watcherUtils.js'

export function normalizeRoute(value) {
  if (!value) return ''
  return String(value)
    .toLowerCase()
    .replace(/\bnld\s*3\s*\/\s*4\b/g, 'nld3/4')
    .replace(/\s*<+\s*-+\s*>?\s*/g, ' <> ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isIgnorableNld(value) {
  const normalized = normalizeRoute(value)
  if (!normalized) return true
  if (normalized === 'other') return true
  if (normalized === 'dfa nld') return true
  return false
}

export function getEventRouteKey(event) {
  const rawKey = event?.nldRoute || event?.partialCircuit || ''
  if (isIgnorableNld(rawKey)) return ''
  return rawKey
}

export function expandNld3_4Variants(normalized) {
  const variants = new Set([normalized])
  if (/\bnld3\/4\b/.test(normalized)) {
    variants.add(normalized.replace(/\bnld3\/4\b/g, 'nld3'))
    variants.add(normalized.replace(/\bnld3\/4\b/g, 'nld4'))
  }
  return Array.from(variants)
}

export function buildOutageRouteIndex(outages) {
  return outages.map((item) => ({
    ticketId: item.id,
    nldNorm: normalizeRoute(item.nld || ''),
    subjectNorm: normalizeRoute(item.subject || '')
  }))
}

export function hasMatchingOutageForEvent(event, outageIndex) {
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

export function transformPartialNldAlerts(results, {
  partialLookbackHours,
  zendeskSubdomain
}) {
  const nowMs = Date.now()
  const cutoffMs = nowMs - partialLookbackHours * 60 * 60 * 1000
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
        ticketUrl: zendeskSubdomain ? zendeskAgentTicketLink(zendeskSubdomain, ticket.id) : '',
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

export function findPartialClusters(events, { nowMs = Date.now(), clusterWindowHours, clusterMinEvents } = {}) {
  const windowMs = clusterWindowHours * 60 * 60 * 1000
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
    if (items.length < clusterMinEvents) continue

    const sorted = [...items].sort((a, b) => a.createdMs - b.createdMs)
    const last = sorted[sorted.length - 1]
    clusters.push({ routeKey, events: sorted, last })
  }

  return clusters
}

export function findPartialNotLogged(events, outageIndex, { partialNotLoggedMinutes }) {
  const affected = []

  for (const event of events) {
    if (event.isCleared) continue
    if (event.ageMinutes < partialNotLoggedMinutes) continue
    if (!getEventRouteKey(event)) continue
    if (hasMatchingOutageForEvent(event, outageIndex)) continue
    affected.push(event)
  }

  return affected
}
