#!/usr/bin/env node

import prisma from '../lib/prisma.js'
import {
  importCurrentStockStatusWorkbook,
  importStockStatusFromGmail
} from '../lib/stockManagement.js'

async function main() {
  const localFile = process.argv[2] || process.env.STOCK_STATUS_FILE

  const result = localFile
    ? await importCurrentStockStatusWorkbook(prisma, localFile, {
        sourceFilename: localFile,
        sourceSubject: 'local stock status file'
      })
    : await importStockStatusFromGmail(prisma)

  console.log(JSON.stringify(result, null, 2))
}

main()
  .catch((error) => {
    console.error('Stock status ingest failed:', error?.message || error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {})
  })
