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

// Tier 1: P1 only
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
      'Content-Type': 'application/json'
    }
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(
      `[SLA WATCHER] Tier1 search/export failed: ${res.status} ${res.statusText} – ${text}`
    )
  }

  const data = await res.json()
  return data.results || []
}

// Tier 2: request_type_noc_tier_2, all priorities
async function fetchTier2Tickets() {
  const auth = Buffer.from(
    `${ZENDESK_EMAIL}/token:${ZENDESK_API_TOKEN}`,
    'utf8'
  ).toString('base64')

  const url = new URL(
    `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`
  )

  url.searchParams.set(
    'query',
    'tags:request_type_noc_tier_2 form:"Frogfoot Initial Form" status:new'
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
      `[SLA WATCHER] Tier2 search/export failed: ${res.status} ${res.statusText} – ${text}`
    )
  }

  const data = await res.json()
  return data.results || []
}

// WhatsApp message builder (Tier1 + Tier2, with links)
function buildAlertMessage({ ftthTickets, fttbTickets, tier2Tickets }) {
  if (!ftthTickets.length && !fttbTickets.length && !tier2Tickets.length) {
    return null
  }

  const baseUrl = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/agent/tickets`
  const lines = []

  lines.push(
    `⚠️ NOC acknowledgement SLA at risk (age between ${WARNING_MINUTES}–${SLA_MINUTES} minutes)`
  )
  lines.push('')

  const fmtLine = t => {
    const url = `${baseUrl}/${t.id}`
    return `• #${t.id} – ${t.ageMinutes.toFixed(0)} min – ${t.subject ?? ''}\n  ${url}`
  }

  // Tier 1 P1 (FTTH / FTTB)
  if (ftthTickets.length || fttbTickets.length) {
    lines.push('Tier 1 – P1 tickets:')
    lines.push('')

    if (ftthTickets.length) {
      lines.push(`FTTH P1 (count: ${ftthTickets.length})`)
      ftthTickets.forEach(t => lines.push(fmtLine(t)))
      lines.push('')
    }

    if (fttbTickets.length) {
      lines.push(`FTTB P1 (count: ${fttbTickets.length})`)
      fttbTickets.forEach(t => lines.push(fmtLine(t)))
      lines.push('')
    }
  }

  // Tier 2
  if (tier2Tickets.length) {
    lines.push('Tier 2 tickets (request_type_noc_tier_2):')
    lines.push(`Count: ${tier2Tickets.length}`)
    tier2Tickets.forEach(t => lines.push(fmtLine(t)))
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
    `[SLA WATCHER] Starting ack watcher – warning at ${WARNING_MINUTES} min, SLA ${SLA_MINUTES} min`
  )

  const tick = async () => {
    try {
      const now = dayjs()

      // ---------- Tier 1: P1 only ----------
      const tier1Raw = await fetchTier1Tickets()
      const ftth = []
      const fttb = []

      for (const t of tier1Raw) {
        const tags = t.tags || []
        if (!isP1(tags)) continue

        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageMinutes = now.diff(created, 'minute', true)
        if (ageMinutes < WARNING_MINUTES || ageMinutes >= SLA_MINUTES) continue

        const warnKey = `ackP1-${t.id}`
        if (warnedTicketIds.has(warnKey)) continue
        warnedTicketIds.add(warnKey)

        const product = classifyProduct(tags)
        const enriched = {
          id: t.id,
          subject: t.title,
          status: t.status,
          ageMinutes
        }

        if (product === 'FTTH') ftth.push(enriched)
        else if (product === 'FTTB') fttb.push(enriched)
      }

      // ---------- Tier 2: request_type_noc_tier_2 ----------
      const tier2Raw = await fetchTier2Tickets()
      const tier2 = []

      for (const t of tier2Raw) {
        const created = dayjs(t.created_at)
        if (!created.isValid()) continue

        const ageMinutes = now.diff(created, 'minute', true)
        if (ageMinutes < WARNING_MINUTES || ageMinutes >= SLA_MINUTES) continue

        const warnKey = `ackT2-${t.id}`
        if (warnedTicketIds.has(warnKey)) continue
        warnedTicketIds.add(warnKey)

        tier2.push({
          id: t.id,
          subject: t.title,
          status: t.status,
          ageMinutes
        })
      }

      const msg = buildAlertMessage({
        ftthTickets: ftth,
        fttbTickets: fttb,
        tier2Tickets: tier2
      })

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
