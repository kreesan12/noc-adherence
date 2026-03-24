// server/vipTicketWatcher.js
import dayjs from 'dayjs'

// ---- Config ----
const POLL_INTERVAL_MS = Number(process.env.VIP_POLL_MS || 2 * 60 * 1000)
const LOOKBACK_HOURS = Number(process.env.VIP_LOOKBACK_HOURS || 2)

// Organization based VIP rule
const VIP_ORG_ID = String(process.env.VIP_ORG_ID || '42757142385041')

// Tag based VIP rules
const VIP_TAG_RULES = [
  {
    key: 'vip-carrier-down',
    tag: String(process.env.VIP_TAG || 'iris_vip_carrier_down').trim(),
    title: '🟪 VIP carrier down (Telemedia)'
  },
  {
    key: 'rise-traffic-drop',
    tag: String(process.env.VIP_RISE_TRAFFIC_TAG || 'iris_rise_traffic').trim(),
    title: '🚨 RISE traffic drop',
    includePriority: false,
    includeTags: false,
    includeOrgId: false
  }
].filter(rule => rule.tag)

// Send VIP alerts to a different WhatsApp group (optional)
const VIP_GROUP_ID = process.env.WHATSAPP_VIP_GROUP_ID || null

// Cache safety
const CACHE_TTL_HOURS = Number(process.env.VIP_CACHE_TTL_HOURS || 72)
const CACHE_MAX_KEYS = Number(process.env.VIP_CACHE_MAX_KEYS || 5000)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[VIP WATCHER] Zendesk env vars missing; watcher will not run')
}

// ---- TTL cache helpers ----
function makeTtlCache (ttlMs, maxKeys) {
  const m = new Map() // key -> expiresAtMs

  function prune () {
    const now = Date.now()
    for (const [k, exp] of m.entries()) {
      if (exp <= now) m.delete(k)
    }
    while (m.size > maxKeys) {
      const firstKey = m.keys().next().value
      m.delete(firstKey)
    }
  }

  function has (key) {
    prune()
    const exp = m.get(key)
    if (!exp) return false
    if (exp <= Date.now()) {
      m.delete(key)
      return false
    }
    return true
  }

  function add (key) {
    prune()
    m.set(key, Date.now() + ttlMs)
  }

  return { has, add, prune, size: () => m.size }
}

const TTL_MS = CACHE_TTL_HOURS * 60 * 60 * 1000
const warnedNew = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)

// ---- Helpers (Zendesk) ----
function makeAuthHeader () {
  const auth = Buffer.from(
    `${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`,
    'utf8'
  ).toString('base64')
  return `Basic ${auth}`
}

async function fetchJsonWithTimeout (url, { headers, timeoutMs = 25000 } = {}) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, { headers, signal: controller.signal })
    const text = await res.text()

    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText} - ${text}`)
    }

    return JSON.parse(text)
  } finally {
    clearTimeout(t)
  }
}

function zendeskAgentTicketLink (id) {
  return `https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${id}`
}

function safeStr (v) {
  return (v === null || v === undefined) ? '' : String(v)
}

function buildVipMsg ({
  title,
  ticket,
  reason,
  ageHours,
  includePriority = true,
  includeTags = true,
  includeOrgId = true
}) {
  const lines = []
  lines.push(title)
  lines.push('')

  lines.push(`Ticket #${ticket.id}: ${safeStr(ticket.subject)}`)
  lines.push(
    includePriority
      ? `Status: ${safeStr(ticket.status)} | Priority: ${safeStr(ticket.priority)}`
      : `Status: ${safeStr(ticket.status)}`
  )
  lines.push(`Created: ${safeStr(ticket.created_at)} | Updated: ${safeStr(ticket.updated_at)}`)
  lines.push(`Age: ${Number.isFinite(ageHours) ? ageHours.toFixed(2) : ''} h`)

  if (reason) lines.push(`Reason: ${reason}`)
  if (includeTags && Array.isArray(ticket.tags) && ticket.tags.length) {
    lines.push(`Tags: ${ticket.tags.join(', ')}`)
  }

  if (includeOrgId && ticket.organization_id) lines.push(`Org ID: ${ticket.organization_id}`)
  lines.push(`Link: ${zendeskAgentTicketLink(ticket.id)}`)

  return lines.join('\n')
}

function buildCreatedLookbackQuery () {
  return `created>${LOOKBACK_HOURS}hours`
}

async function fetchVipOrgTicketsRaw () {
  const createdCutoff = buildCreatedLookbackQuery()

  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `type:ticket status<solved organization_id:${VIP_ORG_ID} ${createdCutoff}`
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), {
    headers: {
      Authorization: makeAuthHeader(),
      'Content-Type': 'application/json'
    }
  })

  return data.results || []
}

async function fetchVipTagTicketsRaw (tag) {
  const createdCutoff = buildCreatedLookbackQuery()
  const query = `type:ticket status<solved tags:${tag} ${createdCutoff}`

  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', query)
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const data = await fetchJsonWithTimeout(url.toString(), {
    headers: {
      Authorization: makeAuthHeader(),
      'Content-Type': 'application/json'
    }
  })

  return { results: (data.results || []), query }
}

// ---- Main entrypoint ----
let watcherStarted = false

export function startVipTicketWatcher (sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[VIP WATCHER] Not starting - Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  const groupLabel = VIP_GROUP_ID ? `override ${VIP_GROUP_ID}` : 'default group'
  const tagLabel = VIP_TAG_RULES.length
    ? VIP_TAG_RULES.map(rule => rule.tag).join(', ')
    : '(none)'

  console.log(
    `[VIP WATCHER] Starting - poll ${Math.round(POLL_INTERVAL_MS / 1000)}s, lookback ${LOOKBACK_HOURS}h, group ${groupLabel}`
  )
  console.log(`[VIP WATCHER] Rules - org ${VIP_ORG_ID}, tags ${tagLabel}`)
  console.log(`[VIP WATCHER] Cache - TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const sendVip = async (msg) => {
    // Never let a send failure kill the tick
    try {
      await sendSlaAlert(msg, VIP_GROUP_ID ? { groupId: VIP_GROUP_ID } : {})
    } catch (e) {
      console.error('[VIP WATCHER] send failed:', e?.message || e)
    }
  }

  const tick = async () => {
    try {
      const now = dayjs()

      // 1) Org based VIP tickets (creation alerts)
      const vipOrg = await fetchVipOrgTicketsRaw()

      for (const t of vipOrg) {
        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageHours = now.diff(created, 'hour', true)

        const key = `vip-org-new:${t.id}`
        if (warnedNew.has(key)) continue
        warnedNew.add(key)

        const msg = buildVipMsg({
          title: '🟣 VIP ticket logged (Telemedia)',
          ticket: t,
          reason: `organization_id=${VIP_ORG_ID}`,
          ageHours
        })

        console.log('[VIP WATCHER] Sending WA VIP org NEW alert', t.id)
        await sendVip(msg)
      }

      // 2) Tag based VIP tickets (creation alerts)
      for (const rule of VIP_TAG_RULES) {
        const { results: vipTags, query } = await fetchVipTagTicketsRaw(rule.tag)

        console.log('[VIP WATCHER] Tag query:', query, '| results:', vipTags.length)
        if (vipTags[0]) {
          console.log('[VIP WATCHER] Tag sample:', rule.tag, vipTags[0].id, vipTags[0].created_at)
        }

        for (const t of vipTags) {
          const created = dayjs(t.created_at)
          if (!created.isValid()) continue

          const ageHours = now.diff(created, 'hour', true)

          const key = `vip-tag-new:${rule.key}:${t.id}`
          if (warnedNew.has(key)) continue
          warnedNew.add(key)

          const msg = buildVipMsg({
            title: rule.title,
            ticket: t,
            reason: `tags=${rule.tag}`,
            ageHours,
            includePriority: rule.includePriority,
            includeTags: rule.includeTags,
            includeOrgId: rule.includeOrgId
          })

          console.log('[VIP WATCHER] Sending WA VIP tag NEW alert', rule.tag, t.id)
          await sendVip(msg)
        }
      }
    } catch (err) {
      console.error('[VIP WATCHER] Tick error:', err?.message || err)
    }
  }

  tick()

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  interval.unref?.()
}
