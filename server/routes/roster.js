// server/routes/roster.js
import { Router } from 'express'
import pkg from 'papaparse'          // <- CJS default import
const { parse } = pkg               // <- pull out the parse() fn
import { z } from 'zod'

/** each CSV row is initially all strings */
const rowSchema = z.object({
  agentId: z.string()
    .transform(s => {
      const n = Number(s)
      if (Number.isNaN(n)) throw new Error('agentId must be a number')
      return n
    }),
  shiftDate: z.string().refine(s => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid shiftDate',
  }),
  startAt: z.string().refine(s => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid startAt',
  }),
  endAt: z.string().refine(s => !Number.isNaN(Date.parse(s)), {
    message: 'Invalid endAt',
  }),
})

export default prisma => {
  const r = Router()

  // POST /api/roster
  // Expects JSON: { csv: "agentId,shiftDate,startAt,endAt\n…" }
  r.post('/', async (req, res, next) => {
    try {
      const csv = req.body.csv
      if (!csv) {
        return res
          .status(400)
          .json({ error: 'Missing CSV payload in `csv` field' })
      }

      // 1️⃣ parse CSV → array of plain objects
      const { data: rawRows, errors: parseErrors } = parse(csv, {
        header: true,
        skipEmptyLines: true,
      })
      if (parseErrors.length) {
        return res.status(400).json({ error: parseErrors })
      }

      // 2️⃣ validate & transform each row
      const validated = rowSchema.array().parse(rawRows)

      // 3️⃣ map to proper types for Prisma
      const toInsert = validated.map(r => ({
        agentId:   r.agentId,
        shiftDate: new Date(r.shiftDate),
        startAt:   new Date(r.startAt),
        endAt:     new Date(r.endAt),
      }))

      // 4️⃣ bulk create
      await prisma.shift.createMany({ data: toInsert })

      res.json({ added: toInsert.length })
    } catch (err) {
      next(err)
    }
  })

  return r
}
