// nldOutageWatcher.js
import dayjs from 'dayjs'

const OUTAGE_WINDOW_MINUTES = Number(process.env.NLD_WINDOW_MINUTES || 60) // "time frame"
const BREACH_HOURS = Number(process.env.NLD_BREACH_HOURS || 4)             // red-flag threshold
const POLL_INTERVAL_MS = 5 * 60 * 1000                                     // every 5 minutes

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[NLD WATCHER] Zendesk env vars missing; watcher will not run')
}

// Track which tickets we've already warned on (per dyno lifetime)
const warnedRecent = new Set() // recent NLD outages in window
const warnedBreach = new Set() // old 4h+ breaches

// ----- Helpers -----

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
      `[NLD WATCHER] search/export failed: ${res.status} ${res.statusText} – ${text}`
    )
  }

  const data = await res.json()
  return data.results || []
}

// Build the WhatsApp messages

function buildRecentMsg (tickets, windowMinutes) {
  if (!tickets.length) return null

  const lines = []
  lines.push(`🟡 NLD outages active in the last ${windowMinutes} minutes`)
  lines.push('')

  tickets.forEach(t => {
    lines.push(`Ticket #${t.id} – ${t.subject || ''}`)
    lines.push(`Age       : ${t.ageMinutes.toFixed(0)} min`)
    lines.push(`Created   : ${t.created_at}`)
    lines.push(`Updated   : ${t.updated_at}`)
    lines.push(`Impact    : ${t.subscriberImpact}`)
    lines.push(`Status    : ${t.outageStatus}`)
    lines.push(`Who       : ${t.whoWorking}`)
    lines.push(`Type      : ${t.type}`)
    lines.push(`DFA Ref   : ${t.dfaRef}`)
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
    lines.push(`Status    : ${t.outageStatus}`)
    lines.push(`Who       : ${t.whoWorking}`)
    lines.push(`Type      : ${t.type}`)
    lines.push(`DFA Ref   : ${t.dfaRef}`)
    lines.push(`Liquid Ref: ${t.liquidRef}`)
    lines.push(`Liquid Cir: ${t.liquidCircuit}`)
    lines.push(`Link      : https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets/${t.id}`)
    lines.push('')
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

  const tick = async () => {
    try {
      const now = dayjs()
      const raw = await fetchOutageTickets()

      const recent = []
      const breaches = []

      for (const t of raw) {
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
          outageStatus: cf(t, 4419340564625) || '',
          whoWorking: cf(t, 6832283279121) || '',
          type: cf(t, 14118200804369) || '',
          dfaRef: cf(t, 7657855944209) || '',
          liquidRef: cf(t, 7657816716433) || '',
          liquidCircuit: cf(t, 8008871186961) || ''
        }

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

      const recentMsg = buildRecentMsg(recent, OUTAGE_WINDOW_MINUTES)
      if (recentMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD recent-outage alert:')
        console.log(recentMsg)
        await sendSlaAlert(recentMsg)
      }

      const breachMsg = buildBreachMsg(breaches, BREACH_HOURS, OUTAGE_WINDOW_MINUTES)
      if (breachMsg) {
        console.log('[NLD WATCHER] Sending WhatsApp NLD BREACH alert:')
        console.log(breachMsg)
        await sendSlaAlert(breachMsg)
      }
    } catch (err) {
      console.error('[NLD WATCHER] Tick error:', err.message)
    }
  }

  // Run immediately once, then every 5 minutes
  tick()
  setInterval(tick, POLL_INTERVAL_MS)
}
