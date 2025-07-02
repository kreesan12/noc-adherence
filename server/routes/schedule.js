import { Router } from 'express'
export default prisma => {
  const r = Router()

  // day view
  r.get('/', async (req, res) => {
    // ?date=YYYY-MM-DD  OR  ?week=YYYY-MM-DD (Monday)
    if (req.query.week) {
      const start = new Date(req.query.week)
      const end   = new Date(start); end.setDate(end.getDate()+6)
      const shifts = await prisma.shift.findMany({
        where:{ shiftDate:{ gte:start, lte:end } },
        include:{ agent:true, attendance:{ include:{ duty:true } } }
      })
      return res.json(shifts)
    }
    const date = new Date(req.query.date)
    const shifts = await prisma.shift.findMany({
      where:{ shiftDate:date },
      include:{ agent:true, attendance:{ include:{ duty:true } } }
    })
    res.json(shifts)
  })

  // update attendance
  r.patch('/:shiftId', async (req, res) => {
    const shiftId = Number(req.params.shiftId)
    const payload = req.body
    const updated = await prisma.attendanceLog.upsert({
      where :{ shiftId },
      update: payload,
      create: { shiftId, ...payload }
    })
    await res.audit('update_attendance','AttendanceLog',updated.id,payload)
    res.json(updated)
  })

  return r
}
