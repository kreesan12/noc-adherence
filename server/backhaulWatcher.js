import dayjs from 'dayjs'
import {
  compactText,
  fetchJsonWithTimeout,
  formatAgeHours,
  formatPlural,
  formatTimestamp,
  isResolvedStatus,
  makeAuthHeader,
  makeTtlCache,
  parseHourThresholds,
  safeStr,
  zendeskAgentTicketLink
} from './lib/watcherUtils.js'

const POLL_INTERVAL_MS = Number(process.env.BACKHAUL_POLL_MS || 5 * 60 * 1000)
const LOOKBACK_HOURS = Number(process.env.BACKHAUL_LOOKBACK_HOURS || 4)
const RESOLVED_LOOKBACK_HOURS = Number(process.env.BACKHAUL_RESOLVED_LOOKBACK_HOURS || 24)
const BACKHAUL_TAG = String(process.env.BACKHAUL_TAG || 'iris_backhaul_down').trim()
const BACKHAUL_GROUP_ID = process.env.WHATSAPP_BACKHAUL_GROUP_ID || null

const BREACH_THRESHOLDS_HOURS = parseHourThresholds(
  process.env.BACKHAUL_BREACH_THRESHOLDS_HOURS,
  [4, 8, 12, 24]
)

const CACHE_TTL_HOURS = Number(process.env.BACKHAUL_CACHE_TTL_HOURS || 72)
const CACHE_MAX_KEYS = Number(process.env.BACKHAUL_CACHE_MAX_KEYS || 5000)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[BACKHAUL WATCHER] Zendesk env vars missing; watcher will not run')
}

const TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000
const warnedNew = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedBreach = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedResolved = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)

function makeHeaders() {
  return {
    Authorization: makeAuthHeader(ZENDESK_EMAIL, ZENDESK_API_TOKEN),
    'Content-Type': 'application/json'
  }
}

async function fetchActiveBackhaulTickets() {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', `type:ticket status<solved tags:${BACKHAUL_TAG}`)
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

async function fetchRecentlyUpdatedBackhaulTickets() {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', `type:ticket tags:${BACKHAUL_TAG} updated>${RESOLVED_LOOKBACK_HOURS}hours`)
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

function buildTicketSummary(ticket, now) {
  const created = dayjs(ticket.created_at)
  const updated = dayjs(ticket.updated_at)
  const ageHours = created.isValid() ? now.diff(created, 'hour', true) : NaN
  const totalHours = created.isValid() && updated.isValid()
    ? updated.diff(created, 'hour', true)
    : ageHours

  return {
    id: ticket.id,
    status: safeStr(ticket.status) || 'unknown',
    priority: safeStr(ticket.priority) || 'n/a',
    subject: compactText(ticket.subject),
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    ageHours,
    totalHours
  }
}

function buildNewAlertMessage(tickets) {
  if (!tickets.length) return null

  const lines = [`Backhaul alert | ${formatPlural(tickets.length, 'new item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(`#${ticket.id} | ${ticket.status} | ${ticket.priority.toUpperCase()} | ${formatAgeHours(ticket.ageHours)} old`)
    if (ticket.subject) lines.push(`Subject: ${ticket.subject}`)
    lines.push(`Last update: ${formatTimestamp(ticket.updated_at)}`)
    lines.push('Action: validate backhaul impact and update stakeholders')
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildBreachAlertMessage(tickets, thresholdHours) {
  if (!tickets.length) return null

  const lines = [`Backhaul aging breach | ${thresholdHours}h | ${formatPlural(tickets.length, 'item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(`#${ticket.id} | ${ticket.status} | ${ticket.priority.toUpperCase()} | ${formatAgeHours(ticket.ageHours)} open`)
    if (ticket.subject) lines.push(`Subject: ${ticket.subject}`)
    lines.push(`Last update: ${formatTimestamp(ticket.updated_at)}`)
    lines.push('Action: chase update or escalate carrier follow-up')
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildResolvedAlertMessage(tickets) {
  if (!tickets.length) return null

  const lines = [`Backhaul resolved | ${formatPlural(tickets.length, 'cleared item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(`#${ticket.id} | ${ticket.status} | ${formatAgeHours(ticket.totalHours)} total`)
    if (ticket.subject) lines.push(`Subject: ${ticket.subject}`)
    lines.push(`Last update: ${formatTimestamp(ticket.updated_at)}`)
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

let watcherStarted = false

export function startBackhaulWatcher(sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[BACKHAUL WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (!BACKHAUL_TAG) {
    console.warn('[BACKHAUL WATCHER] Not starting - backhaul tag missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  const groupLabel = BACKHAUL_GROUP_ID ? `override ${BACKHAUL_GROUP_ID}` : 'default group'
  console.log(
    `[BACKHAUL WATCHER] Starting - poll ${Math.round(POLL_INTERVAL_MS / 1000)}s, lookback ${LOOKBACK_HOURS}h, resolved lookback ${RESOLVED_LOOKBACK_HOURS}h, group ${groupLabel}`
  )
  console.log(`[BACKHAUL WATCHER] Rules - tag ${BACKHAUL_TAG}, breach tiers ${BREACH_THRESHOLDS_HOURS.join(', ')}`)
  console.log(`[BACKHAUL WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const sendBackhaul = async (message) => {
    try {
      await sendSlaAlert(message, BACKHAUL_GROUP_ID ? { groupId: BACKHAUL_GROUP_ID } : {})
    } catch (error) {
      console.error('[BACKHAUL WATCHER] send failed:', error?.message || error)
    }
  }

  const tick = async () => {
    try {
      const now = dayjs()
      const activeTickets = await fetchActiveBackhaulTickets()
      const fresh = []
      const breachesByThreshold = new Map()
      BREACH_THRESHOLDS_HOURS.forEach((threshold) => breachesByThreshold.set(threshold, []))

      for (const ticket of activeTickets) {
        const summary = buildTicketSummary(ticket, now)
        if (!Number.isFinite(summary.ageHours)) continue

        if (summary.ageHours <= LOOKBACK_HOURS) {
          const key = `backhaul-new-${ticket.id}`
          if (!warnedNew.has(key)) {
            warnedNew.add(key)
            fresh.push(summary)
          }
        }

        for (const threshold of BREACH_THRESHOLDS_HOURS) {
          if (summary.ageHours >= threshold) {
            const key = `backhaul-breach-${threshold}-${ticket.id}`
            if (!warnedBreach.has(key)) {
              warnedBreach.add(key)
              breachesByThreshold.get(threshold).push(summary)
            }
          }
        }
      }

      const newMessage = buildNewAlertMessage(fresh)
      if (newMessage) {
        console.log('[BACKHAUL WATCHER] Sending WhatsApp new backhaul alert')
        await sendBackhaul(newMessage)
      }

      for (const threshold of BREACH_THRESHOLDS_HOURS) {
        const message = buildBreachAlertMessage(breachesByThreshold.get(threshold) || [], threshold)
        if (message) {
          console.log(`[BACKHAUL WATCHER] Sending WhatsApp backhaul breach ${threshold}h alert`)
          await sendBackhaul(message)
        }
      }

      const updatedTickets = await fetchRecentlyUpdatedBackhaulTickets()
      const resolved = []

      for (const ticket of updatedTickets) {
        if (!isResolvedStatus(ticket.status)) continue

        const summary = buildTicketSummary(ticket, now)
        const key = `backhaul-resolved-${ticket.id}-${ticket.status}-${ticket.updated_at}`
        if (warnedResolved.has(key)) continue
        warnedResolved.add(key)
        resolved.push(summary)
      }

      const resolvedMessage = buildResolvedAlertMessage(resolved)
      if (resolvedMessage) {
        console.log('[BACKHAUL WATCHER] Sending WhatsApp resolved backhaul alert')
        await sendBackhaul(resolvedMessage)
      }
    } catch (error) {
      console.error('[BACKHAUL WATCHER] Tick error:', error?.message || error)
    }
  }

  tick()

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  interval.unref?.()
}
