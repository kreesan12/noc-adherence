// nldOutageWatcher.js
import dayjs from 'dayjs'

const OUTAGE_WINDOW_MINUTES = Number(process.env.NLD_WINDOW_MINUTES || 60) // "time frame" for new outage alert
const BREACH_HOURS = Number(process.env.NLD_BREACH_HOURS || 4)             // red-flag threshold
const POLL_INTERVAL_MS = 5 * 60 * 1000                                     // every 5 minutes

// partial NLD metrics
const PARTIAL_LOOKBACK_HOURS = Number(process.env.NLD_PARTIAL_LOOKBACK_HOURS || 24)
const CLUSTER_WINDOW_HOURS = Number(process.env.NLD_CLUSTER_WINDOW_HOURS || 6)
const CLUSTER_MIN_EVENTS = Number(process.env.NLD_CLUSTER_MIN_EVENTS || 3)
const PARTIAL_NOT_LOGGED_MINUTES = Number(process.env.NLD_NOT_LOGGED_MINUTES || 30)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[NLD WATCHER] Zendesk env vars missing; watcher will not run')
}

// Track which tickets we've already warned on (per dyno lifetime)
const warnedRecent = new Set()            // recent NLD outages in window (Outage Capturing)
const warnedBreach = new Set()            // old 4h+ breaches (Outage Capturing)
const warnedPartialClusters = new Set()   // partial NLD flap clusters

// For partial “not logged yet” we want repeated alerts every 30 min.
// Map: key = ticketId (string), value = last bucket notified (integer: 1 for 30m, 2 for 60m, etc)
const partialNotLoggedBuckets = new Map()

// ----- Helpers (Outage Capturing) -----

function isNldTicket (t) {
  return (t.subject || '').toUpperCase().includes('NLD')
}

function cf (t, id) {
  const field = (t.custom_fields || []).find(f => String(f.id) === String(id))
  const val = field?.value
  if (Array.isArray(val)) return val[0]
  return val ?? ''
}

async function fetchOutageTickets () {
  const auth = Buffer.from(
    `${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`,
    'utf8'
  ).toString('base64')

  const url = new URL(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`
  )

  // group:5160847905297 form:"Outage Capturing" status<solved
  url.searchParams.set(
    'query',
    'group:5160847905297 form:"Outage Capturing" status<solved'
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `[NLD WATCHER] search/export (Outage Capturing) failed: ${res.status} ${res.statusText} – ${text}`
    )
  }

  const data = await res.json()
  return data.results || []
}

// Normalise route / NLD strings for fuzzy matching
function normalizeRoute (str) {
  if (!str) return ''
  return str
    .toLowerCase()
    // normalise "<>", "<->", " < > " etc to " <> "
    .replace(/\s*<[-–]?>\s*/g, ' <> ')
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
}

// Build an index of unsolved outages for route matching
function buildOutageRouteIndex (enrichedOutages) {
  return enrichedOutages.map(o => ({
    ticketId: o.id,
    nldNorm: normalizeRoute(o.nld || ''),
    subjectNorm: normalizeRoute(o.subject || '')
  }))
}

// Does this partial NLD event have a matching unsolved outage?
function hasMatchingOutageForEvent (event, outageIndex) {
  const eventNorm = normalizeRoute(event.nldRoute || event.partialCircuit || '')
  if (!eventNorm) return false

  for (const o of outageIndex) {
    const { nldNorm, subjectNorm } = o
    if (nldNorm && (nldNorm.includes(eventNorm) || eventNorm.includes(nldNorm))) {
      return true
    }
    if (subjectNorm && (subjectNorm.includes(eventNorm) || eventNorm.includes(subjectNorm))) {
      return true
    }
  }

  return false
}

// Build the WhatsApp messages (Outage Capturing)

function buildRecentMsg (tickets) {
  if (!tickets.length) return null

  const lines = []
  lines.push('🟡 NEW NLD OUTAGE')
  lines.push('')

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
    lines.push('') // blank line between tickets
  })

  return lines.join('\n')
}

function buildBreachMsg (tickets, breachHours, windowMinutes) {
  if (!tickets.length) return null

  const lines = []
  lines.push(`🔴 NLD outage duration exceeded ${breachHours} hours (outside last ${windowMinutes} minutes)`)
  lines.push('')

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

// ----- Partial NLD Alerts (second API / JSONata port) -----

async function fetchPartialNldAlertsRaw () {
  const auth = Buffer.from(
    `${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`,
    'utf8'
  ).toString('base64')

  const url = new URL(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`
  )

  // type:ticket tags:partial_nld_alert requester:"IRIS API" -tags:"partial_nld_alert_duplicate_solved"
  url.searchParams.set(
    'query',
    'type:ticket tags:partial_nld_alert requester:"IRIS API" -tags:"partial_nld_alert_duplicate_solved"'
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `[NLD WATCHER] search/export (partial NLD) failed: ${res.status} ${res.statusText} – ${text}`
    )
  }

  const data = await res.json()
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

    const raw = (parts[0] || '').trim()        // "NLD Down" / "NLD Flap" / Other
    const route = (parts[1] || '').trim()      // "Pietermaritzburg <> Heidelberg"

    const partialRaw = parts[2]
    let partial = 'none'
    if (partialRaw) {
      partial = partialRaw.trim()
      // normalise "<>" and double spaces
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
        nldRoute: route,          // "Pietermaritzburg <> Heidelberg"
        partialCircuit: partial,  // third pipe segment if present
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

// ---- cluster detection on partial NLD events ----

function findPartialClusters (events) {
  const byKey = new Map()

  // Group by routeKey – primarily nldRoute, fallback to partialCircuit
  events.forEach(e => {
    const routeKey = e.nldRoute || e.partialCircuit || 'UNKNOWN'
    if (!routeKey || routeKey === 'UNKNOWN') return

    if (!byKey.has(routeKey)) byKey.set(routeKey, [])
    byKey.get(routeKey).push({ ...e, routeKey })
  })

  const clusters = []
  const windowMs = CLUSTER_WINDOW_HOURS * 60 * 60 * 1000

  for (const [routeKey, arr] of byKey.entries()) {
    if (arr.length < CLUSTER_MIN_EVENTS) continue

    const sorted = [...arr].sort((a, b) => a.createdMs - b.createdMs)

    let i = 0
    while (i < sorted.length) {
      const startMs = sorted[i].createdMs
      let j = i

      while (j < sorted.length && sorted[j].createdMs - startMs <= windowMs) {
        j++
      }

      const count = j - i
      if (count >= CLUSTER_MIN_EVENTS) {
        const windowEvents = sorted.slice(i, j)
        const clusterKey =
          `partial-cluster:${routeKey}:${windowEvents[0].ticketId}:${windowEvents[windowEvents.length - 1].ticketId}`

        if (!warnedPartialClusters.has(clusterKey)) {
          warnedPartialClusters.add(clusterKey)
          clusters.push({
            routeKey,
            count,
            events: windowEvents
          })
        }
      }

      i++
    }
  }

  return clusters
}

function buildPartialClusterMsg (clusters) {
  if (!clusters.length) return null

  const lines = []
  lines.push(
    `🟠 Partial NLD flap / outage clusters (>=${CLUSTER_MIN_EVENTS} events in ${CLUSTER_WINDOW_HOURS}h on same partial circuit)`
  )
  lines.push('')

  clusters.forEach(cluster => {
    const { routeKey, count, events } = cluster
    const isMajor = count > CLUSTER_MIN_EVENTS

    const label = isMajor
      ? `🔴 MAJOR MAJOR RED FLAG – ${count} events`
      : `🟠 Cluster – ${count} events`

    lines.push(`${label} on partial circuit: ${routeKey}`)
    events.forEach(e => {
      lines.push(
        `• ${e.created_at} – #${e.ticketId} – ${e.eventGroup} – circuit ${e.circuit}`
      )
      lines.push(`  ${e.ticketUrl}`)
    })
    lines.push('')
  })

  return lines.join('\n')
}

// ---- "outage not logged yet" on partial NLD alerts ----

function findPartialNotLogged (events, outageIndex) {
  const affected = []

  for (const e of events) {
    if (e.isCleared) continue
    if (e.ageMinutes < PARTIAL_NOT_LOGGED_MINUTES) continue

    // If there IS a matching unsolved outage, this is fine: skip
    if (hasMatchingOutageForEvent(e, outageIndex)) continue

    const bucket = Math.floor(e.ageMinutes / PARTIAL_NOT_LOGGED_MINUTES)
    if (bucket < 1) continue // safety, though age >= threshold above

    const key = String(e.ticketId)
    const lastBucket = partialNotLoggedBuckets.get(key) || 0

    // Only alert when we cross a new 30-min bucket: 1 (30m), 2 (60m), 3 (90m), etc
    if (bucket > lastBucket) {
      partialNotLoggedBuckets.set(key, bucket)
      affected.push({ ...e, bucket })
    }
  }

  return affected
}

function buildPartialNotLoggedMsg (events) {
  if (!events.length) return null

  const lines = []
  lines.push(
    `🔴 Partial NLD alerts active with NO logged outage (age >= ${PARTIAL_NOT_LOGGED_MINUTES} min)`
  )
  lines.push(
    `Repeated every ${PARTIAL_NOT_LOGGED_MINUTES} min per event while it remains active and without an outage.`
  )
  lines.push('')

  events.forEach(e => {
    lines.push(
      `• #${e.ticketId} – ${e.eventGroup} – ${e.nldRoute || e.partialCircuit || ''}`
    )
    lines.push(
      `  Age: ${e.ageHours.toFixed(2)} h (bucket ${e.bucket}) – state: ${e.state}`
    )
    lines.push(`  Circuit: ${e.circuit}`)
    lines.push(`  ${e.ticketUrl}`)
  })

  return lines.join('\n')
}

// ----- Main public entrypoint -----

let watcherStarted = false

export function startNldOutageWatcher (sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[NLD WATCHER] Not starting – Zendesk config missing')
    return
  }
  if (watcherStarted) return
  watcherStarted = true

  console.log(
    `[NLD WATCHER] Starting NLD outage watcher – window ${OUTAGE_WINDOW_MINUTES} min, breach ${BREACH_HOURS} h, poll every 5 min`
  )
  console.log(
    `[NLD WATCHER] Partial NLD: lookback ${PARTIAL_LOOKBACK_HOURS}h, cluster ${CLUSTER_MIN_EVENTS} events / ${CLUSTER_WINDOW_HOURS}h, not-logged >= ${PARTIAL_NOT_LOGGED_MINUTES} min (repeats every ${PARTIAL_NOT_LOGGED_MINUTES} min)`
  )

  const tick = async () => {
    try {
      const now = dayjs()

      // --------- 1) Outage Capturing NLD tickets ---------
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

        // Recent NLD outages within the configured window
        if (ageMinutes >= 0 && ageMinutes <= OUTAGE_WINDOW_MINUTES) {
          const key = `recent-${t.id}`
          if (!warnedRecent.has(key)) {
            warnedRecent.add(key)
            recent.push(enriched)
          }
        }

        // Breach: still unsolved, older than breachHours, and outside recent window
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
        console.log('[NLD WATCHER] Sending WhatsApp NLD recent-outage alert:')
        console.log(recentMsg)
        await sendSlaAlert(recentMsg)
      }

      const breachMsg = buildBreachMsg(
        breaches,
        BREACH_HOURS,
        OUTAGE_WINDOW_MINUTES
      )
      if (breachMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD BREACH alert:')
        console.log(breachMsg)
        await sendSlaAlert(breachMsg)
      }

      // Build outage route index for correlation with partial events
      const outageIndex = buildOutageRouteIndex(allEnrichedOutages)

      // --------- 2) Partial NLD alert metrics ---------
      const rawPartial = await fetchPartialNldAlertsRaw()
      const partialEvents = transformPartialNldAlerts(rawPartial)

      // 2a) clusters on same partial circuit (nldRoute) within 6h
      const clusters = findPartialClusters(partialEvents)
      const clusterMsg = buildPartialClusterMsg(clusters)
      if (clusterMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD CLUSTER alert:')
        console.log(clusterMsg)
        await sendSlaAlert(clusterMsg)
      }

      // 2b) “outage not logged yet” – active partial alerts >= 30 min with NO matching outage
      const notLogged = findPartialNotLogged(partialEvents, outageIndex)
      const notLoggedMsg = buildPartialNotLoggedMsg(notLogged)
      if (notLoggedMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp PARTIAL NLD NOT-LOGGED alert:')
        console.log(notLoggedMsg)
        await sendSlaAlert(notLoggedMsg)
      }
    } catch (err) {
      console.error('[NLD WATCHER] Tick error:', err.message)
    }
  }

  // Run immediately once, then every 5 minutes
  tick()
  setInterval(tick, POLL_INTERVAL_MS)
}
