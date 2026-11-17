import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import XLSX from 'xlsx'
import { verifyToken } from './auth.js'
import { createInventoryRepository, fail } from '../tools/networkInventory/repository.js'
import { readInventoryWorkbook } from '../tools/networkInventory/normalize.js'
import { reviewFingerprint } from '../tools/networkInventory/quality.js'
import { inventoryKinds } from '../../frontend/src/features/networkInventory/domain.js'

export const canEditInventory = user => ['admin', 'manager', 'engineering'].includes(String(user?.role || '').toLowerCase())
export default function networkInventoryRoutes({ repo = createInventoryRepository() } = {}) {
  const r = Router(); r.use(verifyToken)
  const write = (req, res, next) => canEditInventory(req.user) ? next() : res.status(403).json({ error: 'Inventory editor access is required.' })
  const route = work => async (req, res, next) => { try { await work(req, res) } catch (e) { next(e) } }
  r.get('/', route(async (req, res) => res.json({ ...await repo.getSnapshot(), canEdit: canEditInventory(req.user) })))
  r.post('/imports/preview', write, route(async (req, res) => {
    if (typeof req.body.workbookBase64 !== 'string' || req.body.workbookBase64.length > 14 * 1024 * 1024) throw fail(400, 'Choose an Excel workbook up to 10 MB.')
    const filename = String(req.body.filename || 'Inventory.xlsx').replace(/[^a-zA-Z0-9 _().-]/g, '_').slice(0, 200)
    const parsed = readInventoryWorkbook(Buffer.from(req.body.workbookBase64, 'base64'), filename)
    res.json(await repo.stageImport(parsed, req.user))
  }))
  r.post('/imports/:id/apply', write, route(async (req, res) => {
    const overwriteIds = req.body.overwriteIds || []
    if (!Array.isArray(overwriteIds) || overwriteIds.some(id => typeof id !== 'string')) throw fail(400, 'Invalid import choices.')
    res.json(await repo.applyImport(req.params.id, req.user, { overwriteIds, note: req.body.note || '' }))
  }))
  r.post('/records/:kind', write, route(async (req, res) => {
    const kind = req.params.kind, id = `${kind}:manual:${randomUUID()}`
    res.json(await repo.saveRecord(kind, id, req.body.data, null, req.user, req.body.note, true))
  }))
  r.patch('/records/:kind/:id', write, route(async (req, res) =>
    res.json(await repo.saveRecord(req.params.kind, req.params.id, req.body.data, req.body.expectedVersion, req.user, req.body.note))))
  r.get('/records/:kind/:id/history', route(async (req, res) => res.json(await repo.history(req.params.kind, req.params.id))))
  r.get('/records/:kind/:id/sources', route(async (req, res) => res.json(await repo.sources(req.params.kind, req.params.id))))
  r.get('/records/:kind/:id/review-context', route(async (req, res) => {
    const s = await repo.getSnapshot(), fingerprint = reviewFingerprint(s, req.params.kind, req.params.id)
    if (!fingerprint) throw fail(404, 'Record not found.')
    res.json({ fingerprint, revision: s.revision })
  }))
  r.post('/reviews', write, route(async (req, res) => res.json(await repo.signOff(req.body.kind, req.body.recordId, req.user, req.body.note, req.body.fingerprint))))
  r.post('/issues/:id/acknowledge', write, route(async (req, res) => res.json(await repo.acknowledgeIssue(req.params.id, req.body.evidenceHash, req.user, req.body.note))))
  r.post('/issues/acknowledge-batch', write, route(async (req, res) => res.json(await repo.acknowledgeIssues(req.body.issues, req.user, req.body.note))))
  r.get('/export', route(async (_req, res) => {
    const s = await repo.getSnapshot(), book = XLSX.utils.book_new()
    const exportRows = inventoryKinds.flatMap(kind => s.records[kind].map(r => ({ kind, id: r.id, data: JSON.stringify(r.data), sourceRefs: JSON.stringify(r.sourceRefs) })))
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(exportRows), 'Inventory records')
    for (const kind of inventoryKinds) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(s.records[kind].map(r => ({ id: r.id, ...Object.fromEntries(Object.entries(r.data).map(([k, v]) => [k, v && typeof v === 'object' ? JSON.stringify(v) : v])), source: r.sourceRefs.map(x => `${x.sheet}:${x.row}`).join('; ') }))), kind)
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(s.issues.map(i => ({ code: i.code, severity: i.severity, subject: i.label, message: i.message, status: i.status, details: JSON.stringify(i.details), reviewNote: i.review?.note || '' }))), 'Findings')
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(s.reviews), 'Manual sign-offs')
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', 'attachment; filename="Network_Inventory.xlsx"')
    res.send(XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true }))
  }))
  return r
}
