// server/routes/attendance.js
import { Router } from 'express'

export default prisma => {
  const r = Router()

  // PATCH /api/attendance/:shiftId
  r.patch('/:shiftId', async (req, res, next) => {
    try {
      const shiftId = Number(req.params.shiftId)
      const { status, dutyName, lunchStart, lunchEnd } = req.body

      // 1️⃣ find or create the duty record (if a name was supplied)
      let dutyId = null
      if (dutyName) {
        const duty = await prisma.duty.upsert({
          where:  { name: dutyName },
          create: { name: dutyName },
          update: {}                    // no-op if it already exists
        })
        dutyId = duty.id
      }

      // 2️⃣ build the data payload
      const data = {
        status,
        dutyId,
        lunchStart: lunchStart ? new Date(lunchStart) : null,
        lunchEnd:   lunchEnd   ? new Date(lunchEnd)   : null,
        supervisorId:  req.user.id
      }

      // 3️⃣ upsert on the unique shiftId
      const saved = await prisma.attendanceLog.upsert({
        where:  { shiftId },
        update: data,
        create: {
          shiftId,
          ...data
        }
      })

      // 4️⃣ respond immediately
      res.json(saved)

      // 5️⃣ fire-and-forget the audit (errors logged but won’t block the response)
      res
        .audit('update_attendance', 'AttendanceLog', saved.id, data)
        .catch(err => console.warn('⚠️ audit failed:', err))

    } catch (err) {
      next(err)
    }
  })

  return r
}
