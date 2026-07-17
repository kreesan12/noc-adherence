#!/usr/bin/env node

import prisma from '../lib/prisma.js'
import { importStockTemplateWorkbook } from '../lib/stockManagement.js'

async function main() {
  const templateFile = process.argv[2] || process.env.STOCK_TEMPLATE_FILE
  if (!templateFile) {
    throw new Error('Provide a template workbook path as argv[2] or set STOCK_TEMPLATE_FILE')
  }

  const result = await importStockTemplateWorkbook(prisma, templateFile)
  console.log(`Imported stock template rows: ${result.importedRows}`)
}

main()
  .catch((error) => {
    console.error('Stock template import failed:', error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
