#!/usr/bin/env node

import prisma from '../lib/prisma.js'
import { generateStockRedistributionPlan } from '../lib/stockManagement.js'

async function main() {
  const plan = await generateStockRedistributionPlan(prisma, { source: 'daily' })
  const summary = plan.summary || {}
  console.log(`Stock redistribution plan ${plan.id}: ${summary.legCount || 0} legs, ${summary.totalNewQty || 0} new units to review`)
}

main()
  .catch((error) => {
    console.error('Stock redistribution generation failed:', error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
