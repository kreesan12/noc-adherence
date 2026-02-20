// server/vipTicketWatcher.js
import dayjs from 'dayjs'

// ---- Config ----
const POLL_INTERVAL_MS = Number(process.env.VIP_POLL_MS || 5 * 60 * 1000)

// Look back 2 hours to catch anything we might have missed (but still bounded)
const LOOKBACK_HOURS = Number(process.env.VIP_LOOKBACK_HOURS || 2)

// Organization based VIP rule
const VIP_ORG_ID = String(process.env.VIP_ORG_ID || '42757142385041')

// Tag based VIP rule (any match triggers)
const VIP_TAGS = (process.env.VIP_TAGS || 'iris_vip_carrier_down,iris_integration')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

// Send VIP alerts to a different WhatsApp group (optional)
// If not set, falls back to default group configured in whatsappClient.js
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
      throw new Error(`${res.status} ${res.statusText} – ${text}`)
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

function buildVipMsg ({ title, ticket, reason, ageHours }) {
  const lines = []
  lines.push(title)
  lines.push('')

  lines.push(`Ticket #${ticket.id}: ${safeStr(ticket.subject)}`)
  lines.push(`Status: ${safeStr(ticket.status)} | Priority: ${safeStr(ticket.priority)}`)
  lines.push(`Created: ${safeStr(ticket.created_at)} | Updated: ${safeStr(ticket.updated_at)}`)
  lines.push(`Age: ${Number.isFinite(ageHours) ? ageHours.toFixed(2) : ''} h`)

  if (reason) lines.push(`Reason: ${reason}`)
  if (Array.isArray(ticket.tags) && ticket.tags.length) {
    lines.push(`Tags: ${ticket.tags.join(', ')}`)
  }

  if (ticket.organization_id) lines.push(`Org ID: ${ticket.organization_id}`)
  lines.push(`Link: ${zendeskAgentTicketLink(ticket.id)}`)

  return lines.join('\n')
}

function buildCreatedLookbackQuery () {
  // Zendesk search supports relative times like created>2hours
  return `created>${LOOKBACK_HOURS}hours`
}

async function fetchVipOrgTicketsRaw () {
  const createdCutoff = buildCreatedLookbackQuery()

  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `type:ticket organization_id:${VIP_ORG_ID} ${createdCutoff}`
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

async function fetchVipTagTicketsRaw () {
  const createdCutoff = buildCreatedLookbackQuery()
  const tagQuery = VIP_TAGS.map(t => `tags:${t}`).join(' OR ')

  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `type:ticket (${tagQuery}) ${createdCutoff}`
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

// ---- Main entrypoint ----
let watcherStarted = false

export function startVipTicketWatcher (sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[VIP WATCHER] Not starting – Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  const groupLabel = VIP_GROUP_ID ? `override ${VIP_GROUP_ID}` : 'default group'
  console.log(
    `[VIP WATCHER] Starting – poll ${Math.round(POLL_INTERVAL_MS / 1000)}s, lookback ${LOOKBACK_HOURS}h, group ${groupLabel}`
  )
  console.log(`[VIP WATCHER] Rules – org ${VIP_ORG_ID}, tags ${VIP_TAGS.join(', ')}`)
  console.log(`[VIP WATCHER] Cache – TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const sendVip = async (msg) => {
    await sendSlaAlert(msg, VIP_GROUP_ID ? { groupId: VIP_GROUP_ID } : {})
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

        // Only alert once per ticket
        const key = `vip-org-new:${t.id}`
        if (warnedNew.has(key)) continue

        warnedNew.add(key)

        const msg = buildVipMsg({
          title: '🟣 VIP ticket logged (Org rule)',
          ticket: t,
          reason: `organization_id=${VIP_ORG_ID}`,
          ageHours
        })

        console.log('[VIP WATCHER] Sending WA VIP org NEW alert', t.id)
        await sendVip(msg)
      }

      // 2) Tag based VIP tickets (creation alerts)
      const vipTags = await fetchVipTagTicketsRaw()

      for (const t of vipTags) {
        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageHours = now.diff(created, 'hour', true)

        const tagList = Array.isArray(t.tags) ? t.tags : []
        const matched = VIP_TAGS.filter(x => tagList.includes(x))
        const reason = matched.length ? `tags=${matched.join(', ')}` : `tags in ${VIP_TAGS.join(', ')}`

        const key = `vip-tag-new:${t.id}`
        if (warnedNew.has(key)) continue

        warnedNew.add(key)

        const msg = buildVipMsg({
          title: '🟪 VIP carrier down or integration ticket logged (Tag rule)',
          ticket: t,
          reason,
          ageHours
        })

        console.log('[VIP WATCHER] Sending WA VIP tag NEW alert', t.id)
        await sendVip(msg)
      }
    } catch (err) {
      console.error('[VIP WATCHER] Tick error:', err?.message || err)
    }
  }

  tick()

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  interval.unref?.()
}