// server/routes/roster.js
import { Router } from 'express'
import { parse } from 'papaparse'
import { z } from 'zod'

const shiftSchema = z.object({
  agentId: z.number(),
  shiftDate: z.string().refine(str => !isNaN(Date.parse(str)), {
    message: 'Invalid shiftDate',
  }),
  startAt: z.string().refine(str => !isNaN(Date.parse(str)), {
    message: 'Invalid startAt',
  }),
  endAt: z.string().refine(str => !isNaN(Date.parse(str)), {
    message: 'Invalid endAt',
  }),
})

export default prisma => {
  const r = Router()

  // POST /api/roster
  // Expects JSON: { csv: "agentId,shiftDate,startAt,endAt\n…" }
  r.post('/', async (req, res) => {
    const csv = req.body.csv
    if (!csv) {
      return res.status(400).json({ error: 'Missing CSV payload in `csv` field' })
    }

    // parse the CSV
    const { data: rawRows, errors } = parse(csv, {
      header: true,
      skipEmptyLines: true,
    })
    if (errors.length) {
      return res.status(400).json({ error: errors })
    }

    // map to the right types
    const good = rawRows.map(row => ({
      agentId: Number(row.agentId),
      shiftDate: row.shiftDate,
      startAt: row.startAt,
      endAt: row.endAt,
    }))

    // validate & throw if any row is bad
    const parsed = z.array(shiftSchema).parse(good)

    // save them all
    await prisma.shift.createMany({ data: parsed })

    res.json({ added: parsed.length })
  })

  return r
}
