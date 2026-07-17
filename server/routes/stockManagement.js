import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'
import {
  applyStockTemplateReviewChanges,
  buildStockTemplateWorkbookBuffer,
  createStockTemplateItem,
  getCurrentStockDataset,
  importCurrentStockStatusWorkbook,
  importStockStatusFromGmail,
  importStockTemplateWorkbook,
  invalidateStockManagementCache,
  upsertStockNotWarehouseAction
} from '../lib/stockManagement.js'

function requireEngineering(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase()
  if (!['engineering', 'admin', 'manager'].includes(role)) {
    return res.status(403).json({ error: 'Engineering, admin, or manager role required' })
  }
  next()
}

const r = Router()

r.use(verifyToken, requireEngineering)

const NOT_WH_STATUSES = new Set([
  'PENDING_REVIEW',
  'TESTING_IN_PROGRESS',
  'USABLE_PUT_BACK',
  'RETURN_TO_SUPPLIER',
  'HOLD',
  'SCRAP'
])

function parseWholeNumber(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  if (!/^-?\d+$/.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

r.get('/current', async (_req, res) => {
  const dataset = await getCurrentStockDataset(prisma)
  res.json(dataset)
})

r.get('/item/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid item id' })
  }

  const dataset = await getCurrentStockDataset(prisma)
  const item = dataset.items.find((row) => row.id === id)
  if (!item) {
    return res.status(404).json({ error: 'Item not found' })
  }

  res.json(item)
})

r.put('/template-items/:id/match-override', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid item id' })
  }

  const { matchedItemNo, matchedDescription, clear } = req.body || {}
  const existing = await prisma.stockTemplateItem.findUnique({ where: { id } })
  if (!existing) {
    return res.status(404).json({ error: 'Template item not found' })
  }

  await prisma.stockTemplateItem.update({
    where: { id },
    data: clear
      ? {
          manualMatchItemNo: null,
          manualMatchDescription: null
        }
      : {
          manualMatchItemNo: String(matchedItemNo || '').trim() || null,
          manualMatchDescription: String(matchedDescription || '').trim() || null
        }
  })

  invalidateStockManagementCache()
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })
  const item = dataset.items.find((row) => row.id === id)
  res.json(item)
})

r.put('/template-items/:id/required-spares', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid item id' })
  }

  const existing = await prisma.stockTemplateItem.findUnique({ where: { id } })
  if (!existing) {
    return res.status(404).json({ error: 'Template item not found' })
  }

  if (existing.rowType !== 'ITEM') {
    return res.status(400).json({ error: 'Minimum spares can only be edited for item rows' })
  }

  const fields = {
    requiredCpt: parseWholeNumber(req.body?.requiredCpt),
    requiredJhb: parseWholeNumber(req.body?.requiredJhb),
    requiredDbn: parseWholeNumber(req.body?.requiredDbn),
    requiredPel: parseWholeNumber(req.body?.requiredPel),
    requiredBfn: parseWholeNumber(req.body?.requiredBfn),
    requiredGeo: parseWholeNumber(req.body?.requiredGeo),
    requiredPol: parseWholeNumber(req.body?.requiredPol),
    requiredNel: parseWholeNumber(req.body?.requiredNel)
  }

  const invalidField = Object.entries(fields).find(([, value]) => value == null)
  if (invalidField) {
    return res.status(400).json({ error: `Invalid whole-number value for ${invalidField[0]}` })
  }

  const negativeField = Object.entries(fields).find(([, value]) => value < 0)
  if (negativeField) {
    return res.status(400).json({ error: `Minimum spares cannot be negative for ${negativeField[0]}` })
  }

  await prisma.stockTemplateItem.update({
    where: { id },
    data: fields
  })

  invalidateStockManagementCache()
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })
  const item = dataset.items.find((row) => row.id === id)
  res.json(item)
})

r.post('/template-items', async (req, res) => {
  const payload = {
    sectionName: req.body?.sectionName,
    itemDescription: String(req.body?.itemDescription || '').trim(),
    stockCode: String(req.body?.stockCode || '').trim(),
    unitPriceZar: req.body?.unitPriceZar,
    unitPriceUsd: req.body?.unitPriceUsd,
    division: String(req.body?.division || '').trim(),
    requiredCpt: parseWholeNumber(req.body?.requiredCpt),
    requiredJhb: parseWholeNumber(req.body?.requiredJhb),
    requiredDbn: parseWholeNumber(req.body?.requiredDbn),
    requiredPel: parseWholeNumber(req.body?.requiredPel),
    requiredBfn: parseWholeNumber(req.body?.requiredBfn),
    requiredGeo: parseWholeNumber(req.body?.requiredGeo),
    requiredPol: parseWholeNumber(req.body?.requiredPol),
    requiredNel: parseWholeNumber(req.body?.requiredNel)
  }

  if (!payload.itemDescription) {
    return res.status(400).json({ error: 'Item description is required' })
  }

  if (!payload.division) {
    return res.status(400).json({ error: 'Division is required' })
  }

  const invalidField = Object.entries(payload).find(([key, value]) => key.startsWith('required') && value == null)
  if (invalidField) {
    return res.status(400).json({ error: `Invalid whole-number value for ${invalidField[0]}` })
  }

  const negativeField = Object.entries(payload).find(([key, value]) => key.startsWith('required') && value < 0)
  if (negativeField) {
    return res.status(400).json({ error: `Minimum spares cannot be negative for ${negativeField[0]}` })
  }

  try {
    const result = await createStockTemplateItem(prisma, payload)
    res.status(201).json(result)
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500
    res.status(statusCode).json({ error: error?.message || 'Failed to create template item' })
  }
})

r.post('/template-items/:id/review-actions', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid item id' })
  }

  try {
    const result = await applyStockTemplateReviewChanges(prisma, id, {
      deleteOriginal: Boolean(req.body?.deleteOriginal),
      additions: Array.isArray(req.body?.additions) ? req.body.additions : []
    })
    res.json(result)
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500
    res.status(statusCode).json({ error: error?.message || 'Failed to apply stock review changes' })
  }
})

r.put('/not-wh-actions', async (req, res) => {
  const templateItemId = Number(req.body?.templateItemId)
  if (!Number.isFinite(templateItemId)) {
    return res.status(400).json({ error: 'Invalid template item id' })
  }

  const siteId = String(req.body?.siteId || '').trim()
  if (!siteId) {
    return res.status(400).json({ error: 'Site ID is required' })
  }

  const status = String(req.body?.status || '').trim().toUpperCase()
  if (!NOT_WH_STATUSES.has(status)) {
    return res.status(400).json({ error: 'Invalid not warehouse status' })
  }

  try {
    const dataset = await upsertStockNotWarehouseAction(prisma, {
      templateItemId,
      siteId,
      status,
      notes: req.body?.notes,
      updatedBy: req.user?.email || req.user?.fullName || req.user?.role || 'engineering'
    })
    res.json(dataset)
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500
    res.status(statusCode).json({ error: error?.message || 'Failed to update not warehouse action' })
  }
})

r.post('/refresh', async (_req, res) => {
  const templateCount = await prisma.stockTemplateItem.count()
  if (!templateCount && process.env.STOCK_TEMPLATE_FILE) {
    await importStockTemplateWorkbook(prisma, process.env.STOCK_TEMPLATE_FILE)
  }

  const result = process.env.STOCK_STATUS_FILE
    ? await importCurrentStockStatusWorkbook(prisma, process.env.STOCK_STATUS_FILE, {
        sourceFilename: process.env.STOCK_STATUS_FILE,
        sourceSubject: 'local stock status file'
      })
    : await importStockStatusFromGmail(prisma)

  res.json(result)
})

r.get('/export/template', async (_req, res) => {
  const buffer = await buildStockTemplateWorkbookBuffer(prisma)
  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=\"stock-master-${stamp}.xlsx\"`)
  res.send(buffer)
})

export default r
