// server/src/routes/nlds.js
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const r = Router()

/**
 * Quick config – rename these if your table names differ.
 * All queries are best effort: if a table is missing, we fall back gracefully.
 */
const TABLES = {
  lightLevels: 'public.daily_light_level',          // columns: circuit_id, measured_at, a_rx, b_rx
  circuitUptimeDaily: 'public.servicelevels_circuit_daily', // columns: circuit_id, period_date, uptime_pct
  nldUptimeDaily: 'public.servicelevels_nld_daily',         // columns: nld_group, period_date, uptime_pct
}
const UPTIME_WINDOW_DAYS = 30  // change to 7, 30, 'MoTD', etc.

async function safeQuery(sql, params = []) {
  try {
    // prisma.$queryRaw`...` is better for parameterization
    // but we keep this generic since we construct SQL strings
    /* eslint-disable no-unsafe-finally */
    const rows = await prisma.$queryRawUnsafe(sql, ...params)
    return rows ?? []
  } catch (err) {
    console.warn('nlds: optional query failed:', err?.message || err)
    return []
  }
}

function toMap(rows, key, val = x => x) {
  const m = new Map()
  for (const r of rows) m.set(String(r[key]), val(r))
  return m
}

r.get('/nlds.json', async (_req, res, next) => {
  try {
    // 1) Core datasets
    const circuits = await prisma.circuit.findMany({
      select: { circuitId: true, nodeA: true, nodeB: true, nldGroup: true, techType: true },
    })

    const nodes = await prisma.node.findMany()
    const byCode = new Map(nodes.map(n => [n.code, n]))
    const byName = new Map(nodes.map(n => [n.name, n]))

    const resolveNode = (k) => (k && (byCode.get(k) || byName.get(k))) || null

    // 2) Optional: latest Rx per circuit side
    const lvSql = `
      SELECT DISTINCT ON (circuit_id)
             circuit_id,
             measured_at,
             a_rx,
             b_rx
      FROM ${TABLES.lightLevels}
      ORDER BY circuit_id, measured_at DESC
    `
    const latestLevels = await safeQuery(lvSql)
    const levelsByCircuit = toMap(latestLevels, 'circuit_id', r => ({
      aRx: r?.a_rx ?? null,
      bRx: r?.b_rx ?? null,
      measuredAt: r?.measured_at ?? null,
    }))

    // 3) Optional: circuit uptime last N days
    const cuSql = `
      SELECT circuit_id, AVG(uptime_pct)::float AS uptime
      FROM ${TABLES.circuitUptimeDaily}
      WHERE period_date >= CURRENT_DATE - INTERVAL '${UPTIME_WINDOW_DAYS} days'
      GROUP BY circuit_id
    `
    const circuitUptime = await safeQuery(cuSql)
    const uptimeByCircuit = toMap(circuitUptime, 'circuit_id', r => Number(r?.uptime))

    // 4) Optional: NLD uptime last N days
    const nuSql = `
      SELECT nld_group, AVG(uptime_pct)::float AS uptime
      FROM ${TABLES.nldUptimeDaily}
      WHERE period_date >= CURRENT_DATE - INTERVAL '${UPTIME_WINDOW_DAYS} days'
      GROUP BY nld_group
    `
    const nldUptime = await safeQuery(nuSql)
    const uptimeByNld = toMap(nldUptime, 'nld_group', r => Number(r?.uptime))

    // 5) Build spans
    const spans = circuits.map(c => {
      const na = resolveNode(c.nodeA)
      const nb = resolveNode(c.nodeB)
      const lv = levelsByCircuit.get(c.circuitId) || null
      const nldUp = uptimeByNld.get(c.nldGroup) ?? null
      const circUp = uptimeByCircuit.get(c.circuitId) ?? null

      return {
        circuitId: c.circuitId,
        nldGroup: c.nldGroup ?? 'Unassigned',
        techType: c.techType,
        nodeA: na ? { code: na.code, name: na.name, lat: na.lat, lon: na.lon } : { name: c.nodeA },
        nodeB: nb ? { code: nb.code, name: nb.name, lat: nb.lat, lon: nb.lon } : { name: c.nodeB },
        stats: {
          nld:     nldUp != null ? { windowDays: UPTIME_WINDOW_DAYS, uptimePct: nldUp } : undefined,
          circuit: circUp != null ? { windowDays: UPTIME_WINDOW_DAYS, uptimePct: circUp } : undefined,
        },
        levels: lv ?? undefined,
      }
    })

    res.json(spans)
  } catch (e) {
    next(e)
  }
})

export default r
