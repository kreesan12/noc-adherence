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

const POLL_INTERVAL_MS = Number(process.env.VIP_POLL_MS || 2 * 60 * 1000)
const LOOKBACK_HOURS = Number(process.env.VIP_LOOKBACK_HOURS || 2)

const VIP_ORG_ID = String(process.env.VIP_ORG_ID || '42757142385041')

const VIP_TAG_RULES = [
  {
    key: 'vip-carrier-down',
    tag: String(process.env.VIP_TAG || 'iris_vip_carrier_down').trim(),
    title: 'VIP alert | Carrier down',
    reason: 'carrier-down tag'
  },
  {
    key: 'rise-traffic-drop',
    tag: String(process.env.VIP_RISE_TRAFFIC_TAG || 'iris_rise_traffic').trim(),
    title: 'VIP alert | RISE traffic drop',
    reason: 'rise-traffic tag',
    includePriority: false
  }
].filter((rule) => rule.tag)

const VIP_GROUP_ID = process.env.WHATSAPP_VIP_GROUP_ID || null

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

function buildCreatedLookbackQuery() {
  return `created>${LOOKBACK_HOURS}hours`
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

async function fetchVipOrgTicketsRaw() {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `type:ticket status<solved organization_id:${VIP_ORG_ID} ${buildCreatedLookbackQuery()}`
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return data.results || []
}

async function fetchVipTagTicketsRaw(tag) {
  const query = `type:ticket status<solved tags:${tag} ${buildCreatedLookbackQuery()}`
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', query)
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), { headers: makeHeaders() })
  return { query, results: data.results || [] }
}

let watcherStarted = false

export function startVipTicketWatcher(sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[VIP WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  const groupLabel = VIP_GROUP_ID ? `override ${VIP_GROUP_ID}` : 'default group'
  const tagLabel = VIP_TAG_RULES.length
    ? VIP_TAG_RULES.map((rule) => rule.tag).join(', ')
    : '(none)'

  console.log(
    `[VIP WATCHER] Starting - poll ${Math.round(POLL_INTERVAL_MS / 1000)}s, lookback ${LOOKBACK_HOURS}h, group ${groupLabel}`
  )
  console.log(`[VIP WATCHER] Rules - org ${VIP_ORG_ID}, tags ${tagLabel}`)
  console.log(`[VIP WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const sendVip = async (message) => {
    try {
      await sendSlaAlert(message, VIP_GROUP_ID ? { groupId: VIP_GROUP_ID } : {})
    } catch (error) {
      console.error('[VIP WATCHER] send failed:', error?.message || error)
    }
  }

  const tick = async () => {
    try {
      const now = dayjs()
      const vipOrg = await fetchVipOrgTicketsRaw()

      for (const ticket of vipOrg) {
        const created = dayjs(ticket.created_at)
        if (!created.isValid()) continue

        const ageHours = now.diff(created, 'hour', true)
        const key = `vip-org-new:${ticket.id}`
        if (warnedNew.has(key)) continue
        warnedNew.add(key)

        const message = buildVipMessage({
          title: 'VIP ticket logged | Telemedia',
          ticket,
          reason: 'organization match',
          ageHours
        })

        console.log('[VIP WATCHER] Sending WA VIP org NEW alert', ticket.id)
        await sendVip(message)
      }

      for (const rule of VIP_TAG_RULES) {
        const { query, results } = await fetchVipTagTicketsRaw(rule.tag)

        console.log('[VIP WATCHER] Tag query:', query, '| results:', results.length)
        if (results[0]) {
          console.log('[VIP WATCHER] Tag sample:', rule.tag, results[0].id, results[0].created_at)
        }

        for (const ticket of results) {
          const created = dayjs(ticket.created_at)
          if (!created.isValid()) continue

          const ageHours = now.diff(created, 'hour', true)
          const key = `vip-tag-new:${rule.key}:${ticket.id}`
          if (warnedNew.has(key)) continue
          warnedNew.add(key)

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
    }
  }

  tick()

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  interval.unref?.()
}
