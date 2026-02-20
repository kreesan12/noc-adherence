// server/vipTicketWatcher.js

import dayjs from 'dayjs'

// ---- Config ----
const POLL_INTERVAL_MS = Number(process.env.VIP_POLL_MS || 5 * 60 * 1000)

// Limit search lookback so we do not pull lots of historical tickets
// We use Zendesk relative search syntax: created>10minutes
const LOOKBACK_MINUTES = Number(process.env.VIP_LOOKBACK_MINUTES || 10)

// Organization based VIP rule
const VIP_ORG_ID = String(process.env.VIP_ORG_ID || '42757142385041')

// Reminder cadence
const REMIND_EVERY_HOURS = Number(process.env.VIP_REMIND_EVERY_HOURS || 2)

// Tag based VIP rule
// You can override in env: VIP_TAGS="iris_vip_carrier_down,iris_integration"
const VIP_TAGS = (process.env.VIP_TAGS || 'iris_vip_carrier_down,iris_integration')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

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

    // Remove expired
    for (const [k, exp] of m.entries()) {
      if (exp <= now) m.delete(k)
    }

    // If still too big, delete oldest-ish (Map keeps insertion order)
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

// Track reminder buckets per ticket so we resend every N hours only
// key can be "123" for org rule or "tag:123" for tag rule (keeps them independent)
const remindBuckets = new Map() // key -> lastBucketNumber

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

function buildCreatedCutoffQuery () {
  // Zendesk search supports relative times like created>10minutes
  return `created>${LOOKBACK_MINUTES}minutes`
}

async function fetchVipOrgTicketsRaw () {
  const createdCutoff = buildCreatedCutoffQuery()

  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `type:ticket organization_id:${VIP_ORG_ID} status<solved ${createdCutoff}`
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
  const createdCutoff = buildCreatedCutoffQuery()

  // OR all tags so any of them triggers
  const tagQuery = VIP_TAGS.map(t => `tags:${t}`).join(' OR ')

  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    `type:ticket (${tagQuery}) status<solved ${createdCutoff}`
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

function upsertReminderBucket (key, ageHours) {
  const bucket = Math.floor(ageHours / REMIND_EVERY_HOURS)
  const last = remindBuckets.get(key) ?? -1
  if (bucket > last) {
    remindBuckets.set(key, bucket)
    return { shouldSend: true, bucket }
  }
  return { shouldSend: false, bucket }
}

function pruneReminderBuckets () {
  if (remindBuckets.size <= CACHE_MAX_KEYS) return
  const keys = Array.from(remindBuckets.keys())
  for (let i = 0; i < keys.length - CACHE_MAX_KEYS; i++) {
    remindBuckets.delete(keys[i])
  }
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

  console.log(
    `[VIP WATCHER] Starting – poll ${Math.round(POLL_INTERVAL_MS / 1000)}s, lookback ${LOOKBACK_MINUTES}m, remind every ${REMIND_EVERY_HOURS}h`
  )
  console.log(`[VIP WATCHER] Rules – org ${VIP_ORG_ID}, tags ${VIP_TAGS.join(', ')}`)
  console.log(`[VIP WATCHER] Cache – TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const tick = async () => {
    try {
      const now = dayjs()

      // 1) Org based VIP tickets
      const vipOrg = await fetchVipOrgTicketsRaw()

      for (const t of vipOrg) {
        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageHours = now.diff(created, 'hour', true)

        // New ticket alert (first time we see it)
        const newKey = `vip-org-new:${t.id}`
        if (!warnedNew.has(newKey)) {
          warnedNew.add(newKey)
          const msg = buildVipMsg({
            title: '🟣 VIP ticket logged (TELEMEDIA logged a ticket)',
            ticket: t,
            ageHours
          })
          console.log('[VIP WATCHER] Sending WA VIP org NEW alert', t.id)
          await sendSlaAlert(msg)
        }

        // Reminder every N hours while still not solved
        // Only send for bucket >= 1 so we do not duplicate the "new ticket" message immediately
        const bucketKey = String(t.id)
        const { shouldSend, bucket } = upsertReminderBucket(bucketKey, ageHours)
        if (shouldSend && bucket >= 1) {
          const msg = buildVipMsg({
            title: `🟣 VIP ticket still open - TELEMEDIA (${bucket * REMIND_EVERY_HOURS}h)`,
            ticket: t,
            ageHours
          })
          console.log('[VIP WATCHER] Sending WA VIP org REMINDER', t.id, 'bucket', bucket)
          await sendSlaAlert(msg)
        }
      }

      // 2) Tag based VIP tickets
      const vipTags = await fetchVipTagTicketsRaw()

      for (const t of vipTags) {
        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageHours = now.diff(created, 'hour', true)

        // Which tag triggered (for nicer message context)
        const tagList = Array.isArray(t.tags) ? t.tags : []
        const matched = VIP_TAGS.filter(x => tagList.includes(x))
        const reason = matched.length ? `tags=${matched.join(', ')}` : `tags in ${VIP_TAGS.join(', ')}`

        const newKey = `vip-tag-new:${t.id}`
        if (!warnedNew.has(newKey)) {
          warnedNew.add(newKey)
          const msg = buildVipMsg({
            title: '🟪 VIP carrier down - TELEMEDIA',
            ticket: t,
            ageHours
          })
          console.log('[VIP WATCHER] Sending WA VIP tag NEW alert', t.id)
          await sendSlaAlert(msg)
        }

        const bucketKey = `tag:${t.id}`
        const { shouldSend, bucket } = upsertReminderBucket(bucketKey, ageHours)
        if (shouldSend && bucket >= 1) {
          const msg = buildVipMsg({
            title: `🟪 VIP carrier - still open - TELEMEDIA (${bucket * REMIND_EVERY_HOURS}h)`,
            ticket: t,
            ageHours
          })
          console.log('[VIP WATCHER] Sending WA VIP tag REMINDER', t.id, 'bucket', bucket)
          await sendSlaAlert(msg)
        }
      }

      pruneReminderBuckets()
    } catch (err) {
      console.error('[VIP WATCHER] Tick error:', err?.message || err)
    }
  }

  tick()

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  // let Node exit cleanly on dyno shutdown
  interval.unref?.()
}