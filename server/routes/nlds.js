import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { loadCircuitMonitoringRows } from '../lib/nldCircuitState.js'
const r = Router()

r.get('/nlds.json', async (_req, res, next) => {
  try {
    // Use the same effective A/B readings as NLD Light Levels: a newer daily
    // reading takes precedence over the current circuit value after an event.
    const [circuits, nodes] = await Promise.all([
      loadCircuitMonitoringRows(prisma),
      prisma.node.findMany({ select: { code: true, name: true, lat: true, lon: true } })
    ])

    const normaliseKey = (value) => String(value ?? '').trim().toLowerCase()
    const byCode = new Map(nodes.map((node) => [node.code, node]))
    const byName = new Map(nodes.map((node) => [node.name, node]))
    const byNormalisedKey = new Map()
    nodes.forEach((node) => {
      byNormalisedKey.set(normaliseKey(node.code), node)
      byNormalisedKey.set(normaliseKey(node.name), node)
    })

    const resolve = (key) => {
      if (!key) return null
      return byCode.get(key) || byName.get(key) || byNormalisedKey.get(normaliseKey(key)) || null
    }

    const spans = circuits.map(circuit => {
      const na = resolve(circuit.nodeA)
      const nb = resolve(circuit.nodeB)

      return {
        circuitId: circuit.circuitId,
        nldGroup: circuit.nldGroup ?? 'Unassigned',
        techType: circuit.techType,
        nodeA: na
          ? { code: na.code, name: na.name, lat: na.lat, lon: na.lon }
          : { name: circuit.nodeA, lat: circuit.nodeALat, lon: circuit.nodeALon },
        nodeB: nb
          ? { code: nb.code, name: nb.name, lat: nb.lat, lon: nb.lon }
          : { name: circuit.nodeB, lat: circuit.nodeBLat, lon: circuit.nodeBLon },
        levels: {
          aRx: circuit.displayRxA,
          bRx: circuit.displayRxB,
          asOf: circuit.displayAsOf,
          sourceA: circuit.displaySourceA,
          sourceB: circuit.displaySourceB
        }
      }
    })

    res.json(spans)
  } catch (e) {
    next(e)
  }
})

export default r
