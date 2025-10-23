import { Router } from 'express'
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()
const r = Router()

// Create
r.post('/engineering/nld-services', async (req, res, next) => {
  try {
    const p = req.body || {}

    // basic validation
    const required = ['customer','frg','serviceType','capacity','nldRoute','deployment','protection','sideAName','sideBName']
    for (const key of required) {
      if (p[key] === undefined || p[key] === null || String(p[key]).trim() === '') {
        return res.status(400).json({ error: `Missing field: ${key}` })
      }
    }

    const created = await prisma.nldService.create({
      data: {
        customer: p.customer.trim(),
        frg: p.frg.trim(),
        serviceType: p.serviceType,     // 'Carrier' | 'NLD'
        capacity: p.capacity,           // '1G' | '10G' | ...
        nldRoute: p.nldRoute,           // 'CPT <> JHB'
        deployment: p.deployment,       // 'OTN' | 'EVPN'
        protection: !!p.protection,     // boolean
        priPath: p.priPath || null,
        secPath: p.secPath || null,
        stag: p.stag || null,
        ctag: p.ctag || null,

        sideAName: p.sideAName,
        sideAIC: p.sideAIC || null,
        sideASO: p.sideASO || null,
        sideAHandoff: p.sideAHandoff || null,

        sideBName: p.sideBName,
        sideBIC: p.sideBIC || null,
        sideBSO: p.sideBSO || null,
        sideBHandoff: p.sideBHandoff || null,
      }
    })
    res.status(201).json(created)
  } catch (e) {
    next(e)
  }
})

// List (simple paging + search)
r.get('/engineering/nld-services', async (req, res, next) => {
  try {
    const { q = '', skip = '0', take = '50' } = req.query
    const where = q
      ? {
          OR: [
            { customer:   { contains: String(q), mode: 'insensitive' } },
            { frg:        { contains: String(q), mode: 'insensitive' } },
            { nldRoute:   { contains: String(q), mode: 'insensitive' } },
            { sideAName:  { contains: String(q), mode: 'insensitive' } },
            { sideBName:  { contains: String(q), mode: 'insensitive' } },
          ]
        }
      : {}

    const [items, total] = await Promise.all([
      prisma.nldService.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: Number(skip),
        take: Math.min(Number(take), 200),
      }),
      prisma.nldService.count({ where })
    ])

    res.json({ items, total })
  } catch (e) {
    next(e)
  }
})

export default r
