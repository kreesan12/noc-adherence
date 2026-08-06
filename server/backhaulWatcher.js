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
  safeStr,
  zendeskAgentTicketLink
} from './lib/watcherUtils.js'
import { recordWatcherAlert } from './lib/watcherAlertLog.js'
import { getWhatsappWatcherConfig } from './lib/whatsappWatcherConfig.js'

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

async function fetchActiveBackhaulTickets(tag) {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', `type:ticket status<solved tags:${tag}`)
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

async function fetchRecentlyUpdatedBackhaulTickets(tag, resolvedLookbackHours) {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', `type:ticket tags:${tag} updated>${resolvedLookbackHours}hours`)
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

function buildNewAlertMessage(tickets, templates) {
  if (!tickets.length) return null

  const lines = [`${templates.newTitle} | ${formatPlural(tickets.length, 'new item')}`, '']

  tickets.forEach((ticket) => {
    lines.push(`#${ticket.id} | ${ticket.status} | ${ticket.priority.toUpperCase()} | ${formatAgeHours(ticket.ageHours)} old`)
    if (ticket.subject) lines.push(`Subject: ${ticket.subject}`)
    lines.push(`Last update: ${formatTimestamp(ticket.updated_at)}`)
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
    lines.push(`#${ticket.id} | ${ticket.status} | ${ticket.priority.toUpperCase()} | ${formatAgeHours(ticket.ageHours)} open`)
    if (ticket.subject) lines.push(`Subject: ${ticket.subject}`)
    lines.push(`Last update: ${formatTimestamp(ticket.updated_at)}`)
    if (templates.breachAction) lines.push(`Action: ${templates.breachAction}`)
    lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildResolvedAlertMessage(tickets, templates) {
  if (!tickets.length) return null

  const lines = [`${templates.resolvedTitle} | ${formatPlural(tickets.length, 'cleared item')}`, '']

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

export function startBackhaulWatcher(sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[BACKHAUL WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  void getWhatsappWatcherConfig().then(({ backhaul }) => {
    const groupLabel = describeGroups(backhaul.groupIds)
    console.log(
      `[BACKHAUL WATCHER] Starting - poll ${Math.round(backhaul.pollMs / 1000)}s, lookback ${backhaul.lookbackHours}h, resolved lookback ${backhaul.resolvedLookbackHours}h, group ${groupLabel}`
    )
    console.log(
      `[BACKHAUL WATCHER] Rules - tag ${backhaul.tag}, breach tiers ${backhaul.breachThresholdsHours.join(', ')}`
    )
  }).catch(() => {})
  console.log(`[BACKHAUL WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const run = async () => {
    let config

    try {
      const stored = await getWhatsappWatcherConfig()
      config = stored.backhaul
    } catch (error) {
      console.error('[BACKHAUL WATCHER] Config load failed:', error?.message || error)
      scheduleNext(run, 5 * 60 * 1000)
      return
    }

    if (!config.enabled) {
      scheduleNext(run, config.pollMs)
      return
    }

    if (!config.tag) {
      console.warn('[BACKHAUL WATCHER] Skipping tick - backhaul tag is empty')
      scheduleNext(run, config.pollMs)
      return
    }

    const sendBackhaul = async (message) => {
      try {
        await sendSlaAlert(message, config.groupIds?.length ? { groupIds: config.groupIds } : {})
      } catch (error) {
        console.error('[BACKHAUL WATCHER] send failed:', error?.message || error)
      }
    }

    try {
      const now = dayjs()
      const activeTickets = await fetchActiveBackhaulTickets(config.tag)
      const fresh = []
      const breachesByThreshold = new Map()
      config.breachThresholdsHours.forEach((threshold) => breachesByThreshold.set(threshold, []))

      for (const ticket of activeTickets) {
        const summary = buildTicketSummary(ticket, now)
        if (!Number.isFinite(summary.ageHours)) continue

        if (summary.ageHours <= config.lookbackHours) {
          const key = `backhaul-new-${ticket.id}`
          if (await shouldSendAlert(warnedNew, {
            dedupeKey: key,
            watcherKey: 'backhaul',
            alertType: 'new',
            entityId: ticket.id,
            payload: { status: summary.status, updatedAt: summary.updated_at }
          })) {
            fresh.push(summary)
          }
        }

        for (const threshold of config.breachThresholdsHours) {
          if (summary.ageHours >= threshold) {
            const key = `backhaul-breach-${threshold}-${ticket.id}`
            if (await shouldSendAlert(warnedBreach, {
              dedupeKey: key,
              watcherKey: 'backhaul',
              alertType: `breach_${threshold}h`,
              entityId: ticket.id,
              payload: { status: summary.status, updatedAt: summary.updated_at }
            })) {
              breachesByThreshold.get(threshold).push(summary)
            }
          }
        }
      }

      const newMessage = buildNewAlertMessage(fresh, config.templates)
      if (newMessage) {
        console.log('[BACKHAUL WATCHER] Sending WhatsApp new backhaul alert')
        await sendBackhaul(newMessage)
      }

      for (const threshold of config.breachThresholdsHours) {
        const message = buildBreachAlertMessage(breachesByThreshold.get(threshold) || [], threshold, config.templates)
        if (message) {
          console.log(`[BACKHAUL WATCHER] Sending WhatsApp backhaul breach ${threshold}h alert`)
          await sendBackhaul(message)
        }
      }

      const updatedTickets = await fetchRecentlyUpdatedBackhaulTickets(config.tag, config.resolvedLookbackHours)
      const resolved = []

      for (const ticket of updatedTickets) {
        if (!isResolvedStatus(ticket.status)) continue

        const summary = buildTicketSummary(ticket, now)
        const key = `backhaul-resolved-${ticket.id}-${ticket.status}-${ticket.updated_at}`
        const shouldSend = await shouldSendAlert(warnedResolved, {
          dedupeKey: key,
          watcherKey: 'backhaul',
          alertType: 'resolved',
          entityId: ticket.id,
          payload: { status: summary.status, updatedAt: summary.updated_at }
        })
        if (!shouldSend) continue
        resolved.push(summary)
      }

      const resolvedMessage = buildResolvedAlertMessage(resolved, config.templates)
      if (resolvedMessage) {
        console.log('[BACKHAUL WATCHER] Sending WhatsApp resolved backhaul alert')
        await sendBackhaul(resolvedMessage)
      }
    } catch (error) {
      console.error('[BACKHAUL WATCHER] Tick error:', error?.message || error)
    } finally {
      scheduleNext(run, config.pollMs)
    }
  }

  void run()
}
