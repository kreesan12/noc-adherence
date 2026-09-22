import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { verifyToken } from './auth.js'
import {
  applyStockTemplateReviewChanges,
  buildLowStockWatchlistWorkbookBuffer,
  buildRegionalWatchlistWorkbookBuffer,
  buildStockTemplateWorkbookBuffer,
  createStockTemplateItem,
  generateStockRedistributionPlan,
  getCurrentStockDataset,
  getLatestStockRedistributionPlan,
  getStockDailyReportDataset,
  getStockRunRateDataset,
  importCurrentStockStatusWorkbook,
  importStockStatusFromGmail,
  importStockTemplateWorkbook,
  invalidateStockManagementCache,
  rebuildStoredStockRunRateDataset,
  sendStockDailyReports,
  sendStockRedistributionPlan,
  upsertStockNotWarehouseAction
} from '../lib/stockManagement.js'

async function resolveStockAccess(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase()
  if (['engineering', 'admin'].includes(role)) {
    req.stockAccess = { all: true, divisions: [] }
    return next()
  }
  const email = String(req.user?.email || '').trim().toLowerCase()
  if (!email) return res.status(403).json({ error: 'Sign in again before accessing stock management' })
  const contacts = await prisma.stockDivisionContact.findMany({
    where: { email, isActive: true },
    select: { division: true, role: true }
  })
  if (!contacts.length) return res.status(403).json({ error: 'No stock-management division access is assigned to this user' })
  req.stockAccess = {
    all: false,
    divisions: [...new Set(contacts.map((row) => row.division))],
    adminDivisions: [...new Set(contacts.filter((row) => row.role === 'DIVISION_ADMIN').map((row) => row.division))]
  }
  next()
}

const canManageDivision = (req, division) => Boolean(req.stockAccess?.all || req.stockAccess?.adminDivisions?.includes(division))
const requireGeneralStockAdmin = (req, res, next) => req.stockAccess?.all ? next() : res.status(403).json({ error: 'General stock admin access required' })

function applyStockScope(dataset, access) {
  if (access?.all) return dataset
  const divisions = new Set(access?.divisions || [])
  const items = (dataset.items || []).filter((row) => row.rowType !== 'ITEM' || divisions.has(row.division))
  const poolKeys = new Set(items.filter((row) => row.rowType === 'ITEM').map((row) => row.poolKey))
  return {
    ...dataset,
    items,
    divisionSummary: (dataset.divisionSummary || []).filter((row) => divisions.has(row.division)),
    lowStockItems: (dataset.lowStockItems || []).filter((row) => poolKeys.has(row.poolKey)),
    matchReviewItems: (dataset.matchReviewItems || []).filter((row) => divisions.has(row.division)),
    notWarehouseItems: (dataset.notWarehouseItems || []).filter((row) => divisions.has(row.division)),
    stockPools: (dataset.stockPools || []).filter((row) => poolKeys.has(row.poolKey))
  }
}

const r = Router()

r.use(verifyToken, resolveStockAccess)

const NOT_WH_STATUSES = new Set([
  'PENDING_REVIEW',
  'TESTING_IN_PROGRESS',
  'USABLE_PUT_BACK',
  'RETURN_TO_SUPPLIER',
  'HOLD',
  'SCRAP'
])

function refreshRunRatesInBackground() {
  void rebuildStoredStockRunRateDataset(prisma).catch((error) => {
    console.error('[STOCK RUN RATE] Background refresh failed:', error?.message || error)
  })
}

function parseWholeNumber(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  if (!/^-?\d+$/.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function parseBooleanFlag(value, defaultValue = true) {
  if (value == null) return defaultValue
  if (typeof value === 'boolean') return value
  const normalized = String(value).trim().toLowerCase()
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true
  if (['false', '0', 'no', 'n'].includes(normalized)) return false
  return defaultValue
}

r.get('/current', async (req, res) => {
  const dataset = await getCurrentStockDataset(prisma)
  res.json(applyStockScope(dataset, req.stockAccess))
})

r.get('/run-rates', async (_req, res) => {
  const dataset = await getStockRunRateDataset(prisma)
  res.json(dataset)
})

r.get('/item/:id', async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) {
    return res.status(400).json({ error: 'Invalid item id' })
  }

  const dataset = await getCurrentStockDataset(prisma)
  const item = applyStockScope(dataset, req.stockAccess).items.find((row) => row.id === id)
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
  if (!canManageDivision(req, existing.division)) return res.status(403).json({ error: 'You can only change matching for your assigned division' })

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
  refreshRunRatesInBackground()
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
  if (!canManageDivision(req, existing.division)) return res.status(403).json({ error: 'You can only change minimums for your assigned division' })

  const fields = {
    requiredCpt: parseWholeNumber(req.body?.requiredCpt),
    requiredCptConfirmed: parseBooleanFlag(req.body?.requiredCptConfirmed, existing.requiredCptConfirmed !== false),
    requiredJhb: parseWholeNumber(req.body?.requiredJhb),
    requiredJhbConfirmed: parseBooleanFlag(req.body?.requiredJhbConfirmed, existing.requiredJhbConfirmed !== false),
    requiredDbn: parseWholeNumber(req.body?.requiredDbn),
    requiredDbnConfirmed: parseBooleanFlag(req.body?.requiredDbnConfirmed, existing.requiredDbnConfirmed !== false),
    requiredPel: parseWholeNumber(req.body?.requiredPel),
    requiredPelConfirmed: parseBooleanFlag(req.body?.requiredPelConfirmed, existing.requiredPelConfirmed !== false),
    requiredBfn: parseWholeNumber(req.body?.requiredBfn),
    requiredBfnConfirmed: parseBooleanFlag(req.body?.requiredBfnConfirmed, existing.requiredBfnConfirmed !== false),
    requiredGeo: parseWholeNumber(req.body?.requiredGeo),
    requiredGeoConfirmed: parseBooleanFlag(req.body?.requiredGeoConfirmed, existing.requiredGeoConfirmed !== false),
    requiredPol: parseWholeNumber(req.body?.requiredPol),
    requiredPolConfirmed: parseBooleanFlag(req.body?.requiredPolConfirmed, existing.requiredPolConfirmed !== false),
    requiredNel: parseWholeNumber(req.body?.requiredNel),
    requiredNelConfirmed: parseBooleanFlag(req.body?.requiredNelConfirmed, existing.requiredNelConfirmed !== false)
  }

  const invalidField = Object.entries(fields).find(([key, value]) => key.startsWith('required') && !key.endsWith('Confirmed') && value == null)
  if (invalidField) {
    return res.status(400).json({ error: `Invalid whole-number value for ${invalidField[0]}` })
  }

  const negativeField = Object.entries(fields).find(([key, value]) => key.startsWith('required') && !key.endsWith('Confirmed') && value < 0)
  if (negativeField) {
    return res.status(400).json({ error: `Minimum spares cannot be negative for ${negativeField[0]}` })
  }

  await prisma.stockTemplateItem.update({
    where: { id },
    data: fields
  })

  invalidateStockManagementCache()
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })
  refreshRunRatesInBackground()
  const item = dataset.items.find((row) => row.id === id)
  res.json(item)
})

r.post('/template-items', async (req, res) => {
  const payload = {
    sectionName: req.body?.sectionName,
    subSectionName: req.body?.subSectionName,
    itemDescription: String(req.body?.itemDescription || '').trim(),
    stockCode: String(req.body?.stockCode || '').trim(),
    unitPriceZar: req.body?.unitPriceZar,
    unitPriceUsd: req.body?.unitPriceUsd,
    division: String(req.body?.division || '').trim(),
    requiredCpt: parseWholeNumber(req.body?.requiredCpt),
    requiredCptConfirmed: parseBooleanFlag(req.body?.requiredCptConfirmed, true),
    requiredJhb: parseWholeNumber(req.body?.requiredJhb),
    requiredJhbConfirmed: parseBooleanFlag(req.body?.requiredJhbConfirmed, true),
    requiredDbn: parseWholeNumber(req.body?.requiredDbn),
    requiredDbnConfirmed: parseBooleanFlag(req.body?.requiredDbnConfirmed, true),
    requiredPel: parseWholeNumber(req.body?.requiredPel),
    requiredPelConfirmed: parseBooleanFlag(req.body?.requiredPelConfirmed, true),
    requiredBfn: parseWholeNumber(req.body?.requiredBfn),
    requiredBfnConfirmed: parseBooleanFlag(req.body?.requiredBfnConfirmed, true),
    requiredGeo: parseWholeNumber(req.body?.requiredGeo),
    requiredGeoConfirmed: parseBooleanFlag(req.body?.requiredGeoConfirmed, true),
    requiredPol: parseWholeNumber(req.body?.requiredPol),
    requiredPolConfirmed: parseBooleanFlag(req.body?.requiredPolConfirmed, true),
    requiredNel: parseWholeNumber(req.body?.requiredNel),
    requiredNelConfirmed: parseBooleanFlag(req.body?.requiredNelConfirmed, true)
  }

  if (!payload.itemDescription) {
    return res.status(400).json({ error: 'Item description is required' })
  }

  if (!payload.division) {
    return res.status(400).json({ error: 'Division is required' })
  }
  if (!canManageDivision(req, payload.division)) return res.status(403).json({ error: 'You can only add items to your assigned division' })

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
    refreshRunRatesInBackground()
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
    const existing = await prisma.stockTemplateItem.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Template item not found' })
    if (!canManageDivision(req, existing.division)) return res.status(403).json({ error: 'You can only review items in your assigned division' })
    const result = await applyStockTemplateReviewChanges(prisma, id, {
      deleteOriginal: Boolean(req.body?.deleteOriginal),
      additions: Array.isArray(req.body?.additions) ? req.body.additions : []
    })
    refreshRunRatesInBackground()
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
  const existing = await prisma.stockTemplateItem.findUnique({ where: { id: templateItemId } })
  if (!existing) return res.status(404).json({ error: 'Template item not found' })
  if (!canManageDivision(req, existing.division)) return res.status(403).json({ error: 'You can only update Not WH actions for your assigned division' })

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

r.put('/template-items/:id/cost', async (req, res) => {
  const id = Number(req.params.id)
  const unitCost = Number(req.body?.unitCost)
  if (!Number.isFinite(id) || !Number.isFinite(unitCost) || unitCost < 0) {
    return res.status(400).json({ error: 'A non-negative unit cost is required' })
  }
  const existing = await prisma.stockTemplateItem.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Template item not found' })
  if (!canManageDivision(req, existing.division)) return res.status(403).json({ error: 'You can only edit costs for your assigned division' })
  await prisma.stockTemplateItem.updateMany({
    where: existing.stockCode ? { stockCode: existing.stockCode } : { id },
    data: { unitPriceZar: unitCost.toFixed(2) }
  })
  invalidateStockManagementCache()
  const dataset = applyStockScope(await getCurrentStockDataset(prisma, { forceFresh: true }), req.stockAccess)
  refreshRunRatesInBackground()
  res.json(dataset.items.find((row) => row.id === id))
})

r.delete('/template-items/:id', requireGeneralStockAdmin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid item id' })
  const existing = await prisma.stockTemplateItem.findUnique({ where: { id } })
  if (!existing) return res.status(404).json({ error: 'Template item not found' })
  if (!canManageDivision(req, existing.division)) return res.status(403).json({ error: 'You can only delete items in your assigned division' })
  await prisma.stockTemplateItem.delete({ where: { id } })
  invalidateStockManagementCache()
  refreshRunRatesInBackground()
  res.status(204).end()
})

r.get('/redistribution/latest', async (_req, res) => {
  res.json(await getLatestStockRedistributionPlan(prisma))
})

r.get('/redistribution/runs', async (_req, res) => {
  const runs = await prisma.stockRedistributionRun.findMany({
    take: 20,
    orderBy: { generatedAt: 'desc' },
    include: {
      recommendations: {
        select: { recommendedQty: true, deltaQty: true, status: true, sentAt: true }
      }
    }
  })
  res.json(runs.map((run) => ({
    id: run.id,
    generatedAt: run.generatedAt,
    source: run.source,
    summary: run.summary,
    movementLines: run.recommendations.length,
    recommendedQty: run.recommendations.reduce((total, row) => total + Number(row.recommendedQty || 0), 0),
    newQty: run.recommendations.reduce((total, row) => total + Number(row.deltaQty || 0), 0),
    draftLines: run.recommendations.filter((row) => row.status === 'DRAFT' && Number(row.deltaQty || 0) > 0).length,
    sentLines: run.recommendations.filter((row) => row.status === 'SENT').length,
    lastSentAt: run.recommendations.reduce((latest, row) => !latest || (row.sentAt && row.sentAt > latest) ? row.sentAt : latest, null)
  })))
})

r.get('/redistribution/:runId', async (req, res) => {
  const runId = Number(req.params.runId)
  if (!Number.isFinite(runId)) return res.status(400).json({ error: 'Invalid redistribution plan id' })
  const plan = await prisma.stockRedistributionRun.findUnique({
    where: { id: runId },
    include: { recommendations: { orderBy: [{ fromRegion: 'asc' }, { toRegion: 'asc' }, { stockCode: 'asc' }] } }
  })
  if (!plan) return res.status(404).json({ error: 'Redistribution plan not found' })
  res.json(plan)
})

r.post('/redistribution/generate', requireGeneralStockAdmin, async (_req, res) => {
  res.status(201).json(await generateStockRedistributionPlan(prisma, { source: 'manual' }))
})

r.post('/redistribution/:runId/send', requireGeneralStockAdmin, async (req, res) => {
  try {
    res.json(await sendStockRedistributionPlan(prisma, req.params.runId, {
      sentBy: req.user?.email || req.user?.name || 'stock-admin'
    }))
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Failed to send redistribution plan' })
  }
})

r.get('/daily-report', async (req, res) => {
  const data = await getStockDailyReportDataset(prisma)
  if (req.stockAccess?.all) return res.json(data)
  const divisions = new Set(req.stockAccess?.divisions || [])
  res.json({ ...data, reports: data.reports.filter((report) => divisions.has(report.division)) })
})

r.post('/daily-report/send', requireGeneralStockAdmin, async (req, res) => {
  try {
    res.json(await sendStockDailyReports(prisma, { sentBy: req.user?.email || req.user?.name || 'stock-admin' }))
  } catch (error) {
    res.status(400).json({ error: error?.message || 'Failed to send daily reports' })
  }
})

r.get('/admin/contacts', requireGeneralStockAdmin, async (_req, res) => {
  res.json(await prisma.stockDivisionContact.findMany({ orderBy: [{ division: 'asc' }, { role: 'asc' }, { email: 'asc' }] }))
})

r.post('/admin/contacts', requireGeneralStockAdmin, async (req, res) => {
  const division = String(req.body?.division || '').trim()
  const email = String(req.body?.email || '').trim().toLowerCase()
  const role = String(req.body?.role || '').trim().toUpperCase()
  if (!division || !/^\S+@\S+\.\S+$/.test(email) || !['DIVISION_HEAD', 'DIVISION_ADMIN'].includes(role)) {
    return res.status(400).json({ error: 'Division, valid email, and contact role are required' })
  }
  const contact = await prisma.stockDivisionContact.upsert({
    where: { division_email_role: { division, email, role } },
    create: { division, email, role, fullName: String(req.body?.fullName || '').trim() || null, receivesRedistribution: Boolean(req.body?.receivesRedistribution) },
    update: { fullName: String(req.body?.fullName || '').trim() || null, isActive: req.body?.isActive !== false, receivesRedistribution: Boolean(req.body?.receivesRedistribution) }
  })
  res.status(201).json(contact)
})

r.put('/admin/contacts/:id', requireGeneralStockAdmin, async (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid contact id' })
  const contact = await prisma.stockDivisionContact.update({
    where: { id },
    data: {
      fullName: req.body?.fullName == null ? undefined : String(req.body.fullName).trim() || null,
      email: req.body?.email == null ? undefined : String(req.body.email).trim().toLowerCase(),
      isActive: req.body?.isActive == null ? undefined : Boolean(req.body.isActive),
      receivesRedistribution: req.body?.receivesRedistribution == null ? undefined : Boolean(req.body.receivesRedistribution)
    }
  })
  res.json(contact)
})

r.post('/refresh', requireGeneralStockAdmin, async (_req, res) => {
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

r.post('/import-minimum-requirements', async (req, res) => {
  res.status(410).json({
    error: 'Minimum-stock workbook upload is disabled in the web app. Use the manual import script for ad hoc imports.'
  })
})

r.get('/export/template', async (_req, res) => {
  const buffer = await buildStockTemplateWorkbookBuffer(prisma)
  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=\"stock-master-${stamp}.xlsx\"`)
  res.send(buffer)
})

r.get('/export/low-stock', async (_req, res) => {
  const buffer = await buildLowStockWatchlistWorkbookBuffer(prisma)
  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=\"stock-low-stock-watchlist-${stamp}.xlsx\"`)
  res.send(buffer)
})

r.get('/export/regional-watchlist', async (_req, res) => {
  const buffer = await buildRegionalWatchlistWorkbookBuffer(prisma)
  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename=\"stock-regional-watchlist-${stamp}.xlsx\"`)
  res.send(buffer)
})

export default r
