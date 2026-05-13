import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'

const r = Router()

function pad2(n) {
  return String(n).padStart(2, '0')
}

function parseMonthKey(input) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(input || '').trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  if (!Number.isInteger(y) || !Number.isInteger(mo) || mo < 1 || mo > 12) return null
  return `${y}-${pad2(mo)}`
}

function monthKeyFromDate(dt) {
  if (!dt) return null
  const d = new Date(dt)
  if (Number.isNaN(d.valueOf())) return null
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}

function monthStartUtc(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))
}

function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1, 0, 0, 0))
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`
}

function nextMonthStartUtc(monthKey) {
  const [y, m] = monthKey.split('-').map(Number)
  return new Date(Date.UTC(y, m, 1, 0, 0, 0))
}

function buildMonthList(fromKey, toKey) {
  const out = []
  let cur = fromKey
  while (cur <= toKey) {
    out.push(cur)
    cur = addMonths(cur, 1)
  }
  return out
}

function toNum(v, dflt = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : dflt
}

function parseLinkedOutageRef(category) {
  const m = /linked to outage\s+([a-z0-9_-]+)/i.exec(String(category || ''))
  return m ? m[1].toUpperCase() : null
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return false
  return aStart < bEnd && aEnd > bStart
}

function normalizeRange(start, stop) {
  if (!start) return null
  const s = new Date(start)
  const e = new Date(stop || start)
  if (Number.isNaN(s.valueOf()) || Number.isNaN(e.valueOf())) return null
  if (e <= s) return { start: s, end: s }
  return { start: s, end: e }
}

function resolveRange(query) {
  const now = new Date()
  const thisMonth = `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}`
  const defaultFrom = addMonths(thisMonth, -5)
  const fromKey = parseMonthKey(query.from) || defaultFrom
  const toKey = parseMonthKey(query.to) || thisMonth
  const lo = fromKey <= toKey ? fromKey : toKey
  const hi = fromKey <= toKey ? toKey : fromKey
  return {
    fromKey: lo,
    toKey: hi,
    months: buildMonthList(lo, hi),
    fromTs: monthStartUtc(lo),
    toTsExcl: nextMonthStartUtc(hi)
  }
}

r.get('/summary', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)

  const rows = await prisma.$queryRawUnsafe(
    `
    WITH filtered AS (
      SELECT
        COALESCE(NULLIF(s.isp, ''), 'Unknown') AS isp,
        s.frogfootlinklabel,
        s.year_month,
        AVG(s."uptime%")::numeric AS uptime_pct,
        SUM(COALESCE(s.total_downtime, interval '0 second')) AS total_downtime
      FROM public.servicelevels s
      WHERE s.frogfootlinklabel IS NOT NULL
        AND s.year_month >= $1
        AND s.year_month <= $2
      GROUP BY 1, 2, 3
    )
    SELECT
      isp,
      frogfootlinklabel,
      year_month,
      ROUND(uptime_pct, 2) AS uptime_pct,
      EXTRACT(EPOCH FROM total_downtime) / 3600.0 AS downtime_hours
    FROM filtered
    ORDER BY isp, frogfootlinklabel, year_month
    `,
    fromKey,
    toKey
  )

  const isps = new Map()

  for (const row of rows) {
    const ispName = String(row.isp || 'Unknown')
    const link = String(row.frogfootlinklabel || '')
    const ym = String(row.year_month || '')
    const uptime = toNum(row.uptime_pct, null)
    const downtimeHours = toNum(row.downtime_hours, 0)
    if (!link || !ym) continue

    if (!isps.has(ispName)) {
      isps.set(ispName, {
        isp: ispName,
        linksMap: new Map(),
      })
    }
    const isp = isps.get(ispName)

    if (!isp.linksMap.has(link)) {
      const monthValues = {}
      const monthDowntimeHours = {}
      for (const m of months) {
        monthValues[m] = null
        monthDowntimeHours[m] = 0
      }
      isp.linksMap.set(link, {
        frogfootlinklabel: link,
        monthValues,
        monthDowntimeHours,
      })
    }

    const linkRow = isp.linksMap.get(link)
    linkRow.monthValues[ym] = uptime
    linkRow.monthDowntimeHours[ym] = downtimeHours
  }

  const ispList = []
  for (const isp of isps.values()) {
    const links = [...isp.linksMap.values()].sort((a, b) =>
      a.frogfootlinklabel.localeCompare(b.frogfootlinklabel)
    )

    for (const link of links) {
      const vals = Object.values(link.monthValues)
        .map(v => (v == null ? null : toNum(v, null)))
        .filter(v => v != null)

      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
      const worst = vals.length ? Math.min(...vals) : null
      const impactedMonths = vals.filter(v => v < 100).length
      const totalDowntimeHours = Object.values(link.monthDowntimeHours).reduce((a, b) => a + toNum(b), 0)

      link.avgUptimePct = avg == null ? null : Number(avg.toFixed(2))
      link.worstUptimePct = worst == null ? null : Number(worst.toFixed(2))
      link.impactedMonths = impactedMonths
      link.totalDowntimeHours = Number(totalDowntimeHours.toFixed(2))
    }

    const linkCount = links.length
    const avgValues = links.map(l => l.avgUptimePct).filter(v => v != null)
    const ispAvg = avgValues.length ? (avgValues.reduce((a, b) => a + b, 0) / avgValues.length) : null
    const ispWorst = links.length ? Math.min(...links.map(l => l.worstUptimePct ?? 100)) : null
    const impactedLinks = links.filter(l => l.impactedMonths > 0).length
    const totalDowntimeHours = links.reduce((a, l) => a + toNum(l.totalDowntimeHours), 0)

    ispList.push({
      isp: isp.isp,
      linkCount,
      impactedLinks,
      avgUptimePct: ispAvg == null ? null : Number(ispAvg.toFixed(2)),
      worstUptimePct: ispWorst == null ? null : Number(ispWorst.toFixed(2)),
      totalDowntimeHours: Number(totalDowntimeHours.toFixed(2)),
      links
    })
  }

  ispList.sort((a, b) => a.isp.localeCompare(b.isp))

  res.json({
    from: fromKey,
    to: toKey,
    months,
    isps: ispList
  })
})

r.get('/link/:frg/details', verifyToken, async (req, res) => {
  const frg = String(req.params.frg || '').trim()
  if (!frg) return res.status(400).json({ error: 'Missing FRG link label' })

  const { fromKey, toKey, months, fromTs, toTsExcl } = resolveRange(req.query)

  const [slaRows, tickets, outages] = await Promise.all([
    prisma.$queryRawUnsafe(
      `
      SELECT
        year_month,
        ROUND(AVG("uptime%")::numeric, 2) AS uptime_pct,
        EXTRACT(EPOCH FROM SUM(COALESCE(total_downtime, interval '0 second'))) / 3600.0 AS downtime_hours,
        EXTRACT(EPOCH FROM SUM(COALESCE(active_days, interval '0 second'))) / 3600.0 AS active_hours
      FROM public.servicelevels
      WHERE frogfootlinklabel = $1
        AND year_month >= $2
        AND year_month <= $3
      GROUP BY year_month
      ORDER BY year_month
      `,
      frg, fromKey, toKey
    ),
    prisma.$queryRawUnsafe(
      `
      SELECT
        frg,
        ticket_id,
        created_date,
        impact_stop_time,
        year_month,
        "Category" AS category,
        sla_duration,
        sla_exclusion_reason
      FROM public.tickets_output
      WHERE frg = $1
        AND created_date < $2::timestamp
        AND COALESCE(impact_stop_time, created_date) >= $3::timestamp
      ORDER BY created_date ASC NULLS LAST, ticket_id ASC
      `,
      frg, toTsExcl.toISOString().slice(0, 19).replace('T', ' '), fromTs.toISOString().slice(0, 19).replace('T', ' ')
    ),
    prisma.$queryRawUnsafe(
      `
      SELECT DISTINCT ON (os.frogfootlinklabel, os.outageref)
        os.frogfootlinklabel,
        os.outageref AS outage_ref,
        os.changestarted,
        os.resolveddate,
        o.ffticket,
        o.outagetitle,
        o.impact_start,
        o.impact_stop,
        o.year_month,
        o.impact_type,
        o.force_majeure,
        o.cause_class,
        o.cause_class_sub,
        o.region,
        o.node,
        o.summary,
        o.party_at_fault,
        o.infrastructure_owner,
        o.network_segment,
        o.sla_duration
      FROM public.outage_resolvers os
      JOIN public.outages_outage o
        ON o.outage_ref = os.outageref
      WHERE os.frogfootlinklabel = $1
        AND o.impact_start < $2::timestamp
        AND COALESCE(o.impact_stop, o.impact_start) >= $3::timestamp
      ORDER BY os.frogfootlinklabel, os.outageref, o.impact_start DESC NULLS LAST
      `,
      frg, toTsExcl.toISOString().slice(0, 19).replace('T', ' '), fromTs.toISOString().slice(0, 19).replace('T', ' ')
    )
  ])

  const slaByMonth = Object.fromEntries(
    slaRows.map(r => [
      String(r.year_month),
      {
        uptimePct: toNum(r.uptime_pct, null),
        downtimeHours: Number(toNum(r.downtime_hours, 0).toFixed(2)),
        activeHours: Number(toNum(r.active_hours, 0).toFixed(2)),
      }
    ])
  )

  const normalizedOutages = outages.map((o) => {
    const range = normalizeRange(o.impact_start, o.impact_stop)
    return {
      ...o,
      _range: range,
      _month: monthKeyFromDate(o.impact_stop || o.impact_start || o.resolveddate || o.changestarted) || String(o.year_month || '')
    }
  })

  const normalizedTickets = tickets.map((t) => {
    const range = normalizeRange(t.created_date, t.impact_stop_time || t.created_date)
    const linkedOutageRef = parseLinkedOutageRef(t.category)
    const overlapOutageRefs = normalizedOutages
      .filter(o => rangesOverlap(range?.start, range?.end, o._range?.start, o._range?.end))
      .map(o => String(o.outage_ref))
    return {
      ...t,
      _range: range,
      linkedOutageRef,
      overlapOutageRefs,
      _month: monthKeyFromDate(t.impact_stop_time || t.created_date) || String(t.year_month || '')
    }
  })

  const details = {}
  for (const m of months) {
    details[m] = {
      yearMonth: m,
      sla: slaByMonth[m] || { uptimePct: null, downtimeHours: 0, activeHours: 0 },
      tickets: [],
      outages: [],
      overlap: {
        linkedTickets: 0,
        overlapTickets: 0,
        overlapPairs: 0
      }
    }
  }

  for (const o of normalizedOutages) {
    const m = details[o._month] ? o._month : null
    if (!m) continue
    const { _range, _month, ...pub } = o
    details[m].outages.push(pub)
  }

  for (const t of normalizedTickets) {
    const m = details[t._month] ? t._month : null
    if (!m) continue
    const { _range, _month, ...pub } = t
    details[m].tickets.push(pub)
  }

  for (const m of months) {
    const d = details[m]
    d.overlap.linkedTickets = d.tickets.filter(t => !!t.linkedOutageRef).length
    d.overlap.overlapTickets = d.tickets.filter(t => (t.overlapOutageRefs || []).length > 0).length
    d.overlap.overlapPairs = d.tickets.reduce((acc, t) => acc + (t.overlapOutageRefs || []).length, 0)
  }

  res.json({
    frogfootlinklabel: frg,
    from: fromKey,
    to: toKey,
    months,
    details: months.map(m => details[m])
  })
})

export default r

