import { Router } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const r = Router()

/** Coerce value to boolean */
function toBool(v) {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase()
    return s === 'true' || s === '1' || s === 'yes' || s === 'on'
  }
  return !!v
}

/** Trim strings; pass-through others */
function trimOr(v) {
  return (typeof v === 'string') ? v.trim() : v
}

const SEARCH_SCAN_LIMIT = 5000

function normalizeSearchValue(v) {
  return String(v ?? '').toUpperCase().trim()
}

function compactSearchValue(v) {
  return normalizeSearchValue(v).replace(/[^A-Z0-9]+/g, '')
}

function buildPrimaryPathTokens(path) {
  const raw = normalizeSearchValue(path)
  const compact = compactSearchValue(path)
  const tokens = new Set()

  if (!compact) return tokens

  tokens.add(compact)

  raw
    .split(/[^A-Z0-9]+/)
    .map(token => token.trim())
    .filter(Boolean)
    .forEach(token => {
      tokens.add(token)

      if (/^NLD\d+$/.test(token)) {
        token
          .slice(3)
          .split('')
          .forEach(digit => tokens.add(`NLD${digit}`))
      }
    })

  ;(compact.match(/NLD\d+/g) || []).forEach(token => {
    tokens.add(token)

    token
      .slice(3)
      .split('')
      .forEach(digit => tokens.add(`NLD${digit}`))
  })

  ;(compact.match(/NTP[0-9A-Z]+/g) || []).forEach(token => {
    tokens.add(token)
  })

  return tokens
}

function matchesPrimaryPath(path, query) {
  const q = compactSearchValue(query)
  const compactPath = compactSearchValue(path)

  if (!q || !compactPath) return false
  if (compactPath.includes(q)) return true

  for (const token of buildPrimaryPathTokens(path)) {
    if (token === q || token.includes(q)) return true
  }

  return false
}

function matchesServiceSearch(row, query) {
  const q = normalizeSearchValue(query)
  if (!q) return true

  const fields = [
    row.customer,
    row.frg,
    row.serviceType,
    row.capacity,
    row.nldRoute,
    row.deployment,
    row.secPath,
    row.stag,
    row.ctag,
    row.sideAName,
    row.sideBName,
    row.sideAIC,
    row.sideASO,
    row.sideAHandoff,
    row.sideBIC,
    row.sideBSO,
    row.sideBHandoff
  ]

  if (fields.some(value => normalizeSearchValue(value).includes(q))) {
    return true
  }

  return matchesPrimaryPath(row.priPath, query)
}

/* ───────────── CREATE ───────────── */
r.post('/engineering/nld-services', async (req, res, next) => {
  try {
    const p = req.body || {}

    const required = [
      'customer', 'frg', 'serviceType', 'capacity',
      'nldRoute', 'deployment', 'protection',
      'priPath', 'stag', 'ctag',
      'sideAName', 'sideBName',
    ]
    for (const key of required) {
      const val = p[key]
      if (val === undefined || val === null || String(val).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${key}` })
      }
    }

    const protection = toBool(p.protection)
    if (protection) {
      if (p.secPath === undefined || p.secPath === null || String(p.secPath).trim() === '') {
        return res.status(400).json({ error: 'Missing field: secPath (required when protection is ON)' })
      }
    }

    const created = await prisma.nldService.create({
      data: {
        customer:      trimOr(p.customer),
        frg:           trimOr(p.frg),
        serviceType:   trimOr(p.serviceType),
        capacity:      trimOr(p.capacity),
        nldRoute:      trimOr(p.nldRoute),
        deployment:    trimOr(p.deployment),
        protection,
        priPath:       trimOr(p.priPath) || null,
        secPath:       protection ? (trimOr(p.secPath) || null) : null,
        stag:          trimOr(p.stag) || null,
        ctag:          trimOr(p.ctag) || null,
        sideAName:     trimOr(p.sideAName),
        sideAIC:       trimOr(p.sideAIC) || null,
        sideASO:       trimOr(p.sideASO) || null,
        sideAHandoff:  trimOr(p.sideAHandoff) || null,
        sideBName:     trimOr(p.sideBName),
        sideBIC:       trimOr(p.sideBIC) || null,
        sideBSO:       trimOr(p.sideBSO) || null,
        sideBHandoff:  trimOr(p.sideBHandoff) || null,
      }
    })
    res.status(201).json(created)
  } catch (e) { next(e) }
})

/* ───────────── LIST ───────────── */
r.get('/engineering/nld-services', async (req, res, next) => {
  try {
    const { q = '', skip = '0', take = '50' } = req.query
    const s = String(q).trim()

    const skipNum = Math.max(Number(skip) || 0, 0)
    const takeNum = Math.min(Math.max(Number(take) || 50, 1), 200)

    let items
    let total

    if (!s) {
      ;[items, total] = await Promise.all([
        prisma.nldService.findMany({
          orderBy: { createdAt: 'desc' },
          skip: skipNum,
          take: takeNum,
        }),
        prisma.nldService.count(),
      ])
    } else {
      const allItems = await prisma.nldService.findMany({
        orderBy: { createdAt: 'desc' },
        take: SEARCH_SCAN_LIMIT,
      })

      const filtered = allItems.filter(item => matchesServiceSearch(item, s))
      total = filtered.length
      items = filtered.slice(skipNum, skipNum + takeNum)
    }

    res.json({ items, total })
  } catch (e) { next(e) }
})

/* ───────────── UPDATE (PATCH) ───────────── */
r.patch('/engineering/nld-services/:id', async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' })

    const existing = await prisma.nldService.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'Not found' })

    const src = req.body || {}
    const updatable = {}

    const fields = [
      'customer','frg','serviceType','capacity','nldRoute','deployment',
      'protection','priPath','secPath','stag','ctag',
      'sideAName','sideAHandoff','sideAIC','sideASO',
      'sideBName','sideBHandoff','sideBIC','sideBSO',
    ]

    for (const k of fields) {
      if (Object.prototype.hasOwnProperty.call(src, k)) {
        if (k === 'protection') {
          updatable.protection = toBool(src.protection)
        } else {
          updatable[k] = trimOr(src[k])
        }
      }
    }

    // normalise secondary path based on protection
    if (Object.prototype.hasOwnProperty.call(updatable, 'protection')) {
      if (!updatable.protection) {
        updatable.secPath = null
      } else if (
        Object.prototype.hasOwnProperty.call(updatable, 'secPath') &&
        (updatable.secPath === '' || updatable.secPath == null)
      ) {
        return res.status(400).json({ error: 'secPath is required when protection is ON' })
      }
    }

    const updated = await prisma.nldService.update({
      where: { id },
      data: updatable,
    })
    res.json(updated)
  } catch (e) { next(e) }
})

export default r
