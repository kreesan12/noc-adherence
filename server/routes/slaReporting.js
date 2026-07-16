import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'

const r = Router()
const DOWNTIME_CATEGORY = 'Service impacting'
const SLA_TARGET = 99.5
const RESPONSE_CACHE_TTL_MS = 60 * 1000
const responseCache = new Map()
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

function buildProductGroupOrderExpr(expr) {
  return `
    CASE COALESCE(${expr}, 'FTTB')
      WHEN 'FTTB' THEN 1
      WHEN 'FTTH' THEN 2
      WHEN 'FTTC' THEN 3
      ELSE 4
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

function getSlaDimensionFilters(query) {
  return {
    productGroup: normalizeFilter(query.productGroup),
    productType: normalizeFilter(query.productType),
    serviceType: normalizeFilter(query.serviceType)
  }
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
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const payload = await withCachedResponse('sla-overview-base', {
    fromKey,
    toKey,
    productGroup,
    productType,
    serviceType
  }, async () => {
    const [
      cardRows,
      optionRows,
      monthRows,
      outageMonthRows,
      outageRangeRows,
      worstIspRows,
      productRows,
      serviceRows
    ] = await runSequentially([
      () => prisma.$queryRawUnsafe(
        `
        WITH link_rollup AS (
          SELECT
            l.frogfootlinklabel,
            AVG(COALESCE(l.uptime_pct, 100))::numeric AS avg_uptime_pct,
            MIN(COALESCE(l.uptime_pct, 100))::numeric AS worst_uptime_pct,
            SUM(COALESCE(l.impacted, 0))::int AS impacted_months,
            SUM(COALESCE(l.total_downtime_hours, 0))::numeric AS downtime_hours
          FROM public.sla_link_monthly_fact l
          WHERE l.year_month >= $1
            AND l.year_month <= $2
            AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
          GROUP BY l.frogfootlinklabel
        )
        SELECT
          COUNT(*)::int AS total_links,
          COALESCE(SUM(CASE WHEN impacted_months > 0 THEN 1 ELSE 0 END), 0)::int AS impacted_links,
          COALESCE(SUM(CASE WHEN avg_uptime_pct < ${SLA_TARGET} THEN 1 ELSE 0 END), 0)::int AS breach_links,
          COALESCE(ROUND(AVG(avg_uptime_pct)::numeric, 2), 0) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(worst_uptime_pct)::numeric, 2), 0) AS worst_uptime_pct,
          COALESCE(ROUND(SUM(downtime_hours)::numeric, 2), 0) AS total_downtime_hours
        FROM link_rollup
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        SELECT DISTINCT
          COALESCE(k.product_group, 'FTTB') AS product_group,
          COALESCE(k.product_type, 'Unknown') AS product_type,
          COALESCE(k.service_type, 'Unknown') AS service_type
        FROM public.sla_monthly_kpi k
        WHERE k.year_month >= $1
          AND k.year_month <= $2
        ORDER BY
          CASE COALESCE(k.product_group, 'FTTB')
            WHEN 'FTTB' THEN 1
            WHEN 'FTTH' THEN 2
            WHEN 'FTTC' THEN 3
            ELSE 4
          END,
          COALESCE(k.product_type, 'Unknown'),
          COALESCE(k.service_type, 'Unknown')
        `,
        fromKey,
        toKey
      ),
      () => prisma.$queryRawUnsafe(
        `
        SELECT
          k.year_month,
          COALESCE(SUM(k.total_links), 0)::int AS total_links,
          COALESCE(SUM(k.impacted_links), 0)::int AS impacted_links,
          COALESCE(SUM(k.breach_links), 0)::int AS breach_links,
          COALESCE(SUM(k.ticket_count), 0)::int AS ticket_count,
          COALESCE(SUM(k.service_impacting_ticket_count), 0)::int AS service_impacting_tickets,
          COALESCE(SUM(k.outage_impact_count), 0)::int AS outage_impact_count,
          COALESCE(SUM(k.unique_outage_link_count), 0)::int AS unique_outage_count,
          COALESCE(
            ROUND(
              SUM(COALESCE(k.avg_uptime_pct, 0) * COALESCE(k.total_links, 0))
              / NULLIF(SUM(COALESCE(k.total_links, 0)), 0),
              2
            ),
            0
          ) AS avg_uptime_pct
        FROM public.sla_monthly_kpi k
        WHERE k.year_month >= $1
          AND k.year_month <= $2
          AND ($3::text = '' OR COALESCE(k.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(k.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(k.service_type, 'Unknown') = $5)
        GROUP BY k.year_month
        ORDER BY k.year_month
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH outage_rollup AS (
          SELECT
            o.year_month,
            o.outage_ref
          FROM public.sla_outage_link_monthly_fact o
          WHERE o.year_month >= $1
            AND o.year_month <= $2
            AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
          GROUP BY o.year_month, o.outage_ref
        )
        SELECT
          year_month,
          COUNT(*)::int AS outage_count
        FROM outage_rollup
        GROUP BY year_month
        ORDER BY year_month
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH outage_rollup AS (
          SELECT
            o.outage_ref,
            MAX(COALESCE(o.client_count, 0))::int AS client_count
          FROM public.sla_outage_link_monthly_fact o
          WHERE o.year_month >= $1
            AND o.year_month <= $2
            AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
          GROUP BY o.outage_ref
        )
        SELECT
          COUNT(*)::int AS outage_count,
          COUNT(*) FILTER (WHERE client_count < 20)::int AS minor_outage_count,
          COUNT(*) FILTER (WHERE client_count >= 20)::int AS major_outage_count
        FROM outage_rollup
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH monthly_isp AS (
          SELECT
            s.isp,
            s.year_month,
            COALESCE(SUM(s.link_count), 0)::int AS link_count,
            COALESCE(SUM(s.breach_links), 0)::int AS breach_links,
            COALESCE(MIN(s.worst_uptime_pct), 0)::numeric AS worst_uptime_pct,
            COALESCE(SUM(s.total_downtime_hours), 0)::numeric AS downtime_hours,
            COALESCE(
              SUM(COALESCE(s.avg_uptime_pct, 0) * COALESCE(s.link_count, 0))
              / NULLIF(SUM(COALESCE(s.link_count, 0)), 0),
              0
            ) AS avg_uptime_pct
          FROM public.sla_isp_monthly_summary s
          WHERE s.year_month >= $1
            AND s.year_month <= $2
            AND ($3::text = '' OR COALESCE(s.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(s.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(s.service_type, 'Unknown') = $5)
          GROUP BY s.isp, s.year_month
        )
        SELECT
          isp,
          MAX(link_count)::int AS link_count,
          COALESCE(
            ROUND(
              SUM(avg_uptime_pct * link_count)
              / NULLIF(SUM(link_count), 0),
              2
            ),
            0
          ) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(worst_uptime_pct), 2), 0) AS worst_uptime_pct,
          MAX(breach_links)::int AS breach_links,
          COALESCE(ROUND(SUM(downtime_hours), 2), 0) AS downtime_hours
        FROM monthly_isp
        GROUP BY isp
        ORDER BY avg_uptime_pct ASC NULLS LAST, downtime_hours DESC, isp ASC
        LIMIT 8
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH monthly_group AS (
          SELECT
            COALESCE(k.product_group, 'FTTB') AS label,
            k.year_month,
            COALESCE(SUM(k.total_links), 0)::int AS total_links,
            COALESCE(SUM(k.impacted_links), 0)::int AS impacted_links,
            COALESCE(MIN(k.worst_uptime_pct), 0)::numeric AS worst_uptime_pct,
            COALESCE(
              SUM(COALESCE(k.avg_uptime_pct, 0) * COALESCE(k.total_links, 0))
              / NULLIF(SUM(COALESCE(k.total_links, 0)), 0),
              0
            ) AS avg_uptime_pct
          FROM public.sla_monthly_kpi k
          WHERE k.year_month >= $1
            AND k.year_month <= $2
            AND ($3::text = '' OR COALESCE(k.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(k.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(k.service_type, 'Unknown') = $5)
          GROUP BY COALESCE(k.product_group, 'FTTB'), k.year_month
        )
        SELECT
          label,
          MAX(total_links)::int AS link_count,
          MAX(impacted_links)::int AS impacted_links,
          COALESCE(
            ROUND(
              SUM(avg_uptime_pct * total_links)
              / NULLIF(SUM(total_links), 0),
              2
            ),
            0
          ) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(worst_uptime_pct), 2), 0) AS worst_uptime_pct
        FROM monthly_group
        GROUP BY label
        ORDER BY
          CASE label
            WHEN 'FTTB' THEN 1
            WHEN 'FTTH' THEN 2
            WHEN 'FTTC' THEN 3
            ELSE 4
          END,
          label ASC
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH monthly_service AS (
          SELECT
            COALESCE(k.service_type, 'Unknown') AS label,
            k.year_month,
            COALESCE(SUM(k.total_links), 0)::int AS total_links,
            COALESCE(SUM(k.impacted_links), 0)::int AS impacted_links,
            COALESCE(MIN(k.worst_uptime_pct), 0)::numeric AS worst_uptime_pct,
            COALESCE(
              SUM(COALESCE(k.avg_uptime_pct, 0) * COALESCE(k.total_links, 0))
              / NULLIF(SUM(COALESCE(k.total_links, 0)), 0),
              0
            ) AS avg_uptime_pct
          FROM public.sla_monthly_kpi k
          WHERE k.year_month >= $1
            AND k.year_month <= $2
            AND ($3::text = '' OR COALESCE(k.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(k.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(k.service_type, 'Unknown') = $5)
          GROUP BY COALESCE(k.service_type, 'Unknown'), k.year_month
        )
        SELECT
          label,
          MAX(total_links)::int AS link_count,
          MAX(impacted_links)::int AS impacted_links,
          COALESCE(
            ROUND(
              SUM(avg_uptime_pct * total_links)
              / NULLIF(SUM(total_links), 0),
              2
            ),
            0
          ) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(worst_uptime_pct), 2), 0) AS worst_uptime_pct
        FROM monthly_service
        GROUP BY label
        ORDER BY impacted_links DESC, link_count DESC, label ASC
        LIMIT 12
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      )
    ])

    const cards = cardRows?.[0] || {}
    const outageSummary = outageRangeRows?.[0] || {}
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
        ...monthMap[key],
        totalLinks: toNum(row.total_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        breachLinks: toNum(row.breach_links, 0),
        ticketCount: toNum(row.ticket_count, 0),
        serviceImpactingTickets: toNum(row.service_impacting_tickets, 0),
        outageImpactCount: toNum(row.outage_impact_count, 0),
        uniqueOutageCount: toNum(row.unique_outage_count, 0)
      }
    }

    for (const row of outageMonthRows) {
      const key = String(row.year_month || '').trim()
      if (!monthMap[key]) continue
      monthMap[key] = {
        ...monthMap[key],
        outageCount: toNum(row.outage_count, 0)
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

    const ticketCount = months.reduce((sum, month) => sum + toNum(monthMap[month]?.ticketCount, 0), 0)
    const serviceImpactingTickets = months.reduce((sum, month) => sum + toNum(monthMap[month]?.serviceImpactingTickets, 0), 0)

    return {
      from: fromKey,
      to: toKey,
      months,
      productGroups: [...new Set(optionRows.map((row) => String(row.product_group || 'FTTB').trim()).filter(Boolean))],
      productTypes: [...new Set(optionRows.map((row) => String(row.product_type || 'Unknown').trim()).filter(Boolean))],
      serviceTypes: [...new Set(optionRows.map((row) => String(row.service_type || 'Unknown').trim()).filter(Boolean))],
      selectedProductGroup: productGroup,
      selectedProductType: productType,
      selectedServiceType: serviceType,
      cards: {
        totalLinks: toNum(cards.total_links, 0),
        impactedLinks: toNum(cards.impacted_links, 0),
        breachLinks: toNum(cards.breach_links, 0),
        avgUptimePct: toNum(cards.avg_uptime_pct, 0),
        worstUptimePct: toNum(cards.worst_uptime_pct, 0),
        totalDowntimeHours: toNum(cards.total_downtime_hours, 0),
        ticketCount,
        serviceImpactingTickets,
        outageCount: toNum(outageSummary.outage_count, 0),
        minorOutageCount: toNum(outageSummary.minor_outage_count, 0),
        majorOutageCount: toNum(outageSummary.major_outage_count, 0)
      },
      monthTrend: months.map((month) => monthMap[month]),
      worstIsps: worstIspRows.map((row) => ({
        isp: String(row.isp || 'Unknown'),
        linkCount: toNum(row.link_count, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        worstUptimePct: toNum(row.worst_uptime_pct, 0),
        breachLinks: toNum(row.breach_links, 0),
        downtimeHours: toNum(row.downtime_hours, 0)
      })),
      productPerformance: productRows.map((row) => ({
        label: String(row.label || 'Unknown'),
        linkCount: toNum(row.link_count, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        worstUptimePct: toNum(row.worst_uptime_pct, 0)
      })),
      servicePerformance: serviceRows.map((row) => ({
        label: String(row.label || 'Unknown'),
        linkCount: toNum(row.link_count, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        worstUptimePct: toNum(row.worst_uptime_pct, 0)
      }))
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
      SELECT DISTINCT
        COALESCE(l.product_group, 'FTTB') AS product_group,
        COALESCE(l.product_type, 'Unknown') AS product_type,
        COALESCE(l.service_type, 'Unknown') AS service_type
      FROM public.sla_link_monthly_fact l
      WHERE l.year_month >= $1
        AND l.year_month <= $2
      ORDER BY
        CASE COALESCE(l.product_group, 'FTTB')
          WHEN 'FTTB' THEN 1
          WHEN 'FTTH' THEN 2
          WHEN 'FTTC' THEN 3
          ELSE 4
        END,
        COALESCE(l.product_type, 'Unknown'),
        COALESCE(l.service_type, 'Unknown')
      `,
      fromKey,
      toKey
    )

    return {
      from: fromKey,
      to: toKey,
      productGroups: [...new Set(rows.map((row) => String(row.product_group || 'FTTB').trim()).filter(Boolean))],
      productTypes: [...new Set(rows.map((row) => String(row.product_type || 'Unknown').trim()).filter(Boolean))],
      serviceTypes: [...new Set(rows.map((row) => String(row.service_type || 'Unknown').trim()).filter(Boolean))]
    }
  })

  res.json(payload)
})

r.get('/overview/ops', verifyToken, async (req, res) => {
  const { fromKey, toKey } = resolveRange(req.query)
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const payload = await withCachedResponse('sla-overview-ops', {
    fromKey,
    toKey,
    productGroup,
    productType,
    serviceType
  }, async () => {
    const [ticketRows, outageRows] = await runSequentially([
      () => prisma.$queryRawUnsafe(
        `
        SELECT
          COUNT(*)::int AS ticket_count,
          COUNT(*) FILTER (WHERE COALESCE(t.service_impacting, false))::int AS service_impacting_ticket_count
        FROM public.sla_ticket_monthly_fact t
        WHERE t.year_month >= $1
          AND t.year_month <= $2
          AND ($3::text = '' OR COALESCE(t.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(t.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(t.service_type, 'Unknown') = $5)
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH filtered_outages AS (
          SELECT
            o.outage_ref,
            COALESCE(o.client_count, 0)::int AS client_count
          FROM public.sla_outage_link_monthly_fact o
          WHERE o.year_month >= $1
            AND o.year_month <= $2
            AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        ), outage_rollup AS (
          SELECT
            outage_ref,
            MAX(client_count)::int AS client_count
          FROM filtered_outages
          GROUP BY outage_ref
        )
        SELECT
          COALESCE((SELECT COUNT(*) FROM filtered_outages), 0)::int AS outage_impact_count,
          COUNT(*)::int AS outage_count,
          COUNT(*) FILTER (WHERE client_count < 20)::int AS minor_outage_count,
          COUNT(*) FILTER (WHERE client_count >= 20)::int AS major_outage_count
        FROM outage_rollup
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      )
    ])

    const ticketCard = ticketRows?.[0] || {}
    const outageCard = outageRows?.[0] || {}

    return {
      from: fromKey,
      to: toKey,
      cards: {
        ticketCount: toNum(ticketCard.ticket_count, 0),
        serviceImpactingTickets: toNum(ticketCard.service_impacting_ticket_count, 0),
        outageCount: toNum(outageCard.outage_count, 0),
        outageImpactCount: toNum(outageCard.outage_impact_count, 0),
        minorOutageCount: toNum(outageCard.minor_outage_count, 0),
        majorOutageCount: toNum(outageCard.major_outage_count, 0)
      }
    }
  })

  res.json(payload)
})

r.get('/overview/trend', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const payload = await withCachedResponse('sla-overview-trend', {
    fromKey,
    toKey,
    productGroup,
    productType,
    serviceType
  }, async () => {
    const [monthRows, outageRows] = await runSequentially([
      () => prisma.$queryRawUnsafe(
        `
        SELECT
          l.year_month,
          COUNT(*)::int AS total_links,
          COALESCE(ROUND(AVG(COALESCE(l.uptime_pct, 100))::numeric, 2), 0) AS avg_uptime_pct,
          COALESCE(SUM(CASE WHEN COALESCE(l.impacted, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS impacted_links,
          COALESCE(SUM(CASE WHEN COALESCE(l.breach, 0) > 0 THEN 1 ELSE 0 END), 0)::int AS breach_links,
          COALESCE(SUM(COALESCE(l.ticket_count, 0)), 0)::int AS ticket_count,
          COALESCE(SUM(COALESCE(l.service_impacting_ticket_count, 0)), 0)::int AS service_impacting_tickets,
          COALESCE(SUM(COALESCE(l.outage_impact_count, 0)), 0)::int AS outage_impact_count,
          COALESCE(SUM(COALESCE(l.unique_outage_link_count, 0)), 0)::int AS unique_outage_count
        FROM public.sla_link_monthly_fact l
        WHERE l.year_month >= $1
          AND l.year_month <= $2
          AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
        GROUP BY l.year_month
        ORDER BY l.year_month
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        SELECT
          o.year_month,
          COUNT(DISTINCT o.outage_ref)::int AS outage_count
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.year_month
        ORDER BY o.year_month
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      )
    ])

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
        ...monthMap[key],
        totalLinks: toNum(row.total_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        breachLinks: toNum(row.breach_links, 0),
        ticketCount: toNum(row.ticket_count, 0),
        serviceImpactingTickets: toNum(row.service_impacting_tickets, 0),
        outageImpactCount: toNum(row.outage_impact_count, 0),
        uniqueOutageCount: toNum(row.unique_outage_count, 0)
      }
    }

    for (const row of outageRows) {
      const key = String(row.year_month || '').trim()
      if (!monthMap[key]) continue
      monthMap[key] = {
        ...monthMap[key],
        outageCount: toNum(row.outage_count, 0)
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
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const payload = await withCachedResponse('sla-overview-isps', {
    fromKey,
    toKey,
    productGroup,
    productType,
    serviceType
  }, async () => {
    const rows = await prisma.$queryRawUnsafe(
      `
      WITH link_rollup AS (
        SELECT
          COALESCE(l.isp, 'Unknown') AS isp,
          l.frogfootlinklabel,
          AVG(COALESCE(l.uptime_pct, 100))::numeric AS avg_uptime_pct,
          MIN(COALESCE(l.uptime_pct, 100))::numeric AS worst_uptime_pct,
          SUM(COALESCE(l.breach, 0))::int AS breach_months,
          SUM(COALESCE(l.total_downtime_hours, 0))::numeric AS downtime_hours
        FROM public.sla_link_monthly_fact l
        WHERE l.year_month >= $1
          AND l.year_month <= $2
          AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
        GROUP BY 1, 2
      )
      SELECT
        isp,
        COUNT(*)::int AS link_count,
        COALESCE(ROUND(AVG(avg_uptime_pct)::numeric, 2), 0) AS avg_uptime_pct,
        COALESCE(ROUND(MIN(worst_uptime_pct)::numeric, 2), 0) AS worst_uptime_pct,
        COALESCE(SUM(CASE WHEN breach_months > 0 THEN 1 ELSE 0 END), 0)::int AS breach_links,
        COALESCE(ROUND(SUM(downtime_hours)::numeric, 2), 0) AS downtime_hours
      FROM link_rollup
      GROUP BY isp
      ORDER BY avg_uptime_pct ASC NULLS LAST, downtime_hours DESC, isp ASC
      LIMIT 8
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    )

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
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const payload = await withCachedResponse('sla-overview-groups', {
    fromKey,
    toKey,
    productGroup,
    productType,
    serviceType
  }, async () => {
    const [productRows, serviceRows] = await runSequentially([
      () => prisma.$queryRawUnsafe(
        `
        WITH link_rollup AS (
          SELECT
            COALESCE(l.product_group, 'FTTB') AS label,
            l.frogfootlinklabel,
            AVG(COALESCE(l.uptime_pct, 100))::numeric AS avg_uptime_pct,
            MIN(COALESCE(l.uptime_pct, 100))::numeric AS worst_uptime_pct,
            SUM(COALESCE(l.impacted, 0))::int AS impacted_months
          FROM public.sla_link_monthly_fact l
          WHERE l.year_month >= $1
            AND l.year_month <= $2
            AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
          GROUP BY 1, 2
        )
        SELECT
          label,
          COUNT(*)::int AS link_count,
          COALESCE(SUM(CASE WHEN impacted_months > 0 THEN 1 ELSE 0 END), 0)::int AS impacted_links,
          COALESCE(ROUND(AVG(avg_uptime_pct)::numeric, 2), 0) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(worst_uptime_pct)::numeric, 2), 0) AS worst_uptime_pct
        FROM link_rollup
        GROUP BY label
        ORDER BY
          CASE label
            WHEN 'FTTB' THEN 1
            WHEN 'FTTH' THEN 2
            WHEN 'FTTC' THEN 3
            ELSE 4
          END,
          label ASC
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH link_rollup AS (
          SELECT
            COALESCE(l.service_type, 'Unknown') AS label,
            l.frogfootlinklabel,
            AVG(COALESCE(l.uptime_pct, 100))::numeric AS avg_uptime_pct,
            MIN(COALESCE(l.uptime_pct, 100))::numeric AS worst_uptime_pct,
            SUM(COALESCE(l.impacted, 0))::int AS impacted_months
          FROM public.sla_link_monthly_fact l
          WHERE l.year_month >= $1
            AND l.year_month <= $2
            AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
          GROUP BY 1, 2
        )
        SELECT
          label,
          COUNT(*)::int AS link_count,
          COALESCE(SUM(CASE WHEN impacted_months > 0 THEN 1 ELSE 0 END), 0)::int AS impacted_links,
          COALESCE(ROUND(AVG(avg_uptime_pct)::numeric, 2), 0) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(worst_uptime_pct)::numeric, 2), 0) AS worst_uptime_pct
        FROM link_rollup
        GROUP BY label
        ORDER BY impacted_links DESC, link_count DESC, label ASC
        LIMIT 12
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
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
      servicePerformance: serviceRows.map((row) => ({
        label: String(row.label || 'Unknown'),
        linkCount: toNum(row.link_count, 0),
        impactedLinks: toNum(row.impacted_links, 0),
        avgUptimePct: toNum(row.avg_uptime_pct, 0),
        worstUptimePct: toNum(row.worst_uptime_pct, 0)
      }))
    }
  })

  res.json(payload)
})

r.get('/breaches', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)
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
  const thresholdValue = Number.isFinite(threshold) ? threshold : SLA_TARGET

  const [countRows, rows] = await runSequentially([
    () => prisma.$queryRawUnsafe(
      `
      WITH link_rollup AS (
        SELECT
          COALESCE(l.isp, 'Unknown') AS isp,
          l.frogfootlinklabel,
          AVG(COALESCE(l.uptime_pct, 100))::numeric AS avg_uptime_pct
        FROM public.sla_link_monthly_fact l
        WHERE l.year_month >= $1
          AND l.year_month <= $2
          AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
          AND ($6::text = '' OR l.frogfootlinklabel ILIKE $7 ESCAPE '\\' OR COALESCE(l.isp, 'Unknown') ILIKE $7 ESCAPE '\\')
        GROUP BY 1, 2
      )
      SELECT COUNT(*)::int AS total_count
      FROM link_rollup
      WHERE avg_uptime_pct < $8::numeric
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType,
      search,
      searchLike,
      thresholdValue
    ),
    () => prisma.$queryRawUnsafe(
      `
      WITH link_month AS (
        SELECT
          COALESCE(l.isp, 'Unknown') AS isp,
          l.frogfootlinklabel,
          COALESCE(l.product_group, 'FTTB') AS product_group,
          COALESCE(l.product_type, 'Unknown') AS product_type,
          COALESCE(l.service_type, 'Unknown') AS service_type,
          l.year_month,
          COALESCE(l.uptime_pct, 100)::numeric AS uptime_pct,
          COALESCE(l.total_downtime_hours, 0)::numeric AS total_downtime_hours
        FROM public.sla_link_monthly_fact l
        WHERE l.year_month >= $1
          AND l.year_month <= $2
          AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
          AND ($6::text = '' OR l.frogfootlinklabel ILIKE $7 ESCAPE '\\' OR COALESCE(l.isp, 'Unknown') ILIKE $7 ESCAPE '\\')
      ),
      link_rollup AS (
        SELECT
          isp,
          frogfootlinklabel,
          MIN(product_group) AS product_group,
          MIN(product_type) AS product_type,
          MIN(service_type) AS service_type,
          COALESCE(ROUND(AVG(uptime_pct)::numeric, 2), 0) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(uptime_pct)::numeric, 2), 0) AS worst_uptime_pct,
          COALESCE(SUM(CASE WHEN uptime_pct < 100 THEN 1 ELSE 0 END), 0)::int AS impacted_months,
          COALESCE(SUM(CASE WHEN uptime_pct < $8::numeric THEN 1 ELSE 0 END), 0)::int AS below_threshold_months,
          COALESCE(ROUND(SUM(total_downtime_hours)::numeric, 2), 0) AS total_downtime_hours
        FROM link_month
        GROUP BY 1, 2
      ),
      ticket_counts AS (
        SELECT
          t.frg,
          COUNT(*)::int AS ticket_count,
          COUNT(*) FILTER (WHERE COALESCE(t.service_impacting, false))::int AS service_impacting_tickets
        FROM public.sla_ticket_monthly_fact t
        WHERE t.year_month >= $1
          AND t.year_month <= $2
          AND ($3::text = '' OR COALESCE(t.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(t.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(t.service_type, 'Unknown') = $5)
        GROUP BY t.frg
      ),
      outage_counts AS (
        SELECT
          o.frogfootlinklabel,
          COUNT(DISTINCT o.outage_ref)::int AS outage_count
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.frogfootlinklabel
      ),
      paged_links AS (
        SELECT
          lr.*
        FROM link_rollup lr
        WHERE lr.avg_uptime_pct < $8::numeric
        ORDER BY lr.avg_uptime_pct ASC, lr.worst_uptime_pct ASC, lr.total_downtime_hours DESC, lr.frogfootlinklabel ASC
        LIMIT $9
        OFFSET $10
      )
      SELECT
        pl.isp,
        pl.frogfootlinklabel,
        pl.product_group,
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
        COALESCE(ROUND(lm.uptime_pct::numeric, 2), 0) AS uptime_pct
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
      productGroup,
      productType,
      serviceType,
      search,
      searchLike,
      thresholdValue,
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
        productGroup: String(row.product_group || 'FTTB'),
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
    threshold: thresholdValue,
    page,
    pageSize,
    totalCount: toNum(countRows?.[0]?.total_count, links.length),
    links
  })
})
r.get('/outages/analytics', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const [monthRows, impactRows, causeRows, regionRows, partyRows, topRows] = await runSequentially([
    () => prisma.$queryRawUnsafe(
      `
      WITH outage_rollup AS (
        SELECT
          o.year_month,
          o.outage_ref,
          MAX(COALESCE(o.impact_type, 'Unknown')) AS impact_type,
          MAX(COALESCE(o.cause_class, 'Unknown')) AS cause_class,
          MAX(COALESCE(o.outage_region, 'Unknown')) AS region,
          MAX(COALESCE(o.party_at_fault, 'Unknown')) AS party_at_fault,
          MIN(o.impact_start) AS impact_start,
          MAX(o.impact_stop) AS impact_stop,
          COUNT(DISTINCT o.frogfootlinklabel)::int AS affected_links,
          MAX(COALESCE(o.duration_hours, 0))::numeric AS duration_hours
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.year_month, o.outage_ref
      )
      SELECT
        year_month,
        COUNT(*)::int AS outage_count,
        COALESCE(SUM(affected_links), 0)::int AS affected_links,
        COALESCE(ROUND(SUM(duration_hours)::numeric, 2), 0) AS downtime_hours
      FROM outage_rollup
      GROUP BY year_month
      ORDER BY year_month
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      WITH outage_rollup AS (
        SELECT
          o.outage_ref,
          MAX(COALESCE(o.impact_type, 'Unknown')) AS label,
          COUNT(DISTINCT o.frogfootlinklabel)::int AS affected_links,
          MAX(COALESCE(o.duration_hours, 0))::numeric AS duration_hours
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        COALESCE(SUM(affected_links), 0)::int AS affected_links,
        COALESCE(ROUND(SUM(duration_hours)::numeric, 2), 0) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      WITH outage_rollup AS (
        SELECT
          o.outage_ref,
          MAX(COALESCE(o.cause_class, 'Unknown')) AS label,
          COUNT(DISTINCT o.frogfootlinklabel)::int AS affected_links,
          MAX(COALESCE(o.duration_hours, 0))::numeric AS duration_hours
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        COALESCE(SUM(affected_links), 0)::int AS affected_links,
        COALESCE(ROUND(SUM(duration_hours)::numeric, 2), 0) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      WITH outage_rollup AS (
        SELECT
          o.outage_ref,
          MAX(COALESCE(o.outage_region, 'Unknown')) AS label,
          COUNT(DISTINCT o.frogfootlinklabel)::int AS affected_links,
          MAX(COALESCE(o.duration_hours, 0))::numeric AS duration_hours
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        COALESCE(SUM(affected_links), 0)::int AS affected_links,
        COALESCE(ROUND(SUM(duration_hours)::numeric, 2), 0) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      WITH outage_rollup AS (
        SELECT
          o.outage_ref,
          MAX(COALESCE(o.party_at_fault, 'Unknown')) AS label,
          COUNT(DISTINCT o.frogfootlinklabel)::int AS affected_links,
          MAX(COALESCE(o.duration_hours, 0))::numeric AS duration_hours
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.outage_ref
      )
      SELECT
        label,
        COUNT(*)::int AS outage_count,
        COALESCE(SUM(affected_links), 0)::int AS affected_links,
        COALESCE(ROUND(SUM(duration_hours)::numeric, 2), 0) AS downtime_hours
      FROM outage_rollup
      GROUP BY label
      ORDER BY outage_count DESC, affected_links DESC, label ASC
      LIMIT 10
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      WITH outage_rollup AS (
        SELECT
          o.outage_ref,
          MAX(o.year_month) AS year_month,
          MIN(o.impact_start) AS impact_start,
          MAX(o.impact_stop) AS impact_stop,
          MAX(COALESCE(o.impact_type, 'Unknown')) AS impact_type,
          MAX(COALESCE(o.cause_class, 'Unknown')) AS cause_class,
          MAX(COALESCE(o.outage_region, 'Unknown')) AS region,
          MAX(COALESCE(o.party_at_fault, 'Unknown')) AS party_at_fault,
          MAX(COALESCE(o.summary, '')) AS summary,
          COUNT(DISTINCT o.frogfootlinklabel)::int AS affected_links,
          MAX(COALESCE(o.duration_hours, 0))::numeric AS duration_hours
        FROM public.sla_outage_link_monthly_fact o
        WHERE o.year_month >= $1
          AND o.year_month <= $2
          AND ($3::text = '' OR COALESCE(o.product_group, 'FTTB') = $3)
          AND ($4::text = '' OR COALESCE(o.product_type, 'Unknown') = $4)
          AND ($5::text = '' OR COALESCE(o.service_type, 'Unknown') = $5)
        GROUP BY o.outage_ref
      )
      SELECT
        outage_ref,
        year_month,
        impact_start,
        impact_stop,
        impact_type,
        cause_class,
        region,
        party_at_fault,
        summary,
        affected_links,
        COALESCE(ROUND(duration_hours::numeric, 2), 0) AS duration_hours
      FROM outage_rollup
      ORDER BY affected_links DESC, duration_hours DESC, impact_start DESC NULLS LAST
      LIMIT 25
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
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
  const { fromKey, toKey, months } = resolveRange(req.query)
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const [monthRows, categoryRows, severityRows, partyRows, topRows] = await runSequentially([
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        t.year_month,
        COUNT(*)::int AS ticket_count,
        COUNT(*) FILTER (WHERE COALESCE(t.service_impacting, false))::int AS service_impacting_tickets,
        COUNT(*) FILTER (WHERE COALESCE(t.excluded_hours, 0) > 0)::int AS excluded_tickets,
        COUNT(*) FILTER (WHERE COALESCE(t.excluded_hours, 0) > 0)::int AS access_adjusted_tickets,
        COALESCE(ROUND(AVG(COALESCE(t.final_hours, 0))::numeric, 2), 0) AS avg_final_downtime_hours
      FROM public.sla_ticket_monthly_fact t
      WHERE t.year_month >= $1
        AND t.year_month <= $2
        AND ($3::text = '' OR COALESCE(t.product_group, 'FTTB') = $3)
        AND ($4::text = '' OR COALESCE(t.product_type, 'Unknown') = $4)
        AND ($5::text = '' OR COALESCE(t.service_type, 'Unknown') = $5)
      GROUP BY t.year_month
      ORDER BY t.year_month
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE(t.category, 'Unknown') AS label,
        COUNT(*)::int AS ticket_count
      FROM public.sla_ticket_monthly_fact t
      WHERE t.year_month >= $1
        AND t.year_month <= $2
        AND ($3::text = '' OR COALESCE(t.product_group, 'FTTB') = $3)
        AND ($4::text = '' OR COALESCE(t.product_type, 'Unknown') = $4)
        AND ($5::text = '' OR COALESCE(t.service_type, 'Unknown') = $5)
      GROUP BY COALESCE(t.category, 'Unknown')
      ORDER BY ticket_count DESC, label ASC
      LIMIT 12
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE(t.severity, 'Unknown') AS label,
        COUNT(*)::int AS ticket_count
      FROM public.sla_ticket_monthly_fact t
      WHERE t.year_month >= $1
        AND t.year_month <= $2
        AND ($3::text = '' OR COALESCE(t.product_group, 'FTTB') = $3)
        AND ($4::text = '' OR COALESCE(t.product_type, 'Unknown') = $4)
        AND ($5::text = '' OR COALESCE(t.service_type, 'Unknown') = $5)
      GROUP BY COALESCE(t.severity, 'Unknown')
      ORDER BY ticket_count DESC, label ASC
      LIMIT 12
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        COALESCE(t.party_at_fault, 'Unknown') AS label,
        COUNT(*)::int AS ticket_count
      FROM public.sla_ticket_monthly_fact t
      WHERE t.year_month >= $1
        AND t.year_month <= $2
        AND ($3::text = '' OR COALESCE(t.product_group, 'FTTB') = $3)
        AND ($4::text = '' OR COALESCE(t.product_type, 'Unknown') = $4)
        AND ($5::text = '' OR COALESCE(t.service_type, 'Unknown') = $5)
      GROUP BY COALESCE(t.party_at_fault, 'Unknown')
      ORDER BY ticket_count DESC, label ASC
      LIMIT 12
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
    ),
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        t.ticket_id,
        t.frg,
        t.year_month,
        t.created_date,
        t.impact_stop_time,
        COALESCE(t.category, 'Unknown') AS category,
        COALESCE(t.severity, 'Unknown') AS severity,
        COALESCE(t.party_at_fault, 'Unknown') AS party_at_fault,
        COALESCE(t.product_group, 'FTTB') AS product_group,
        COALESCE(t.product_type, 'Unknown') AS product_type,
        COALESCE(t.service_type, 'Unknown') AS service_type,
        COALESCE(t.site_access_times, 'Unknown') AS site_access_times,
        COALESCE(t.site_access_schedule, 'Unknown') AS site_access_schedule,
        COALESCE(ROUND(t.raw_hours::numeric, 2), 0) AS raw_hours,
        COALESCE(ROUND(t.excluded_hours::numeric, 2), 0) AS excluded_hours,
        COALESCE(ROUND(t.final_hours::numeric, 2), 0) AS final_hours
      FROM public.sla_ticket_monthly_fact t
      WHERE t.year_month >= $1
        AND t.year_month <= $2
        AND ($3::text = '' OR COALESCE(t.product_group, 'FTTB') = $3)
        AND ($4::text = '' OR COALESCE(t.product_type, 'Unknown') = $4)
        AND ($5::text = '' OR COALESCE(t.service_type, 'Unknown') = $5)
      ORDER BY t.final_hours DESC, t.excluded_hours DESC, t.created_date DESC NULLS LAST
      LIMIT 25
      `,
      fromKey,
      toKey,
      productGroup,
      productType,
      serviceType
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
      productGroup: String(row.product_group || 'FTTB'),
      productType: String(row.product_type || 'Unknown'),
      serviceType: String(row.service_type || 'Unknown'),
      siteAccessTimes: String(row.site_access_times || 'Unknown'),
      siteAccessSchedule: String(row.site_access_schedule || 'Unknown'),
      rawHours: toNum(row.raw_hours, 0),
      excludedHours: toNum(row.excluded_hours, 0),
      finalHours: toNum(row.final_hours, 0)
    }))
  })
})
r.get('/summary', verifyToken, async (req, res) => {
  const { fromKey, toKey, months } = resolveRange(req.query)
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const payload = await withCachedResponse('sla-summary', {
    fromKey,
    toKey,
    productGroup,
    productType,
    serviceType
  }, async () => {
    const [rows, optionRows] = await runSequentially([
      () => prisma.$queryRawUnsafe(
        `
        WITH link_rollup AS (
          SELECT
            COALESCE(l.isp, 'Unknown') AS isp,
            l.frogfootlinklabel,
            AVG(COALESCE(l.uptime_pct, 100))::numeric AS avg_uptime_pct,
            MIN(COALESCE(l.uptime_pct, 100))::numeric AS worst_uptime_pct,
            SUM(COALESCE(l.impacted, 0))::int AS impacted_months,
            SUM(COALESCE(l.total_downtime_hours, 0))::numeric AS downtime_hours
          FROM public.sla_link_monthly_fact l
          WHERE l.year_month >= $1
            AND l.year_month <= $2
            AND ($3::text = '' OR COALESCE(l.product_group, 'FTTB') = $3)
            AND ($4::text = '' OR COALESCE(l.product_type, 'Unknown') = $4)
            AND ($5::text = '' OR COALESCE(l.service_type, 'Unknown') = $5)
          GROUP BY 1, 2
        )
        SELECT
          isp,
          COUNT(*)::int AS link_count,
          COALESCE(SUM(CASE WHEN impacted_months > 0 THEN 1 ELSE 0 END), 0)::int AS impacted_links,
          COALESCE(ROUND(AVG(avg_uptime_pct)::numeric, 2), 0) AS avg_uptime_pct,
          COALESCE(ROUND(MIN(worst_uptime_pct)::numeric, 2), 0) AS worst_uptime_pct,
          COALESCE(ROUND(SUM(downtime_hours)::numeric, 2), 0) AS total_downtime_hours
        FROM link_rollup
        GROUP BY isp
        ORDER BY isp ASC
        `,
        fromKey,
        toKey,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        SELECT DISTINCT
          COALESCE(l.product_group, 'FTTB') AS product_group,
          COALESCE(l.product_type, 'Unknown') AS product_type,
          COALESCE(l.service_type, 'Unknown') AS service_type
        FROM public.sla_link_monthly_fact l
        WHERE l.year_month >= $1
          AND l.year_month <= $2
        ORDER BY
          CASE COALESCE(l.product_group, 'FTTB')
            WHEN 'FTTB' THEN 1
            WHEN 'FTTH' THEN 2
            WHEN 'FTTC' THEN 3
            ELSE 4
          END,
          COALESCE(l.product_type, 'Unknown'),
          COALESCE(l.service_type, 'Unknown')
        `,
        fromKey,
        toKey
      )
    ])

    return {
      from: fromKey,
      to: toKey,
      months,
      productGroups: [...new Set(optionRows.map((row) => String(row.product_group || 'FTTB').trim()).filter(Boolean))],
      productTypes: [...new Set(optionRows.map((row) => String(row.product_type || 'Unknown').trim()).filter(Boolean))],
      serviceTypes: [...new Set(optionRows.map((row) => String(row.service_type || 'Unknown').trim()).filter(Boolean))],
      selectedProductGroup: productGroup,
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
  const { productGroup, productType, serviceType } = getSlaDimensionFilters(req.query)

  const payload = await withCachedResponse('sla-isp-links', {
    ispName,
    fromKey,
    toKey,
    page,
    pageSize,
    frgSearch,
    productGroup,
    productType,
    serviceType
  }, async () => {
    const [countRows, rows] = await runSequentially([
      () => prisma.$queryRawUnsafe(
        `
        SELECT COUNT(DISTINCT l.frogfootlinklabel)::int AS total_count
        FROM public.sla_link_monthly_fact l
        WHERE l.frogfootlinklabel IS NOT NULL
          AND COALESCE(l.isp, 'Unknown') = $1
          AND l.year_month >= $2
          AND l.year_month <= $3
          AND ($4::text = '' OR l.frogfootlinklabel ILIKE $5 ESCAPE '\\')
          AND ($6::text = '' OR COALESCE(l.product_group, 'FTTB') = $6)
          AND ($7::text = '' OR COALESCE(l.product_type, 'Unknown') = $7)
          AND ($8::text = '' OR COALESCE(l.service_type, 'Unknown') = $8)
        `,
        ispName,
        fromKey,
        toKey,
        frgSearch,
        frgLike,
        productGroup,
        productType,
        serviceType
      ),
      () => prisma.$queryRawUnsafe(
        `
        WITH link_month AS (
          SELECT
            l.frogfootlinklabel,
            l.year_month,
            COALESCE(l.uptime_pct, 100)::numeric AS uptime_pct,
            COALESCE(l.total_downtime_hours, 0)::numeric AS total_downtime_hours
          FROM public.sla_link_monthly_fact l
          WHERE l.frogfootlinklabel IS NOT NULL
            AND COALESCE(l.isp, 'Unknown') = $1
            AND l.year_month >= $2
            AND l.year_month <= $3
            AND ($4::text = '' OR l.frogfootlinklabel ILIKE $5 ESCAPE '\\')
            AND ($6::text = '' OR COALESCE(l.product_group, 'FTTB') = $6)
            AND ($7::text = '' OR COALESCE(l.product_type, 'Unknown') = $7)
            AND ($8::text = '' OR COALESCE(l.service_type, 'Unknown') = $8)
        ),
        link_rollup AS (
          SELECT
            frogfootlinklabel,
            COALESCE(ROUND(AVG(uptime_pct)::numeric, 2), 0) AS avg_uptime_pct,
            COALESCE(ROUND(MIN(uptime_pct)::numeric, 2), 0) AS worst_uptime_pct,
            COALESCE(SUM(CASE WHEN uptime_pct < 100 THEN 1 ELSE 0 END), 0)::int AS impacted_months,
            COALESCE(ROUND(SUM(total_downtime_hours)::numeric, 2), 0) AS total_downtime_hours
          FROM link_month
          GROUP BY frogfootlinklabel
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
          LIMIT $9
          OFFSET $10
        )
        SELECT
          pl.frogfootlinklabel,
          pl.avg_uptime_pct,
          pl.worst_uptime_pct,
          pl.impacted_months,
          pl.total_downtime_hours,
          lm.year_month,
          COALESCE(ROUND(lm.uptime_pct::numeric, 2), 0) AS uptime_pct,
          COALESCE(ROUND(lm.total_downtime_hours::numeric, 2), 0) AS downtime_hours
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
        productGroup,
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

    return {
      isp: ispName,
      from: fromKey,
      to: toKey,
      months,
      page,
      pageSize,
      frgSearch,
      productGroup,
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

  const { fromKey, toKey, months } = resolveRange(req.query)

  const [slaRows, tickets, outages] = await runSequentially([
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        year_month,
        COALESCE(ROUND(AVG(COALESCE(uptime_pct, 100))::numeric, 2), 0) AS uptime_pct,
        COALESCE(ROUND(SUM(COALESCE(total_downtime_hours, 0))::numeric, 2), 0) AS downtime_hours,
        COALESCE(ROUND(SUM(COALESCE(active_hours, 0))::numeric, 2), 0) AS active_hours
      FROM public.sla_link_monthly_fact
      WHERE frogfootlinklabel = $1
        AND year_month >= $2
        AND year_month <= $3
      GROUP BY year_month
      ORDER BY year_month
      `,
      frg,
      fromKey,
      toKey
    ),
    () => prisma.$queryRawUnsafe(
      `
      SELECT
        frg,
        ticket_id,
        created_date,
        impact_stop_time,
        year_month,
        category,
        product_group,
        product_type,
        service_type,
        site_access_times,
        site_access_schedule,
        raw_hours,
        excluded_hours,
        final_hours,
        severity,
        party_at_fault
      FROM public.sla_ticket_monthly_fact
      WHERE frg = $1
        AND year_month >= $2
        AND year_month <= $3
      ORDER BY created_date ASC NULLS LAST, ticket_id ASC
      `,
      frg,
      fromKey,
      toKey
    ),
    () => prisma.$queryRawUnsafe(
      `
      SELECT DISTINCT ON (so.frogfootlinklabel, so.outage_ref)
        so.frogfootlinklabel,
        so.outage_ref,
        NULL::timestamp AS changestarted,
        NULL::timestamp AS resolveddate,
        oo.ffticket,
        oo.outagetitle,
        so.impact_start,
        so.impact_stop,
        so.year_month,
        so.impact_type,
        oo.force_majeure,
        so.cause_class,
        so.cause_class_sub,
        so.outage_region AS region,
        oo.node,
        so.summary,
        so.party_at_fault,
        oo.infrastructure_owner,
        oo.network_segment
      FROM public.sla_outage_link_monthly_fact so
      LEFT JOIN public.outages_outage oo
        ON oo.outage_ref = so.outage_ref
      WHERE so.frogfootlinklabel = $1
        AND so.year_month >= $2
        AND so.year_month <= $3
      ORDER BY so.frogfootlinklabel, so.outage_ref, so.impact_start DESC NULLS LAST
      `,
      frg,
      fromKey,
      toKey
    )
  ])

  const slaByMonth = Object.fromEntries(
    slaRows.map((row) => [
      String(row.year_month),
      {
        uptimePct: toNum(row.uptime_pct, null),
        downtimeHours: Number(toNum(row.downtime_hours, 0).toFixed(2)),
        activeHours: Number(toNum(row.active_hours, 0).toFixed(2))
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
      .filter((o) => rangesOverlap(range?.start, range?.end, o._range?.start, o._range?.end))
      .map((o) => String(o.outage_ref))
    return {
      ...t,
      _range: range,
      linkedOutageRef,
      overlapOutageRefs,
      _month: monthKeyFromDate(t.impact_stop_time || t.created_date) || String(t.year_month || '')
    }
  })

  const details = {}
  for (const month of months) {
    details[month] = {
      yearMonth: month,
      sla: slaByMonth[month] || { uptimePct: null, downtimeHours: 0, activeHours: 0 },
      tickets: [],
      outages: [],
      overlap: {
        linkedTickets: 0,
        overlapTickets: 0,
        overlapPairs: 0
      }
    }
  }

  for (const outage of normalizedOutages) {
    const month = details[outage._month] ? outage._month : null
    if (!month) continue
    const { _range, _month, ...pub } = outage
    details[month].outages.push(pub)
  }

  for (const ticket of normalizedTickets) {
    const month = details[ticket._month] ? ticket._month : null
    if (!month) continue
    const { _range, _month, ...pub } = ticket
    details[month].tickets.push(pub)
  }

  for (const month of months) {
    const detail = details[month]
    detail.overlap.linkedTickets = detail.tickets.filter((ticket) => !!ticket.linkedOutageRef).length
    detail.overlap.overlapTickets = detail.tickets.filter((ticket) => (ticket.overlapOutageRefs || []).length > 0).length
    detail.overlap.overlapPairs = detail.tickets.reduce((acc, ticket) => acc + (ticket.overlapOutageRefs || []).length, 0)
  }

  res.json({
    frogfootlinklabel: frg,
    from: fromKey,
    to: toKey,
    months,
    details: months.map((month) => details[month])
  })
})

export default r
