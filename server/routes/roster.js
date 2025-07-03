// server/routes/roster.js
import { Router } from 'express'
import { parse } from 'papaparse'
import { z } from 'zod'

export default prisma => {
  const router = Router()

  // Zod schema for one row
  const Row = z.object({
    agentId: z.number(),
    shiftDate: z.string().refine(s => /^\d{4}-\d{2}-\d{2}$/.test(s), {
      message: 'Expected YYYY-MM-DD',
    }),
    startAt: z.string().refine(
      s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z)?$/.test(s),
      { message: 'Expected full ISO datetime with seconds: YYYY-MM-DDTHH:mm:ss' }
    ),
    endAt: z.string().refine(
      s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z)?$/.test(s),
      { message: 'Expected full ISO datetime with seconds: YYYY-MM-DDTHH:mm:ss' }
    ),
  })

  // POST /api/roster  – raw CSV body
  router.post('/', async (req, res) => {
    if (!req.body.csv) {
      return res.status(400).json({ error: 'Missing csv in body' })
    }

    // 1️⃣  Parse CSV text
    const { data: rawRows, errors: parseErrors } = parse(req.body.csv, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,           // <-- convert unquoted digits to numbers
      transform: (value, field) => {
        // ensure any datetime missing seconds gets “:00” appended
        if ((field === 'startAt' || field === 'endAt') && typeof value === 'string') {
          return value.length === 16 ? value + ':00' : value
        }
        return value
      }
    })

    if (parseErrors.length) {
      return res.status(400).json({ error: parseErrors })
    }

    // 2️⃣  Validate & collect
    const good:typeof rawRows = []
    const zodErrs = []
    for (let i = 0; i < rawRows.length; i++) {
      const row = rawRows[i]
      const result = Row.safeParse(row)
      if (!result.success) {
        zodErrs.push(...result.error.errors.map(e => ({
          path: [i, ...e.path],
          message: e.message,
          code: e.code
        })))
      } else {
        good.push(result.data)
      }
    }
    if (zodErrs.length) {
      return res.status(400).json({ error: zodErrs })
    }

    // 3️⃣  Bulk insert
    try {
      const created = await prisma.shift.createMany({
        data: good.map(r => ({
          agentId:   r.agentId,
          shiftDate: new Date(r.shiftDate),
          startAt:   new Date(r.startAt),
          endAt:     new Date(r.endAt),
        }))
      })
      res.json({ count: created.count })
    } catch (err) {
      console.error(err)
      res.status(500).json({ error: 'Database error' })
    }
  })

  return router
}
