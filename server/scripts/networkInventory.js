// Setup/import/export are explicit operator actions; no device connections exist in this module.
import fs from 'node:fs'
import { loadServerEnv } from '../lib/loadEnv.js'
import { readInventoryWorkbook } from '../tools/networkInventory/normalize.js'
import { createInventoryRepository } from '../tools/networkInventory/repository.js'
import { enrichInventorySnapshot } from '../tools/networkInventory/quality.js'

loadServerEnv()
const mode = process.argv[2], file = process.argv[3]
if (!['analyse', 'import', 'setup'].includes(mode)) throw Error('Use analyse <workbook>, import <workbook>, or setup. Optional NETWORK_INVENTORY_DATABASE_URL selects the isolated module database.')
if (mode === 'analyse') {
  const parsed = readInventoryWorkbook(fs.readFileSync(file), file.split(/[\\/]/).at(-1)), snapshot = enrichInventorySnapshot({ records: parsed.records })
  console.log(JSON.stringify({ sheets: parsed.sheetCounts, counts: snapshot.summary, issueGroups: snapshot.issues.reduce((a, i) => { a[i.code] = (a[i.code] || 0) + 1; return a }, {}) }, null, 2))
} else {
  const repo = createInventoryRepository()
  try {
    await repo.initialise()
    if (mode === 'import') {
      const parsed = readInventoryWorkbook(fs.readFileSync(file), file.split(/[\\/]/).at(-1))
      const preview = await repo.stageImport(parsed, { name: 'Initial workbook import', role: 'admin' })
      if (preview.conflicts.length) throw Error('Existing manual edits require an import preview in the UI; CLI will not overwrite them.')
      await repo.applyImport(preview.id, { name: 'Initial workbook import', role: 'admin' }, { note: 'Initial inventory import; all ladders remain not up to date and device-unverified.' })
      console.log(JSON.stringify({ imported: true, counts: preview.counts }))
    } else console.log('Isolated network_inventory schema is ready.')
  } finally { await repo.close() }
}
