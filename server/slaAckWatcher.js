// slaAckWatcher.js
import dayjs from 'dayjs'

const SLA_MINUTES = Number(process.env.SLA_ACK_MINUTES || 30)
const WARNING_MINUTES = Number(process.env.SLA_WARNING_MINUTES || 20)

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
  console.warn('[SLA WATCHER] Zendesk env vars missing; watcher will not run')
}

// tickets we have already warned on (per dyno lifetime)
const warnedTicketIds = new Set()

function classifyProduct(tags = []) {
  const hasTag = t => tags.includes(t)

  const hasFTTB = hasTag('t2_fttb')
  const hasFTTH =
    hasTag('t2_ftth') ||
    hasTag('ff_air') ||
    hasTag('dstv') ||
    hasTag('rise')

  if (hasFTTB) return 'FTTB'
  if (hasFTTH) return 'FTTH'
  return 'Other'
}

// we only care about P1 now
function isP1(tags = []) {
  return tags.includes('play_p1')
}

async function fetchTier1Tickets() {
  const auth = Buffer.from(
    `${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`,
    'utf8'
  ).toString('base64')

  const url = new URL(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`
  )

  url.searchParams.set(
    'query',
    'group:"NOC Tier1 Support" form:"Frogfoot Initial Form" status<solved'
  )
  url.searchParams.set('filter[type]', 'ticket')
  url.searchParams.set('page[size]', '1000')

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `[SLA WATCHER] Zendesk search/export failed: ${res.status} ${res.statusText} – ${text}`
    )
  }

  const data = await res.json()
  return data.results || []
}

function buildAlertMessage(ftthTickets, fttbTickets) {
  if (!ftthTickets.length && !fttbTickets.length) return null

  const lines = []
  lines.push(
    `⚠️ NOC Tier 1 P1 acknowledgement SLA at risk (age between ${WARNING_MINUTES}–${SLA_MINUTES} minutes)`
  )
  lines.push('')

  const fmtLine = t =>
    `• #${t.id} – ${t.ageMinutes.toFixed(0)} min – ${t.subject ?? ''}`

  if (ftthTickets.length) {
    lines.push(`FTTH P1 tickets (count: ${ftthTickets.length})`)
    ftthTickets.forEach(t => lines.push(fmtLine(t)))
    lines.push('')
  }

  if (fttbTickets.length) {
    lines.push(`FTTB P1 tickets (count: ${fttbTickets.length})`)
    fttbTickets.forEach(t => lines.push(fmtLine(t)))
    lines.push('')
  }

  return lines.join('\n')
}

export function startSlaAckWatcher(sendSlaAlert) {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    console.warn('[SLA WATCHER] Not starting – Zendesk config missing')
    return
  }

  console.log(
    `[SLA WATCHER] Starting Tier1 P1 ack watcher – warning at ${WARNING_MINUTES} min, SLA ${SLA_MINUTES} min`
  )

  const tick = async () => {
    try {
      const now = dayjs()
      const tickets = await fetchTier1Tickets()

      const ftth = []
      const fttb = []

      for (const t of tickets) {
        const tags = t.tags || []
        if (!isP1(tags)) continue // ✅ P1 only

        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageMinutes = now.diff(created, 'minute', true)

        // ✅ only tickets between WARNING and SLA windows
        if (ageMinutes < WARNING_MINUTES || ageMinutes >= SLA_MINUTES) {
          continue
        }

        const warnKey = `ackP1-${t.id}`

        // ✅ if we already warned once for this ticket, skip
        if (warnedTicketIds.has(warnKey)) continue
        warnedTicketIds.add(warnKey)

        const product = classifyProduct(tags)
        const enriched = {
          id: t.id,
          subject: t.title,
          status: t.status,
          ageMinutes,
        }

        if (product === 'FTTH') ftth.push(enriched)
        else if (product === 'FTTB') fttb.push(enriched)
      }

      const msg = buildAlertMessage(ftth, fttb)
      if (msg) {
        console.log('[SLA WATCHER] Sending WhatsApp SLA alert:')
        console.log(msg)
        await sendSlaAlert(msg)
      }
    } catch (err) {
      console.error('[SLA WATCHER] Tick error:', err.message)
    }
  }

  // first run after 1 min, then every minute
  setTimeout(() => {
    tick()
    setInterval(tick, 60 * 1000)
  }, 60 * 1000)
}
