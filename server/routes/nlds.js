// server/src/routes/nlds.ts
import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const r = Router()

r.get('/nlds.json', async (_req, res, next) => {
  try {
    // Pull circuits once
    const circuits = await prisma.circuit.findMany({
      select: {
        circuitId: true,
        nodeA: true,
        nodeB: true,
        nldGroup: true,
        techType: true,
        // legacy fields are ignored here on purpose
      }
    })

    // Pull nodes once and index by code and by name
    const nodes = await prisma.node.findMany()
    const byCode = new Map(nodes.map(n => [n.code, n]))
    const byName = new Map(nodes.map(n => [n.name, n]))

    const resolve = (key) => {
      if (!key) return null
      return byCode.get(key) || byName.get(key) || null
    }

    const spans = circuits.map(c => {
      const na = resolve(c.nodeA)
      const nb = resolve(c.nodeB)

      return {
        circuitId: c.circuitId,
        nldGroup: c.nldGroup ?? 'Unassigned',
        techType: c.techType,
        nodeA: na ? { code: na.code, name: na.name, lat: na.lat, lon: na.lon } : { name: c.nodeA },
        nodeB: nb ? { code: nb.code, name: nb.name, lat: nb.lat, lon: nb.lon } : { name: c.nodeB }
      }
    })

    res.json(spans)
  } catch (e) {
    next(e)
  }
})

export default r
