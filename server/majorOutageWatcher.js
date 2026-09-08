import dayjs from 'dayjs'
import {
  compactText,
  fetchJsonWithTimeout,
  formatAgeHours,
  formatPlural,
  formatTimestamp,
  isSolvedStatus,
  makeAuthHeader,
  makeTtlCache,
  zendeskAgentTicketLink
} from './lib/watcherUtils.js'
import { recordWatcherAlert } from './lib/watcherAlertLog.js'
import { getWhatsappWatcherConfig } from './lib/whatsappWatcherConfig.js'

const CACHE_TTL_HOURS = Number(process.env.MAJOR_OUTAGE_CACHE_TTL_HOURS || 72)
const CACHE_MAX_KEYS = Number(process.env.MAJOR_OUTAGE_CACHE_MAX_KEYS || 5000)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN
const OUTAGE_GROUP_ID = String(process.env.OUTAGE_WATCHER_GROUP_ID || '5160847905297').trim()
const OUTAGE_FORM_NAME = String(process.env.OUTAGE_WATCHER_FORM_NAME || 'Outage Capturing').trim()
const NLD_FIELD_ID = '40137360073617'
const REGION_FIELD_ID = '5522811974801'
const SUBSCRIBER_IMPACT_FIELD_ID = '5552674828049'
const LAST_UPDATE_FIELD_ID = '5352766585489'
const SERVICE_TYPE_FIELD_ID = '6715159991185'

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[MAJOR OUTAGE WATCHER] Zendesk env vars missing; watcher will not run')
}

const TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000
const warnedNew = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedBreach = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)

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

function isNldTicket(ticket) {
  const subject = String(ticket.subject || '').toUpperCase()
  if (subject.includes('NLD')) return true
  return !!String(cf(ticket, NLD_FIELD_ID) || '').trim()
}

export function isMajorOutageTicket(ticket) {
  return !isNldTicket(ticket)
}

export async function fetchActiveMajorOutages() {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', `group:${OUTAGE_GROUP_ID} form:"${OUTAGE_FORM_NAME}" status<solved`)
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

export async function fetchRecentlyUpdatedMajorOutages(resolvedLookbackHours) {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `group:${OUTAGE_GROUP_ID} form:"${OUTAGE_FORM_NAME}" updated>${resolvedLookbackHours}hours`
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

export function buildSummary(ticket, now) {
  const created = dayjs(ticket.created_at)
  const updated = dayjs(ticket.updated_at)
  const ageHours = created.isValid() ? now.diff(created, 'hour', true) : NaN
  const totalHours = created.isValid() && updated.isValid()
    ? updated.diff(created, 'hour', true)
    : ageHours

  return {
    id: ticket.id,
    status: String(ticket.status || ''),
    priority: String(ticket.priority || 'n/a'),
    subject: compactText(ticket.subject),
    region: String(cf(ticket, REGION_FIELD_ID) || '').trim() || 'Unknown region',
    subscriberImpact: Number(cf(ticket, SUBSCRIBER_IMPACT_FIELD_ID)) || 0,
    lastUpdateNote: compactText(cf(ticket, LAST_UPDATE_FIELD_ID) || '', 180),
    serviceType: String(cf(ticket, SERVICE_TYPE_FIELD_ID) || '').trim() || '',
    created_at: ticket.created_at,
    updated_at: ticket.updated_at,
    ageHours,
    totalHours
  }
}

function formatLastUpdate(ticket) {
  return ticket.lastUpdateNote || formatTimestamp(ticket.updated_at)
}

function buildNewAlertMessage(tickets, templates) {
  if (!tickets.length) return null

  const lines = [`${templates.newTitle} | ${formatPlural(tickets.length, 'new item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(
      `#${ticket.id} | ${ticket.region} | ${ticket.subscriberImpact} subs | ${ticket.priority.toUpperCase()} | ${formatAgeHours(ticket.ageHours)} open`
    )
    if (ticket.subject) lines.push(`Subject: ${ticket.subject}`)
    if (ticket.serviceType) lines.push(`Service type: ${ticket.serviceType}`)
    lines.push(`Last update: ${formatLastUpdate(ticket)}`)
    if (templates.newAction) lines.push(`Action: ${templates.newAction}`)
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildBreachAlertMessage(tickets, thresholdHours, templates) {
  if (!tickets.length) return null

  const lines = [`${templates.breachTitle} | ${thresholdHours}h | ${formatPlural(tickets.length, 'item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(
      `#${ticket.id} | ${ticket.region} | ${ticket.subscriberImpact} subs | ${ticket.priority.toUpperCase()} | ${formatAgeHours(ticket.ageHours)} open`
    )
    if (ticket.subject) lines.push(`Subject: ${ticket.subject}`)
    if (ticket.serviceType) lines.push(`Service type: ${ticket.serviceType}`)
    lines.push(`Last update: ${formatLastUpdate(ticket)}`)
    if (templates.breachAction) lines.push(`Action: ${templates.breachAction}`)
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

let watcherStarted = false
let nextTimer = null
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

export function startMajorOutageWatcher(sendSlaAlert, isWhatsAppReady = () => true) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[MAJOR OUTAGE WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  void getWhatsappWatcherConfig().then(({ majorOutage }) => {
    const groupLabel = describeGroups(majorOutage.groupIds)
    console.log(
      `[MAJOR OUTAGE WATCHER] Starting - poll ${Math.round(majorOutage.pollMs / 1000)}s, lookback ${majorOutage.lookbackHours}h, resolved lookback ${majorOutage.resolvedLookbackHours}h, group ${groupLabel}`
    )
    console.log(
      `[MAJOR OUTAGE WATCHER] Rules - non-NLD tickets in ${OUTAGE_FORM_NAME}, breach tiers ${majorOutage.breachThresholdsHours.join(', ')}`
    )
  }).catch(() => {})
  console.log(`[MAJOR OUTAGE WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const run = async () => {
    let config

    try {
      const stored = await getWhatsappWatcherConfig()
      config = stored.majorOutage
    } catch (error) {
      console.error('[MAJOR OUTAGE WATCHER] Config load failed:', error?.message || error)
      scheduleNext(run, 5 * 60 * 1000)
      return
    }

    if (!config.enabled) {
      scheduleNext(run, config.pollMs)
      return
    }

    if (!isWhatsAppReady()) {
      if (!whatsappUnavailableWarned) {
        console.warn('[MAJOR OUTAGE WATCHER] WhatsApp is not linked; deferring alert processing without recording dedupe state')
        whatsappUnavailableWarned = true
      }
      scheduleNext(run, config.pollMs)
      return
    }
    whatsappUnavailableWarned = false

    const sendMajorOutage = async (message) => {
      try {
        await sendSlaAlert(message, {
          ...(config.groupIds?.length ? { groupIds: config.groupIds } : {}),
          ...(config.mentionJids?.length ? { mentionJids: config.mentionJids } : {})
        })
      } catch (error) {
        console.error('[MAJOR OUTAGE WATCHER] send failed:', error?.message || error)
      }
    }

    try {
      const now = dayjs()
      const activeTickets = await fetchActiveMajorOutages()
      const fresh = []
      const immediateBreachHours = config.breachThresholdsHours[0] || 4
      const immediateBreaches = []

      for (const ticket of activeTickets) {
        if (!isMajorOutageTicket(ticket)) continue

        const summary = buildSummary(ticket, now)
        if (!Number.isFinite(summary.ageHours)) continue

        if (summary.ageHours <= config.lookbackHours) {
          const key = `major-outage-new-${ticket.id}`
          if (await shouldSendAlert(warnedNew, {
            dedupeKey: key,
            watcherKey: 'major_outage',
            alertType: 'new',
            entityId: ticket.id,
            payload: { status: summary.status, updatedAt: summary.updated_at, region: summary.region }
          })) {
            fresh.push(summary)
          }
        }

        if (summary.ageHours >= immediateBreachHours) {
          const key = `major-outage-breach-${immediateBreachHours}-${ticket.id}`
          if (await shouldSendAlert(warnedBreach, {
            dedupeKey: key,
            watcherKey: 'major_outage',
            alertType: `breach_${immediateBreachHours}h`,
            entityId: ticket.id,
            payload: { status: summary.status, updatedAt: summary.updated_at, region: summary.region }
          })) {
            immediateBreaches.push(summary)
          }
        }
      }

      const newMessage = buildNewAlertMessage(fresh, config.templates)
      if (newMessage) {
        console.log('[MAJOR OUTAGE WATCHER] Sending WhatsApp new major outage alert')
        await sendMajorOutage(newMessage)
      }

      const breachMessage = buildBreachAlertMessage(immediateBreaches, immediateBreachHours, config.templates)
      if (breachMessage) {
        console.log(`[MAJOR OUTAGE WATCHER] Sending WhatsApp major outage breach ${immediateBreachHours}h alert`)
        await sendMajorOutage(breachMessage)
      }
    } catch (error) {
      console.error('[MAJOR OUTAGE WATCHER] Tick error:', error?.message || error)
    } finally {
      scheduleNext(run, config.pollMs)
    }
  }

  void run()
}
