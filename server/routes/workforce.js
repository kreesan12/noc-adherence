import { Router } from 'express'
import prisma from '../lib/prisma.js'      // your Prisma client
import dayjs from 'dayjs'

const r = Router()

// helper: closes any matching open vacancy when a new engagement fills it
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

/* ─── teams ───────────────────────────── */
r.get('/teams', async (_, res) => {
  const teams = await prisma.team.findMany({ orderBy: { name: 'asc' } })
  res.json(teams)
})

r.post('/teams', async (req, res) => {
  const team = await prisma.team.create({ data: { name: req.body.name } })
  res.status(201).json(team)
})

/* ─── engagements ─────────────────────── */
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
    where: filter,
    include: { agent: true, team: true },
    orderBy: [{ startDate: 'desc' }]
  })

  res.json(rows)
})

r.post('/engagements', async (req, res) => {
  const { agentId, teamId, startDate, note } = req.body
  const start = new Date(startDate)

  const row = await prisma.engagement.create({
    data: { agentId, teamId, startDate: start, note }
  })

  // close any overlapping vacancy
  await closeVacancy(teamId, start)

  res.status(201).json(row)
})

r.patch('/engagements/:id/terminate', async (req, res) => {
  const id = Number(req.params.id)
  const { endDate, note } = req.body
  const end = new Date(endDate)

  const engagement = await prisma.engagement.update({
    where: { id },
    data: { endDate: end, note }
  })

  // open a new vacancy the day after they leave
  await prisma.vacancy.create({
    data: {
      teamId:   engagement.teamId,
      openFrom: dayjs(end).add(1, 'day').toDate(),
      reason:   note ?? 'exit'
    }
  })

  res.json({ ok: true })
})

/* ─── vacancies ───────────────────────── */
r.get('/vacancies', async (req, res) => {
  const open = req.query.open === 'true'
  const rows = await prisma.vacancy.findMany({
    where: open ? { closedAt: null } : {},
    include: { team: true },
    orderBy: [{ openFrom: 'asc' }]
  })
  res.json(rows)
})

/* ─── headcount report ────────────────── */
r.get('/reports/headcount', async (req, res) => {
  const { from, to } = req.query

  // run the same raw SQL you had
  const rawRows = await prisma.$queryRaw`
    WITH months AS (
      SELECT generate_series(${from}::date, ${to}::date, interval '1 month') mon
    )
    SELECT
      t.name,
      to_char(m.mon, 'YYYY-MM') AS month,
      COUNT(e.id) AS headcount,
      COUNT(v.id) FILTER (
        WHERE v."closedAt" IS NULL OR v."closedAt" >= m.mon
      ) AS vacancies
    FROM months m
    CROSS JOIN "Team" t
    LEFT JOIN "Engagement" e
      ON e."teamId" = t.id
     AND e."startDate" <= m.mon + interval '1 month - 1 day'
     AND (e."endDate" IS NULL OR e."endDate" >= m.mon)
    LEFT JOIN "Vacancy" v
      ON v."teamId" = t.id
     AND v."openFrom" <= m.mon + interval '1 month - 1 day'
    GROUP BY t.name, month
    ORDER BY t.name, month
  `

  // convert BigInt → Number
  const rows = rawRows.map(r => ({
    name:      r.name,
    month:     r.month,
    headcount: Number(r.headcount),
    vacancies: Number(r.vacancies)
  }))

  res.json(rows)
})

export default r
