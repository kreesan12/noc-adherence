// server/routes/engineering.js
import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'
import {
  INITIAL_OVERRIDE_SOURCE,
  loadCircuitMonitoringRows
} from '../lib/nldCircuitState.js'

const irisMappingFields = [
  'irisGraphAId', 'irisGraphBId',
  'irisGraphALabel', 'irisGraphBLabel',
  'irisGraphADevice', 'irisGraphBDevice'
]

const optionalText = (value) => {
  if (value == null) return null
  const text = String(value).trim()
  return text || null
}

function requireEngineering(req, res, next) {
  const role = (req.user?.role || '').toLowerCase()
  if (!['engineering', 'admin', 'manager'].includes(role))
    return res.status(403).json({ error: 'Engineering, admin, or manager role required' })
  next()
}

const r = Router()

/* ---------- read endpoints (public) ---------------------- */
r.get('/circuits', async (_, res) => {
  const rows = await loadCircuitMonitoringRows(prisma)
  res.json(rows)
})


r.get('/circuit/:id', async (req, res) => {
  const id = +req.params.id
  const c = await prisma.circuit.findUnique({
    where: { id },
    include: {
      // This endpoint is opened on demand by the history drawer. Keep enough
      // samples for a useful circuit timeline without loading them for the grid.
      levelHistory: { orderBy: { changedAt: 'desc' }, take: 100 },
      lightEvents: { orderBy: { eventDate: 'asc' }, take: 100 },
      dailyLevels: { orderBy: { sampleTime: 'desc' }, take: 800 }
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

r.post('/circuit/:id/initial-values', verifyToken, requireEngineering, async (req, res) => {
  const id = +req.params.id
  const { initialRxSiteA, initialRxSiteB, changedAt, reason } = req.body || {}

  const numOrNull = (v) => {
    if (v === '' || v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const exists = await prisma.circuit.findUnique({
    where: { id },
    select: { id: true }
  })

  if (!exists) return res.status(404).json({ error: 'Circuit not found' })

  const override = await prisma.circuitLevelHistory.create({
    data: {
      circuitId: id,
      rxSiteA: numOrNull(initialRxSiteA),
      rxSiteB: numOrNull(initialRxSiteB),
      reason: String(reason || '').trim() || 'initial values override',
      source: INITIAL_OVERRIDE_SOURCE,
      changedById: req.user.id,
      changedAt: changedAt ? new Date(changedAt) : new Date()
    }
  })

  res.status(201).json(override)
})

// Manual light-level event insert from UI
r.post('/circuit/:id/light-event', verifyToken, requireEngineering, async (req, res) => {
  const id = +req.params.id

  const numOrNull = (v) => {
    if (v === '' || v == null) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const toIntOrNull = (v) => {
    if (v === '' || v == null) return null
    const n = Number(v)
    return Number.isInteger(n) ? n : null
  }

  const {
    ticketId,
    impactType,
    impactHours,
    eventDate,
    sideAPrev,
    sideACurr,
    sideBPrev,
    sideBCurr,
    reason = 'manual light event',
  } = req.body || {}

  try {
    const result = await prisma.$transaction(async (tx) => {
      const circuit = await tx.circuit.findUnique({ where: { id } })
      if (!circuit) return null

      const prevA = numOrNull(sideAPrev)
      const prevB = numOrNull(sideBPrev)
      const currAInput = numOrNull(sideACurr)
      const currBInput = numOrNull(sideBCurr)

      const nextA = currAInput ?? circuit.currentRxSiteA ?? null
      const nextB = currBInput ?? circuit.currentRxSiteB ?? null

      const sideADelta = (prevA == null || currAInput == null) ? null : (currAInput - prevA)
      const sideBDelta = (prevB == null || currBInput == null) ? null : (currBInput - prevB)

      const when = eventDate ? new Date(eventDate) : new Date()

      const event = await tx.lightLevelEvent.create({
        data: {
          circuitId: id,
          ticketId: toIntOrNull(ticketId),
          impactType: impactType || 'Manual',
          eventDate: when,
          sideAPrev: prevA,
          sideACurr: currAInput,
          sideBPrev: prevB,
          sideBCurr: currBInput,
          sideADelta,
          sideBDelta,
          impactHours: numOrNull(impactHours),
          sourceEmailId: 'manual-ui',
        }
      })

      await tx.circuit.update({
        where: { id },
        data: {
          currentRxSiteA: nextA,
          currentRxSiteB: nextB,
        }
      })

      await tx.circuitLevelHistory.create({
        data: {
          circuitId: id,
          rxSiteA: nextA,
          rxSiteB: nextB,
          reason,
          source: 'manual-event-ui',
          changedById: req.user.id,
          changedAt: when,
        }
      })

      return event
    })

    if (!result) return res.status(404).json({ error: 'Circuit not found' })
    return res.status(201).json(result)
  } catch (e) {
    console.error(e)
    return res.status(500).json({ error: 'Failed to insert manual light event' })
  }
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
    'currentRxSiteA', 'currentRxSiteB',
    'circuitId', 'nodeA', 'nodeB', 'techType',
    ...irisMappingFields
  ]

  const data = {}
  for (const k of allowed) {
    if (Object.prototype.hasOwnProperty.call(req.body, k)) {
      data[k] = irisMappingFields.includes(k) ? optionalText(req.body[k]) : req.body[k]
    }
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'No allowed fields provided to update' })
  }

  const addHistory =
    Object.prototype.hasOwnProperty.call(req.body, 'currentRxSiteA') ||
    Object.prototype.hasOwnProperty.call(req.body, 'currentRxSiteB')

  const irisMappingChanged = irisMappingFields.some((field) =>
    Object.prototype.hasOwnProperty.call(req.body, field)
  )

  try {
    const updated = await prisma.circuit.update({
      where: { id },
      data: {
        ...data,
        ...(irisMappingChanged ? { irisMappingUpdatedAt: new Date() } : {}),
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
        id: true,
        circuitId: true,
        nodeA: true,
        nodeB: true,
        techType: true,
        nldGroup: true,
        nodeALat: true, nodeALon: true, nodeBLat: true, nodeBLon: true,
        currentRxSiteA: true, currentRxSiteB: true, updatedAt: true,
        irisGraphAId: true, irisGraphBId: true,
        irisGraphALabel: true, irisGraphBLabel: true,
        irisGraphADevice: true, irisGraphBDevice: true,
        irisMappingUpdatedAt: true
      }
    })
    res.json(updated)
  } catch (e) {
    if (e?.code === 'P2025') {
      return res.status(404).json({ error: 'Circuit not found' })
    }
    if (e?.code === 'P2002') {
      return res.status(409).json({ error: 'Circuit ID must be unique' })
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
    irisGraphAId, irisGraphBId,
    irisGraphALabel, irisGraphBLabel,
    irisGraphADevice, irisGraphBDevice,
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
    const irisMapping = {
      irisGraphAId: optionalText(irisGraphAId),
      irisGraphBId: optionalText(irisGraphBId),
      irisGraphALabel: optionalText(irisGraphALabel),
      irisGraphBLabel: optionalText(irisGraphBLabel),
      irisGraphADevice: optionalText(irisGraphADevice),
      irisGraphBDevice: optionalText(irisGraphBDevice)
    }
    const hasIrisMapping = Object.values(irisMapping).some(Boolean)

    const created = await prisma.circuit.create({
      data: {
        circuitId, nodeA, nodeB, techType, nldGroup,
        currentRxSiteA, currentRxSiteB,
        nodeALat, nodeALon, nodeBLat, nodeBLon,
        ...irisMapping,
        ...(hasIrisMapping ? { irisMappingUpdatedAt: new Date() } : {}),
      },
      select: {
        id: true, circuitId: true, nodeA: true, nodeB: true, techType: true, nldGroup: true,
        currentRxSiteA: true, currentRxSiteB: true, updatedAt: true,
        nodeALat: true, nodeALon: true, nodeBLat: true, nodeBLon: true,
        irisGraphAId: true, irisGraphBId: true,
        irisGraphALabel: true, irisGraphBLabel: true,
        irisGraphADevice: true, irisGraphBDevice: true,
        irisMappingUpdatedAt: true
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
