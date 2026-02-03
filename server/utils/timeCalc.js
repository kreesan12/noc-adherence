export function hoursBetween(startAt, endAt, breakStart, breakEnd) {
  const ms = new Date(endAt).getTime() - new Date(startAt).getTime()
  let hours = ms / (1000 * 60 * 60)

  if (breakStart && breakEnd) {
    const bms = new Date(breakEnd).getTime() - new Date(breakStart).getTime()
    hours -= bms / (1000 * 60 * 60)
  }

  return Math.max(0, Math.round(hours * 100) / 100)
}
