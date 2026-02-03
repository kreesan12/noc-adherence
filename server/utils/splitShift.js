import dayjs from "dayjs"

export function splitShiftByDate(shift) {
  const start = dayjs(shift.startAt)
  const end = dayjs(shift.endAt)

  if (end.isSame(start, "day")) return [{ ...shift }]

  const endOfStartDay = start.endOf("day")
  const startOfEndDay = end.startOf("day")

  return [
    {
      ...shift,
      workDate: start.format("YYYY-MM-DD"),
      startAt: start.toDate(),
      endAt: endOfStartDay.toDate(),
      breakStart: shift.breakStart,
      breakEnd: shift.breakEnd,
    },
    {
      ...shift,
      workDate: end.format("YYYY-MM-DD"),
      startAt: startOfEndDay.toDate(),
      endAt: end.toDate(),
      breakStart: null,
      breakEnd: null,
    },
  ]
}
