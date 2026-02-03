import dayjs from "dayjs"

export function getOvertimePeriodForDate(dateLike) {
  const d = dayjs(dateLike).startOf("day")
  const day = d.date()

  let start
  let end
  let label

  if (day >= 15) {
    start = d.date(15)
    end = start.add(1, "month").date(14)
  } else {
    start = d.subtract(1, "month").date(15)
    end = d.date(14)
  }

  const labelStart = start.format("MMM")
  const labelEnd = end.format("MMM")
  const labelYear = end.format("YYYY")
  label = `${labelStart} to ${labelEnd} ${labelYear}`

  const key = `${start.format("YYYY_MM_DD")}__${end.format("YYYY_MM_DD")}`

  return {
    key,
    label,
    startDate: start.format("YYYY-MM-DD"),
    endDate: end.format("YYYY-MM-DD"),
  }
}

export function isSunday(dateLike) {
  return dayjs(dateLike).day() === 0
}
