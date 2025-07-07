import dayjs from 'dayjs'

/**
 * Greedy cover solver for a 3-week rotation of 5 days on/2 off + 1 transition day.
 *
 * @param forecast      Array of { date: 'YYYY-MM-DD', staffing: [ { hour, requiredAgents } ] }
 * @param opts
 *   weeks            how many full 7-day weeks in the rotation (default 3)
 *   shiftLength      shift length in hours (default 9)
 *   startHours       optional array of allowed startHour values to try
 * @returns solution    Array of { startDate, startHour, length, count }
 */
export function assignRotationalShifts(
  forecast,
  { weeks = 3, shiftLength = 9, startHours } = {}
) {
  // 1) build needs map
  const needs = {}
  const allDates = []
  forecast.forEach(day => {
    if (!Array.isArray(day.staffing)) return
    allDates.push(day.date)
    day.staffing.forEach(({ hour, requiredAgents }) => {
      needs[`${day.date}|${hour}`] = requiredAgents
    })
  })
  allDates.sort()
  const dateSet = new Set(allDates)

  // 2) limit startDates to the first-week window
  const firstWeek = allDates.filter(d => {
    const diff = dayjs(d).diff(dayjs(allDates[0]), 'day')
    return diff >= 0 && diff < 7
  })

  // helper: given a startDate, return the 5 work-day dates for each week
  function getWorkDates(startDate) {
    const dates = []
    for (let w = 0; w < weeks; w++) {
      const base = dayjs(startDate).add(w * 7, 'day')
      for (let doff = 0; doff < 5; doff++) {
        const d = base.add(doff, 'day').format('YYYY-MM-DD')
        if (dateSet.has(d)) dates.push(d)
      }
    }
    return dates
  }

  // 3) enumerate candidates (startDate × startHour)
  const candidates = []
  for (const startDate of firstWeek) {
    const workDates = getWorkDates(startDate)
    if (workDates.length < weeks * 5) continue   // skip if forecast too short

    const hoursToTry = Array.isArray(startHours)
      ? startHours
      : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

    for (const startHour of hoursToTry) {
      // build the cover‐set for this rotation block
      const cover = []
      for (const d of workDates) {
        for (let h = startHour; h < startHour + shiftLength; h++) {
          cover.push(`${d}|${h}`)
        }
      }
      candidates.push({ startDate, startHour, length: shiftLength, cover })
    }
  }

  // 4) greedy pick by max‐min unmet need
  const solution = []
  const localNeeds = { ...needs }
  while (true) {
    let best = null
    let bestCount = 0

    for (const c of candidates) {
      const minCount = Math.min(...c.cover.map(k => localNeeds[k] || 0))
      if (minCount > bestCount) {
        best = c
        bestCount = minCount
      }
    }
    if (!best || bestCount === 0) break

    solution.push({
      startDate: best.startDate,
      startHour: best.startHour,
      length:    best.length,
      count:     bestCount
    })

    best.cover.forEach(k => {
      localNeeds[k] = Math.max(0, (localNeeds[k] || 0) - bestCount)
    })
  }

  return solution
}


/**
 * Top-level: auto-tune startHours then assign
 */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5 } = {}
) {
  // 1) full run over all hours
  const fullSolution = assignRotationalShifts(forecast, { weeks, shiftLength })
  // 2) tally by startHour
  const tally = fullSolution.reduce((acc, { startHour, count }) => {
    acc[startHour] = (acc[startHour]||0) + count
    return acc
  }, {})
  const best = Object.entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a,b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  // 3) re-run restricted to those top startHours
  const startHours = best.map(b => b.startHour)
  const solution = assignRotationalShifts(forecast, {
    weeks, shiftLength, startHours
  })

  return { bestStartHours: best, solution }
}
