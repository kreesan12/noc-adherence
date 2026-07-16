import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'

const r = Router()
const DOWNTIME_CATEGORY = 'Service impacting'
const SLA_TARGET = 99.5
const RESPONSE_CACHE_TTL_MS = 60 * 1000
const responseCache = new Map()
const PRODUCT_GROUP_ORDER_SQL = `
  CASE label
    WHEN 'FTTB' THEN 1
    WHEN 'FTTH' THEN 2
    WHEN 'FTTC' THEN 3
    ELSE 4
  END
`
const LINK_META_CTE = `
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
`

function buildProductGroupExpr(expr) {
  return `
    CASE
      WHEN LOWER(COALESCE(${expr}, '')) LIKE '%home%' OR LOWER(COALESCE(${expr}, '')) LIKE '%air%' THEN 'FTTH'
      WHEN LOWER(COALESCE(${expr}, '')) LIKE '%rise%' THEN 'FTTC'
      ELSE 'FTTB'
    END
  `
}

function buildOutageClientCountExpr(alias = 'o') {
  return `
    COALESCE(
      NULLIF(REGEXP_REPLACE(COALESCE(${alias}.sub_count::text, ''), '[^0-9.-]', '', 'g'), ''),
      '0'
    )::numeric
  `
}

function getCacheKey(scope, params) {
  return `${scope}:${JSON.stringify(params)}`
}

function getCachedResponse(scope, params) {
  const key = getCacheKey(scope, params)
  const cached = responseCache.get(key)
  if (!cached) return null
  if (cached.expiresAt <= Date.now()) {
    responseCache.delete(key)
    return null
  }
  return cached.payload
}

function setCachedResponse(scope, params, payload) {
  responseCache.set(getCacheKey(scope, params), {
    expiresAt: Date.now() + RESPONSE_CACHE_TTL_MS,
    payload
  })
  return payload
}

async function withCachedResponse(scope, params, load) {
  const cached = getCachedResponse(scope, params)
  if (cached) return cached
  const payload = await load()
  return setCachedResponse(scope, params, payload)
}

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

function toTimestampParam(dt) {
  return new Date(dt).toISOString().slice(0, 19).replace('T', ' ')
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

async function runSequentially(tasks) {
  const results = []
  for (const task of tasks) {
    results.push(await task())
  }
  return results
}

r.get('/overview', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const needsServiceMeta = Boolean(serviceType)
  const sql = `
    ${needsServiceMeta ? `${LINK_META_CTE},` : 'WITH'}
    isp_base AS (
      SELECT
        i.frogfootlinklabel,
        COALESCE(NULLIF(i.isp, ''), 'Unknown') AS isp,
        i.year_month,
        i."uptime%"::numeric AS uptime_pct,
        COALESCE(i.total_downtime, interval '0 second') AS total_downtime,
        COALESCE(i.unique_links_affected, 0)::int AS unique_links_affected
      FROM public.isp_table i
      ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
      WHERE i.frogfootlinklabel IS NOT NULL
        AND i.year_month >= $1
        AND i.year_month <= $2
        AND ($3::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $3)
        ${needsServiceMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
    ),
    link_rollup AS (
      SELECT
        isp,
        frogfootlinklabel,
        AVG(uptime_pct)::numeric AS avg_uptime_pct,
        MIN(uptime_pct)::numeric AS worst_uptime_pct,
        SUM(CASE WHEN unique_links_affected > 0 THEN 1 ELSE 0 END)::int AS impacted_months,
        SUM(EXTRACT(EPOCH FROM total_downtime)) / 3600.0 AS downtime_hours
      FROM isp_base
      GROUP BY 1, 2
    )
    SELECT
      COALESCE((SELECT COUNT(*)::int FROM link_rollup), 0) AS total_links,
      COALESCE((SELECT COUNT(*)::int FROM link_rollup WHERE impacted_months > 0), 0) AS impacted_links,
      COALESCE((SELECT COUNT(*)::int FROM link_rollup WHERE avg_uptime_pct < ${SLA_TARGET}), 0) AS breach_links,
      COALESCE((SELECT ROUND(AVG(avg_uptime_pct), 2) FROM link_rollup), 0) AS avg_uptime_pct,
      COALESCE((SELECT ROUND(MIN(worst_uptime_pct), 2) FROM link_rollup), 0) AS worst_uptime_pct,
      COALESCE((SELECT ROUND(SUM(downtime_hours)::numeric, 2) FROM link_rollup), 0) AS total_downtime_hours
  `
  const sqlArgs = needsServiceMeta
    ? [fromKey, toKey, productType, serviceType]
    : [fromKey, toKey, productType]

  const payload = await withCachedResponse('sla-overview-base', {
    fromKey,
    toKey,
    productType,
    serviceType
  }, async () => {
    const cardRows = await prisma.$queryRawUnsafe(sql, ...sqlArgs)
    const cards = cardRows?.[0] || {}
    return {
      from: fromKey,
      to: toKey,
      months,
      productTypes: [],
      serviceTypes: [],
      selectedProductType: productType,
      selectedServiceType: serviceType,
      cards: {
        totalLinks: toNum(cards.total_links, 0),
        impactedLinks: toNum(cards.impacted_links, 0),
        breachLinks: toNum(cards.breach_links, 0),
        avgUptimePct: toNum(cards.avg_uptime_pct, 0),
        worstUptimePct: toNum(cards.worst_uptime_pct, 0),
        totalDowntimeHours: toNum(cards.total_downtime_hours, 0),
        ticketCount: null,
        serviceImpactingTickets: null,
        outageCount: null
      },
      monthTrend: [],
      worstIsps: [],
      productPerformance: [],
      servicePerformance: []
    }
  })

  res.json(payload)
})

r.get('/overview/options', verifyToken, async (req, res) => {
  const { fromKey, toKey } = resolveRange(req.query)

  const payload = await withCachedResponse('sla-overview-options', {
    fromKey,
    toKey
  }, async () => {
    const rows = await prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      links_in_range AS (
        SELECT DISTINCT
          i.frogfootlinklabel,
          COALESCE(NULLIF(i.producttype, ''), 'Unknown') AS product_type
        FROM public.isp_table i
        WHERE i.frogfootlinklabel IS NOT NULL
          AND i.year_month >= $1
          AND i.year_month <= $2
      )
      SELECT DISTINCT
        lr.product_type,
        COALESCE(lm.service_type, 'Unknown') AS service_type
      FROM links_in_range lr
      LEFT JOIN link_meta lm
        ON lm.frogfootlinklabel = lr.frogfootlinklabel
      ORDER BY 1, 2
      `,
      fromKey,
      toKey
    )

    return {
      from: fromKey,
      to: toKey,
      productTypes: [...new Set(rows.map((row) => String(row.product_type || 'Unknown').trim()).filter(Boolean))],
      serviceTypes: [...new Set(rows.map((row) => String(row.service_type || 'Unknown').trim()).filter(Boolean))]
    }
  })

  res.json(payload)
})

r.get('/overview/ops', verifyToken, async (req, res) => {
  const { fromKey, toKey } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const needsServiceMeta = Boolean(serviceType)
  const needsOutageMeta = Boolean(productType || serviceType)
  const sql = `
    ${needsServiceMeta ? LINK_META_CTE : ''}
    SELECT
      COALESCE(SUM(COALESCE(i.tickets, 0)), 0)::int AS ticket_count,
      COALESCE(SUM(COALESCE(i.outages, 0)), 0)::int AS outage_impact_count
    FROM public.isp_table i
    ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
    WHERE i.year_month >= $1
      AND i.year_month <= $2
      AND ($3::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $3)
      ${needsServiceMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
  `
  const sqlArgs = needsServiceMeta
    ? [fromKey, toKey, productType, serviceType]
    : [fromKey, toKey, productType]

  const payload = await withCachedResponse('sla-overview-ops', {
    fromKey,
    toKey,
    productType,
    serviceType
  }, async () => {
    const outageSql = `
      ${needsOutageMeta ? `${LINK_META_CTE},` : 'WITH'}
      outage_base AS (
        SELECT DISTINCT
          o.outage_ref,
          o.year_month,
          ${buildOutageClientCountExpr('o')} AS client_count
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        ${needsOutageMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = os.frogfootlinklabel' : ''}
        WHERE o.outage_ref IS NOT NULL
          AND o.year_month >= $1
          AND o.year_month <= $2
          ${needsOutageMeta ? "AND ($3::text = '' OR COALESCE(lm.product_type, 'Unknown') = $3)" : ''}
          ${needsOutageMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
      )
      SELECT
        COUNT(*)::int AS outage_count,
        COUNT(*) FILTER (WHERE client_count < 20)::int AS minor_outage_count,
        COUNT(*) FILTER (WHERE client_count >= 20)::int AS major_outage_count
      FROM outage_base
    `
    const outageArgs = needsOutageMeta
      ? [fromKey, toKey, productType, serviceType]
      : [fromKey, toKey]

    const [rows, outageRows] = await runSequentially([
      () => prisma.$queryRawUnsafe(sql, ...sqlArgs),
      () => prisma.$queryRawUnsafe(outageSql, ...outageArgs)
    ])
    const card = rows?.[0] || {}
    const outageCard = outageRows?.[0] || {}
    return {
      from: fromKey,
      to: toKey,
      cards: {
        ticketCount: toNum(card.ticket_count, 0),
        serviceImpactingTickets: null,
        outageCount: toNum(outageCard.outage_count, 0),
        outageImpactCount: toNum(card.outage_impact_count, 0),
        minorOutageCount: toNum(outageCard.minor_outage_count, 0),
        majorOutageCount: toNum(outageCard.major_outage_count, 0)
      }
    }
  })

  res.json(payload)
})

r.get('/overview/trend', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const needsServiceMeta = Boolean(serviceType)
  const needsOutageMeta = Boolean(productType || serviceType)
  const sql = `
    ${needsServiceMeta ? `${LINK_META_CTE},` : 'WITH'}
    isp_base AS (
      SELECT
        i.frogfootlinklabel,
        i.year_month,
        i."uptime%"::numeric AS uptime_pct,
        COALESCE(i.unique_links_affected, 0)::int AS unique_links_affected,
        COALESCE(i.tickets, 0)::int AS tickets,
        COALESCE(i.outages, 0)::int AS outage_impacts
      FROM public.isp_table i
      ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
      WHERE i.frogfootlinklabel IS NOT NULL
        AND i.year_month >= $1
        AND i.year_month <= $2
        AND ($3::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $3)
        ${needsServiceMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
    ),
    month_rollup AS (
      SELECT
        i.year_month,
        COUNT(DISTINCT i.frogfootlinklabel)::int AS total_links,
        ROUND(AVG(i.uptime_pct), 2) AS avg_uptime_pct,
        COUNT(DISTINCT i.frogfootlinklabel) FILTER (WHERE i.unique_links_affected > 0)::int AS impacted_links,
        COUNT(DISTINCT i.frogfootlinklabel) FILTER (WHERE i.uptime_pct < ${SLA_TARGET})::int AS breach_links,
        SUM(i.tickets)::int AS ticket_count,
        SUM(i.outage_impacts)::int AS outage_impact_count
      FROM isp_base i
      GROUP BY i.year_month
    )
    SELECT
      m.year_month,
      m.total_links,
      m.avg_uptime_pct,
      m.impacted_links,
      m.breach_links,
      m.ticket_count,
      m.outage_impact_count,
      NULL::int AS service_impacting_tickets,
      0::int AS outage_count,
      0::int AS unique_outage_count
    FROM month_rollup m
    ORDER BY m.year_month
  `
  const sqlArgs = needsServiceMeta
    ? [fromKey, toKey, productType, serviceType]
    : [fromKey, toKey, productType]

  const payload = await withCachedResponse('sla-overview-trend', {
    fromKey,
    toKey,
    productType,
    serviceType
  }, async () => {
    const outageSql = `
      ${needsOutageMeta ? `${LINK_META_CTE},` : 'WITH'}
      outage_base AS (
        SELECT DISTINCT
          o.year_month,
          o.outage_ref
        FROM public.outages_outage o
        ${needsOutageMeta ? 'JOIN public.outage_resolvers os ON os.outageref = o.outage_ref' : ''}
        ${needsOutageMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = os.frogfootlinklabel' : ''}
        WHERE o.outage_ref IS NOT NULL
          AND o.year_month >= $1
          AND o.year_month <= $2
          ${needsOutageMeta ? "AND ($3::text = '' OR COALESCE(lm.product_type, 'Unknown') = $3)" : ''}
          ${needsOutageMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
      )
      SELECT
        ob.year_month,
        COUNT(DISTINCT ob.outage_ref)::int AS outage_count
      FROM outage_base ob
      GROUP BY ob.year_month
      ORDER BY ob.year_month
    `
    const outageArgs = needsOutageMeta
      ? [fromKey, toKey, productType, serviceType]
      : [fromKey, toKey]

    const monthRows = await prisma.$queryRawUnsafe(sql, ...sqlArgs)
    let outageRows = []
    try {
      outageRows = await prisma.$queryRawUnsafe(outageSql, ...outageArgs)
    } catch {
      outageRows = []
    }
    const monthMap = Object.fromEntries(months.map((month) => [month, {
      yearMonth: month,
      totalLinks: 0,
      avgUptimePct: 0,
      impactedLinks: 0,
      breachLinks: 0,
      ticketCount: 0,
      serviceImpactingTickets: 0,
      outageCount: 0,
      outageImpactCount: 0,
      uniqueOutageCount: 0,
      ticketContactRatioPct: 0,
      outageImpactRatioPct: 0,
      uniqueOutageImpactRatioPct: 0
    }]))

    for (const row of monthRows) {
      const key = String(row.year_month || '').trim()
      if (!monthMap[key]) continue
      monthMap[key] = {
        yearMonth: key,
        totalLinks: toNum(row.total_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        breachLinks: toNum(row.breach_links, 0),
        ticketCount: toNum(row.ticket_count, 0),
        serviceImpactingTickets: toNum(row.service_impacting_tickets, 0),
        outageCount: 0,
        outageImpactCount: toNum(row.outage_impact_count, 0),
        uniqueOutageCount: 0,
        ticketContactRatioPct: 0,
        outageImpactRatioPct: 0,
        uniqueOutageImpactRatioPct: 0
      }
    }

    for (const row of outageRows) {
      const key = String(row.year_month || '').trim()
      if (!monthMap[key]) continue
      monthMap[key] = {
        ...monthMap[key],
        outageCount: toNum(row.outage_count, 0),
        uniqueOutageCount: toNum(row.outage_count, 0)
      }
    }

    for (const month of months) {
      const current = monthMap[month]
      const totalLinks = toNum(current.totalLinks, 0)
      monthMap[month] = {
        ...current,
        ticketContactRatioPct: totalLinks ? (toNum(current.ticketCount, 0) / totalLinks) * 100 : 0,
        outageImpactRatioPct: totalLinks ? (toNum(current.outageImpactCount, 0) / totalLinks) * 100 : 0,
        uniqueOutageImpactRatioPct: totalLinks ? (toNum(current.uniqueOutageCount, 0) / totalLinks) * 100 : 0
      }
    }

    return {
      from: fromKey,
      to: toKey,
      months,
      monthTrend: months.map((month) => monthMap[month])
    }
  })

  res.json(payload)
})

r.get('/overview/isps', verifyToken, async (req, res) => {
  const { fromKey, toKey } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const needsServiceMeta = Boolean(serviceType)
  const sql = `
    ${needsServiceMeta ? `${LINK_META_CTE},` : 'WITH'}
    isp_base AS (
      SELECT
        COALESCE(NULLIF(i.isp, ''), 'Unknown') AS isp,
        i.frogfootlinklabel,
        i."uptime%"::numeric AS uptime_pct,
        COALESCE(i.total_downtime, interval '0 second') AS total_downtime
      FROM public.isp_table i
      ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
      WHERE i.frogfootlinklabel IS NOT NULL
        AND i.year_month >= $1
        AND i.year_month <= $2
        AND ($3::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $3)
        ${needsServiceMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
    ),
    link_rollup AS (
      SELECT
        isp,
        frogfootlinklabel,
        AVG(uptime_pct)::numeric AS avg_uptime_pct,
        MIN(uptime_pct)::numeric AS worst_uptime_pct,
        SUM(EXTRACT(EPOCH FROM total_downtime)) / 3600.0 AS downtime_hours
      FROM isp_base
      GROUP BY 1, 2
    )
    SELECT
      isp,
      COUNT(*)::int AS link_count,
      ROUND(AVG(avg_uptime_pct), 2) AS avg_uptime_pct,
      ROUND(MIN(worst_uptime_pct), 2) AS worst_uptime_pct,
      COUNT(*) FILTER (WHERE avg_uptime_pct < ${SLA_TARGET})::int AS breach_links,
      ROUND((SUM(downtime_hours)::numeric), 2) AS downtime_hours
    FROM link_rollup
    GROUP BY isp
    ORDER BY avg_uptime_pct ASC NULLS LAST, downtime_hours DESC, isp ASC
    LIMIT 8
  `
  const sqlArgs = needsServiceMeta
    ? [fromKey, toKey, productType, serviceType]
    : [fromKey, toKey, productType]

  const payload = await withCachedResponse('sla-overview-isps', {
    fromKey,
    toKey,
    productType,
    serviceType
  }, async () => {
    const rows = await prisma.$queryRawUnsafe(sql, ...sqlArgs)
    return {
      from: fromKey,
      to: toKey,
      worstIsps: rows.map((row) => ({
        isp: String(row.isp || 'Unknown'),
        linkCount: toNum(row.link_count, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        worstUptimePct: toNum(row.worst_uptime_pct, 0),
        breachLinks: toNum(row.breach_links, 0),
        downtimeHours: toNum(row.downtime_hours, 0)
      }))
    }
  })

  res.json(payload)
})

r.get('/overview/groups', verifyToken, async (req, res) => {
  const { fromKey, toKey } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const needsServiceMeta = Boolean(serviceType)
  const productGroupExpr = buildProductGroupExpr("COALESCE(NULLIF(i.producttype, ''), 'Unknown')")
  const groupArgs = needsServiceMeta
    ? [fromKey, toKey, productType, serviceType]
    : [fromKey, toKey, productType]

  const payload = await withCachedResponse('sla-overview-groups', {
    fromKey,
    toKey,
    productType,
    serviceType
  }, async () => {
    const [productRows] = await runSequentially([
      () => prisma.$queryRawUnsafe(
        `
        ${needsServiceMeta ? `${LINK_META_CTE},` : 'WITH'}
        isp_base AS (
          SELECT
            i.frogfootlinklabel,
            ${productGroupExpr} AS product_group,
            i."uptime%"::numeric AS uptime_pct,
            COALESCE(i.unique_links_affected, 0)::int AS unique_links_affected
          FROM public.isp_table i
          ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
          WHERE i.frogfootlinklabel IS NOT NULL
            AND i.year_month >= $1
            AND i.year_month <= $2
            AND ($3::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $3)
            ${needsServiceMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
        )
        SELECT
          COALESCE(i.product_group, 'FTTB') AS label,
          COUNT(DISTINCT i.frogfootlinklabel)::int AS link_count,
          COUNT(DISTINCT i.frogfootlinklabel) FILTER (WHERE i.unique_links_affected > 0)::int AS impacted_links,
          ROUND(AVG(i.uptime_pct), 2) AS avg_uptime_pct,
          ROUND(MIN(i.uptime_pct), 2) AS worst_uptime_pct
        FROM isp_base i
        GROUP BY COALESCE(i.product_group, 'FTTB')
        ORDER BY ${PRODUCT_GROUP_ORDER_SQL}
        `,
        ...groupArgs
      )
    ])

    return {
      from: fromKey,
      to: toKey,
      productPerformance: productRows.map((row) => ({
        label: String(row.label || 'Unknown'),
        linkCount: toNum(row.link_count, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        worstUptimePct: toNum(row.worst_uptime_pct, 0)
      })),
      servicePerformance: []
    }
  })

  res.json(payload)
})

r.get('/breaches', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const threshold = Number.parseFloat(String(req.query.threshold ?? `${SLA_TARGET}`))
  const search = normalizeFilter(req.query.search)
  const searchLike = `%${escapeLikePattern(search)}%`
  const rawPage = Number.parseInt(String(req.query.page ?? '0'), 10)
  const rawPageSize = Number.parseInt(String(req.query.pageSize ?? '100'), 10)
  const page = Number.isFinite(rawPage) && rawPage >= 0 ? rawPage : 0
  const pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0
    ? Math.min(rawPageSize, 300)
    : 100
  const offset = page * pageSize

  const [countRows, rows] = await runSequentially([
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      link_month AS (
        SELECT
          COALESCE(NULLIF(s.isp, ''), 'Unknown') AS isp,
          s.frogfootlinklabel,
          AVG(s."uptime%")::numeric AS avg_uptime_pct
        FROM public.servicelevels s
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = s.frogfootlinklabel
        WHERE s.frogfootlinklabel IS NOT NULL
          AND s.year_month >= $1
          AND s.year_month <= $2
          AND ($3::text = '' OR COALESCE(lm.product_type, 'Unknown') = $3)
          AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)
          AND ($5::text = '' OR s.frogfootlinklabel ILIKE $6 ESCAPE '\\' OR COALESCE(NULLIF(s.isp, ''), 'Unknown') ILIKE $6 ESCAPE '\\')
        GROUP BY 1, 2
      ),
      link_rollup AS (
        SELECT
          isp,
          frogfootlinklabel,
          AVG(avg_uptime_pct)::numeric AS avg_uptime_pct
        FROM link_month
        GROUP BY 1, 2
      )
      SELECT COUNT(*)::int AS total_count
      FROM link_rollup
      WHERE avg_uptime_pct < $7::numeric
      `,
      fromKey,
      toKey,
      productType,
      serviceType,
      search,
      searchLike,
      Number.isFinite(threshold) ? threshold : SLA_TARGET
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      link_month AS (
        SELECT
          COALESCE(NULLIF(s.isp, ''), 'Unknown') AS isp,
          s.frogfootlinklabel,
          COALESCE(lm.product_type, 'Unknown') AS product_type,
          COALESCE(lm.service_type, 'Unknown') AS service_type,
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
          AND ($5::text = '' OR s.frogfootlinklabel ILIKE $6 ESCAPE '\\' OR COALESCE(NULLIF(s.isp, ''), 'Unknown') ILIKE $6 ESCAPE '\\')
        GROUP BY 1, 2, 3, 4, 5
      ),
      link_rollup AS (
        SELECT
          isp,
          frogfootlinklabel,
          MIN(product_type) AS product_type,
          MIN(service_type) AS service_type,
          ROUND(AVG(uptime_pct)::numeric, 2) AS avg_uptime_pct,
          ROUND(MIN(uptime_pct)::numeric, 2) AS worst_uptime_pct,
          SUM(CASE WHEN uptime_pct < 100 THEN 1 ELSE 0 END)::int AS impacted_months,
          SUM(CASE WHEN uptime_pct < $7::numeric THEN 1 ELSE 0 END)::int AS below_threshold_months,
          ROUND((SUM(EXTRACT(EPOCH FROM total_downtime)) / 3600.0)::numeric, 2) AS total_downtime_hours
        FROM link_month
        GROUP BY 1, 2
      ),
      ticket_counts AS (
        SELECT
          t.frg,
          COUNT(*)::int AS ticket_count,
          COUNT(*) FILTER (WHERE t."Category" = $8)::int AS service_impacting_tickets
        FROM public.tickets_output t
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = t.frg
        WHERE t.year_month >= $1
          AND t.year_month <= $2
          AND ($3::text = '' OR COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) = $3)
          AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)
        GROUP BY t.frg
      ),
      outage_counts AS (
        SELECT
          os.frogfootlinklabel,
          COUNT(DISTINCT o.outage_ref)::int AS outage_count
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = os.frogfootlinklabel
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(lm.product_type, 'Unknown') = $3)
          AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)
        GROUP BY os.frogfootlinklabel
      ),
      paged_links AS (
        SELECT
          lr.*
        FROM link_rollup lr
        WHERE lr.avg_uptime_pct < $7::numeric
        ORDER BY lr.avg_uptime_pct ASC, lr.worst_uptime_pct ASC, lr.total_downtime_hours DESC, lr.frogfootlinklabel ASC
        LIMIT $9
        OFFSET $10
      )
      SELECT
        pl.isp,
        pl.frogfootlinklabel,
        pl.product_type,
        pl.service_type,
        pl.avg_uptime_pct,
        pl.worst_uptime_pct,
        pl.impacted_months,
        pl.below_threshold_months,
        pl.total_downtime_hours,
        COALESCE(tc.ticket_count, 0) AS ticket_count,
        COALESCE(tc.service_impacting_tickets, 0) AS service_impacting_tickets,
        COALESCE(oc.outage_count, 0) AS outage_count,
        lm.year_month,
        ROUND(lm.uptime_pct, 2) AS uptime_pct
      FROM paged_links pl
      LEFT JOIN link_month lm
        ON lm.frogfootlinklabel = pl.frogfootlinklabel
      LEFT JOIN ticket_counts tc
        ON tc.frg = pl.frogfootlinklabel
      LEFT JOIN outage_counts oc
        ON oc.frogfootlinklabel = pl.frogfootlinklabel
      ORDER BY pl.avg_uptime_pct ASC, pl.worst_uptime_pct ASC, pl.total_downtime_hours DESC, pl.frogfootlinklabel ASC, lm.year_month ASC
      `,
      fromKey,
      toKey,
      productType,
      serviceType,
      search,
      searchLike,
      Number.isFinite(threshold) ? threshold : SLA_TARGET,
      DOWNTIME_CATEGORY,
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
      for (const month of months) monthValues[month] = null
      byLink.set(link, {
        frogfootlinklabel: link,
        isp: String(row.isp || 'Unknown'),
        productType: String(row.product_type || 'Unknown'),
        serviceType: String(row.service_type || 'Unknown'),
        avgUptimePct: toNum(row.avg_uptime_pct, null),
        worstUptimePct: toNum(row.worst_uptime_pct, null),
        impactedMonths: toNum(row.impacted_months, 0),
        belowThresholdMonths: toNum(row.below_threshold_months, 0),
        totalDowntimeHours: toNum(row.total_downtime_hours, 0),
        ticketCount: toNum(row.ticket_count, 0),
        serviceImpactingTickets: toNum(row.service_impacting_tickets, 0),
        outageCount: toNum(row.outage_count, 0),
        monthValues
      })
    }
    const ref = byLink.get(link)
    const monthKey = String(row.year_month || '').trim()
    if (monthKey && monthSet.has(monthKey)) {
      ref.monthValues[monthKey] = toNum(row.uptime_pct, null)
    }
  }

  const links = [...byLink.values()].map((row) => ({
    ...row,
    currentMonthUptimePct: toNum(row.monthValues[toKey], null)
  }))

  res.json({
    from: fromKey,
    to: toKey,
    months,
    threshold: Number.isFinite(threshold) ? threshold : SLA_TARGET,
    page,
    pageSize,
    totalCount: toNum(countRows?.[0]?.total_count, links.length),
    links
  })
})

r.get('/outages/analytics', verifyToken, async (req, res) => {
  const { fromKey, toKey, months, fromTs, toTsExcl } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const fromTsText = toTimestampParam(fromTs)
  const toTsText = toTimestampParam(toTsExcl)

  const [
    monthRows,
    impactRows,
    causeRows,
    regionRows,
    partyRows,
    topRows
  ] = await runSequentially([
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      filtered_outages AS (
        SELECT DISTINCT
          os.frogfootlinklabel,
          o.outage_ref,
          o.impact_start,
          o.impact_stop,
          o.year_month,
          COALESCE(NULLIF(o.impact_type, ''), 'Unknown') AS impact_type,
          COALESCE(NULLIF(o.cause_class, ''), 'Unknown') AS cause_class,
          COALESCE(NULLIF(o.region, ''), 'Unknown') AS region,
          COALESCE(NULLIF(o.party_at_fault, ''), 'Unknown') AS party_at_fault,
          COALESCE(NULLIF(o.summary, ''), '') AS summary
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = os.frogfootlinklabel
        WHERE o.impact_start < $3::timestamp
          AND COALESCE(o.impact_stop, o.impact_start) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(lm.product_type, 'Unknown') = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      ),
      outage_rollup AS (
        SELECT
          outage_ref,
          MAX(year_month) AS year_month,
          MAX(impact_type) AS impact_type,
          MAX(cause_class) AS cause_class,
          MAX(region) AS region,
          MAX(party_at_fault) AS party_at_fault,
          MIN(impact_start) AS impact_start,
          MAX(impact_stop) AS impact_stop,
          COUNT(DISTINCT frogfootlinklabel)::int AS affected_links
        FROM filtered_outages
        GROUP BY outage_ref
      )
      SELECT
        year_month,
        COUNT(*)::int AS outage_count,
        SUM(affected_links)::int AS affected_links,
        ROUND((
          SUM(EXTRACT(EPOCH FROM COALESCE(impact_stop - impact_start, interval '0 second')))
          / 3600.0
        )::numeric, 2) AS downtime_hours
      FROM outage_rollup
      GROUP BY year_month
      ORDER BY year_month
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      filtered_outages AS (
        SELECT DISTINCT
          os.frogfootlinklabel,
          o.outage_ref,
          o.impact_start,
          o.impact_stop,
          COALESCE(NULLIF(o.impact_type, ''), 'Unknown') AS impact_type
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = os.frogfootlinklabel
        WHERE o.impact_start < $3::timestamp
          AND COALESCE(o.impact_stop, o.impact_start) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(lm.product_type, 'Unknown') = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      ),
      outage_rollup AS (
        SELECT
          outage_ref,
          MAX(impact_type) AS label,
          MIN(impact_start) AS impact_start,
          MAX(impact_stop) AS impact_stop,
          COUNT(DISTINCT frogfootlinklabel)::int AS affected_links
        FROM filtered_outages
        GROUP BY outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        SUM(affected_links)::int AS affected_links,
        ROUND((
          SUM(EXTRACT(EPOCH FROM COALESCE(impact_stop - impact_start, interval '0 second')))
          / 3600.0
        )::numeric, 2) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      filtered_outages AS (
        SELECT DISTINCT
          os.frogfootlinklabel,
          o.outage_ref,
          o.impact_start,
          o.impact_stop,
          COALESCE(NULLIF(o.cause_class, ''), 'Unknown') AS cause_class
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = os.frogfootlinklabel
        WHERE o.impact_start < $3::timestamp
          AND COALESCE(o.impact_stop, o.impact_start) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(lm.product_type, 'Unknown') = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      ),
      outage_rollup AS (
        SELECT
          outage_ref,
          MAX(cause_class) AS label,
          MIN(impact_start) AS impact_start,
          MAX(impact_stop) AS impact_stop,
          COUNT(DISTINCT frogfootlinklabel)::int AS affected_links
        FROM filtered_outages
        GROUP BY outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        SUM(affected_links)::int AS affected_links,
        ROUND((
          SUM(EXTRACT(EPOCH FROM COALESCE(impact_stop - impact_start, interval '0 second')))
          / 3600.0
        )::numeric, 2) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      filtered_outages AS (
        SELECT DISTINCT
          os.frogfootlinklabel,
          o.outage_ref,
          o.impact_start,
          o.impact_stop,
          COALESCE(NULLIF(o.region, ''), 'Unknown') AS region
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = os.frogfootlinklabel
        WHERE o.impact_start < $3::timestamp
          AND COALESCE(o.impact_stop, o.impact_start) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(lm.product_type, 'Unknown') = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      ),
      outage_rollup AS (
        SELECT
          outage_ref,
          MAX(region) AS label,
          MIN(impact_start) AS impact_start,
          MAX(impact_stop) AS impact_stop,
          COUNT(DISTINCT frogfootlinklabel)::int AS affected_links
        FROM filtered_outages
        GROUP BY outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        SUM(affected_links)::int AS affected_links,
        ROUND((
          SUM(EXTRACT(EPOCH FROM COALESCE(impact_stop - impact_start, interval '0 second')))
          / 3600.0
        )::numeric, 2) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      filtered_outages AS (
        SELECT DISTINCT
          os.frogfootlinklabel,
          o.outage_ref,
          o.impact_start,
          o.impact_stop,
          COALESCE(NULLIF(o.party_at_fault, ''), 'Unknown') AS party_at_fault
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = os.frogfootlinklabel
        WHERE o.impact_start < $3::timestamp
          AND COALESCE(o.impact_stop, o.impact_start) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(lm.product_type, 'Unknown') = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      ),
      outage_rollup AS (
        SELECT
          outage_ref,
          MAX(party_at_fault) AS label,
          MIN(impact_start) AS impact_start,
          MAX(impact_stop) AS impact_stop,
          COUNT(DISTINCT frogfootlinklabel)::int AS affected_links
        FROM filtered_outages
        GROUP BY outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        SUM(affected_links)::int AS affected_links,
        ROUND((
          SUM(EXTRACT(EPOCH FROM COALESCE(impact_stop - impact_start, interval '0 second')))
          / 3600.0
        )::numeric, 2) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      filtered_outages AS (
        SELECT DISTINCT
          os.frogfootlinklabel,
          o.outage_ref,
          o.impact_start,
          o.impact_stop,
          o.year_month,
          COALESCE(NULLIF(o.impact_type, ''), 'Unknown') AS impact_type,
          COALESCE(NULLIF(o.cause_class, ''), 'Unknown') AS cause_class,
          COALESCE(NULLIF(o.region, ''), 'Unknown') AS region,
          COALESCE(NULLIF(o.party_at_fault, ''), 'Unknown') AS party_at_fault,
          COALESCE(NULLIF(o.summary, ''), '') AS summary
        FROM public.outage_resolvers os
        JOIN public.outages_outage o
          ON o.outage_ref = os.outageref
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = os.frogfootlinklabel
        WHERE o.impact_start < $3::timestamp
          AND COALESCE(o.impact_stop, o.impact_start) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(lm.product_type, 'Unknown') = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      )
      SELECT
        outage_ref,
        MAX(year_month) AS year_month,
        MIN(impact_start) AS impact_start,
        MAX(impact_stop) AS impact_stop,
        MAX(impact_type) AS impact_type,
        MAX(cause_class) AS cause_class,
        MAX(region) AS region,
        MAX(party_at_fault) AS party_at_fault,
        MAX(summary) AS summary,
        COUNT(DISTINCT frogfootlinklabel)::int AS affected_links,
        ROUND((
          EXTRACT(EPOCH FROM COALESCE(MAX(impact_stop) - MIN(impact_start), interval '0 second'))
          / 3600.0
        )::numeric, 2) AS duration_hours
      FROM filtered_outages
      GROUP BY outage_ref
      ORDER BY affected_links DESC, duration_hours DESC, impact_start DESC NULLS LAST
      LIMIT 25
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    )
  ])

  const byMonthMap = Object.fromEntries(months.map((month) => [month, {
    yearMonth: month,
    outageCount: 0,
    affectedLinks: 0,
    downtimeHours: 0
  }]))

  for (const row of monthRows) {
    const key = String(row.year_month || '').trim()
    if (!byMonthMap[key]) continue
    byMonthMap[key] = {
      yearMonth: key,
      outageCount: toNum(row.outage_count, 0),
      affectedLinks: toNum(row.affected_links, 0),
      downtimeHours: toNum(row.downtime_hours, 0)
    }
  }

  res.json({
    from: fromKey,
    to: toKey,
    months,
    byMonth: months.map((month) => byMonthMap[month]),
    byImpactType: impactRows.map((row) => ({
      label: String(row.label || 'Unknown'),
      outageCount: toNum(row.outage_count, 0),
      affectedLinks: toNum(row.affected_links, 0),
      downtimeHours: toNum(row.downtime_hours, 0)
    })),
    byCauseClass: causeRows.map((row) => ({
      label: String(row.label || 'Unknown'),
      outageCount: toNum(row.outage_count, 0),
      affectedLinks: toNum(row.affected_links, 0),
      downtimeHours: toNum(row.downtime_hours, 0)
    })),
    byRegion: regionRows.map((row) => ({
      label: String(row.label || 'Unknown'),
      outageCount: toNum(row.outage_count, 0),
      affectedLinks: toNum(row.affected_links, 0),
      downtimeHours: toNum(row.downtime_hours, 0)
    })),
    byPartyAtFault: partyRows.map((row) => ({
      label: String(row.label || 'Unknown'),
      outageCount: toNum(row.outage_count, 0),
      affectedLinks: toNum(row.affected_links, 0),
      downtimeHours: toNum(row.downtime_hours, 0)
    })),
    topOutages: topRows.map((row) => ({
      outageRef: String(row.outage_ref || ''),
      yearMonth: String(row.year_month || ''),
      impactStart: row.impact_start,
      impactStop: row.impact_stop,
      impactType: String(row.impact_type || 'Unknown'),
      causeClass: String(row.cause_class || 'Unknown'),
      region: String(row.region || 'Unknown'),
      partyAtFault: String(row.party_at_fault || 'Unknown'),
      summary: String(row.summary || ''),
      affectedLinks: toNum(row.affected_links, 0),
      durationHours: toNum(row.duration_hours, 0)
    }))
  })
})

r.get('/tickets/analytics', verifyToken, async (req, res) => {
  const { fromKey, toKey, months, fromTs, toTsExcl } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const fromTsText = toTimestampParam(fromTs)
  const toTsText = toTimestampParam(toTsExcl)

  const [
    monthRows,
    categoryRows,
    severityRows,
    partyRows,
    topRows
  ] = await runSequentially([
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      ticket_enriched AS (
        SELECT
          t.ticket_id,
          t.frg,
          t.created_date,
          t.impact_stop_time,
          t.year_month,
          COALESCE(NULLIF(t."Category", ''), 'Unknown') AS category,
          COALESCE(NULLIF(z.severity, ''), 'Unknown') AS severity,
          COALESCE(NULLIF(z.partyatfault, ''), 'Unknown') AS party_at_fault,
          COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) AS product_type,
          COALESCE(lm.service_type, 'Unknown') AS service_type,
          COALESCE(t.raw_downtime, interval '0 second') AS raw_downtime,
          COALESCE(t.excluded_site_access_duration, interval '0 second') AS excluded_site_access_duration,
          COALESCE(t.final_ticket_downtime, interval '0 second') AS final_ticket_downtime,
          COALESCE(NULLIF(t.site_access_times, ''), 'Unknown') AS site_access_times
        FROM public.tickets_output t
        LEFT JOIN public.zendesktickets z
          ON z.ticketid = t.ticket_id
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = t.frg
        WHERE t.created_date < $3::timestamp
          AND COALESCE(t.impact_stop_time, t.created_date) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      )
      SELECT
        year_month,
        COUNT(*)::int AS ticket_count,
        COUNT(*) FILTER (WHERE category = $5)::int AS service_impacting_tickets,
        COUNT(*) FILTER (WHERE category <> $5)::int AS excluded_tickets,
        COUNT(*) FILTER (WHERE excluded_site_access_duration > interval '0 second')::int AS access_adjusted_tickets,
        ROUND((AVG(EXTRACT(EPOCH FROM final_ticket_downtime)) / 3600.0)::numeric, 2) AS avg_final_downtime_hours
      FROM ticket_enriched
      GROUP BY year_month
      ORDER BY year_month
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText,
      DOWNTIME_CATEGORY
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      ticket_enriched AS (
        SELECT
          COALESCE(NULLIF(t."Category", ''), 'Unknown') AS category
        FROM public.tickets_output t
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = t.frg
        WHERE t.created_date < $3::timestamp
          AND COALESCE(t.impact_stop_time, t.created_date) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      )
      SELECT
        category AS label,
        COUNT(*)::int AS ticket_count
      FROM ticket_enriched
      GROUP BY category
      ORDER BY ticket_count DESC, label ASC
      LIMIT 12
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      ticket_enriched AS (
        SELECT
          COALESCE(NULLIF(z.severity, ''), 'Unknown') AS severity
        FROM public.tickets_output t
        LEFT JOIN public.zendesktickets z
          ON z.ticketid = t.ticket_id
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = t.frg
        WHERE t.created_date < $3::timestamp
          AND COALESCE(t.impact_stop_time, t.created_date) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      )
      SELECT
        severity AS label,
        COUNT(*)::int AS ticket_count
      FROM ticket_enriched
      GROUP BY severity
      ORDER BY ticket_count DESC, label ASC
      LIMIT 12
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      ticket_enriched AS (
        SELECT
          COALESCE(NULLIF(z.partyatfault, ''), 'Unknown') AS party_at_fault
        FROM public.tickets_output t
        LEFT JOIN public.zendesktickets z
          ON z.ticketid = t.ticket_id
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = t.frg
        WHERE t.created_date < $3::timestamp
          AND COALESCE(t.impact_stop_time, t.created_date) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      )
      SELECT
        party_at_fault AS label,
        COUNT(*)::int AS ticket_count
      FROM ticket_enriched
      GROUP BY party_at_fault
      ORDER BY ticket_count DESC, label ASC
      LIMIT 12
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    ),
    () => prisma.$queryRawUnsafe(
      `
      ${LINK_META_CTE},
      ticket_enriched AS (
        SELECT
          t.ticket_id,
          t.frg,
          t.created_date,
          t.impact_stop_time,
          t.year_month,
          COALESCE(NULLIF(t."Category", ''), 'Unknown') AS category,
          COALESCE(NULLIF(z.severity, ''), 'Unknown') AS severity,
          COALESCE(NULLIF(z.partyatfault, ''), 'Unknown') AS party_at_fault,
          COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) AS product_type,
          COALESCE(lm.service_type, 'Unknown') AS service_type,
          COALESCE(t.raw_downtime, interval '0 second') AS raw_downtime,
          COALESCE(t.excluded_site_access_duration, interval '0 second') AS excluded_site_access_duration,
          COALESCE(t.final_ticket_downtime, interval '0 second') AS final_ticket_downtime,
          COALESCE(NULLIF(t.site_access_times, ''), 'Unknown') AS site_access_times
        FROM public.tickets_output t
        LEFT JOIN public.zendesktickets z
          ON z.ticketid = t.ticket_id
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = t.frg
        WHERE t.created_date < $3::timestamp
          AND COALESCE(t.impact_stop_time, t.created_date) >= $4::timestamp
          AND ($1::text = '' OR COALESCE(NULLIF(t.product_type, ''), COALESCE(lm.product_type, 'Unknown')) = $1)
          AND ($2::text = '' OR COALESCE(lm.service_type, 'Unknown') = $2)
      )
      SELECT
        ticket_id,
        frg,
        year_month,
        created_date,
        impact_stop_time,
        category,
        severity,
        party_at_fault,
        product_type,
        service_type,
        site_access_times,
        ROUND((EXTRACT(EPOCH FROM raw_downtime) / 3600.0)::numeric, 2) AS raw_hours,
        ROUND((EXTRACT(EPOCH FROM excluded_site_access_duration) / 3600.0)::numeric, 2) AS excluded_hours,
        ROUND((EXTRACT(EPOCH FROM final_ticket_downtime) / 3600.0)::numeric, 2) AS final_hours
      FROM ticket_enriched
      ORDER BY final_ticket_downtime DESC, excluded_site_access_duration DESC, created_date DESC NULLS LAST
      LIMIT 25
      `,
      productType,
      serviceType,
      toTsText,
      fromTsText
    )
  ])

  const byMonthMap = Object.fromEntries(months.map((month) => [month, {
    yearMonth: month,
    ticketCount: 0,
    serviceImpactingTickets: 0,
    excludedTickets: 0,
    accessAdjustedTickets: 0,
    avgFinalDowntimeHours: 0
  }]))

  for (const row of monthRows) {
    const key = String(row.year_month || '').trim()
    if (!byMonthMap[key]) continue
    byMonthMap[key] = {
      yearMonth: key,
      ticketCount: toNum(row.ticket_count, 0),
      serviceImpactingTickets: toNum(row.service_impacting_tickets, 0),
      excludedTickets: toNum(row.excluded_tickets, 0),
      accessAdjustedTickets: toNum(row.access_adjusted_tickets, 0),
      avgFinalDowntimeHours: toNum(row.avg_final_downtime_hours, 0)
    }
  }

  res.json({
    from: fromKey,
    to: toKey,
    months,
    byMonth: months.map((month) => byMonthMap[month]),
    byCategory: categoryRows.map((row) => ({
      label: String(row.label || 'Unknown'),
      ticketCount: toNum(row.ticket_count, 0)
    })),
    bySeverity: severityRows.map((row) => ({
      label: String(row.label || 'Unknown'),
      ticketCount: toNum(row.ticket_count, 0)
    })),
    byPartyAtFault: partyRows.map((row) => ({
      label: String(row.label || 'Unknown'),
      ticketCount: toNum(row.ticket_count, 0)
    })),
    topTickets: topRows.map((row) => ({
      ticketId: String(row.ticket_id || ''),
      frg: String(row.frg || ''),
      yearMonth: String(row.year_month || ''),
      createdDate: row.created_date,
      impactStopTime: row.impact_stop_time,
      category: String(row.category || 'Unknown'),
      severity: String(row.severity || 'Unknown'),
      partyAtFault: String(row.party_at_fault || 'Unknown'),
      productType: String(row.product_type || 'Unknown'),
      serviceType: String(row.service_type || 'Unknown'),
      siteAccessTimes: String(row.site_access_times || 'Unknown'),
      rawHours: toNum(row.raw_hours, 0),
      excludedHours: toNum(row.excluded_hours, 0),
      finalHours: toNum(row.final_hours, 0)
    }))
  })
})

r.get('/summary', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const productType = normalizeFilter(req.query.productType)
  const serviceType = normalizeFilter(req.query.serviceType)
  const needsServiceMeta = Boolean(serviceType)
  const summarySql = `
    ${needsServiceMeta ? `${LINK_META_CTE},` : 'WITH'}
    isp_base AS (
      SELECT
        COALESCE(NULLIF(i.isp, ''), 'Unknown') AS isp,
        i.frogfootlinklabel,
        i.year_month,
        i."uptime%"::numeric AS uptime_pct,
        COALESCE(i.total_downtime, interval '0 second') AS total_downtime,
        COALESCE(i.unique_links_affected, 0)::int AS unique_links_affected
      FROM public.isp_table i
      ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
      WHERE i.frogfootlinklabel IS NOT NULL
        AND i.year_month >= $1
        AND i.year_month <= $2
        AND ($3::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $3)
        ${needsServiceMeta ? "AND ($4::text = '' OR COALESCE(lm.service_type, 'Unknown') = $4)" : ''}
    ),
    link_rollup AS (
      SELECT
        ib.isp,
        ib.frogfootlinklabel,
        AVG(ib.uptime_pct)::numeric AS avg_uptime_pct,
        MIN(ib.uptime_pct)::numeric AS worst_uptime_pct,
        SUM(CASE WHEN ib.unique_links_affected > 0 THEN 1 ELSE 0 END)::int AS impacted_months,
        SUM(EXTRACT(EPOCH FROM ib.total_downtime)) / 3600.0 AS downtime_hours
      FROM isp_base ib
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
  `
  const summaryArgs = needsServiceMeta
    ? [fromKey, toKey, productType, serviceType]
    : [fromKey, toKey, productType]

  const payload = await withCachedResponse('sla-summary', {
    fromKey,
    toKey,
    productType,
    serviceType
  }, async () => {
    const [rows, optionRows] = await runSequentially([
      () => prisma.$queryRawUnsafe(summarySql, ...summaryArgs),
      () => prisma.$queryRawUnsafe(
        `
        ${LINK_META_CTE},
        links_in_range AS (
          SELECT DISTINCT
            i.frogfootlinklabel,
            COALESCE(NULLIF(i.producttype, ''), 'Unknown') AS product_type
          FROM public.isp_table i
          WHERE i.frogfootlinklabel IS NOT NULL
            AND i.year_month >= $1
            AND i.year_month <= $2
        )
        SELECT DISTINCT
          lr.product_type,
          COALESCE(lm.service_type, 'Unknown') AS service_type
        FROM links_in_range lr
        LEFT JOIN link_meta lm
          ON lm.frogfootlinklabel = lr.frogfootlinklabel
        ORDER BY 1, 2
        `,
        fromKey,
        toKey
      )
    ])

    return {
      from: fromKey,
      to: toKey,
      months,
      productTypes: [...new Set(optionRows.map((row) => String(row.product_type || 'Unknown').trim()).filter(Boolean))],
      serviceTypes: [...new Set(optionRows.map((row) => String(row.service_type || 'Unknown').trim()).filter(Boolean))],
      selectedProductType: productType,
      selectedServiceType: serviceType,
      isps: rows.map((row) => ({
        isp: String(row.isp || 'Unknown'),
        linkCount: toNum(row.link_count, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, null),
        worstUptimePct: toNum(row.worst_uptime_pct, null),
        totalDowntimeHours: toNum(row.total_downtime_hours, 0)
      }))
    }
  })

  res.json(payload)
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
  const needsServiceMeta = Boolean(serviceType)
  const countSql = `
    ${needsServiceMeta ? LINK_META_CTE : ''}
    SELECT COUNT(DISTINCT i.frogfootlinklabel)::int AS total_count
    FROM public.isp_table i
    ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
    WHERE i.frogfootlinklabel IS NOT NULL
      AND COALESCE(NULLIF(i.isp, ''), 'Unknown') = $1
      AND i.year_month >= $2
      AND i.year_month <= $3
      AND ($4::text = '' OR i.frogfootlinklabel ILIKE $5 ESCAPE '\\')
      AND ($6::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $6)
      ${needsServiceMeta ? "AND ($7::text = '' OR COALESCE(lm.service_type, 'Unknown') = $7)" : ''}
  `
  const rowsSql = `
    ${needsServiceMeta ? `${LINK_META_CTE},` : 'WITH'}
    isp_base AS (
      SELECT
        i.frogfootlinklabel,
        i.year_month,
        i."uptime%"::numeric AS uptime_pct,
        COALESCE(i.total_downtime, interval '0 second') AS total_downtime,
        COALESCE(i.unique_links_affected, 0)::int AS unique_links_affected
      FROM public.isp_table i
      ${needsServiceMeta ? 'LEFT JOIN link_meta lm ON lm.frogfootlinklabel = i.frogfootlinklabel' : ''}
      WHERE i.frogfootlinklabel IS NOT NULL
        AND COALESCE(NULLIF(i.isp, ''), 'Unknown') = $1
        AND i.year_month >= $2
        AND i.year_month <= $3
        AND ($4::text = '' OR i.frogfootlinklabel ILIKE $5 ESCAPE '\\')
        AND ($6::text = '' OR COALESCE(NULLIF(i.producttype, ''), 'Unknown') = $6)
        ${needsServiceMeta ? "AND ($7::text = '' OR COALESCE(lm.service_type, 'Unknown') = $7)" : ''}
    ),
    link_rollup AS (
      SELECT
        ib.frogfootlinklabel,
        ROUND(AVG(ib.uptime_pct)::numeric, 2) AS avg_uptime_pct,
        ROUND(MIN(ib.uptime_pct)::numeric, 2) AS worst_uptime_pct,
        SUM(CASE WHEN ib.unique_links_affected > 0 THEN 1 ELSE 0 END)::int AS impacted_months,
        ROUND((SUM(EXTRACT(EPOCH FROM ib.total_downtime)) / 3600.0)::numeric, 2) AS total_downtime_hours
      FROM isp_base ib
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
      ib.year_month,
      ROUND(ib.uptime_pct, 2) AS uptime_pct,
      EXTRACT(EPOCH FROM ib.total_downtime) / 3600.0 AS downtime_hours
    FROM paged_links pl
    LEFT JOIN isp_base ib
      ON ib.frogfootlinklabel = pl.frogfootlinklabel
    ORDER BY pl.frogfootlinklabel, ib.year_month
  `
  const sharedArgs = needsServiceMeta
    ? [ispName, fromKey, toKey, frgSearch, frgLike, productType, serviceType]
    : [ispName, fromKey, toKey, frgSearch, frgLike, productType]

  const payload = await withCachedResponse('sla-isp-links', {
    ispName,
    fromKey,
    toKey,
    page,
    pageSize,
    frgSearch,
    productType,
    serviceType
  }, async () => {
    const [countRows, rows] = await runSequentially([
      () => prisma.$queryRawUnsafe(countSql, ...sharedArgs),
      () => prisma.$queryRawUnsafe(rowsSql, ...sharedArgs, pageSize, offset)
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

    return {
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
    }
  })

  res.json(payload)
})

r.get('/link/:frg/details', verifyToken, async (req, res) => {
  const frg = String(req.params.frg || '').trim()
  if (!frg) return res.status(400).json({ error: 'Missing FRG link label' })

  const { fromKey, toKey, months, fromTs, toTsExcl } = resolveRange(req.query)

  const [slaRows, tickets, outages] = await runSequentially([
    () => prisma.$queryRawUnsafe(
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
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        frg,
        ticket_id,
        created_date,
        impact_stop_time,
        year_month,
        "Category" AS category,
        sla_exclusion_reason,
        product_type,
        site_access_times,
        site_access_schedule,
        raw_downtime,
        excluded_site_access_duration,
        final_ticket_downtime
      FROM public.tickets_output
      WHERE frg = $1
        AND created_date < $2::timestamp
        AND COALESCE(impact_stop_time, created_date) >= $3::timestamp
      ORDER BY created_date ASC NULLS LAST, ticket_id ASC
      `,
      frg, toTsExcl.toISOString().slice(0, 19).replace('T', ' '), fromTs.toISOString().slice(0, 19).replace('T', ' ')
    ),
    () => prisma.$queryRawUnsafe(
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
