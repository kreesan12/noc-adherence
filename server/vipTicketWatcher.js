import dayjs from 'dayjs'
import {
  compactText,
  fetchJsonWithTimeout,
  formatAgeHours,
  makeAuthHeader,
  makeTtlCache,
  safeStr,
  zendeskAgentTicketLink
} from './lib/watcherUtils.js'
import { recordWatcherAlert } from './lib/watcherAlertLog.js'
import { getWhatsappWatcherConfig } from './lib/whatsappWatcherConfig.js'

const CACHE_TTL_HOURS = Number(process.env.VIP_CACHE_TTL_HOURS || 72)
const CACHE_MAX_KEYS = Number(process.env.VIP_CACHE_MAX_KEYS || 5000)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[VIP WATCHER] Zendesk env vars missing; watcher will not run')
}

const TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000
const warnedNew = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)

function buildCreatedLookbackQuery(lookbackHours) {
  return `created>${lookbackHours}hours`
}

function buildVipMessage({
  title,
  ticket,
  reason,
  ageHours,
  includePriority = true
}) {
  const lines = [title, '']

  const status = safeStr(ticket.status) || 'unknown'
  const priority = safeStr(ticket.priority) || 'n/a'
  const ageLabel = formatAgeHours(ageHours)
  const headerParts = [`#${ticket.id}`, status]

  if (includePriority) {
    headerParts.push(priority.toUpperCase())
  }

  headerParts.push(`${ageLabel} old`)
  lines.push(headerParts.join(' | '))

  const subject = compactText(ticket.subject)
  if (subject) lines.push(`Subject: ${subject}`)
  if (reason) lines.push(`Reason: ${reason}`)
  lines.push(`Link: ${zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticket.id)}`)

  return lines.join('\n')
}

function makeHeaders() {
  return {
    Authorization: makeAuthHeader(ZENDESK_EMAIL, ZENDESK_API_TOKEN),
    'Content-Type': 'application/json'
  }
}

async function fetchVipOrgTicketsRaw(orgId, lookbackHours) {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `type:ticket status<solved organization_id:${orgId} ${buildCreatedLookbackQuery(lookbackHours)}`
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

async function fetchVipTagTicketsRaw(tag, lookbackHours) {
  const query = `type:ticket status<solved tags:${tag} ${buildCreatedLookbackQuery(lookbackHours)}`
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', query)
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return { query, results: data.results || [] }
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
  const wait = Math.max(30 * 1000, Number(delayMs) || 2 * 60 * 1000)
  nextTimer = setTimeout(run, wait)
  nextTimer.unref?.()
}

export function startVipTicketWatcher(sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[VIP WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  void getWhatsappWatcherConfig().then(({ vip }) => {
    const groupLabel = vip.groupId ? `override ${vip.groupId}` : 'default group'
    const tagLabel = vip.tagRules.length
      ? vip.tagRules.map((rule) => rule.tag).join(', ')
      : '(none)'

    console.log(
      `[VIP WATCHER] Starting - poll ${Math.round(vip.pollMs / 1000)}s, lookback ${vip.lookbackHours}h, group ${groupLabel}`
    )
    console.log(`[VIP WATCHER] Rules - org ${vip.orgId}, tags ${tagLabel}`)
  }).catch(() => {})
  console.log(`[VIP WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const run = async () => {
    let config

    try {
      const stored = await getWhatsappWatcherConfig()
      config = stored.vip
    } catch (error) {
      console.error('[VIP WATCHER] Config load failed:', error?.message || error)
      scheduleNext(run, 2 * 60 * 1000)
      return
    }

    if (!config.enabled) {
      scheduleNext(run, config.pollMs)
      return
    }

    const sendVip = async (message) => {
      try {
        await sendSlaAlert(message, config.groupId ? { groupId: config.groupId } : {})
      } catch (error) {
        console.error('[VIP WATCHER] send failed:', error?.message || error)
      }
    }

    try {
      const now = dayjs()
      const vipOrg = await fetchVipOrgTicketsRaw(config.orgId, config.lookbackHours)

      for (const ticket of vipOrg) {
        const created = dayjs(ticket.created_at)
        if (!created.isValid()) continue

        const ageHours = now.diff(created, 'hour', true)
        const key = `vip-org-new:${ticket.id}`
        const shouldSend = await shouldSendAlert(warnedNew, {
          dedupeKey: key,
          watcherKey: 'vip',
          alertType: 'org_new',
          entityId: ticket.id,
          payload: { status: ticket.status, updatedAt: ticket.updated_at }
        })
        if (!shouldSend) continue

        const message = buildVipMessage({
          title: config.templates.orgTitle,
          ticket,
          reason: config.templates.orgReason,
          ageHours
        })

        console.log('[VIP WATCHER] Sending WA VIP org NEW alert', ticket.id)
        await sendVip(message)
      }

      for (const rule of config.tagRules) {
        const { query, results } = await fetchVipTagTicketsRaw(rule.tag, config.lookbackHours)

        console.log('[VIP WATCHER] Tag query:', query, '| results:', results.length)
        if (results[0]) {
          console.log('[VIP WATCHER] Tag sample:', rule.tag, results[0].id, results[0].created_at)
        }

        for (const ticket of results) {
          const created = dayjs(ticket.created_at)
          if (!created.isValid()) continue

          const ageHours = now.diff(created, 'hour', true)
          const key = `vip-tag-new:${rule.key}:${ticket.id}`
          const shouldSend = await shouldSendAlert(warnedNew, {
            dedupeKey: key,
            watcherKey: 'vip',
            alertType: `tag_new_${rule.key}`,
            entityId: ticket.id,
            payload: { tag: rule.tag, status: ticket.status, updatedAt: ticket.updated_at }
          })
          if (!shouldSend) continue

          const message = buildVipMessage({
            title: rule.title,
            ticket,
            reason: rule.reason,
            ageHours,
            includePriority: rule.includePriority
          })

          console.log('[VIP WATCHER] Sending WA VIP tag NEW alert', rule.tag, ticket.id)
          await sendVip(message)
        }
      }
    } catch (error) {
      console.error('[VIP WATCHER] Tick error:', error?.message || error)
    } finally {
      scheduleNext(run, config.pollMs)
    }
  }

  void run()
}
