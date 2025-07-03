// server/routes/attendance.js
import { Router } from 'express'

export default prisma => {
  const r = Router()

  // PATCH /api/attendance/:id
  r.patch('/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id)
      const { status, dutyName, lunchStart, lunchEnd } = req.body

      // look up or create the duty:
      let dutyId = undefined
      if (dutyName) {
        const found = await prisma.duty.findUnique({ where: { name: dutyName } })
        if (found) {
          dutyId = found.id
        } else {
          const created = await prisma.duty.create({ data: { name: dutyName } })
          dutyId = created.id
        }
      }

      const updated = await prisma.attendanceLog.update({
        where: { id },
        data: {
          status,
          dutyId,
          lunchStart: lunchStart ? new Date(lunchStart) : undefined,
          lunchEnd:   lunchEnd   ? new Date(lunchEnd)   : undefined,
          updatedBy:  req.user.id,    // assuming verifyToken set req.user.id
        },
      })

      res.json(updated)
    } catch (err) {
      next(err)
    }
  })

  return r
}
