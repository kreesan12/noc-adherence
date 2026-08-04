#!/usr/bin/env node

import prisma from '../lib/prisma.js'
import { importMinimumStockRequirementsWorkbook } from '../lib/stockManagement.js'

async function main() {
  const workbookFile = process.argv[2] || process.env.STOCK_MINIMUM_REQUIREMENTS_FILE
  if (!workbookFile) {
    throw new Error('Provide a minimum-stock workbook path as argv[2] or set STOCK_MINIMUM_REQUIREMENTS_FILE')
  }

  const result = await importMinimumStockRequirementsWorkbook(prisma, workbookFile)
  const meta = result?.meta || {}

  console.log([
    `Imported minimum-stock rows: ${meta.importedRows ?? 0}`,
    `Updated existing items: ${meta.updatedCount ?? 0}`,
    `Created new items: ${meta.createdCount ?? 0}`,
    `Unconfirmed imported rows: ${meta.unconfirmedImportedRows ?? 0}`
  ].join('\n'))
}

main()
  .catch((error) => {
    console.error('Minimum-stock import failed:', error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
