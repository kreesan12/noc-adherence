import dayjs from "dayjs"
import { getOvertimePeriodForDate, isSunday } from "../utils/overtimePeriod.js"
import { hoursBetween } from "../utils/timeCalc.js"
import { splitShiftByDate } from "../utils/splitShift.js"

export async function ensureCurrentPeriod(prisma) {
  const p = getOvertimePeriodForDate(new Date())

  const period = await prisma.overtimePeriod.upsert({
    where: { key: p.key },
    update: { label: p.label },
    create: {
      key: p.key,
      label: p.label,
      startDate: new Date(p.startDate),
      endDate: new Date(p.endDate),
    },
  })

  return period
}

export async function ensurePeriodForDate(prisma, dateLike) {
  const p = getOvertimePeriodForDate(dateLike)

  const period = await prisma.overtimePeriod.upsert({
    where: { key: p.key },
    update: { label: p.label },
    create: {
      key: p.key,
      label: p.label,
      startDate: new Date(p.startDate),
      endDate: new Date(p.endDate),
    },
  })

  return period
}

export async function generateFixedOvertimeForPeriod(prisma, periodId, supervisorId) {
  const period = await prisma.overtimePeriod.findUnique({ where: { id: periodId } })
  if (!period) throw new Error("Period not found")

  const holidays = await prisma.publicHoliday.findMany({
    where: {
      isActive: true,
      date: { gte: period.startDate, lte: period.endDate },
    },
    select: { date: true },
  })

  const holidaySet = new Set(holidays.map(h => dayjs(h.date).format("YYYY-MM-DD")))

  // Only shifts for agents under this supervisor
  const agents = await prisma.agent.findMany({
    where: { supervisorId },
    select: { id: true },
  })
  const agentIds = agents.map(a => a.id)

  const shifts = await prisma.shift.findMany({
    where: {
      agentId: { in: agentIds },
      shiftDate: { gte: period.startDate, lte: period.endDate },
    },
  })

  let createdOrUpdated = 0

  for (const s of shifts) {
    const pieces = splitShiftByDate({
      ...s,
      workDate: dayjs(s.startAt).format("YYYY-MM-DD"),
    })

    for (const piece of pieces) {
      const workDate = piece.workDate
      const sunday = isSunday(workDate)
      const holiday = holidaySet.has(workDate)

      let rate = null
      if (holiday) rate = 1.0
      else if (sunday) rate = 0.5

      if (!rate) continue

      const totalHours = hoursBetween(piece.startAt, piece.endAt, piece.breakStart, piece.breakEnd)

      // Upsert unique key: period, agent, workDate, startAt, endAt, source FIXED
      // Prisma does not support composite upsert without a unique constraint.
      // So we do find then update or create.
      const existing = await prisma.overtimeEntry.findFirst({
        where: {
          periodId,
          agentId: s.agentId,
          source: "FIXED",
          workDate: new Date(workDate),
          startAt: piece.startAt,
          endAt: piece.endAt,
        },
      })

      if (existing) {
        const updated = await prisma.overtimeEntry.update({
          where: { id: existing.id },
          data: {
            totalHours,
            rate,
            supervisorId,
          },
        })
        if (updated) createdOrUpdated += 1
      } else {
        await prisma.overtimeEntry.create({
          data: {
            periodId,
            agentId: s.agentId,
            source: "FIXED",
            status: "SUBMITTED",
            workDate: new Date(workDate),
            startAt: piece.startAt,
            endAt: piece.endAt,
            totalHours,
            rate,
            supervisorId,
            reason: holiday ? "Public holiday shift" : "Sunday shift",
          },
        })
        createdOrUpdated += 1
      }
    }
  }

  return { createdOrUpdated }
}

export function manualRateForDate(workDate, holidaySet) {
  const d = dayjs(workDate).format("YYYY-MM-DD")
  const sunday = isSunday(d)
  const holiday = holidaySet.has(d)
  return (sunday || holiday) ? 2.0 : 1.5
}

export function assertManualWithin7Days(workDate) {
  const d = dayjs(workDate).startOf("day")
  const min = dayjs().startOf("day").subtract(7, "day")
  if (d.isBefore(min)) {
    throw new Error("Manual overtime cannot be captured older than 7 days")
  }
}
