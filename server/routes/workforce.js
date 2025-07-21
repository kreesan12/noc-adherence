// backend/routes/workforce.js
import { Router } from 'express'
import prisma from '../lib/prisma.js'
import dayjs from 'dayjs'

const r = Router()

// ─── Helper ─────────────────────────────────────────────────────────
// Close any vacancy whose openFrom ≤ startDate and whose closedAt is
// null or ≥ startDate.
async function closeVacancy(teamId, startDate) {
  await prisma.vacancy.updateMany({
    where: {
      teamId,
      openFrom: { lte: startDate },
      OR: [
        { closedAt: null },
        { closedAt: { gte: startDate } }
      ]
    },
    data: { closedAt: startDate }
  })
}

// ─── Teams ─────────────────────────────────────────────────────────
r.get('/teams', async (_, res) => {
  const teams = await prisma.team.findMany({ orderBy: { name: 'asc' } })
  res.json(teams)
})

r.post('/teams', async (req, res) => {
  const team = await prisma.team.create({ data: { name: req.body.name } })
  res.status(201).json(team)
})

// ─── Engagements ───────────────────────────────────────────────────
r.get('/engagements', async (req, res) => {
  const { teamId, activeOn } = req.query
  const filter = {}

  if (teamId) {
    filter.teamId = Number(teamId)
  }

  if (activeOn) {
    const d = new Date(activeOn)
    filter.startDate = { lte: d }
    filter.OR = [
      { endDate: null },
      { endDate: { gte: d } }
    ]
  }

  const rows = await prisma.engagement.findMany({
    where:  filter,
    include:{ agent:true, team:true },
    orderBy:[{ startDate:'desc' }]
  })

  res.json(rows)
})

r.post('/engagements', async (req, res) => {
  const { agentId, teamId, startDate, note } = req.body
  const start = new Date(startDate)

  const row = await prisma.engagement.create({
    data:{ agentId, teamId, startDate:start, note }
  })

  // fill any matching vacancy
  await closeVacancy(teamId, start)

  res.status(201).json(row)
})

r.patch('/engagements/:id/terminate', async (req, res) => {
  const id = Number(req.params.id)
  const { endDate, note } = req.body
  const end = new Date(endDate)

  const engagement = await prisma.engagement.update({
    where:{ id },
    data:{ endDate:end, note }
  })

  // open vacancy the day after
  await prisma.vacancy.create({
    data:{
      teamId:   engagement.teamId,
      openFrom: dayjs(end).add(1,'day').toDate(),
      reason:   note ?? 'exit'
    }
  })

  res.json({ ok:true })
})

// ─── Vacancies ────────────────────────────────────────────────────
r.get('/vacancies', async (req, res) => {
  const open = req.query.open === 'true'
  const rows = await prisma.vacancy.findMany({
    where:   open ? { closedAt:null } : {},
    include: { team:true },
    orderBy: [{ openFrom:'asc' }]
  })
  res.json(rows)
})

/* ───────────────────── PATCH  /vacancies/:id  ← NEW ───────────────── */
r.patch('/vacancies/:id', async (req,res)=> {
  const id   = Number(req.params.id)
  const body = req.body      // any subset of the Vacancy fields
  try {
    const row = await prisma.vacancy.update({ where:{ id }, data: body })
    res.json(row)
  } catch (err) {
    console.error(err) ; res.status(400).json({ error:'Bad payload' })
  }
})

/* ───────────── DOCX requisition generator  ← NEW ────────────── */
import Docxtemplater from 'docxtemplater'
import PizZip from 'pizzip'
import fs from 'fs'
import path from 'path'

r.get('/vacancies/:id/requisition', async (req,res)=> {
  const id   = Number(req.params.id)
  const v    = await prisma.vacancy.findUnique({ where:{ id }, include:{ team:true }})
  if (!v) return res.status(404).end()

  /* load template.docx from /templates folder */
  const tplPath = path.resolve('templates/requisition-template.docx')
  const zip = new PizZip(fs.readFileSync(tplPath))
  const doc = new Docxtemplater(zip).setData({
    team:        v.team.name,
    openFrom:    dayjs(v.openFrom).format('YYYY-MM-DD'),
    reason:      v.reason ?? '',
    status:      v.status,
    candidate:   v.candidateName ?? '',
    startDate:   v.startDate ? dayjs(v.startDate).format('YYYY-MM-DD') : ''
  })
  try { doc.render() } catch(e){ return res.status(500).end() }

  const buf = doc.getZip().generate({type:'nodebuffer'})
  res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  res.setHeader('Content-Disposition',`attachment; filename=requisition-${id}.docx`)
  res.send(buf)
})

/* ──────────────────────────────────────────────────────────────────────────
 * HEAD-COUNT REPORT
 * GET /api/workforce/reports/headcount
 *   ?from=YYYY-MM-DD
 *   ?to=YYYY-MM-DD
 *   ?gran=month | week      (optional, default = month)
 * ------------------------------------------------------------------------ */
r.get('/reports/headcount', async (req, res, next) => {
  try {
    const { from, to, gran = 'month' } = req.query
    if (!from || !to) {
      return res.status(400).json({ error: 'from & to are required (YYYY-MM-DD)' })
    }

    /* 1) STEP + DATE-FORMAT STRINGS -------------------------------------- */
    const step = gran === 'week'
      ? "interval '1 week'"
      : "interval '1 month'"

    const fmt = gran === 'week'
      ? "to_char(p.mon, 'IYYY-\"W\"IW')"      /* 2025-W29 ISO week */
      : "to_char(p.mon, 'YYYY-MM')"           /* 2025-07         */

    /* 2)  FULL SQL  ------------------------------------------------------ */
    const sql = `
      WITH periods AS (
        SELECT generate_series($1::date, $2::date, ${step}) AS mon
      ),
      /* ---------- A) Heads coming from the Engagement table ---------- */
      eng_rows AS (
        SELECT
          e."teamId",
          p.mon
        FROM "Engagement" e
        JOIN periods p
          ON e."startDate" <= p.mon + ${step} - interval '1 day'
         AND (e."endDate"  IS NULL OR e."endDate" >= p.mon)
      ),
      /* ---------- B) Agents that have NO engagement rows ------------- */
      agents_no_eng AS (
        SELECT
          t.id  AS "teamId",
          p.mon
        FROM "Agent" a
        JOIN "Team"  t ON t.name = a.role
        JOIN periods p
          ON a."start_date" <= p.mon + ${step} - interval '1 day'
        WHERE NOT EXISTS (
          SELECT 1 FROM "Engagement" e WHERE e."agentId" = a.id
        )
      ),
      heads AS (
        SELECT * FROM eng_rows
        UNION ALL
        SELECT * FROM agents_no_eng
      )
      /* ---------- Final aggregation ---------------------------------- */
      SELECT
        t.name,
        ${fmt}                    AS period,
        COUNT(h."teamId")           AS headcount,
        COUNT(v.id) FILTER (
          WHERE v.status IN (
            'OPEN','AWAITING_APPROVAL','APPROVED',
            'INTERVIEWING','OFFER_SENT'
          )
        )                         AS vacancies
      FROM periods p
      CROSS JOIN "Team" t
      LEFT JOIN heads    h
             ON h."teamId" = t.id
            AND h.mon      = p.mon
      LEFT JOIN "Vacancy" v
             ON v."team_id" = t.id
            AND v."open_from" <= p.mon + ${step} - interval '1 day'
      GROUP BY t.name, period
      ORDER BY t.name, period;
    `

    const raw = await prisma.$queryRawUnsafe(sql, from, to)

    res.json(
      raw.map(r => ({
        name      : r.name,
        period    : r.period,
        headcount : Number(r.headcount),
        vacancies : Number(r.vacancies)
      }))
    )
  } catch (err) {
    next(err)
  }
})
/* ────────────────────────────────────────────────────────────────────────── */

export default r
