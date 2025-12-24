// server/nldOutageWatcher.js
import dayjs from 'dayjs'

// ---- Config ----
const OUTAGE_WINDOW_MINUTES = Number(process.env.NLD_WINDOW_MINUTES || 60)
const BREACH_HOURS = Number(process.env.NLD_BREACH_HOURS || 4)
const POLL_INTERVAL_MS = Number(process.env.NLD_POLL_MS || 5 * 60 * 1000)

// partial NLD metrics
const PARTIAL_LOOKBACK_HOURS = Number(process.env.NLD_PARTIAL_LOOKBACK_HOURS || 24)
const CLUSTER_WINDOW_HOURS = Number(process.env.NLD_CLUSTER_WINDOW_HOURS || 6)
const CLUSTER_MIN_EVENTS = Number(process.env.NLD_CLUSTER_MIN_EVENTS || 3)
const PARTIAL_NOT_LOGGED_MINUTES = Number(process.env.NLD_NOT_LOGGED_MINUTES || 30)

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

// Normalise route / NLD strings for fuzzy matching
function normalizeRoute (str) {
  if (!str) return ''
  return str
    .toLowerCase()
    .replace(/\s*<[-–]?>\s*/g, ' <> ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildOutageRouteIndex (enrichedOutages) {
  return enrichedOutages.map(o => ({
    ticketId: o.id,
    nldNorm: normalizeRoute(o.nld || ''),
    subjectNorm: normalizeRoute(o.subject || '')
  }))
}

function hasMatchingOutageForEvent (event, outageIndex) {
  const eventNorm = normalizeRoute(event.nldRoute || event.partialCircuit || '')
  if (!eventNorm) return false

  for (const o of outageIndex) {
    const { nldNorm, subjectNorm } = o
    if (nldNorm && (nldNorm.includes(eventNorm) || eventNorm.includes(nldNorm))) return true
    if (subjectNorm && (subjectNorm.includes(eventNorm) || eventNorm.includes(subjectNorm))) return true
  }

  return false
}

// ---- WhatsApp message builders ----
function buildRecentMsg (tickets) {
  if (!tickets.length) return null
  const lines = ['🟡 NEW NLD OUTAGE', '']

  tickets.forEach(t => {
    lines.push(`Ticket #${t.id} – ${t.subject || ''}`)
    lines.push(`Age       : ${t.ageMinutes.toFixed(0)} min`)
    lines.push(`Created   : ${t.created_at}`)
    lines.push(`Updated   : ${t.updated_at}`)
    lines.push(`Impact    : ${t.subscriberImpact}`)
    lines.push(`NLD       : ${t.nld || ''}`)
    lines.push(`Liquid Ref: ${t.liquidRef}`)
    lines.push(`Liquid Cir: ${t.liquidCircuit}`)
    lines.push(`Link      : https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`)
    lines.push('')
  })

  return lines.join('\n')
}

function buildBreachMsg (tickets, breachHours, windowMinutes) {
  if (!tickets.length) return null
  const lines = [`🔴 NLD outage duration exceeded ${breachHours} hours (outside last ${windowMinutes} minutes)`, '']

  tickets.forEach(t => {
    lines.push(`Ticket #${t.id} – ${t.subject || ''}`)
    lines.push(`Age       : ${t.ageHours.toFixed(1)} h`)
    lines.push(`Created   : ${t.created_at}`)
    lines.push(`Updated   : ${t.updated_at}`)
    lines.push(`Impact    : ${t.subscriberImpact}`)
    lines.push(`NLD       : ${t.nld || ''}`)
    lines.push(`Liquid Ref: ${t.liquidRef}`)
    lines.push(`Liquid Cir: ${t.liquidCircuit}`)
    lines.push(`Link      : https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`)
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
    const cleared = tags.includes('partial_nld_alert_clear')

    const ageMs = nowMs - createdMs
    const ageHours = ageMs / (60 * 60 * 1000)
    const ageMinutes = ageMs / (60 * 1000)

    let eventGroup = 'Other'
    if (raw === 'NLD Down') eventGroup = 'NLD Down'
    else if (raw === 'NLD Flap') eventGroup = 'NLD Flap'

    circuits.forEach(circuitCode => {
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
function findPartialClusters (events) {
  const byKey = new Map()
  const windowMs = CLUSTER_WINDOW_HOURS * 60 * 60 * 1000

  events.forEach(e => {
    const routeKey = e.nldRoute || e.partialCircuit || 'UNKNOWN'
    if (!routeKey || routeKey === 'UNKNOWN') return
    if (!byKey.has(routeKey)) byKey.set(routeKey, [])
    byKey.get(routeKey).push({ ...e, routeKey })
  })

  const clusters = []

  for (const [routeKey, arr] of byKey.entries()) {
    if (arr.length < CLUSTER_MIN_EVENTS) continue

    const sorted = [...arr].sort((a, b) => a.createdMs - b.createdMs)

    for (let i = 0; i < sorted.length; i++) {
      const startMs = sorted[i].createdMs
      let j = i
      while (j < sorted.length && sorted[j].createdMs - startMs <= windowMs) j++

      const count = j - i
      if (count >= CLUSTER_MIN_EVENTS) {
        const windowEvents = sorted.slice(i, j)
        const clusterKey =
          `partial-cluster:${routeKey}:${windowEvents[0].ticketId}:${windowEvents[windowEvents.length - 1].ticketId}`

        if (!warnedPartialClusters.has(clusterKey)) {
          warnedPartialClusters.add(clusterKey)
          clusters.push({ routeKey, count, events: windowEvents })
        }
      }
    }
  }

  return clusters
}

function buildPartialClusterMsg (clusters) {
  if (!clusters.length) return null

  const lines = [
    `🟠 Partial NLD flap / outage clusters (>=${CLUSTER_MIN_EVENTS} events in ${CLUSTER_WINDOW_HOURS}h on same partial circuit)`,
    ''
  ]

  clusters.forEach(cluster => {
    const { routeKey, count, events } = cluster
    const label = count > CLUSTER_MIN_EVENTS
      ? `🔴 MAJOR MAJOR RED FLAG – ${count} events`
      : `🟠 Cluster – ${count} events`

    lines.push(`${label} on partial circuit: ${routeKey}`)
    events.forEach(e => {
      lines.push(`• ${e.created_at} – #${e.ticketId} – ${e.eventGroup} – circuit ${e.circuit}`)
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
    `🔴 Partial NLD alerts active with NO logged outage (age >= ${PARTIAL_NOT_LOGGED_MINUTES} min)`,
    `Repeated every ${PARTIAL_NOT_LOGGED_MINUTES} min per event while it remains active and without an outage.`,
    ''
  ]

  events.forEach(e => {
    lines.push(`• #${e.ticketId} – ${e.eventGroup} – ${e.nldRoute || e.partialCircuit || ''}`)
    lines.push(`  Age: ${e.ageHours.toFixed(2)} h (bucket ${e.bucket}) – state: ${e.state}`)
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

  console.log(`[NLD WATCHER] Starting – window ${OUTAGE_WINDOW_MINUTES} min, breach ${BREACH_HOURS} h, poll ${Math.round(POLL_INTERVAL_MS / 1000)}s`)
  console.log(`[NLD WATCHER] Partial – lookback ${PARTIAL_LOOKBACK_HOURS}h, cluster ${CLUSTER_MIN_EVENTS} events / ${CLUSTER_WINDOW_HOURS}h, not-logged >= ${PARTIAL_NOT_LOGGED_MINUTES} min`)
  console.log(`[NLD WATCHER] Cache – TTL ${CACHE_TTL_HOURS}h, maxKeys ${CACHE_MAX_KEYS}`)

  const tick = async () => {
    try {
      const now = dayjs()

      // 1) Outage Capturing NLD tickets
      const rawOutages = await fetchOutageTickets()

      const recent = []
      const breaches = []
      const allEnrichedOutages = []

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

        if (ageHours >= BREACH_HOURS && ageMinutes > OUTAGE_WINDOW_MINUTES) {
          const key = `breach-${t.id}`
          if (!warnedBreach.has(key)) {
            warnedBreach.add(key)
            breaches.push(enriched)
          }
        }
      }

      const recentMsg = buildRecentMsg(recent)
      if (recentMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD recent-outage alert')
        await sendSlaAlert(recentMsg)
      }

      const breachMsg = buildBreachMsg(breaches, BREACH_HOURS, OUTAGE_WINDOW_MINUTES)
      if (breachMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD BREACH alert')
        await sendSlaAlert(breachMsg)
      }

      const outageIndex = buildOutageRouteIndex(allEnrichedOutages)

      // 2) Partial NLD alert metrics
      const rawPartial = await fetchPartialNldAlertsRaw()
      const partialEvents = transformPartialNldAlerts(rawPartial)

      const clusters = findPartialClusters(partialEvents)
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
