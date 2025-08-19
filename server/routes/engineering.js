// server/routes/engineering.js
import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'

function requireEngineering(req, res, next) {
  if ((req.user?.role || '').toLowerCase() !== 'engineering')
    return res.status(403).json({ error: 'Engineering role required' })
  next()
}

const r = Router()

/* ---------- read endpoints (public) ---------------------- */
r.get('/circuits', async (_, res) => {
  const circuits = await prisma.circuit.findMany({
    select: {
      id: true,
      circuitId: true,
      nodeA: true,
      nodeB: true,
      techType: true,
      currentRxSiteA: true,
      currentRxSiteB: true,
      updatedAt: true,
      nldGroup: true,

        nodeALat: true,
        nodeALon: true,
        nodeBLat: true,
        nodeBLon: true,

      // Count of history excluding the initial import (unchanged)
      _count: {
        select: {
          levelHistory: {
            where: { reason: { not: 'initial import' } }
          }
        }
      },

      // Initial import record (baseline for deltas)
      levelHistory: {
        where: { reason: 'initial import' },
        orderBy: { changedAt: 'asc' },
        take: 1,
        select: { rxSiteA: true, rxSiteB: true, changedAt: true }
      },

      // NEW: latest light-level event date
      lightEvents: {
        select: { eventDate: true },
        orderBy: { eventDate: 'desc' },
        take: 1
      },

      dailyLevels: {
      select: { sampleTime: true, side: true, rx: true },
      orderBy: { sampleTime: 'desc' },
      take: 2  // we only need A and B latest
    }
    },
    orderBy: [{ nldGroup: 'asc' }, { circuitId: 'asc' }]
  })

  // Flatten initial import info and compute lastEventAt
  const shaped = circuits.map(c => {
    const init = c.levelHistory?.[0] ?? null
    const latestEventAt = c.lightEvents?.[0]?.eventDate ?? null

    // Only show lastEventAt if it is strictly AFTER the initial import
    let lastEventAt = latestEventAt
    if (init?.changedAt && latestEventAt) {
      const initTs = new Date(init.changedAt).getTime()
      const eventTs = new Date(latestEventAt).getTime()
      if (!(eventTs > initTs)) lastEventAt = null
    }

    // Drop the arrays from the payload to keep it clean
    const { levelHistory, lightEvents, ...rest } = c

    return {
      ...rest,
      initRxSiteA: init?.rxSiteA ?? null,
      initRxSiteB: init?.rxSiteB ?? null,
      initial: init,          // { rxSiteA, rxSiteB, changedAt } or null
      lastEventAt             // Date | null
    }
  })

  res.json(shaped)
})


r.get('/circuit/:id', async (req, res) => {
  const id = +req.params.id
  const c = await prisma.circuit.findUnique({
    where: { id },
    include: {
      levelHistory: { orderBy: { changedAt: 'desc' }, take: 20 },
      lightEvents: { orderBy: { eventDate: 'asc' }, take: 20 } // order any way you prefer
    }
  })
  if (!c) return res.sendStatus(404)
  res.json(c)
})

/* ---------- write endpoints (engineering only) ----------- */
r.post('/circuit/:id', verifyToken, requireEngineering, async (req, res) => {
  const id = +req.params.id
  const { currentRxSiteA, currentRxSiteB, changedAt, reason = 'manual edit' } = req.body

  const updated = await prisma.circuit.update({
    where: { id },
    data: {
      currentRxSiteA,
      currentRxSiteB,
      levelHistory: {
        create: {
          rxSiteA: currentRxSiteA,
          rxSiteB: currentRxSiteB,
          reason,
          source: 'web ui',
          changedById: req.user.id,
          ...(changedAt ? { changedAt: new Date(changedAt) } : {})
        }
      }
    }
  })

  res.json(updated)
})


r.post('/circuit/:id/comment', verifyToken, requireEngineering, async (req, res) => {
  const id = +req.params.id
  const { comment } = req.body
  await prisma.circuitLevelHistory.create({
    data: {
      circuitId: id, reason: comment, source: 'comment',
      changedById: req.user.id
    }
  })
  res.sendStatus(201)
})

// NEW: PATCH endpoint to update mapping fields like nldGroup
r.patch('/circuit/:id', verifyToken, requireEngineering, async (req, res) => {
  const id = +req.params.id

  // Whitelist fields you allow to be patched
  const allowed = [
    'nldGroup',
    'nodeALat', 'nodeALon', 'nodeBLat', 'nodeBLon',
    'currentRxSiteA', 'currentRxSiteB' // optional: if included, we’ll log history
  ]

  const data = {}
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      data[k] = req.body[k]
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No allowed fields provided to update' })
  }

  const addHistory =
    Object.prototype.hasOwnProperty.call(req.body, 'currentRxSiteA') ||
    Object.prototype.hasOwnProperty.call(req.body, 'currentRxSiteB')

  try {
    const updated = await prisma.circuit.update({
      where: { id },
      data: {
        ...data,
        ...(addHistory ? {
          levelHistory: {
            create: {
              rxSiteA: req.body.currentRxSiteA ?? undefined,
              rxSiteB: req.body.currentRxSiteB ?? undefined,
              reason: req.body.reason ?? 'manual edit (PATCH)',
              source: 'web ui',
              changedById: req.user.id
            }
          }
        } : {})
      },
      select: {
        id: true, circuitId: true, nldGroup: true,
        nodeALat: true, nodeALon: true, nodeBLat: true, nodeBLon: true,
        currentRxSiteA: true, currentRxSiteB: true, updatedAt: true
      }
    })
    res.json(updated)
  } catch (e) {
    if (e?.code === 'P2025') {
      return res.status(404).json({ error: 'Circuit not found' })
    }
    console.error(e)
    res.status(500).json({ error: 'Unexpected error' })
  }
})


// NEW: create a circuit
r.post('/circuits', verifyToken, requireEngineering, async (req, res) => {
  const {
    circuitId, nodeA, nodeB, techType = '', nldGroup = '',
    currentRxSiteA = null, currentRxSiteB = null,
    nodeALat = null, nodeALon = null, nodeBLat = null, nodeBLon = null,
  } = req.body || {}

  // basic validation
  if (!circuitId?.trim() || !nodeA?.trim() || !nodeB?.trim()) {
    return res.status(400).json({ error: 'circuitId, nodeA, nodeB are required' })
  }

  // bounds checks if provided
  const inRange = (n, min, max) => n === null || n === undefined || (Number.isFinite(Number(n)) && Number(n) >= min && Number(n) <= max)
  if (!inRange(nodeALat, -90, 90) || !inRange(nodeBLat, -90, 90)) {
    return res.status(400).json({ error: 'Latitudes must be between -90 and 90' })
  }
  if (!inRange(nodeALon, -180, 180) || !inRange(nodeBLon, -180, 180)) {
    return res.status(400).json({ error: 'Longitudes must be between -180 and 180' })
  }

  try {
    const created = await prisma.circuit.create({
      data: {
        circuitId, nodeA, nodeB, techType, nldGroup,
        currentRxSiteA, currentRxSiteB,
        nodeALat, nodeALon, nodeBLat, nodeBLon,
      },
      select: {
        id: true, circuitId: true, nodeA: true, nodeB: true, techType: true, nldGroup: true,
        currentRxSiteA: true, currentRxSiteB: true, updatedAt: true,
        nodeALat: true, nodeALon: true, nodeBLat: true, nodeBLon: true,
      }
    })
    res.status(201).json(created)
  } catch (e) {
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'Circuit ID must be unique' })
    }
    console.error(e)
    res.status(500).json({ error: 'Unexpected error' })
  }
})

r.post('/circuits/daily-light', verifyToken, requireEngineering, async (req, res) => {
  // body: { rows: [{ circuitId, side:'A'|'B', rx, mnemonic, routerName, parsedCode, sourceEmailId, sampleTime }...] }
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
  if (!rows.length) return res.status(400).json({ error: 'No rows' })

  try {
    // Upsert one by one (daily files are small). If you need speed, do a findMany + batch split by new vs existing.
    for (const r of rows) {
      const circuit = await prisma.circuit.findFirst({
        where: { id: r.circuitId }
      })
      if (!circuit) continue

      await prisma.dailyLightLevel.upsert({
        where: {
          circuitId_side_sampleTime: {
            circuitId: r.circuitId,
            side: r.side,
            sampleTime: new Date(r.sampleTime)
          }
        },
        update: {
          rx: r.rx,
          mnemonic: r.mnemonic ?? null,
          routerName: r.routerName ?? null,
          parsedCode: r.parsedCode ?? null,
          sourceEmailId: r.sourceEmailId ?? null,
        },
        create: {
          circuitId: r.circuitId,
          side: r.side,
          rx: r.rx,
          mnemonic: r.mnemonic ?? null,
          routerName: r.routerName ?? null,
          parsedCode: r.parsedCode ?? null,
          sourceEmailId: r.sourceEmailId ?? null,
          sampleTime: new Date(r.sampleTime)
        }
      })
    }
    res.sendStatus(204)
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Daily ingest failed' })
  }
})


export default r
