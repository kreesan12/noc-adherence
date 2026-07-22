import fs from 'fs/promises'
import path from 'path'
import { google } from 'googleapis'
import * as XLSX from 'xlsx'
import ExcelJS from 'exceljs'
import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat.js'

dayjs.extend(customParseFormat)

const STOCK_TEMPLATE_SHEET = 'Min Stock Master'
const STOCK_TRACKING_SHEET = 'Montly tracking'
const STATUS_HEADER_ROW_INDEX = 2
const TEMPLATE_DATA_ROW_START_INDEX = 2
const SUBJECT_PREFIX_RE = /^(?:\s*(?:re|fw|fwd)\s*:\s*)+/i

const REGION_ORDER = ['CPT', 'JHB', 'DBN', 'PEL', 'BFN', 'GEO', 'POL', 'NEL']
const MATCH_REVIEW_THRESHOLD = 0.75
const MATCH_ACCEPT_THRESHOLD = 0.58
const MATCH_MARGIN_THRESHOLD = 0.08

const STOCK_EXPORT_HEADER_ROW_1 = [
  'Stock Items/Description', 'Stock Code ', 'Unit price ZAR', 'Unit price  USD', 'Division',
  'Required Spares', 'Required Spares', 'Required Spares', 'Required Spares',
  'Required Spares', 'Required Spares', 'Required Spares', 'Required Spares',
  'Availabele Stock  CPT', '', '',
  'Availabele Stock  JHB', '', '',
  'Availabele Stock  DBN', '',
  'Availabele Stock  PEL', '', '',
  'Availabele Stock  BFN', '',
  'Availabele Stock  GEO', '',
  'Availabele Stock  POL', '',
  'Availabele Stock  NEL', '',
  'Available Stock', 'Ordered Stock', 'MINIMUM SPARES', 'Warehouse Stock',
  'Total Stock', 'Unit Cost', 'Gap', 'Gap Cost', ''
]

const STOCK_EXPORT_HEADER_ROW_2 = [
  '', '', '', '', '',
  'CPT', 'JHB', 'DBN', 'PEL', 'BFN', 'GEO', 'POL', 'NEL',
  'WAR-MT-CPT', 'VOX-FF-CPT ', 'TOTAL',
  'WAR-FF-PTA', 'VOX-FF-JHB ', 'TOTAL',
  'WAR-FF-DBN', 'TOTAL',
  'WAR-FF-PEL', 'WAR-FF-DBN', 'TOTAL',
  'WAR-FF-BLM', 'TOTAL',
  'WAR-FF-GEO', 'TOTAL',
  'WAR-FF-POL', 'TOTAL',
  'WAR-FF-NEL', 'TOTAL',
  'Not in Warehouses', 'Total', 'Required', 'Usable',
  'All Stock', 'Derived ZAR', 'Qty', 'ZAR', ''
]

const REGION_ALIAS_MAP = {
  CPT: 'CPT',
  JHB: 'JHB',
  PTA: 'JHB',
  GPX: 'JHB',
  CPJ: 'JHB',
  FAU: 'JHB',
  PT: 'JHB',
  DBN: 'DBN',
  PMB: 'DBN',
  KZN: 'DBN',
  KZS: 'DBN',
  PEL: 'PEL',
  PE: 'PEL',
  ELS: 'PEL',
  ELN: 'PEL',
  BFN: 'BFN',
  BLM: 'BFN',
  KIM: 'BFN',
  GEO: 'GEO',
  POL: 'POL',
  LEP: 'POL',
  NEL: 'NEL'
}

const SITE_REGION_OVERRIDES = {
  'WAR-BL-RTS': 'BFN',
  'WAR-GE-RTS': 'GEO',
  'WAR-KZ-RTS': 'DBN',
  'WAR-PE-RTS': 'PEL',
  'WAR-PT-FAU': 'JHB',
  'WAR-PT-RTS': 'JHB',
  'WAR-REF-BL': 'BFN',
  'WAR-REF-GE': 'GEO',
  'WAR-REF-PE': 'PEL',
  'WAR-REF-PT': 'JHB',
  'VOX-FF-CPJ': 'JHB',
  'VOX-FF-FAU': 'JHB',
  'VOX-FF-ELN': 'PEL'
}

const WAREHOUSE_FIELD_CONFIG = {
  cptWarehousePrimary: { region: 'CPT', aliases: ['WAR-MT-CPT'] },
  cptWarehouseSecondary: { region: 'CPT', aliases: ['VOX-FF-CPT', 'VOX-SL-CPT'] },
  jhbWarehousePrimary: { region: 'JHB', aliases: ['WAR-FF-PTA', 'WAR-MT-PTA', 'WAR-SL-PTA', 'WAR-PT-FAU', 'WAR-PT-RTS', 'WAR-REF-PT'] },
  jhbWarehouseSecondary: { region: 'JHB', aliases: ['VOX-FF-JHB', 'VOX-FF-CPJ', 'VOX-FF-FAU'] },
  dbnWarehousePrimary: { region: 'DBN', aliases: ['WAR-FF-DBN', 'WAR-KZ-RTS'] },
  pelWarehousePrimary: { region: 'PEL', aliases: ['WAR-FF-PEL', 'WAR-MT-PEL', 'WAR-PE-RTS', 'WAR-REF-PE'] },
  pelWarehouseSecondary: { region: 'PEL', aliases: ['VOX-FF-ELN'] },
  bfnWarehousePrimary: { region: 'BFN', aliases: ['WAR-FF-BLM', 'WAR-BL-RTS', 'WAR-REF-BL'] },
  geoWarehousePrimary: { region: 'GEO', aliases: ['WAR-FF-GEO', 'WAR-MT-GEO', 'WAR-GE-RTS', 'WAR-REF-GE'] },
  polWarehousePrimary: { region: 'POL', aliases: ['WAR-FF-POL'] },
  nelWarehousePrimary: { region: 'NEL', aliases: ['WAR-FF-NEL'] }
}

const WAREHOUSE_ALIAS_TO_FIELD = Object.fromEntries(
  Object.entries(WAREHOUSE_FIELD_CONFIG).flatMap(([field, cfg]) => cfg.aliases.map((alias) => [alias, field]))
)

const DEFAULT_WAREHOUSE_FIELD_BY_REGION = {
  CPT: { war: 'cptWarehousePrimary', vox: 'cptWarehouseSecondary', fallback: 'cptWarehousePrimary' },
  JHB: { war: 'jhbWarehousePrimary', vox: 'jhbWarehouseSecondary', fallback: 'jhbWarehousePrimary' },
  DBN: { war: 'dbnWarehousePrimary', vox: 'dbnWarehousePrimary', fallback: 'dbnWarehousePrimary' },
  PEL: { war: 'pelWarehousePrimary', vox: 'pelWarehouseSecondary', fallback: 'pelWarehousePrimary' },
  BFN: { war: 'bfnWarehousePrimary', vox: 'bfnWarehousePrimary', fallback: 'bfnWarehousePrimary' },
  GEO: { war: 'geoWarehousePrimary', vox: 'geoWarehousePrimary', fallback: 'geoWarehousePrimary' },
  POL: { war: 'polWarehousePrimary', vox: 'polWarehousePrimary', fallback: 'polWarehousePrimary' },
  NEL: { war: 'nelWarehousePrimary', vox: 'nelWarehousePrimary', fallback: 'nelWarehousePrimary' }
}

const projectionCache = {
  value: null,
  createdAt: 0
}

const runRateCache = {
  value: null,
  createdAt: 0
}

function cleanCell(value) {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim()
}

function toInt(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const parsed = Number(raw.replace(/,/g, ''))
  return Number.isFinite(parsed) ? Math.round(parsed) : 0
}

function toMoney(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const parsed = Number(raw.replace(/[^0-9.-]+/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function sumRequiredSpares(record) {
  return [
    record.requiredCpt,
    record.requiredJhb,
    record.requiredDbn,
    record.requiredPel,
    record.requiredBfn,
    record.requiredGeo,
    record.requiredPol,
    record.requiredNel
  ].reduce((sum, value) => sum + Number(value || 0), 0)
}

function normalizeCode(value) {
  return cleanCell(value).toUpperCase().replace(/\s+/g, ' ')
}

function canonicalCode(value) {
  return normalizeCode(value).replace(/[^A-Z0-9]+/g, '')
}

function normalizeDescription(value) {
  return cleanCell(value)
    .toUpperCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenOverlapScore(a, b) {
  const left = new Set(normalizeDescription(a).split(' ').filter(Boolean))
  const right = new Set(normalizeDescription(b).split(' ').filter(Boolean))
  if (!left.size || !right.size) return 0
  let hits = 0
  for (const token of left) {
    if (right.has(token)) hits += 1
  }
  return hits / left.size
}

function diceCoefficient(a, b) {
  const left = normalizeDescription(a).replace(/\s+/g, '')
  const right = normalizeDescription(b).replace(/\s+/g, '')
  if (!left || !right) return 0
  if (left === right) return 1

  const build = (value) => {
    const map = new Map()
    for (let index = 0; index < value.length - 1; index += 1) {
      const gram = value.slice(index, index + 2)
      map.set(gram, (map.get(gram) || 0) + 1)
    }
    return map
  }

  const leftBigrams = build(left)
  const rightBigrams = build(right)
  let overlap = 0
  for (const [gram, count] of leftBigrams.entries()) {
    overlap += Math.min(count, rightBigrams.get(gram) || 0)
  }
  const total = Math.max(left.length - 1, 0) + Math.max(right.length - 1, 0)
  return total > 0 ? (2 * overlap) / total : 0
}

function buildFuzzyScore(templateDescription, candidateDescription) {
  const tokenScore = tokenOverlapScore(templateDescription, candidateDescription)
  const dice = diceCoefficient(templateDescription, candidateDescription)
  return (tokenScore * 0.65) + (dice * 0.35)
}

function uniqueBy(items, getKey) {
  const seen = new Set()
  const output = []
  for (const item of items) {
    const key = getKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }
  return output
}

function parseReportDate(value) {
  const match = String(value || '').match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}\s+[AP]M)/i)
  if (!match) return null
  const parsed = dayjs(match[1], 'DD/MM/YYYY hh:mm A', true)
  return parsed.isValid() ? parsed.toDate() : null
}

function parseStockStatusSubjectDate(subject) {
  const cleaned = String(subject || '').replace(SUBJECT_PREFIX_RE, '').trim()
  const match = cleaned.match(/(\d{2}\/\d{2}\/\d{4}\s+\d{2}:\d{2}(?::\d{2})?)/)
  if (!match) return null

  const parsed = dayjs(match[1], ['DD/MM/YYYY HH:mm:ss', 'DD/MM/YYYY HH:mm'], true)
  return parsed.isValid() ? parsed.toDate() : null
}

function normalizeSubject(subject) {
  return String(subject || '')
    .replace(SUBJECT_PREFIX_RE, '')
    .replace(/[–—]/g, '-')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .toLowerCase()
}

function getSubjectHeader(message) {
  return (message?.payload?.headers || []).find((header) => String(header?.name || '').toLowerCase() === 'subject')?.value || ''
}

function isWarehouseLike(siteId) {
  return /^(WAR|VOX)-/i.test(cleanCell(siteId))
}

function resolveSiteRegion(siteId) {
  const cleaned = cleanCell(siteId).toUpperCase()
  if (!cleaned) return null
  if (SITE_REGION_OVERRIDES[cleaned]) return SITE_REGION_OVERRIDES[cleaned]

  const tokens = cleaned.split('-').filter(Boolean)
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const token = tokens[index]
    if (REGION_ALIAS_MAP[token]) return REGION_ALIAS_MAP[token]
  }
  return null
}

function resolveWarehouseField(siteId, region) {
  const cleaned = cleanCell(siteId).toUpperCase()
  if (!cleaned || !region) return null
  if (WAREHOUSE_ALIAS_TO_FIELD[cleaned]) return WAREHOUSE_ALIAS_TO_FIELD[cleaned]
  if (!isWarehouseLike(cleaned)) return null

  const defaults = DEFAULT_WAREHOUSE_FIELD_BY_REGION[region]
  if (!defaults) return null
  if (cleaned.startsWith('VOX-') && defaults.vox) return defaults.vox
  if (cleaned.startsWith('WAR-') && defaults.war) return defaults.war
  return defaults.fallback || null
}

async function loadBufferFromInput(input) {
  if (Buffer.isBuffer(input)) return input
  const filePath = path.resolve(String(input))
  return fs.readFile(filePath)
}

async function runBatches(items, batchSize, worker) {
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize)
    await Promise.all(batch.map(worker))
  }
}

export function invalidateStockManagementCache() {
  projectionCache.value = null
  projectionCache.createdAt = 0
  runRateCache.value = null
  runRateCache.createdAt = 0
}

export function getTemplateHeaderRows() {
  return [STOCK_EXPORT_HEADER_ROW_1, STOCK_EXPORT_HEADER_ROW_2]
}

function parseTemplateWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = workbook.Sheets[STOCK_TEMPLATE_SHEET]
  if (!sheet) {
    throw new Error(`Template sheet ${STOCK_TEMPLATE_SHEET} not found`)
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  let currentSection = null
  const output = []

  for (let index = TEMPLATE_DATA_ROW_START_INDEX; index < rows.length; index += 1) {
    const row = rows[index] || []
    const itemDescription = cleanCell(row[0])
    const stockCode = cleanCell(row[1])
    const unitPriceZar = cleanCell(row[2])
    const unitPriceUsd = cleanCell(row[3])
    const division = cleanCell(row[4])

    if (!itemDescription && !stockCode && !division) continue

    const rowOrder = index + 1

    if (itemDescription && !stockCode && !division) {
      currentSection = itemDescription
      output.push({
        rowOrder,
        rowType: 'SECTION',
        sectionName: itemDescription,
        itemDescription,
        stockCode: null,
        unitPriceZar: null,
        unitPriceUsd: null,
        division: null,
        requiredCpt: 0,
        requiredJhb: 0,
        requiredDbn: 0,
        requiredPel: 0,
        requiredBfn: 0,
        requiredGeo: 0,
        requiredPol: 0,
        requiredNel: 0
      })
      continue
    }

    output.push({
      rowOrder,
      rowType: 'ITEM',
      sectionName: currentSection,
      itemDescription,
      stockCode: stockCode || null,
      unitPriceZar: unitPriceZar || null,
      unitPriceUsd: unitPriceUsd || null,
      division: division || null,
      requiredCpt: toInt(row[5]),
      requiredJhb: toInt(row[6]),
      requiredDbn: toInt(row[7]),
      requiredPel: toInt(row[8]),
      requiredBfn: toInt(row[9]),
      requiredGeo: toInt(row[10]),
      requiredPol: toInt(row[11]),
      requiredNel: toInt(row[12])
    })
  }

  return output
}

export async function importStockTemplateWorkbook(prisma, input) {
  const buffer = await loadBufferFromInput(input)
  const records = parseTemplateWorkbook(buffer)
  const rowOrders = records.map((record) => record.rowOrder)

  const existingRows = await prisma.stockTemplateItem.findMany({
    select: {
      id: true,
      rowOrder: true,
      requiredCpt: true,
      requiredJhb: true,
      requiredDbn: true,
      requiredPel: true,
      requiredBfn: true,
      requiredGeo: true,
      requiredPol: true,
      requiredNel: true
    }
  })
  const existingByRowOrder = new Map(existingRows.map((row) => [row.rowOrder, row]))

  const updates = []
  const creates = []

  for (const record of records) {
    const existing = existingByRowOrder.get(record.rowOrder)
    if (existing) {
      const nextRecord = { ...record }

      // Preserve manual minimum-spares corrections when the source template still carries zeros.
      if (sumRequiredSpares(nextRecord) === 0 && sumRequiredSpares(existing) > 0) {
        nextRecord.requiredCpt = existing.requiredCpt
        nextRecord.requiredJhb = existing.requiredJhb
        nextRecord.requiredDbn = existing.requiredDbn
        nextRecord.requiredPel = existing.requiredPel
        nextRecord.requiredBfn = existing.requiredBfn
        nextRecord.requiredGeo = existing.requiredGeo
        nextRecord.requiredPol = existing.requiredPol
        nextRecord.requiredNel = existing.requiredNel
      }

      updates.push(nextRecord)
    } else {
      creates.push(record)
    }
  }

  if (creates.length) {
    await prisma.stockTemplateItem.createMany({
      data: creates
    })
  }

  await runBatches(updates, 20, async (record) => {
    await prisma.stockTemplateItem.update({
      where: { rowOrder: record.rowOrder },
      data: {
        rowType: record.rowType,
        sectionName: record.sectionName,
        itemDescription: record.itemDescription,
        stockCode: record.stockCode,
        unitPriceZar: record.unitPriceZar,
        unitPriceUsd: record.unitPriceUsd,
        division: record.division,
        requiredCpt: record.requiredCpt,
        requiredJhb: record.requiredJhb,
        requiredDbn: record.requiredDbn,
        requiredPel: record.requiredPel,
        requiredBfn: record.requiredBfn,
        requiredGeo: record.requiredGeo,
        requiredPol: record.requiredPol,
        requiredNel: record.requiredNel
      }
    })
  })

  await prisma.stockTemplateItem.deleteMany({
    where: {
      rowOrder: { notIn: rowOrders }
    }
  })

  invalidateStockManagementCache()
  return { importedRows: records.length }
}

function parseStockStatusWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) throw new Error('Stock status workbook has no worksheets')

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
  const reportDate = parseReportDate(rows?.[0]?.[2])
  const headers = rows[STATUS_HEADER_ROW_INDEX] || []

  const records = rows.slice(STATUS_HEADER_ROW_INDEX + 1)
    .map((row) => Object.fromEntries(headers.map((header, index) => [cleanCell(header), cleanCell(row[index])])))
    .filter((row) => row['Item No'] && row['Item Description'])
    .map((row) => ({
      itemNo: row['Item No'],
      itemDescription: row['Item Description'],
      itemShortName: row['Item Short Name'] || null,
      itemClass: row['Item Class'] || null,
      siteId: row['Site ID'] || null,
      itemGenericDescription: row['Item Generic Description'] || null,
      itemTrackingOption: row['Item Tracking Option'] || null,
      qtyOnOrder: toInt(row['Qty on Order']),
      qtyAllocated: toInt(row['Qty Allocated']),
      qtyOnHand: toInt(row['Qty on Hand']),
      qtyAvailable: toInt(row['Qty Available']),
      valuationText: row.Valuation || null
    }))

  return {
    reportDate,
    records
  }
}

function buildStatusItemGroups(statusRows) {
  const exactMap = new Map()
  const canonicalMap = new Map()
  const descriptionMap = new Map()

  for (const row of statusRows) {
    const itemNo = normalizeCode(row.itemNo)
    if (!itemNo) continue

    let group = exactMap.get(itemNo)
    if (!group) {
      group = {
        itemNo,
        canonicalCode: canonicalCode(itemNo),
        descriptions: new Set(),
        normalizedDescriptions: new Set(),
        rows: []
      }
      exactMap.set(itemNo, group)
      if (!canonicalMap.has(group.canonicalCode)) canonicalMap.set(group.canonicalCode, [])
      canonicalMap.get(group.canonicalCode).push(group)
    }

    group.rows.push(row)
    group.descriptions.add(cleanCell(row.itemDescription))
    group.normalizedDescriptions.add(normalizeDescription(row.itemDescription))
  }

  const groups = [...exactMap.values()].map((group) => {
    const descriptions = [...group.descriptions].filter(Boolean)
    const normalizedDescriptions = [...group.normalizedDescriptions].filter(Boolean)
    return {
      ...group,
      descriptions,
      normalizedDescriptions,
      primaryDescription: descriptions[0] || group.itemNo
    }
  })

  for (const group of groups) {
    for (const normalized of group.normalizedDescriptions) {
      if (!descriptionMap.has(normalized)) descriptionMap.set(normalized, [])
      descriptionMap.get(normalized).push(group)
    }
  }

  return { exactMap, canonicalMap, descriptionMap, groups }
}

function chooseMatchForTemplateItem(templateItem, indexes) {
  const rawCode = normalizeCode(templateItem.stockCode || '')
  const manualCode = normalizeCode(templateItem.manualMatchItemNo || '')
  const canonical = canonicalCode(manualCode || rawCode)
  const description = templateItem.manualMatchDescription || templateItem.itemDescription || ''
  const normalizedDescription = normalizeDescription(description)

  if (manualCode && indexes.exactMap.has(manualCode)) {
    return { group: indexes.exactMap.get(manualCode), method: 'manual_override', score: 1, candidates: [] }
  }

  if (rawCode && indexes.exactMap.has(rawCode)) {
    return { group: indexes.exactMap.get(rawCode), method: 'exact_code', score: 1, candidates: [] }
  }

  if (canonical) {
    const canonicalMatches = indexes.canonicalMap.get(canonical) || []
    if (canonicalMatches.length === 1) {
      return {
        group: canonicalMatches[0],
        method: manualCode ? 'manual_canonical_code' : 'canonical_code',
        score: 0.98,
        candidates: []
      }
    }
  }

  if (normalizedDescription) {
    const exactDescMatches = uniqueBy(indexes.descriptionMap.get(normalizedDescription) || [], (group) => group.itemNo)
    if (exactDescMatches.length === 1) {
      return { group: exactDescMatches[0], method: 'exact_description', score: 0.96, candidates: [] }
    }
  }

  const fuzzyCandidates = uniqueBy(
    indexes.groups
      .map((group) => ({
        itemNo: group.itemNo,
        itemDescription: group.primaryDescription,
        score: buildFuzzyScore(description, group.primaryDescription),
        group
      }))
      .filter((candidate) => candidate.score > 0.2)
      .sort((left, right) => right.score - left.score),
    (candidate) => candidate.itemNo
  ).slice(0, 5)

  const best = fuzzyCandidates[0] || null
  const second = fuzzyCandidates[1] || null

  if (best && best.score >= MATCH_ACCEPT_THRESHOLD && (!second || (best.score - second.score) >= MATCH_MARGIN_THRESHOLD)) {
    return {
      group: best.group,
      method: 'fuzzy_description',
      score: Number(best.score.toFixed(4)),
      candidates: fuzzyCandidates.map(({ group, ...candidate }) => candidate)
    }
  }

  return {
    group: null,
    method: 'unmatched',
    score: best ? Number(best.score.toFixed(4)) : 0,
    candidates: fuzzyCandidates.map(({ group, ...candidate }) => candidate)
  }
}

function createEmptyProjectionFields() {
  return {
    cptWarehousePrimary: 0,
    cptWarehouseSecondary: 0,
    jhbWarehousePrimary: 0,
    jhbWarehouseSecondary: 0,
    dbnWarehousePrimary: 0,
    pelWarehousePrimary: 0,
    pelWarehouseSecondary: 0,
    bfnWarehousePrimary: 0,
    geoWarehousePrimary: 0,
    polWarehousePrimary: 0,
    nelWarehousePrimary: 0,
    cptTotal: 0,
    jhbTotal: 0,
    dbnTotal: 0,
    pelTotal: 0,
    bfnTotal: 0,
    geoTotal: 0,
    polTotal: 0,
    nelTotal: 0,
    notInWarehouses: 0,
    availableTotal: 0,
    allAvailableTotal: 0,
    orderedStock: 0,
    unknownSiteQty: 0,
    regionFieldTotals: {
      CPT: 0,
      JHB: 0,
      DBN: 0,
      PEL: 0,
      BFN: 0,
      GEO: 0,
      POL: 0,
      NEL: 0
    }
  }
}

function buildProjectedItem(templateItem, indexes) {
  if (templateItem.rowType === 'SECTION') {
    return {
      id: templateItem.id,
      rowOrder: templateItem.rowOrder,
      rowType: templateItem.rowType,
      sectionName: templateItem.sectionName,
      itemDescription: templateItem.itemDescription,
      stockCode: templateItem.stockCode,
      division: templateItem.division,
      requiredByRegion: null,
      requiredTotal: 0
    }
  }

  const requiredByRegion = {
    CPT: templateItem.requiredCpt || 0,
    JHB: templateItem.requiredJhb || 0,
    DBN: templateItem.requiredDbn || 0,
    PEL: templateItem.requiredPel || 0,
    BFN: templateItem.requiredBfn || 0,
    GEO: templateItem.requiredGeo || 0,
    POL: templateItem.requiredPol || 0,
    NEL: templateItem.requiredNel || 0
  }

  const requiredTotal = Object.values(requiredByRegion).reduce((sum, value) => sum + Number(value || 0), 0)
  const projection = createEmptyProjectionFields()
  const match = chooseMatchForTemplateItem(templateItem, indexes)
  const matchedRows = match.group?.rows || []
  const siteMap = new Map()
  let totalQtyOnHand = 0
  let totalValuation = 0

  for (const row of matchedRows) {
    const siteId = cleanCell(row.siteId) || 'UNKNOWN'
    const region = resolveSiteRegion(siteId)
    const warehouseField = resolveWarehouseField(siteId, region)
    const qtyAvailable = toInt(row.qtyAvailable)
    const qtyOnOrder = toInt(row.qtyOnOrder)
    const qtyOnHand = toInt(row.qtyOnHand)
    const valuation = toMoney(row.valuationText)

    projection.orderedStock += qtyOnOrder
    totalQtyOnHand += qtyOnHand
    totalValuation += valuation

    if (warehouseField) {
      projection[warehouseField] += qtyAvailable
      const regionKey = WAREHOUSE_FIELD_CONFIG[warehouseField].region.toLowerCase()
      projection[`${regionKey}Total`] += qtyAvailable
    } else {
      projection.notInWarehouses += qtyAvailable
      if (region) {
        projection.regionFieldTotals[region] += qtyAvailable
      } else {
        projection.unknownSiteQty += qtyAvailable
      }
    }

    const siteKey = `${siteId}::${warehouseField || 'FIELD'}::${region || 'UNKNOWN'}`
    const current = siteMap.get(siteKey) || {
      siteId,
      region: region || 'Unknown',
      warehouseLike: isWarehouseLike(siteId),
      warehouseField: warehouseField || null,
      qtyAvailable: 0,
      qtyOnOrder: 0
    }
    current.qtyAvailable += qtyAvailable
    current.qtyOnOrder += qtyOnOrder
    siteMap.set(siteKey, current)
  }

  projection.availableTotal = [
    projection.cptTotal,
    projection.jhbTotal,
    projection.dbnTotal,
    projection.pelTotal,
    projection.bfnTotal,
    projection.geoTotal,
    projection.polTotal,
    projection.nelTotal
  ].reduce((sum, value) => sum + Number(value || 0), 0)

  projection.allAvailableTotal = projection.availableTotal + Number(projection.notInWarehouses || 0)

  const siteBreakdown = [...siteMap.values()].sort((left, right) => {
    if (right.qtyAvailable !== left.qtyAvailable) return right.qtyAvailable - left.qtyAvailable
    return left.siteId.localeCompare(right.siteId)
  })

  const shortage = Math.max(requiredTotal - projection.availableTotal, 0)
  const isMatched = Boolean(match.group)
  const isLowConfidence = isMatched && match.score < MATCH_REVIEW_THRESHOLD
  const unitCost = totalQtyOnHand > 0 ? Number((totalValuation / totalQtyOnHand).toFixed(2)) : 0
  const gapCost = Number((shortage * unitCost).toFixed(2))

  return {
    id: templateItem.id,
    rowOrder: templateItem.rowOrder,
    rowType: templateItem.rowType,
    sectionName: templateItem.sectionName,
    itemDescription: templateItem.itemDescription,
    stockCode: templateItem.stockCode,
    unitPriceZar: templateItem.unitPriceZar,
    unitPriceUsd: templateItem.unitPriceUsd,
    division: templateItem.division,
    requiredByRegion,
    requiredTotal,
    totalQtyOnHand,
    totalValuation,
    unitCost,
    matchedItemNo: match.group?.itemNo || null,
    matchedItemDescription: match.group?.primaryDescription || null,
    matchMethod: match.method,
    matchScore: match.score,
    matchStatus: isMatched ? (isLowConfidence ? 'Needs review' : 'Matched') : 'Unmatched',
    isLowConfidence,
    ...projection,
    shortage,
    gapCost,
    belowMinimum: projection.availableTotal < requiredTotal,
    candidateMatches: match.candidates,
    siteBreakdown
  }
}

function buildRegionWatchlistRows(itemRows) {
  return REGION_ORDER.map((region) => {
    const regionKey = region.toLowerCase()
    const rows = itemRows
      .map((row) => {
        const required = Number(row.requiredByRegion?.[region] || 0)
        const warehouseAvailable = Number(row[`${regionKey}Total`] || 0)
        const notWh = Number(row.regionFieldTotals?.[region] || 0)
        const gap = Math.max(required - warehouseAvailable, 0)
        return {
          id: row.id,
          row: {
            id: row.id,
            itemDescription: row.itemDescription
          },
          itemDescription: row.itemDescription,
          stockCode: row.stockCode,
          sectionName: row.sectionName,
          division: row.division,
          required,
          warehouseAvailable,
          notWh,
          gap,
          unitCost: Number(row.unitCost || 0),
          gapCost: Number((gap * Number(row.unitCost || 0)).toFixed(2))
        }
      })
      .filter((entry) => entry.gap > 0)
      .sort((left, right) => right.gap - left.gap || right.gapCost - left.gapCost || String(left.itemDescription || '').localeCompare(String(right.itemDescription || '')))

    return {
      region,
      totalGap: rows.reduce((sum, entry) => sum + entry.gap, 0),
      totalGapCost: Number(rows.reduce((sum, entry) => sum + Number(entry.gapCost || 0), 0).toFixed(2)),
      affectedItems: rows.length,
      rows
    }
  }).filter((entry) => entry.affectedItems > 0)
}

function buildCurrentDataset(templateItems, statusRows, latestImport, importHistory, notWarehouseActions = []) {
  const indexes = buildStatusItemGroups(statusRows)
  const actionMap = new Map(
    notWarehouseActions.map((row) => [`${row.templateItemId}::${cleanCell(row.siteId).toUpperCase()}`, row])
  )
  const projectedRows = templateItems
    .sort((left, right) => left.rowOrder - right.rowOrder)
    .map((item) => buildProjectedItem(item, indexes))

  const itemRows = projectedRows.filter((row) => row.rowType === 'ITEM')
  const matchedRows = itemRows.filter((row) => row.matchMethod !== 'unmatched')
  const lowConfidenceRows = itemRows.filter((row) => row.isLowConfidence)
  const unresolvedRows = itemRows.filter((row) => row.matchMethod === 'unmatched')
  const lowStockRows = itemRows
    .filter((row) => row.belowMinimum)
    .sort((left, right) => right.shortage - left.shortage || right.gapCost - left.gapCost || left.itemDescription.localeCompare(right.itemDescription))
  const regionWatchlist = buildRegionWatchlistRows(itemRows)

  const notWarehouseItems = itemRows
    .flatMap((row) => (row.siteBreakdown || [])
      .filter((site) => !site.warehouseField && Number(site.qtyAvailable || 0) > 0)
      .map((site) => {
        const action = actionMap.get(`${row.id}::${cleanCell(site.siteId).toUpperCase()}`)
        return {
          key: `${row.id}::${site.siteId}`,
          templateItemId: row.id,
          itemDescription: row.itemDescription,
          stockCode: row.stockCode,
          division: row.division,
          siteId: site.siteId,
          region: site.region,
          qtyAvailable: Number(site.qtyAvailable || 0),
          qtyOnOrder: Number(site.qtyOnOrder || 0),
          unitCost: Number(row.unitCost || 0),
          totalValue: Number((Number(site.qtyAvailable || 0) * Number(row.unitCost || 0)).toFixed(2)),
          status: action?.status || 'PENDING_REVIEW',
          notes: action?.notes || '',
          updatedBy: action?.updatedBy || '',
          updatedAt: action?.updatedAt || null
        }
      }))
    .sort((left, right) => right.qtyAvailable - left.qtyAvailable || left.itemDescription.localeCompare(right.itemDescription))

  const regionSummary = REGION_ORDER.map((region) => {
    const regionKey = region.toLowerCase()
    const requiredTotal = itemRows.reduce((sum, row) => sum + Number(row.requiredByRegion?.[region] || 0), 0)
    const warehouseTotal = itemRows.reduce((sum, row) => sum + Number(row[`${regionKey}Total`] || 0), 0)
    const fieldTotal = itemRows.reduce((sum, row) => sum + Number(row.regionFieldTotals?.[region] || 0), 0)
    return {
      region,
      requiredTotal,
      warehouseTotal,
      fieldTotal,
      availableTotal: warehouseTotal + fieldTotal,
      usableAvailableTotal: warehouseTotal,
      gap: Math.max(requiredTotal - warehouseTotal, 0)
    }
  })

  const divisionMap = new Map()
  for (const row of itemRows) {
    const key = cleanCell(row.division) || 'Unassigned'
    const current = divisionMap.get(key) || {
      division: key,
      itemCount: 0,
      lowStockCount: 0,
      availableTotal: 0,
      allAvailableTotal: 0,
      requiredTotal: 0,
      orderedStock: 0,
      notInWarehouseTotal: 0,
      gapCostTotal: 0
    }
    current.itemCount += 1
    if (row.belowMinimum) current.lowStockCount += 1
    current.availableTotal += Number(row.availableTotal || 0)
    current.allAvailableTotal += Number(row.allAvailableTotal || 0)
    current.requiredTotal += Number(row.requiredTotal || 0)
    current.orderedStock += Number(row.orderedStock || 0)
    current.notInWarehouseTotal += Number(row.notInWarehouses || 0)
    current.gapCostTotal += Number(row.gapCost || 0)
    divisionMap.set(key, current)
  }

  return {
    generatedAt: new Date().toISOString(),
    latestImport,
    importHistory,
    summary: {
      templateItemCount: itemRows.length,
      matchedItemCount: matchedRows.length,
      lowConfidenceCount: lowConfidenceRows.length,
      unresolvedItemCount: unresolvedRows.length,
      lowStockCount: lowStockRows.length,
      orderedStockTotal: itemRows.reduce((sum, row) => sum + Number(row.orderedStock || 0), 0),
      notInWarehouseTotal: itemRows.reduce((sum, row) => sum + Number(row.notInWarehouses || 0), 0),
      availableTotal: itemRows.reduce((sum, row) => sum + Number(row.availableTotal || 0), 0),
      allAvailableTotal: itemRows.reduce((sum, row) => sum + Number(row.allAvailableTotal || 0), 0),
      requiredTotal: itemRows.reduce((sum, row) => sum + Number(row.requiredTotal || 0), 0),
      gapCostTotal: Number(itemRows.reduce((sum, row) => sum + Number(row.gapCost || 0), 0).toFixed(2)),
      unknownSiteQtyTotal: itemRows.reduce((sum, row) => sum + Number(row.unknownSiteQty || 0), 0),
      matchCoveragePct: itemRows.length ? Number(((matchedRows.length / itemRows.length) * 100).toFixed(2)) : 0
    },
    regionSummary,
    divisionSummary: [...divisionMap.values()].sort((left, right) => right.lowStockCount - left.lowStockCount || left.division.localeCompare(right.division)),
    lowStockItems: lowStockRows,
    regionWatchlist,
    sectionOptions: templateItems.filter((row) => row.rowType === 'SECTION').map((row) => row.itemDescription || row.sectionName).filter(Boolean),
    matchReviewItems: [...lowConfidenceRows, ...unresolvedRows].sort((left, right) => {
      if (left.matchMethod === 'unmatched' && right.matchMethod !== 'unmatched') return -1
      if (left.matchMethod !== 'unmatched' && right.matchMethod === 'unmatched') return 1
      return left.itemDescription.localeCompare(right.itemDescription)
    }),
    notWarehouseItems,
    items: projectedRows
  }
}

export async function getCurrentStockDataset(prisma, { forceFresh = false } = {}) {
  if (!forceFresh && projectionCache.value && (Date.now() - projectionCache.createdAt) < 60_000) {
    return projectionCache.value
  }

  const [templateItems, statusRows, importRuns, notWarehouseActions] = await Promise.all([
    prisma.stockTemplateItem.findMany({ orderBy: { rowOrder: 'asc' } }),
    prisma.stockStatusCurrentRow.findMany({ orderBy: [{ itemNo: 'asc' }, { siteId: 'asc' }] }),
    prisma.stockImportRun.findMany({ orderBy: { createdAt: 'desc' }, take: 10 }),
    prisma.stockNotWarehouseAction.findMany({ orderBy: { updatedAt: 'desc' } })
  ])

  const dataset = buildCurrentDataset(
    templateItems,
    statusRows,
    importRuns[0] || null,
    importRuns.map((row) => ({
      id: row.id,
      reportDate: row.reportDate,
      sourceFilename: row.sourceFilename,
      createdAt: row.createdAt,
      statusRowCount: row.statusRowCount,
      matchedItemCount: row.matchedItemCount,
      lowConfidenceCount: row.lowConfidenceCount,
      unresolvedItemCount: row.unresolvedItemCount,
      unknownSiteCount: row.unknownSiteCount
    })),
    notWarehouseActions
  )

  projectionCache.value = dataset
  projectionCache.createdAt = Date.now()
  return dataset
}

async function ensureLatestStockHistoryBackfill(prisma) {
  const latestRun = await prisma.stockImportRun.findFirst({
    orderBy: { createdAt: 'desc' }
  })

  if (!latestRun) return false

  const historyCount = await prisma.stockStatusHistoryRow.count({
    where: { importRunId: latestRun.id }
  })
  if (historyCount > 0) return false

  const currentRows = await prisma.stockStatusCurrentRow.findMany({
    where: { importRunId: latestRun.id },
    orderBy: [{ itemNo: 'asc' }, { siteId: 'asc' }]
  })

  if (!currentRows.length) return false

  for (let index = 0; index < currentRows.length; index += 500) {
    const batch = currentRows.slice(index, index + 500)
    await prisma.stockStatusHistoryRow.createMany({
      data: batch.map((row) => ({
        importRunId: row.importRunId,
        itemNo: row.itemNo,
        itemDescription: row.itemDescription,
        itemShortName: row.itemShortName,
        itemClass: row.itemClass,
        siteId: row.siteId,
        itemGenericDescription: row.itemGenericDescription,
        itemTrackingOption: row.itemTrackingOption,
        qtyOnOrder: row.qtyOnOrder,
        qtyAllocated: row.qtyAllocated,
        qtyOnHand: row.qtyOnHand,
        qtyAvailable: row.qtyAvailable,
        valuationText: row.valuationText,
        regionHint: row.regionHint,
        isWarehouseLike: row.isWarehouseLike
      }))
    })
  }

  return true
}

function buildRunRateRowMeta(row, region) {
  return {
    templateItemId: row.id,
    itemDescription: row.itemDescription,
    stockCode: row.stockCode,
    sectionName: row.sectionName,
    division: row.division,
    region
  }
}

function monthKeyFromValue(value) {
  return dayjs(value).format('YYYY-MM')
}

export async function getStockRunRateDataset(prisma, { forceFresh = false } = {}) {
  if (!forceFresh && runRateCache.value && (Date.now() - runRateCache.createdAt) < 60_000) {
    return runRateCache.value
  }

  const seededCurrentSnapshot = await ensureLatestStockHistoryBackfill(prisma)
  const cutoffDate = dayjs().subtract(400, 'day').toDate()

  const [templateItems, importRuns] = await Promise.all([
    prisma.stockTemplateItem.findMany({
      where: { rowType: 'ITEM' },
      orderBy: { rowOrder: 'asc' }
    }),
    prisma.stockImportRun.findMany({
      where: {
        OR: [
          { reportDate: { gte: cutoffDate } },
          { createdAt: { gte: cutoffDate } }
        ]
      },
      orderBy: { createdAt: 'asc' }
    })
  ])

  if (!importRuns.length || !templateItems.length) {
    const emptyDataset = {
      generatedAt: new Date().toISOString(),
      summary: {
        monthsTracked: 0,
        snapshotsTracked: 0,
        activeItemCount: 0,
        latestSnapshotDate: null,
        currentMonthUsage: 0,
        currentMonthProjectedUsage: 0
      },
      monthOptions: [],
      defaultMonth: dayjs().format('YYYY-MM'),
      monthSummary: [],
      rows: [],
      seededCurrentSnapshot,
      hasEnoughHistory: false
    }
    runRateCache.value = emptyDataset
    runRateCache.createdAt = Date.now()
    return emptyDataset
  }

  const historyRows = await prisma.stockStatusHistoryRow.findMany({
    where: {
      importRunId: { in: importRuns.map((row) => row.id) }
    },
    orderBy: [{ importRunId: 'asc' }, { itemNo: 'asc' }, { siteId: 'asc' }]
  })

  const rowsByRun = new Map()
  historyRows.forEach((row) => {
    const current = rowsByRun.get(row.importRunId) || []
    current.push(row)
    rowsByRun.set(row.importRunId, current)
  })

  const orderedRuns = importRuns
    .map((run) => ({
      ...run,
      snapshotDate: run.reportDate || run.createdAt
    }))
    .filter((run) => rowsByRun.has(run.id))
    .sort((left, right) => new Date(left.snapshotDate).getTime() - new Date(right.snapshotDate).getTime())

  const seriesMap = new Map()

  for (const run of orderedRuns) {
    const indexes = buildStatusItemGroups(rowsByRun.get(run.id) || [])
    for (const templateItem of templateItems) {
      const projected = buildProjectedItem(templateItem, indexes)
      for (const region of REGION_ORDER) {
        const regionKey = region.toLowerCase()
        const required = Number(projected.requiredByRegion?.[region] || 0)
        const warehouseAvailable = Number(projected[`${regionKey}Total`] || 0)
        const fieldAvailable = Number(projected.regionFieldTotals?.[region] || 0)
        const orderedStock = Number(projected.orderedStock || 0)

        if (!required && !warehouseAvailable && !fieldAvailable && !orderedStock && projected.matchMethod === 'unmatched') {
          continue
        }

        const key = `${projected.id}::${region}`
        const current = seriesMap.get(key) || {
          ...buildRunRateRowMeta(projected, region),
          matchedItemNo: projected.matchedItemNo || null,
          snapshots: []
        }

        current.matchedItemNo = projected.matchedItemNo || current.matchedItemNo || null
        current.snapshots.push({
          runId: run.id,
          snapshotDate: run.snapshotDate,
          warehouseAvailable,
          fieldAvailable,
          orderedStock,
          required
        })

        seriesMap.set(key, current)
      }
    }
  }

  const monthSummaryMap = new Map()
  const rows = []
  const latestSnapshotDate = orderedRuns.at(-1)?.snapshotDate || null
  const latestMonth = latestSnapshotDate ? monthKeyFromValue(latestSnapshotDate) : dayjs().format('YYYY-MM')

  for (const series of seriesMap.values()) {
    const snapshots = [...series.snapshots].sort((left, right) => new Date(left.snapshotDate).getTime() - new Date(right.snapshotDate).getTime())
    if (!snapshots.length) continue

    const monthBuckets = new Map()
    for (const snapshot of snapshots) {
      const yearMonth = monthKeyFromValue(snapshot.snapshotDate)
      const current = monthBuckets.get(yearMonth) || {
        yearMonth,
        templateItemId: series.templateItemId,
        itemDescription: series.itemDescription,
        stockCode: series.stockCode,
        sectionName: series.sectionName,
        division: series.division,
        region: series.region,
        matchedItemNo: series.matchedItemNo,
        usageQty: 0,
        restockQty: 0,
        snapshots: []
      }
      current.snapshots.push(snapshot)
      monthBuckets.set(yearMonth, current)
    }

    for (let index = 1; index < snapshots.length; index += 1) {
      const previous = snapshots[index - 1]
      const current = snapshots[index]
      const yearMonth = monthKeyFromValue(current.snapshotDate)
      const bucket = monthBuckets.get(yearMonth)
      bucket.usageQty += Math.max(previous.warehouseAvailable - current.warehouseAvailable, 0)
      bucket.restockQty += Math.max(current.warehouseAvailable - previous.warehouseAvailable, 0)
    }

    for (const bucket of monthBuckets.values()) {
      const monthSnapshots = bucket.snapshots.sort((left, right) => new Date(left.snapshotDate).getTime() - new Date(right.snapshotDate).getTime())
      const firstSnapshot = monthSnapshots[0]
      const lastSnapshot = monthSnapshots.at(-1)
      const daysTracked = Math.max(
        dayjs(lastSnapshot.snapshotDate).startOf('day').diff(dayjs(firstSnapshot.snapshotDate).startOf('day'), 'day') + 1,
        1
      )
      const usageQty = Number(bucket.usageQty.toFixed(2))
      const restockQty = Number(bucket.restockQty.toFixed(2))
      const avgDailyUsage = Number((usageQty / daysTracked).toFixed(2))
      const monthDays = dayjs(`${bucket.yearMonth}-01`).daysInMonth()
      const projectedUsage = Number(((usageQty / daysTracked) * monthDays).toFixed(2))
      const netChange = Number((lastSnapshot.warehouseAvailable - firstSnapshot.warehouseAvailable).toFixed(2))

      const row = {
        yearMonth: bucket.yearMonth,
        templateItemId: bucket.templateItemId,
        itemDescription: bucket.itemDescription,
        stockCode: bucket.stockCode,
        sectionName: bucket.sectionName,
        division: bucket.division,
        region: bucket.region,
        matchedItemNo: bucket.matchedItemNo,
        usageQty,
        restockQty,
        netChange,
        avgDailyUsage,
        projectedUsage: bucket.yearMonth === latestMonth ? projectedUsage : usageQty,
        snapshotCount: monthSnapshots.length,
        daysTracked,
        firstSnapshotDate: firstSnapshot.snapshotDate,
        lastSnapshotDate: lastSnapshot.snapshotDate,
        startingWarehouse: firstSnapshot.warehouseAvailable,
        endingWarehouse: lastSnapshot.warehouseAvailable,
        latestFieldAvailable: lastSnapshot.fieldAvailable,
        latestOrderedStock: lastSnapshot.orderedStock,
        required: lastSnapshot.required
      }

      rows.push(row)

      const monthState = monthSummaryMap.get(bucket.yearMonth) || {
        yearMonth: bucket.yearMonth,
        usageQty: 0,
        restockQty: 0,
        netChange: 0,
        projectedUsage: 0,
        itemCount: 0,
        movementItemCount: 0,
        regionMap: new Map()
      }

      monthState.usageQty += row.usageQty
      monthState.restockQty += row.restockQty
      monthState.netChange += row.netChange
      monthState.projectedUsage += row.projectedUsage
      monthState.itemCount += 1
      if (row.usageQty > 0 || row.restockQty > 0) monthState.movementItemCount += 1

      const regionState = monthState.regionMap.get(row.region) || {
        region: row.region,
        usageQty: 0,
        restockQty: 0,
        netChange: 0,
        itemCount: 0,
        movementItemCount: 0
      }
      regionState.usageQty += row.usageQty
      regionState.restockQty += row.restockQty
      regionState.netChange += row.netChange
      regionState.itemCount += 1
      if (row.usageQty > 0 || row.restockQty > 0) regionState.movementItemCount += 1
      monthState.regionMap.set(row.region, regionState)
      monthSummaryMap.set(bucket.yearMonth, monthState)
    }
  }

  const monthSummary = [...monthSummaryMap.values()]
    .map((month) => ({
      yearMonth: month.yearMonth,
      usageQty: Number(month.usageQty.toFixed(2)),
      restockQty: Number(month.restockQty.toFixed(2)),
      netChange: Number(month.netChange.toFixed(2)),
      projectedUsage: Number(month.projectedUsage.toFixed(2)),
      itemCount: month.itemCount,
      movementItemCount: month.movementItemCount,
      regionBreakdown: REGION_ORDER.map((region) => {
        const current = month.regionMap.get(region) || {
          region,
          usageQty: 0,
          restockQty: 0,
          netChange: 0,
          itemCount: 0,
          movementItemCount: 0
        }
        return {
          ...current,
          usageQty: Number(current.usageQty.toFixed(2)),
          restockQty: Number(current.restockQty.toFixed(2)),
          netChange: Number(current.netChange.toFixed(2))
        }
      }).filter((entry) => entry.itemCount > 0)
    }))
    .sort((left, right) => left.yearMonth.localeCompare(right.yearMonth))

  const dataset = {
    generatedAt: new Date().toISOString(),
    summary: {
      monthsTracked: monthSummary.length,
      snapshotsTracked: orderedRuns.length,
      activeItemCount: new Set(rows.map((row) => row.templateItemId)).size,
      latestSnapshotDate,
      currentMonthUsage: Number((monthSummary.find((row) => row.yearMonth === latestMonth)?.usageQty || 0).toFixed(2)),
      currentMonthProjectedUsage: Number((monthSummary.find((row) => row.yearMonth === latestMonth)?.projectedUsage || 0).toFixed(2))
    },
    monthOptions: monthSummary.map((row) => row.yearMonth),
    defaultMonth: latestMonth,
    monthSummary,
    rows: rows.sort((left, right) => right.usageQty - left.usageQty || right.restockQty - left.restockQty || left.itemDescription.localeCompare(right.itemDescription)),
    seededCurrentSnapshot,
    hasEnoughHistory: orderedRuns.length > 1
  }

  runRateCache.value = dataset
  runRateCache.createdAt = Date.now()
  return dataset
}

function createStockTemplateError(message, statusCode = 400) {
  const error = new Error(message)
  error.statusCode = statusCode
  return error
}

function buildRequiredSparePayload(source, carryRequiredSpares) {
  if (!carryRequiredSpares) {
    return {
      requiredCpt: 0,
      requiredJhb: 0,
      requiredDbn: 0,
      requiredPel: 0,
      requiredBfn: 0,
      requiredGeo: 0,
      requiredPol: 0,
      requiredNel: 0
    }
  }

  return {
    requiredCpt: source.requiredCpt,
    requiredJhb: source.requiredJhb,
    requiredDbn: source.requiredDbn,
    requiredPel: source.requiredPel,
    requiredBfn: source.requiredBfn,
    requiredGeo: source.requiredGeo,
    requiredPol: source.requiredPol,
    requiredNel: source.requiredNel
  }
}

function buildReviewClone(source, candidate, carryRequiredSpares) {
  return {
    rowType: source.rowType,
    sectionName: source.sectionName,
    itemDescription: candidate.itemDescription,
    stockCode: candidate.itemNo,
    unitPriceZar: source.unitPriceZar,
    unitPriceUsd: source.unitPriceUsd,
    division: source.division,
    manualMatchItemNo: candidate.itemNo,
    manualMatchDescription: candidate.itemDescription,
    ...buildRequiredSparePayload(source, carryRequiredSpares)
  }
}

export async function applyStockTemplateReviewChanges(prisma, templateItemId, { deleteOriginal = false, additions = [] } = {}) {
  const source = await prisma.stockTemplateItem.findUnique({ where: { id: templateItemId } })
  if (!source) {
    throw createStockTemplateError('Template item not found', 404)
  }

  if (source.rowType !== 'ITEM') {
    throw createStockTemplateError('Review actions can only be applied to item rows')
  }

  const normalizedAdditions = uniqueBy(
    (Array.isArray(additions) ? additions : [])
      .map((candidate) => ({
        itemNo: cleanCell(candidate?.itemNo),
        itemDescription: cleanCell(candidate?.itemDescription)
      }))
      .filter((candidate) => candidate.itemNo),
    (candidate) => candidate.itemNo
  )

  if (!deleteOriginal && !normalizedAdditions.length) {
    throw createStockTemplateError('Select at least one close match or choose to delete the template item')
  }

  let approvedCandidates = []
  if (normalizedAdditions.length) {
    const statusRows = await prisma.stockStatusCurrentRow.findMany({
      orderBy: [{ itemNo: 'asc' }, { siteId: 'asc' }]
    })
    const indexes = buildStatusItemGroups(statusRows)
    const reviewState = buildProjectedItem(source, indexes)
    const candidateMap = new Map((reviewState.candidateMatches || []).map((candidate) => [candidate.itemNo, candidate]))

    approvedCandidates = normalizedAdditions.map((candidate) => {
      const matched = candidateMap.get(candidate.itemNo)
      if (!matched) {
        throw createStockTemplateError(`Candidate ${candidate.itemNo} is no longer available for this review item`)
      }
      return {
        itemNo: matched.itemNo,
        itemDescription: matched.itemDescription
      }
    })
  }

  const orderedRows = await prisma.stockTemplateItem.findMany({
    orderBy: [{ rowOrder: 'asc' }, { id: 'asc' }]
  })
  if (!orderedRows.some((row) => row.id === templateItemId)) {
    throw createStockTemplateError('Template item not found', 404)
  }

  const finalRows = []
  for (const row of orderedRows) {
    if (row.id !== templateItemId) {
      finalRows.push({ kind: 'existing', id: row.id })
      continue
    }

    if (!deleteOriginal) {
      finalRows.push({ kind: 'existing', id: row.id })
    }

    approvedCandidates.forEach((candidate, index) => {
      const carryRequiredSpares = deleteOriginal && approvedCandidates.length === 1 && index === 0
      finalRows.push({
        kind: 'new',
        data: buildReviewClone(source, candidate, carryRequiredSpares)
      })
    })
  }

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < orderedRows.length; index += 1) {
      await tx.stockTemplateItem.update({
        where: { id: orderedRows[index].id },
        data: { rowOrder: -1_000_000 - index }
      })
    }

    if (deleteOriginal) {
      await tx.stockTemplateItem.delete({ where: { id: templateItemId } })
    }

    for (let index = 0; index < finalRows.length; index += 1) {
      const nextRowOrder = TEMPLATE_DATA_ROW_START_INDEX + 1 + index
      const entry = finalRows[index]
      if (entry.kind === 'new') {
        await tx.stockTemplateItem.create({
          data: {
            ...entry.data,
            rowOrder: nextRowOrder
          }
        })
      } else {
        await tx.stockTemplateItem.update({
          where: { id: entry.id },
          data: { rowOrder: nextRowOrder }
        })
      }
    }
  }, {
    maxWait: 10_000,
    timeout: 120_000
  })

  invalidateStockManagementCache()
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })

  return {
    dataset,
    meta: {
      deletedOriginal: deleteOriginal,
      addedCount: approvedCandidates.length
    }
  }
}

async function assertTemplateItemNotDuplicate(prisma, { stockCode, itemDescription, excludeId = null }) {
  const existingItems = await prisma.stockTemplateItem.findMany({
    where: { rowType: 'ITEM' },
    select: { id: true, stockCode: true, itemDescription: true }
  })

  const nextCode = normalizeCode(stockCode || '')
  const nextDescription = normalizeDescription(itemDescription || '')

  const duplicate = existingItems.find((row) => {
    if (excludeId && row.id === excludeId) return false
    const codeMatch = nextCode && normalizeCode(row.stockCode || '') === nextCode
    const descriptionMatch = nextDescription && normalizeDescription(row.itemDescription || '') === nextDescription
    return codeMatch || descriptionMatch
  })

  if (duplicate) {
    throw createStockTemplateError(`Duplicate template item detected: ${duplicate.itemDescription || duplicate.stockCode || 'Existing row'}`, 409)
  }
}

export async function createStockTemplateItem(prisma, data) {
  await assertTemplateItemNotDuplicate(prisma, {
    stockCode: data.stockCode,
    itemDescription: data.itemDescription
  })

  const aggregate = await prisma.stockTemplateItem.aggregate({
    _max: { rowOrder: true }
  })
  const nextRowOrder = Math.max(Number(aggregate._max.rowOrder || 0) + 1, TEMPLATE_DATA_ROW_START_INDEX + 1)

  const created = await prisma.stockTemplateItem.create({
    data: {
      rowOrder: nextRowOrder,
      rowType: 'ITEM',
      sectionName: cleanCell(data.sectionName) || null,
      itemDescription: cleanCell(data.itemDescription) || null,
      stockCode: cleanCell(data.stockCode) || null,
      unitPriceZar: cleanCell(data.unitPriceZar) || null,
      unitPriceUsd: cleanCell(data.unitPriceUsd) || null,
      division: cleanCell(data.division) || null,
      requiredCpt: Number(data.requiredCpt || 0),
      requiredJhb: Number(data.requiredJhb || 0),
      requiredDbn: Number(data.requiredDbn || 0),
      requiredPel: Number(data.requiredPel || 0),
      requiredBfn: Number(data.requiredBfn || 0),
      requiredGeo: Number(data.requiredGeo || 0),
      requiredPol: Number(data.requiredPol || 0),
      requiredNel: Number(data.requiredNel || 0)
    }
  })

  invalidateStockManagementCache()
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })
  return {
    item: dataset.items.find((row) => row.id === created.id) || null,
    dataset
  }
}

export async function upsertStockNotWarehouseAction(prisma, { templateItemId, siteId, status, notes, updatedBy }) {
  const templateItem = await prisma.stockTemplateItem.findUnique({
    where: { id: templateItemId }
  })

  if (!templateItem) {
    throw createStockTemplateError('Template item not found', 404)
  }

  if (templateItem.rowType !== 'ITEM') {
    throw createStockTemplateError('Not warehouse actions can only be saved for item rows')
  }

  const cleanedSiteId = cleanCell(siteId).toUpperCase()
  if (!cleanedSiteId) {
    throw createStockTemplateError('Site ID is required')
  }

  await prisma.stockNotWarehouseAction.upsert({
    where: {
      templateItemId_siteId: {
        templateItemId,
        siteId: cleanedSiteId
      }
    },
    update: {
      status: cleanCell(status) || 'PENDING_REVIEW',
      notes: cleanCell(notes) || null,
      updatedBy: cleanCell(updatedBy) || null
    },
    create: {
      templateItemId,
      siteId: cleanedSiteId,
      status: cleanCell(status) || 'PENDING_REVIEW',
      notes: cleanCell(notes) || null,
      updatedBy: cleanCell(updatedBy) || null
    }
  })

  invalidateStockManagementCache()
  return getCurrentStockDataset(prisma, { forceFresh: true })
}

async function gmailClientFromEnv() {
  const { CLIENT_ID, CLIENT_SECRET, REFRESH_TOKEN } = process.env
  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
    throw new Error('Missing CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN for Gmail access')
  }
  const auth = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET)
  auth.setCredentials({ refresh_token: REFRESH_TOKEN })
  return google.gmail({ version: 'v1', auth })
}

function walkParts(parts = []) {
  return parts.flatMap((part) => (part?.parts ? walkParts(part.parts) : [part])).filter(Boolean)
}

async function getAttachmentBuffer(gmail, messageId, attachmentId) {
  const { data: { data } } = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId,
    id: attachmentId
  })
  return Buffer.from(data, 'base64')
}

function buildSubjectNeedles(subject) {
  const defaultNeedles = [
    'stock status',
    'stock status valuation',
    'minimum stock',
    'qty on hand',
    'lvr order point qty',
    'stock status valuation was executed at',
    'minimum stock qty on hand lvr order point qty was executed at'
  ]

  return Array.from(new Set(
    [subject, ...defaultNeedles]
      .map((value) => normalizeSubject(value))
      .filter(Boolean)
  ))
}

function matchesWantedSubject(subject, needles) {
  const normalized = normalizeSubject(subject)
  return needles.some((needle) => needle && normalized.includes(needle))
}

function pickSpreadsheetAttachment(parts = []) {
  return parts
    .filter((part) => /\.(xlsx|xls)$/i.test(part.filename || ''))
    .map((part) => ({ ...part, size: Number(part.body?.size || 0) }))
    .sort((left, right) => right.size - left.size)[0] || null
}

export async function fetchStockStatusWorkbookFromGmail() {
  const gmail = await gmailClientFromEnv()
  const subject = process.env.GMAIL_STOCK_SUBJECT || 'Stock Status Valuation was executed at'
  const sender = cleanCell(process.env.GMAIL_STOCK_SENDER || '')
  const lookbackDays = Number(process.env.GMAIL_STOCK_LOOKBACK_DAYS || '14') || 14
  const needles = buildSubjectNeedles(subject)
  const q = [sender ? `from:${sender}` : null, `newer_than:${lookbackDays}d`, 'has:attachment'].filter(Boolean).join(' ')

  const { data: { messages } } = await gmail.users.messages.list({
    userId: 'me',
    q,
    maxResults: 30
  })

  if (!messages?.length) {
    throw new Error('Stock status e-mail not found in Gmail lookback window')
  }

  const candidates = []

  for (const summary of messages) {
    const { data: message } = await gmail.users.messages.get({ userId: 'me', id: summary.id })
    const messageSubject = getSubjectHeader(message)
    if (!matchesWantedSubject(messageSubject, needles)) continue

    const parts = walkParts(message.payload?.parts || [])
    const attachment = pickSpreadsheetAttachment(parts)
    if (!attachment?.body?.attachmentId) continue

    candidates.push({
      emailId: summary.id,
      subject: messageSubject,
      attachmentId: attachment.body.attachmentId,
      filename: attachment.filename || 'stock-status.xlsx',
      subjectReportDate: parseStockStatusSubjectDate(messageSubject),
      internalDate: message.internalDate ? new Date(Number(message.internalDate)) : null
    })
  }

  const selected = candidates
    .sort((left, right) => {
      const leftTime = left.subjectReportDate?.getTime() ?? left.internalDate?.getTime() ?? 0
      const rightTime = right.subjectReportDate?.getTime() ?? right.internalDate?.getTime() ?? 0
      return rightTime - leftTime
    })[0]

  if (selected) {
    const buffer = await getAttachmentBuffer(gmail, selected.emailId, selected.attachmentId)
    return {
      buffer,
      filename: selected.filename,
      emailId: selected.emailId,
      subject: selected.subject,
      subjectReportDate: selected.subjectReportDate
    }
  }

  throw new Error(`Stock status e-mail not found for subject ${subject}`)
}

export async function importCurrentStockStatusWorkbook(prisma, input, meta = {}) {
  const buffer = await loadBufferFromInput(input)
  const parsed = parseStockStatusWorkbook(buffer)
  const preparedRows = parsed.records.map((row) => ({
    ...row,
    regionHint: resolveSiteRegion(row.siteId),
    isWarehouseLike: isWarehouseLike(row.siteId)
  }))

  const templateCount = await prisma.stockTemplateItem.count()
  if (!templateCount) {
    throw new Error('No stock template items found. Import the stock template first.')
  }

  const unknownSiteRowCount = preparedRows.filter((row) => !row.regionHint).length

  const run = await prisma.$transaction(async (tx) => {
    await tx.stockStatusCurrentRow.deleteMany({})

    const createdRun = await tx.stockImportRun.create({
      data: {
        reportDate: parsed.reportDate,
        sourceFilename: meta.sourceFilename || meta.filename || null,
        sourceEmailId: meta.sourceEmailId || meta.emailId || null,
        sourceSubject: meta.sourceSubject || meta.subject || null,
        statusRowCount: preparedRows.length,
        matchedItemCount: 0,
        lowConfidenceCount: 0,
        unresolvedItemCount: 0,
        unknownSiteCount: unknownSiteRowCount
      }
    })

    for (let index = 0; index < preparedRows.length; index += 500) {
      const batch = preparedRows.slice(index, index + 500)
      if (!batch.length) continue

      await tx.stockStatusCurrentRow.createMany({
        data: batch.map((row) => ({
          importRunId: createdRun.id,
          itemNo: row.itemNo,
          itemDescription: row.itemDescription,
          itemShortName: row.itemShortName,
          itemClass: row.itemClass,
          siteId: row.siteId,
          itemGenericDescription: row.itemGenericDescription,
          itemTrackingOption: row.itemTrackingOption,
          qtyOnOrder: row.qtyOnOrder,
          qtyAllocated: row.qtyAllocated,
          qtyOnHand: row.qtyOnHand,
          qtyAvailable: row.qtyAvailable,
          valuationText: row.valuationText,
          regionHint: row.regionHint,
          isWarehouseLike: row.isWarehouseLike
        }))
      })

      await tx.stockStatusHistoryRow.createMany({
        data: batch.map((row) => ({
          importRunId: createdRun.id,
          itemNo: row.itemNo,
          itemDescription: row.itemDescription,
          itemShortName: row.itemShortName,
          itemClass: row.itemClass,
          siteId: row.siteId,
          itemGenericDescription: row.itemGenericDescription,
          itemTrackingOption: row.itemTrackingOption,
          qtyOnOrder: row.qtyOnOrder,
          qtyAllocated: row.qtyAllocated,
          qtyOnHand: row.qtyOnHand,
          qtyAvailable: row.qtyAvailable,
          valuationText: row.valuationText,
          regionHint: row.regionHint,
          isWarehouseLike: row.isWarehouseLike
        }))
      })
    }

    return createdRun
  }, {
    maxWait: 10_000,
    timeout: 120_000
  })

  invalidateStockManagementCache()
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })

  await prisma.stockImportRun.update({
    where: { id: run.id },
    data: {
      matchedItemCount: dataset.summary.matchedItemCount,
      lowConfidenceCount: dataset.summary.lowConfidenceCount,
      unresolvedItemCount: dataset.summary.unresolvedItemCount,
      unknownSiteCount: unknownSiteRowCount
    }
  })

  invalidateStockManagementCache()
  return {
    reportDate: parsed.reportDate,
    statusRowCount: preparedRows.length,
    matchedItemCount: dataset.summary.matchedItemCount,
    lowConfidenceCount: dataset.summary.lowConfidenceCount,
    unresolvedItemCount: dataset.summary.unresolvedItemCount,
    unknownSiteQtyTotal: dataset.summary.unknownSiteQtyTotal
  }
}

export async function importStockStatusFromGmail(prisma) {
  const fileMeta = await fetchStockStatusWorkbookFromGmail()
  const existingRun = await prisma.stockImportRun.findFirst({
    where: {
      OR: [
        fileMeta.emailId ? { sourceEmailId: fileMeta.emailId } : null,
        fileMeta.subject ? { sourceSubject: fileMeta.subject } : null
      ].filter(Boolean)
    },
    orderBy: { id: 'desc' }
  })

  if (existingRun) {
    return {
      skipped: true,
      reason: 'Latest stock Gmail message already imported',
      reportDate: existingRun.reportDate,
      statusRowCount: existingRun.statusRowCount,
      matchedItemCount: existingRun.matchedItemCount,
      lowConfidenceCount: existingRun.lowConfidenceCount,
      unresolvedItemCount: existingRun.unresolvedItemCount,
      sourceEmailId: existingRun.sourceEmailId,
      sourceSubject: existingRun.sourceSubject,
      existingRunId: existingRun.id
    }
  }

  return importCurrentStockStatusWorkbook(prisma, fileMeta.buffer, fileMeta)
}

function applySheetHeaderStyles(worksheet) {
  const border = {
    top: { style: 'thin', color: { argb: 'FFD8E3DD' } },
    bottom: { style: 'thin', color: { argb: 'FFD8E3DD' } },
    left: { style: 'thin', color: { argb: 'FFD8E3DD' } },
    right: { style: 'thin', color: { argb: 'FFD8E3DD' } }
  }

  worksheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF155E63' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = border
  })

  worksheet.getRow(2).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FF0F172A' }, size: 10 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F6F1' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = border
  })
}

function setWorkbookStructure(worksheet) {
  worksheet.getRow(1).values = STOCK_EXPORT_HEADER_ROW_1
  worksheet.getRow(2).values = STOCK_EXPORT_HEADER_ROW_2
  worksheet.mergeCells('A1:A2')
  worksheet.mergeCells('B1:B2')
  worksheet.mergeCells('C1:C2')
  worksheet.mergeCells('D1:D2')
  worksheet.mergeCells('E1:E2')
  worksheet.mergeCells('N1:P1')
  worksheet.mergeCells('Q1:S1')
  worksheet.mergeCells('T1:U1')
  worksheet.mergeCells('V1:X1')
  worksheet.mergeCells('Y1:Z1')
  worksheet.mergeCells('AA1:AB1')
  worksheet.mergeCells('AC1:AD1')
  worksheet.mergeCells('AE1:AF1')
  worksheet.views = [{ state: 'frozen', ySplit: 2 }]
  worksheet.columns = [
    { width: 42 }, { width: 22 }, { width: 14 }, { width: 14 }, { width: 16 },
    { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 }, { width: 9 },
    { width: 11 }, { width: 11 }, { width: 10 },
    { width: 11 }, { width: 11 }, { width: 10 },
    { width: 11 }, { width: 10 },
    { width: 11 }, { width: 11 }, { width: 10 },
    { width: 11 }, { width: 10 },
    { width: 11 }, { width: 10 },
    { width: 11 }, { width: 10 },
    { width: 11 }, { width: 10 },
    { width: 14 }, { width: 12 }, { width: 12 }, { width: 12 },
    { width: 12 }, { width: 12 }, { width: 11 }, { width: 14 }, { width: 4 }
  ]
  applySheetHeaderStyles(worksheet)
}

export async function buildStockTemplateWorkbookBuffer(prisma) {
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(STOCK_TEMPLATE_SHEET)
  setWorkbookStructure(worksheet)

  for (const row of dataset.items) {
    const excelRow = worksheet.getRow(row.rowOrder)

    if (row.rowType === 'SECTION') {
      excelRow.getCell(1).value = row.itemDescription || row.sectionName || ''
      excelRow.font = { bold: true, color: { argb: 'FF0F172A' } }
      excelRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F7F6' } }
      continue
    }

    excelRow.values = [
      undefined,
      row.itemDescription || '',
      row.stockCode || '',
      row.unitPriceZar || '',
      row.unitPriceUsd || '',
      row.division || '',
      row.requiredByRegion?.CPT || 0,
      row.requiredByRegion?.JHB || 0,
      row.requiredByRegion?.DBN || 0,
      row.requiredByRegion?.PEL || 0,
      row.requiredByRegion?.BFN || 0,
      row.requiredByRegion?.GEO || 0,
      row.requiredByRegion?.POL || 0,
      row.requiredByRegion?.NEL || 0,
      row.cptWarehousePrimary || 0,
      row.cptWarehouseSecondary || 0,
      row.cptTotal || 0,
      row.jhbWarehousePrimary || 0,
      row.jhbWarehouseSecondary || 0,
      row.jhbTotal || 0,
      row.dbnWarehousePrimary || 0,
      row.dbnTotal || 0,
      row.pelWarehousePrimary || 0,
      row.pelWarehouseSecondary || 0,
      row.pelTotal || 0,
      row.bfnWarehousePrimary || 0,
      row.bfnTotal || 0,
      row.geoWarehousePrimary || 0,
      row.geoTotal || 0,
      row.polWarehousePrimary || 0,
      row.polTotal || 0,
      row.nelWarehousePrimary || 0,
      row.nelTotal || 0,
      row.notInWarehouses || 0,
      row.orderedStock || 0,
      row.requiredTotal || 0,
      row.availableTotal || 0,
      row.allAvailableTotal || 0,
      row.unitCost || 0,
      row.shortage || 0,
      row.gapCost || 0
    ]

    const fillArgb = row.belowMinimum
      ? 'FFFFE2E2'
      : row.matchMethod === 'unmatched'
        ? 'FFFFF1C2'
        : row.isLowConfidence
          ? 'FFFFEDD5'
          : 'FFFFFFFF'

    excelRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      }
      if (columnNumber <= 36) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillArgb } }
      }
      if (columnNumber >= 6 && columnNumber <= 36 && typeof cell.value === 'number') {
        cell.alignment = { horizontal: 'center' }
      }
    })
  }

  const trackingSheet = workbook.addWorksheet(STOCK_TRACKING_SHEET)
  trackingSheet.getCell('A1').value = 'track stock volume changes every month'
  trackingSheet.getCell('A2').value = `Latest report date: ${dataset.latestImport?.reportDate ? dayjs(dataset.latestImport.reportDate).format('YYYY-MM-DD HH:mm') : 'N/A'}`
  trackingSheet.getCell('A3').value = `Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}`

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

function styleSimpleExportSheet(worksheet, headerRowNumber = 4) {
  const headerRow = worksheet.getRow(headerRowNumber)
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF155E63' } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD8E3DD' } },
      bottom: { style: 'thin', color: { argb: 'FFD8E3DD' } },
      left: { style: 'thin', color: { argb: 'FFD8E3DD' } },
      right: { style: 'thin', color: { argb: 'FFD8E3DD' } }
    }
  })
}

export async function buildLowStockWatchlistWorkbookBuffer(prisma) {
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Low Stock Watchlist')

  worksheet.getCell('A1').value = 'Low Stock Watchlist'
  worksheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0F172A' } }
  worksheet.getCell('A2').value = `Latest report date: ${dataset.latestImport?.reportDate ? dayjs(dataset.latestImport.reportDate).format('YYYY-MM-DD HH:mm') : 'N/A'}`
  worksheet.getCell('A3').value = `Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}`

  worksheet.getRow(4).values = [
    'Item Description',
    'Stock Code',
    'Section',
    'Division',
    'Matched Item',
    'Required Total',
    'Warehouse Available',
    'Not WH',
    'Ordered Stock',
    'Gap',
    'Unit Cost',
    'Gap Cost'
  ]
  styleSimpleExportSheet(worksheet, 4)

  worksheet.columns = [
    { width: 42 },
    { width: 18 },
    { width: 20 },
    { width: 18 },
    { width: 18 },
    { width: 14 },
    { width: 16 },
    { width: 12 },
    { width: 13 },
    { width: 12 },
    { width: 14 },
    { width: 14 }
  ]
  worksheet.views = [{ state: 'frozen', ySplit: 4 }]
  worksheet.autoFilter = { from: 'A4', to: 'L4' }

  dataset.lowStockItems.forEach((row) => {
    const added = worksheet.addRow([
      row.itemDescription || '',
      row.stockCode || '',
      row.sectionName || '',
      row.division || '',
      row.matchedItemNo || '',
      Number(row.requiredTotal || 0),
      Number(row.availableTotal || 0),
      Number(row.notInWarehouses || 0),
      Number(row.orderedStock || 0),
      Number(row.shortage || 0),
      Number(row.unitCost || 0),
      Number(row.gapCost || 0)
    ])
    added.eachCell((cell, columnNumber) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
        right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
      }
      if (columnNumber >= 6) {
        cell.alignment = { horizontal: 'right' }
      }
      if (columnNumber === 10 && Number(row.shortage || 0) > 0) {
        cell.font = { bold: true, color: { argb: 'FFB91C1C' } }
      }
      if (columnNumber === 12 && Number(row.gapCost || 0) > 0) {
        cell.font = { bold: true, color: { argb: 'FF1D4ED8' } }
      }
    })
  })

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export async function buildRegionalWatchlistWorkbookBuffer(prisma) {
  const dataset = await getCurrentStockDataset(prisma, { forceFresh: true })
  const workbook = new ExcelJS.Workbook()

  const summarySheet = workbook.addWorksheet('Regional Summary')
  summarySheet.getCell('A1').value = 'Regional Stock Watchlist'
  summarySheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0F172A' } }
  summarySheet.getCell('A2').value = `Latest report date: ${dataset.latestImport?.reportDate ? dayjs(dataset.latestImport.reportDate).format('YYYY-MM-DD HH:mm') : 'N/A'}`
  summarySheet.getCell('A3').value = `Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}`
  summarySheet.getRow(4).values = ['Region', 'Affected Items', 'Total Gap', 'Total Gap Cost']
  summarySheet.columns = [
    { width: 14 },
    { width: 16 },
    { width: 14 },
    { width: 16 }
  ]
  summarySheet.views = [{ state: 'frozen', ySplit: 4 }]
  summarySheet.autoFilter = { from: 'A4', to: 'D4' }
  styleSimpleExportSheet(summarySheet, 4)

  dataset.regionWatchlist.forEach((region) => {
    summarySheet.addRow([
      region.region,
      Number(region.affectedItems || 0),
      Number(region.totalGap || 0),
      Number(region.totalGapCost || 0)
    ])
  })

  for (const region of dataset.regionWatchlist) {
    const worksheet = workbook.addWorksheet(`${region.region} Watchlist`)
    worksheet.getCell('A1').value = `${region.region} Regional Watchlist`
    worksheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0F172A' } }
    worksheet.getCell('A2').value = `Latest report date: ${dataset.latestImport?.reportDate ? dayjs(dataset.latestImport.reportDate).format('YYYY-MM-DD HH:mm') : 'N/A'}`
    worksheet.getCell('A3').value = `Generated: ${dayjs().format('YYYY-MM-DD HH:mm')}`
    worksheet.getRow(4).values = [
      'Item Description',
      'Stock Code',
      'Section',
      'Division',
      'Required',
      'Warehouse Available',
      'Not WH',
      'Gap',
      'Unit Cost',
      'Gap Cost'
    ]
    worksheet.columns = [
      { width: 42 },
      { width: 18 },
      { width: 20 },
      { width: 18 },
      { width: 12 },
      { width: 16 },
      { width: 12 },
      { width: 12 },
      { width: 14 },
      { width: 14 }
    ]
    worksheet.views = [{ state: 'frozen', ySplit: 4 }]
    worksheet.autoFilter = { from: 'A4', to: 'J4' }
    styleSimpleExportSheet(worksheet, 4)

    region.rows.forEach((row) => {
      worksheet.addRow([
        row.itemDescription || '',
        row.stockCode || '',
        row.sectionName || '',
        row.division || '',
        Number(row.required || 0),
        Number(row.warehouseAvailable || 0),
        Number(row.notWh || 0),
        Number(row.gap || 0),
        Number(row.unitCost || 0),
        Number(row.gapCost || 0)
      ])
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
