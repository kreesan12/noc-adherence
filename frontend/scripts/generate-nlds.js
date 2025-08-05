#!/usr/bin/env node
/**  Build-time helper:  `node scripts/generate-nlds.js`
 *   Used in package.json "prebuild" so Vite always has up-to-date geo data.
 */
import fs from 'node:fs/promises'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// ── fetch spans ----------------------------------------------------------------
const spans = await prisma.circuit.findMany({
  select: {
    circuitId: true,
    nldGroup : true,
    nodeA    : { select:{ name:true,  lat:true, lon:true } },
    nodeB    : { select:{ name:true,  lat:true, lon:true } }
  },
  orderBy: [{ nldGroup:'asc' }, { circuitId:'asc' }]
})

// ── write pretty-printed JSON ---------------------------------------------------
const outPath = new URL('../data/nlds.json', import.meta.url)
await fs.writeFile(outPath, JSON.stringify(spans, null, 2))
console.log(`✅  nlds.json generated (${spans.length} spans)`)

await prisma.$disconnect()
