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

function escapeLikePattern(input) {
  return String(input || '').replace(/([\\%_])/g, '\\$1')
}

function normalizeFilter(input) {
  return String(input || '').trim()
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
  const defaultTo = addMonths(thisMonth, -1)
  const defaultFrom = addMonths(defaultTo, -2)
  const fromKey = parseMonthKey(query.from) || defaultFrom
  const toKey = parseMonthKey(query.to) || defaultTo
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
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)

  const [rows, optionRows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `
      WITH link_meta AS (
        SELECT
          sb_link.frogfootlinklabel,
          COALESCE(NULLIF(sb_link.producttype, ''), 'Unknown') AS product_type,
          COALESCE(NULLIF(ns_link.service_type, ''), 'Unknown') AS service_type
        FROM (
          SELECT DISTINCT ON (sb.frogfootlinklabel)
            sb.frogfootlinklabel,
            sb.producttype,
            sb.livedate
          FROM public.solidbase sb
          WHERE sb.frogfootlinklabel IS NOT NULL
          ORDER BY sb.frogfootlinklabel, sb.livedate DESC NULLS LAST
        ) sb_link
        LEFT JOIN (
          SELECT DISTINCT ON (ns.frg)
            ns.frg,
            ns.service_type,
            ns.updated_at,
            ns.created_at
          FROM public."NldService" ns
          WHERE ns.frg IS NOT NULL
          ORDER BY ns.frg, ns.updated_at DESC NULLS LAST, ns.created_at DESC NULLS LAST
        ) ns_link
          ON ns_link.frg = sb_link.frogfootlinklabel
      ),
      link_month AS (
        SELECT
          COALESCE(NULLIF(s.isp, ''), 'Unknown') AS isp,
          s.frogfootlinklabel,
          s.year_month,
          AVG(s."uptime%")::numeric AS uptime_pct,
          SUM(COALESCE(s.total_downtime, interval '0 second')) AS total_downtime
        FROM public.servicelevels s
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = s.frogfootlinklabel
        WHERE s.frogfootlinklabel IS NOT NULL
          AND s.year_month >= $1
          AND s.year_month <= $2
          AND ($3::text = '' OR COALESCE(lm.product_type, 'Unknown') = $3)
          AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)
        GROUP BY 1, 2, 3
      ),
      link_rollup AS (
        SELECT
          lm.isp,
          lm.frogfootlinklabel,
          AVG(lm.uptime_pct)::numeric AS avg_uptime_pct,
          MIN(lm.uptime_pct)::numeric AS worst_uptime_pct,
          SUM(CASE WHEN lm.uptime_pct < 100 THEN 1 ELSE 0 END)::int AS impacted_months,
          SUM(EXTRACT(EPOCH FROM lm.total_downtime)) / 3600.0 AS downtime_hours
        FROM link_month lm
        GROUP BY 1, 2
      )
      SELECT
        lr.isp,
        COUNT(*)::int AS link_count,
        SUM(CASE WHEN lr.impacted_months > 0 THEN 1 ELSE 0 END)::int AS impacted_links,
        ROUND(AVG(lr.avg_uptime_pct), 2) AS avg_uptime_pct,
        ROUND(MIN(lr.worst_uptime_pct), 2) AS worst_uptime_pct,
        ROUND(SUM(lr.downtime_hours)::numeric, 2) AS total_downtime_hours
      FROM link_rollup lr
      GROUP BY lr.isp
      ORDER BY lr.isp
      `,
      fromKey,
      toKey,
      productType,
      serviceType
    ),
    prisma.$queryRawUnsafe(
      `
      WITH link_meta AS (
        SELECT
          sb_link.frogfootlinklabel,
          COALESCE(NULLIF(sb_link.producttype, ''), 'Unknown') AS product_type,
          COALESCE(NULLIF(ns_link.service_type, ''), 'Unknown') AS service_type
        FROM (
          SELECT DISTINCT ON (sb.frogfootlinklabel)
            sb.frogfootlinklabel,
            sb.producttype,
            sb.livedate
          FROM public.solidbase sb
          WHERE sb.frogfootlinklabel IS NOT NULL
          ORDER BY sb.frogfootlinklabel, sb.livedate DESC NULLS LAST
        ) sb_link
        LEFT JOIN (
          SELECT DISTINCT ON (ns.frg)
            ns.frg,
            ns.service_type,
            ns.updated_at,
            ns.created_at
          FROM public."NldService" ns
          WHERE ns.frg IS NOT NULL
          ORDER BY ns.frg, ns.updated_at DESC NULLS LAST, ns.created_at DESC NULLS LAST
        ) ns_link
          ON ns_link.frg = sb_link.frogfootlinklabel
      ),
      links_in_range AS (
        SELECT DISTINCT s.frogfootlinklabel
        FROM public.servicelevels s
        WHERE s.frogfootlinklabel IS NOT NULL
          AND s.year_month >= $1
          AND s.year_month <= $2
      )
      SELECT DISTINCT
        lm.product_type,
        lm.service_type
      FROM links_in_range lr
      LEFT JOIN link_meta lm
        ON lm.frogfootlinklabel = lr.frogfootlinklabel
      ORDER BY lm.product_type, lm.service_type
      `,
      fromKey,
      toKey
    )
  ])

  const isps = rows.map((r) => ({
    isp: String(r.isp || 'Unknown'),
    linkCount: toNum(r.link_count, 0),
    impactedLinks: toNum(r.impacted_links, 0),
    avgUptimePct: toNum(r.avg_uptime_pct, null),
    worstUptimePct: toNum(r.worst_uptime_pct, null),
    totalDowntimeHours: toNum(r.total_downtime_hours, 0)
  }))

  const productTypes = [...new Set(optionRows.map((r) => String(r.product_type || 'Unknown').trim()).filter(Boolean))]
  const serviceTypes = [...new Set(optionRows.map((r) => String(r.service_type || 'Unknown').trim()).filter(Boolean))]

  res.json({
    from: fromKey,
    to: toKey,
    months,
    productTypes,
    serviceTypes,
    selectedProductType: productType,
    selectedServiceType: serviceType,
    isps
  })
})

r.get('/isp/:isp/links', verifyToken, async (req, res) => {
  const ispName = decodeURIComponent(String(req.params.isp || '').trim())
  if (!ispName) return res.status(400).json({ error: 'Missing ISP' })

  const { fromKey, toKey, months } = resolveRange(req.query)
  const rawPage = Number.parseInt(String(req.query.page ?? '0'), 10)
  const rawPageSize = Number.parseInt(String(req.query.pageSize ?? '200'), 10)
  const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
    ? Math.min(rawPageSize, 500)
    : 200
  const offset = page * pageSize
  const frgSearch = String(req.query.frgSearch || '').trim()
  const frgLike = `%${escapeLikePattern(frgSearch)}%`
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)

  const [countRows, rows] = await Promise.all([
    prisma.$queryRawUnsafe(
      `
      WITH link_meta AS (
        SELECT
          sb_link.frogfootlinklabel,
          COALESCE(NULLIF(sb_link.producttype, ''), 'Unknown') AS product_type,
          COALESCE(NULLIF(ns_link.service_type, ''), 'Unknown') AS service_type
        FROM (
          SELECT DISTINCT ON (sb.frogfootlinklabel)
            sb.frogfootlinklabel,
            sb.producttype,
            sb.livedate
          FROM public.solidbase sb
          WHERE sb.frogfootlinklabel IS NOT NULL
          ORDER BY sb.frogfootlinklabel, sb.livedate DESC NULLS LAST
        ) sb_link
        LEFT JOIN (
          SELECT DISTINCT ON (ns.frg)
            ns.frg,
            ns.service_type,
            ns.updated_at,
            ns.created_at
          FROM public."NldService" ns
          WHERE ns.frg IS NOT NULL
          ORDER BY ns.frg, ns.updated_at DESC NULLS LAST, ns.created_at DESC NULLS LAST
        ) ns_link
          ON ns_link.frg = sb_link.frogfootlinklabel
      )
      SELECT COUNT(DISTINCT s.frogfootlinklabel)::int AS total_count
      FROM public.servicelevels s
      LEFT JOIN link_meta lm
        ON lm.frogfootlinklabel = s.frogfootlinklabel
      WHERE s.frogfootlinklabel IS NOT NULL
        AND COALESCE(NULLIF(s.isp, ''), 'Unknown') = $1
        AND s.year_month >= $2
        AND s.year_month <= $3
        AND ($4::text = '' OR s.frogfootlinklabel ILIKE $5 ESCAPE '\\')
        AND ($6::text = '' OR COALESCE(lm.product_type, 'Unknown') = $6)
        AND ($7::text = '' OR COALESCE(lm.service_type, 'Unknown') = $7)
      `,
      ispName,
      fromKey,
      toKey,
      frgSearch,
      frgLike,
      productType,
      serviceType
    ),
    prisma.$queryRawUnsafe(
    `
    WITH link_meta AS (
      SELECT
        sb_link.frogfootlinklabel,
        COALESCE(NULLIF(sb_link.producttype, ''), 'Unknown') AS product_type,
        COALESCE(NULLIF(ns_link.service_type, ''), 'Unknown') AS service_type
      FROM (
        SELECT DISTINCT ON (sb.frogfootlinklabel)
          sb.frogfootlinklabel,
          sb.producttype,
          sb.livedate
        FROM public.solidbase sb
        WHERE sb.frogfootlinklabel IS NOT NULL
        ORDER BY sb.frogfootlinklabel, sb.livedate DESC NULLS LAST
      ) sb_link
      LEFT JOIN (
        SELECT DISTINCT ON (ns.frg)
          ns.frg,
          ns.service_type,
          ns.updated_at,
          ns.created_at
        FROM public."NldService" ns
        WHERE ns.frg IS NOT NULL
        ORDER BY ns.frg, ns.updated_at DESC NULLS LAST, ns.created_at DESC NULLS LAST
      ) ns_link
        ON ns_link.frg = sb_link.frogfootlinklabel
    ),
    link_month AS (
      SELECT
        s.frogfootlinklabel,
        s.year_month,
        AVG(s."uptime%")::numeric AS uptime_pct,
        SUM(COALESCE(s.total_downtime, interval '0 second')) AS total_downtime
      FROM public.servicelevels s
      LEFT JOIN link_meta lm
        ON lm.frogfootlinklabel = s.frogfootlinklabel
      WHERE s.frogfootlinklabel IS NOT NULL
        AND COALESCE(NULLIF(s.isp, ''), 'Unknown') = $1
        AND s.year_month >= $2
        AND s.year_month <= $3
        AND ($4::text = '' OR s.frogfootlinklabel ILIKE $5 ESCAPE '\\')
        AND ($6::text = '' OR COALESCE(lm.product_type, 'Unknown') = $6)
        AND ($7::text = '' OR COALESCE(lm.service_type, 'Unknown') = $7)
      GROUP BY 1, 2
    ),
    link_rollup AS (
      SELECT
        lm.frogfootlinklabel,
        ROUND(AVG(lm.uptime_pct)::numeric, 2) AS avg_uptime_pct,
        ROUND(MIN(lm.uptime_pct)::numeric, 2) AS worst_uptime_pct,
        SUM(CASE WHEN lm.uptime_pct < 100 THEN 1 ELSE 0 END)::int AS impacted_months,
        ROUND((SUM(EXTRACT(EPOCH FROM lm.total_downtime)) / 3600.0)::numeric, 2) AS total_downtime_hours
      FROM link_month lm
      GROUP BY 1
    ),
    paged_links AS (
      SELECT
        lr.frogfootlinklabel,
        lr.avg_uptime_pct,
        lr.worst_uptime_pct,
        lr.impacted_months,
        lr.total_downtime_hours
      FROM link_rollup lr
      ORDER BY lr.frogfootlinklabel
      LIMIT $8
      OFFSET $9
    )
    SELECT
      pl.frogfootlinklabel,
      pl.avg_uptime_pct,
      pl.worst_uptime_pct,
      pl.impacted_months,
      pl.total_downtime_hours,
      lm.year_month,
      ROUND(lm.uptime_pct, 2) AS uptime_pct,
      EXTRACT(EPOCH FROM lm.total_downtime) / 3600.0 AS downtime_hours
    FROM paged_links pl
    LEFT JOIN link_month lm
      ON lm.frogfootlinklabel = pl.frogfootlinklabel
    ORDER BY pl.frogfootlinklabel, lm.year_month
    `,
    ispName,
    fromKey,
    toKey,
    frgSearch,
    frgLike,
    productType,
    serviceType,
    pageSize,
    offset
  )
  ])

  const byLink = new Map()
  const monthSet = new Set(months)
  for (const row of rows) {
    const link = String(row.frogfootlinklabel || '').trim()
    if (!link) continue
    if (!byLink.has(link)) {
      const monthValues = {}
      const monthDowntimeHours = {}
      for (const m of months) {
        monthValues[m] = null
        monthDowntimeHours[m] = 0
      }
      byLink.set(link, {
        frogfootlinklabel: link,
        monthValues,
        monthDowntimeHours,
        avgUptimePct: toNum(row.avg_uptime_pct, null),
        worstUptimePct: toNum(row.worst_uptime_pct, null),
        impactedMonths: toNum(row.impacted_months, 0),
        totalDowntimeHours: toNum(row.total_downtime_hours, 0)
      })
    }
    const ref = byLink.get(link)
    const ym = String(row.year_month || '').trim()
    if (ym && monthSet.has(ym)) {
      ref.monthValues[ym] = toNum(row.uptime_pct, null)
      ref.monthDowntimeHours[ym] = toNum(row.downtime_hours, 0)
    }
  }

  const links = [...byLink.values()].sort((a, b) => a.frogfootlinklabel.localeCompare(b.frogfootlinklabel))
  const totalCount = toNum(countRows?.[0]?.total_count, links.length)

  res.json({
    isp: ispName,
    from: fromKey,
    to: toKey,
    months,
    page,
    pageSize,
    frgSearch,
    productType,
    serviceType,
    totalCount,
    links
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
        o.network_segment
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
