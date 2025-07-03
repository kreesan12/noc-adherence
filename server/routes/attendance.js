// server/routes/attendance.js
import { Router } from 'express'

export default prisma => {
  const r = Router()

  // PATCH /api/attendance/:shiftId
  r.patch('/:shiftId', async (req, res, next) => {
    try {
      const shiftId    = Number(req.params.shiftId)
      const { status, dutyName, lunchStart, lunchEnd } = req.body

      // 1️⃣ find or create the duty record (if a name was supplied)
      let dutyId = null
      if (dutyName) {
        const duty = await prisma.duty.findUnique({
          where: { name: dutyName }
        })
        if (!duty) {
          return res
            .status(400)
            .json({ error: `Unknown duty '${dutyName}'` })
        }
        dutyId = duty.id
      }

      // 2️⃣ build the data payload
      const data = {
        status,
        dutyId,
        lunchStart: lunchStart ? new Date(lunchStart) : null,
        lunchEnd:   lunchEnd   ? new Date(lunchEnd)   : null,
        updatedBy:  req.user.id
      }

      // 3️⃣ upsert on the unique shiftId
      const saved = await prisma.attendanceLog.upsert({
        where: { shiftId },
        update: data,
        create: {
          shiftId,
          ...data
        }
      })

      // 4️⃣ audit & return
      await res.audit(
        'update_attendance',
        'AttendanceLog',
        saved.id,
        data
      )
      res.json(saved)
    } catch (err) {
      next(err)
    }
  })

  return r
}
