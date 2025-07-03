// server/routes/roster.js
import { Router } from 'express'
import pkg from 'papaparse'          // CJS default import
const { parse } = pkg               // pull out the parse() fn
import { z } from 'zod'

/**
 * each CSV row is initially all strings, or accepts a JSON-parsed array from the client
 */
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

  r.post('/', async (req, res, next) => {
    try {
      // Determine whether the client sent raw CSV string or already-parsed JSON rows
      let rawRows
      if (Array.isArray(req.body)) {
        rawRows = req.body
      } else if (typeof req.body.csv === 'string') {
        const { data, errors: parseErrors } = parse(req.body.csv, {
          header: true,
          skipEmptyLines: true,
        })
        if (parseErrors.length) {
          return res.status(400).json({ error: parseErrors })
        }
        rawRows = data
      } else {
        return res.status(400).json({ error: 'Missing CSV payload: provide raw CSV in `csv` field or JSON array in request body' })
      }

      // Validate & transform each row
      const validated = rowSchema.array().parse(rawRows)

      // Map to the proper types for Prisma
      const toInsert = validated.map(r => ({
        agentId:   r.agentId,
        shiftDate: new Date(r.shiftDate),
        startAt:   new Date(r.startAt),
        endAt:     new Date(r.endAt),
      }))

      // Bulk create shifts
      await prisma.shift.createMany({ data: toInsert })

      res.json({ added: toInsert.length })
    } catch (err) {
      next(err)
    }
  })

  return r
}
