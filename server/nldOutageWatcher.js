// server/nldOutageWatcher.js

import dayjs from 'dayjs'

// ---- Config ----
const OUTAGE_WINDOW_MINUTES = Number(process.env.NLD_WINDOW_MINUTES || 60)
const BREACH_HOURS = Number(process.env.NLD_BREACH_HOURS || 4) // keep for backwards compat/logging
const POLL_INTERVAL_MS = Number(process.env.NLD_POLL_MS || 5 * 60 * 1000)

// partial NLD metrics
const PARTIAL_LOOKBACK_HOURS = Number(process.env.NLD_PARTIAL_LOOKBACK_HOURS || 24)

// CHANGE: 3 events in last 3 hours
const CLUSTER_WINDOW_HOURS = Number(process.env.NLD_CLUSTER_WINDOW_HOURS || 3)
const CLUSTER_MIN_EVENTS = Number(process.env.NLD_CLUSTER_MIN_EVENTS || 3)

const PARTIAL_NOT_LOGGED_MINUTES = Number(process.env.NLD_NOT_LOGGED_MINUTES || 30)

// CHANGE: multi breach tiers (includes your existing 4h)
const BREACH_THRESHOLDS_HOURS = [4, 6, 8, 12, 16, 20, 24]

// Memory safety: keep “warned” keys bounded using TTL + max keys
const CACHE_TTL_HOURS = Number(process.env.NLD_CACHE_TTL_HOURS || 72)
const CACHE_MAX_KEYS = Number(process.env.NLD_CACHE_MAX_KEYS || 5000)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[NLD WATCHER] Zendesk env vars missing; watcher will not run')
}

// ---- TTL cache helpers (so Sets don’t grow forever) ----
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
const warnedRecent = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedBreach = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)
const warnedPartialClusters = makeTtlCache(TTL_MS, CACHE_MAX_KEYS)

// For partial “not logged yet” repeated alerts every 30 min.
const partialNotLoggedBuckets = new Map() // ticketId -> last bucket

// ---- Helpers (Zendesk) ----
function isNldTicket (t) {
  return (t.subject || '').toUpperCase().includes('NLD')
}

function cf (t, id) {
  const field = (t.custom_fields || []).find(f => String(f.id) === String(id))
  const val = field?.value
  if (Array.isArray(val)) return val[0]
  return val ?? ''
}

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

async function fetchOutageTickets () {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set('query', 'group:5160847905297 form:"Outage Capturing" status<solved')
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

// ------------------------------
// CHANGE: validity + normalization helpers
// ------------------------------
function normalizeRoute (str) {
  if (!str) return ''
  return String(str)
    .toLowerCase()
    // normalize NLD3/4 variants
    .replace(/\bnld\s*3\s*\/\s*4\b/g, 'nld3/4')
    // normalize arrows
    .replace(/\s*<[-–]?>\s*/g, ' <> ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isIgnorableNld (raw) {
  const s = normalizeRoute(raw)
  if (!s) return true
  if (s === 'other') return true
  if (s === 'dfa nld') return true
  return false
}

function getEventRouteKey (event) {
  // prefer NLD route, fallback to partial circuit
  const rawKey = event?.nldRoute || event?.partialCircuit || ''
  if (isIgnorableNld(rawKey)) return ''
  return rawKey
}

function expandNld3_4Variants (norm) {
  // If alert comes as NLD3/4, allow matching against NLD3, NLD4, and NLD3/4 on outages
  const variants = new Set([norm])
  if (/\bnld3\/4\b/.test(norm)) {
    variants.add(norm.replace(/\bnld3\/4\b/g, 'nld3'))
    variants.add(norm.replace(/\bnld3\/4\b/g, 'nld4'))
  }
  return Array.from(variants)
}

// ------------------------------
// Outage route index (unchanged except uses normalizeRoute above)
// ------------------------------
function buildOutageRouteIndex (enrichedOutages) {
  return enrichedOutages.map(o => ({
    ticketId: o.id,
    nldNorm: normalizeRoute(o.nld || ''),
    subjectNorm: normalizeRoute(o.subject || '')
  }))
}

// CHANGE: matching now supports NLD3/4 variants and ignores DFA NLD / OTHER / blank events
function hasMatchingOutageForEvent (event, outageIndex) {
  const eventKey = getEventRouteKey(event)
  const eventNorm = normalizeRoute(eventKey)
  if (!eventNorm) return false

  const eventVariants = expandNld3_4Variants(eventNorm)

  for (const o of outageIndex) {
    const { nldNorm, subjectNorm } = o

    for (const v of eventVariants) {
      if (nldNorm && (nldNorm.includes(v) || v.includes(nldNorm))) return true
      if (subjectNorm && (subjectNorm.includes(v) || v.includes(subjectNorm))) return true
    }
  }

  return false
}

// ---- WhatsApp message builders ----
function buildRecentMsg (tickets) {
  if (!tickets.length) return null
  const lines = ['🟡 New NLD outage logged', '']

  tickets.forEach(t => {
    lines.push(`Ticket #${t.id}: ${t.subject || ''}`)
    lines.push(`Age: ${t.ageMinutes.toFixed(0)} min`)
    lines.push(`Impact: ${t.subscriberImpact}`)
    lines.push(`NLD: ${t.nld || ''}`)
    if (t.liquidRef) lines.push(`Liquid Ref: ${t.liquidRef}`)
    if (t.liquidCircuit) lines.push(`Liquid Cir: ${t.liquidCircuit}`)
    lines.push(`Link: https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`)
    lines.push('')
  })

  return lines.join('\n')
}

// CHANGE: message builder takes a threshold (single)
function buildBreachMsg (tickets, breachHours, windowMinutes) {
  if (!tickets.length) return null

  const extra = breachHours >= 8 ? ' 🔥' : ''
  const lines = [`🔴 NLD outage open >= ${breachHours}h${extra} (not created in last ${windowMinutes} min)`, '']

  tickets.forEach(t => {
    lines.push(`Ticket #${t.id}: ${t.subject || ''}`)
    lines.push(`Age: ${t.ageHours.toFixed(1)} h`)
    lines.push(`Impact: ${t.subscriberImpact}`)
    lines.push(`NLD: ${t.nld || ''}`)
    if (t.liquidRef) lines.push(`Liquid Ref: ${t.liquidRef}`)
    if (t.liquidCircuit) lines.push(`Liquid Cir: ${t.liquidCircuit}`)
    lines.push(`Link: https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`)
    lines.push('')
  })

  return lines.join('\n')
}

// ---- Partial NLD fetch + transform ----
async function fetchPartialNldAlertsRaw () {
  const url = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  url.searchParams.set(
    'query',
    'type:ticket tags:partial_nld_alert requester:"IRIS API" -tags:"partial_nld_alert_duplicate_solved"'
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

function transformPartialNldAlerts (results) {
  const nowMs = Date.now()
  const cutoffMs = nowMs - PARTIAL_LOOKBACK_HOURS * 60 * 60 * 1000
  const base = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/`

  const events = []

  for (const t of results) {
    const createdMs = Date.parse(t.created_at)
    if (Number.isNaN(createdMs)) continue
    if (createdMs < cutoffMs) continue

    const subject = t.subject || ''
    const parts = subject.split('|')

    const raw = (parts[0] || '').trim()
    const route = (parts[1] || '').trim()

    const partialRaw = parts[2]
    let partial = 'none'
    if (partialRaw) {
      partial = partialRaw.trim()
      partial = partial.replace(/\s*<>\s*/g, ' <-> ')
      partial = partial.replace(/\s{2,}/g, ' ')
    }

    const idx = subject.indexOf('circuit=')
    let circuits = ['unknown']
    if (idx >= 0) {
      const craw = subject.slice(idx + 'circuit='.length)
      const split = craw.split('&').map(s => s.trim()).filter(Boolean)
      if (split.length) circuits = split
    }

    const tags = t.tags || []
    const cleared = tags.includes('iris_alert_clear')

    const ageMs = nowMs - createdMs
    const ageHours = ageMs / (60 * 60 * 1000)
    const ageMinutes = ageMs / (60 * 1000)

    let eventGroup = 'Other'
    if (raw === 'NLD Down') eventGroup = 'NLD Down'
    else if (raw === 'NLD Flap') eventGroup = 'NLD Flap'

    circuits.forEach(circuitCode => {
      // CHANGE: ignore DFA NLD / OTHER / blank upfront (route first, else partial)
      const routeKeyForValidity = route || partial || ''
      if (isIgnorableNld(routeKeyForValidity)) return

      events.push({
        ticketId: t.id,
        ticketUrl: `${base}${t.id}`,
        status: t.status,
        eventGroup,
        nldRoute: route,
        partialCircuit: partial,
        circuit: String(circuitCode || 'unknown'),
        created_at: t.created_at,
        createdMs,
        ageHours,
        ageMinutes,
        isCleared: cleared,
        state: cleared ? 'Cleared' : 'Active'
      })
    })
  }

  return events
}

// ---- Cluster detection ----
function findPartialClusters (events, { nowMs = Date.now() } = {}) {
  const windowMs = CLUSTER_WINDOW_HOURS * 60 * 60 * 1000
  const cutoffMs = nowMs - windowMs

  // Only events in the last CLUSTER_WINDOW_HOURS from "now"
  const recent = events.filter(e => e.createdMs >= cutoffMs)

  const byKey = new Map()

  for (const e of recent) {
    const routeKey = getEventRouteKey(e)
    if (!routeKey) continue

    if (!byKey.has(routeKey)) byKey.set(routeKey, [])
    byKey.get(routeKey).push({ ...e, routeKey })
  }

  const clusters = []

  for (const [routeKey, arr] of byKey.entries()) {
    if (arr.length < CLUSTER_MIN_EVENTS) continue

    // Stable ordering (oldest -> newest) for consistent keys
    const sorted = [...arr].sort((a, b) => a.createdMs - b.createdMs)

    // Dedupe key: same routeKey and same most-recent ticket in the window
    // This ensures once we’ve alerted for the current burst, we won’t repeat it.
    const last = sorted[sorted.length - 1]
    const clusterKey = `partial-cluster-last${CLUSTER_WINDOW_HOURS}h:${normalizeRoute(routeKey)}:${last.ticketId}`

    if (!warnedPartialClusters.has(clusterKey)) {
      warnedPartialClusters.add(clusterKey)
      clusters.push({ routeKey, count: sorted.length, events: sorted })
    }
  }

  return clusters
}

function buildPartialClusterMsg (clusters) {
  if (!clusters.length) return null

  const lines = [
    `🟠 Partial NLD cluster: >=${CLUSTER_MIN_EVENTS} events in ${CLUSTER_WINDOW_HOURS}h on same NLD/partial`,
    ''
  ]

  clusters.forEach(cluster => {
    const { routeKey, count, events } = cluster
    const label = count > CLUSTER_MIN_EVENTS ? `🔴 Cluster (${count} events)` : `🟠 Cluster (${count} events)`

    lines.push(`${label}: ${routeKey}`)
    events.forEach(e => {
      lines.push(`• ${e.created_at} | #${e.ticketId} | ${e.eventGroup} | circuit ${e.circuit}`)
      lines.push(`  ${e.ticketUrl}`)
    })
    lines.push('')
  })

  return lines.join('\n')
}

// ---- “Outage not logged yet” ----
function findPartialNotLogged (events, outageIndex) {
  const affected = []

  for (const e of events) {
    if (e.isCleared) continue
    if (e.ageMinutes < PARTIAL_NOT_LOGGED_MINUTES) continue

    // CHANGE: ignore DFA NLD / OTHER / blank
    if (!getEventRouteKey(e)) continue

    // CHANGE: matching supports NLD3/4 variants
    if (hasMatchingOutageForEvent(e, outageIndex)) continue

    const bucket = Math.floor(e.ageMinutes / PARTIAL_NOT_LOGGED_MINUTES)
    if (bucket < 1) continue

    const key = String(e.ticketId)
    const lastBucket = partialNotLoggedBuckets.get(key) || 0

    if (bucket > lastBucket) {
      partialNotLoggedBuckets.set(key, bucket)
      affected.push({ ...e, bucket })
    }
  }

  // also prevent this map growing forever
  if (partialNotLoggedBuckets.size > CACHE_MAX_KEYS) {
    const keys = Array.from(partialNotLoggedBuckets.keys())
    for (let i = 0; i < keys.length - CACHE_MAX_KEYS; i++) {
      partialNotLoggedBuckets.delete(keys[i])
    }
  }

  return affected
}

function buildPartialNotLoggedMsg (events) {
  if (!events.length) return null

  const lines = [
    `🔴 Partial NLD alert active without a logged outage (>= ${PARTIAL_NOT_LOGGED_MINUTES} min)`,
    `Repeats every ${PARTIAL_NOT_LOGGED_MINUTES} min per ticket while still active.`,
    ''
  ]

  events.forEach(e => {
    lines.push(`• #${e.ticketId} | ${e.eventGroup} | ${e.nldRoute || e.partialCircuit || ''}`)
    lines.push(`  Age: ${e.ageHours.toFixed(2)} h | state: ${e.state} | bucket: ${e.bucket}`)
    lines.push(`  Circuit: ${e.circuit}`)
    lines.push(`  ${e.ticketUrl}`)
  })

  return lines.join('\n')
}

// ---- Main entrypoint ----
let watcherStarted = false

export function startNldOutageWatcher (sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[NLD WATCHER] Not starting – Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  console.log(`[NLD WATCHER] Starting – window ${OUTAGE_WINDOW_MINUTES} min, breach baseline ${BREACH_HOURS} h, poll ${Math.round(POLL_INTERVAL_MS / 1000)}s`)
  console.log(`[NLD WATCHER] Breach tiers – ${BREACH_THRESHOLDS_HOURS.join(', ')} hours`)
  console.log(`[NLD WATCHER] Partial – lookback ${PARTIAL_LOOKBACK_HOURS}h, cluster ${CLUSTER_MIN_EVENTS} events / ${CLUSTER_WINDOW_HOURS}h, not-logged >= ${PARTIAL_NOT_LOGGED_MINUTES} min`)
  console.log(`[NLD WATCHER] Cache – TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const tick = async () => {
    try {
      const now = dayjs()

      // 1) Outage Capturing NLD tickets
      const rawOutages = await fetchOutageTickets()

      const recent = []
      const allEnrichedOutages = []

      // CHANGE: breaches now tracked per threshold
      const breachesByThreshold = new Map() // hours -> enriched[]

      for (const h of BREACH_THRESHOLDS_HOURS) breachesByThreshold.set(h, [])

      for (const t of rawOutages) {
        if (!isNldTicket(t)) continue

        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageMinutes = now.diff(created, 'minute', true)
        const ageHours = now.diff(created, 'hour', true)

        const enriched = {
          id: t.id,
          subject: t.subject,
          created_at: t.created_at,
          updated_at: t.updated_at,
          ageMinutes,
          ageHours,
          subscriberImpact: Number(cf(t, 5552674828049)) || 0,
          nld: cf(t, 40137360073617) || '',
          liquidRef: cf(t, 7657816716433) || '',
          liquidCircuit: cf(t, 8008871186961) || ''
        }

        allEnrichedOutages.push(enriched)

        if (ageMinutes >= 0 && ageMinutes <= OUTAGE_WINDOW_MINUTES) {
          const key = `recent-${t.id}`
          if (!warnedRecent.has(key)) {
            warnedRecent.add(key)
            recent.push(enriched)
          }
        }

        // CHANGE: multi tier breach alerts (in addition to 4h)
        if (ageMinutes > OUTAGE_WINDOW_MINUTES) {
          for (const thresholdHours of BREACH_THRESHOLDS_HOURS) {
            if (ageHours >= thresholdHours) {
              const key = `breach-${thresholdHours}-${t.id}`
              if (!warnedBreach.has(key)) {
                warnedBreach.add(key)
                breachesByThreshold.get(thresholdHours).push(enriched)
              }
            }
          }
        }
      }

      const recentMsg = buildRecentMsg(recent)
      if (recentMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD recent-outage alert')
        await sendSlaAlert(recentMsg)
      }

      // CHANGE: send breach messages per threshold (only if any new ones for that tier)
      for (const thresholdHours of BREACH_THRESHOLDS_HOURS) {
        const list = breachesByThreshold.get(thresholdHours) || []
        const msg = buildBreachMsg(list, thresholdHours, OUTAGE_WINDOW_MINUTES)
        if (msg) {
          console.log(`[NLD WATCHER] Sending WhatsApp NLD BREACH ${thresholdHours}h alert`)
          await sendSlaAlert(msg)
        }
      }

      const outageIndex = buildOutageRouteIndex(allEnrichedOutages)

      // 2) Partial NLD alert metrics
      const rawPartial = await fetchPartialNldAlertsRaw()
      const partialEvents = transformPartialNldAlerts(rawPartial)

      const clusters = findPartialClusters(partialEvents, { nowMs: Date.now() })
      const clusterMsg = buildPartialClusterMsg(clusters)
      if (clusterMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD CLUSTER alert')
        await sendSlaAlert(clusterMsg)
      }

      const notLogged = findPartialNotLogged(partialEvents, outageIndex)
      const notLoggedMsg = buildPartialNotLoggedMsg(notLogged)
      if (notLoggedMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD NOT-LOGGED alert')
        await sendSlaAlert(notLoggedMsg)
      }
    } catch (err) {
      console.error('[NLD WATCHER] Tick error:', err?.message || err)
    }
  }

  tick()

  const interval = setInterval(tick, POLL_INTERVAL_MS)
  // let Node exit cleanly on dyno shutdown
  interval.unref?.()
}
