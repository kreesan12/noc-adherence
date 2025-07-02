import { Router } from 'express'
import { z } from 'zod'

const schema = z.array(z.object({
  agentId   : z.number(),
  shiftDate : z.string().datetime({ offset:false }),
  startAt   : z.string().datetime(),
  endAt     : z.string().datetime()
}))

export default (prisma) => {
  const r = Router()
  r.post('/', async (req, res) => {
    const data = schema.parse(req.body)
    const out  = await prisma.shift.createMany({ data })
    await res.audit('upload_roster', 'Shift', 0, { rows: out.count })
    res.json(out)
  })
  return r
}
