// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Greedy cover solver for a 3-week rotation of 5 days on/2 off + 1 transition day.
 *
 * @param forecast      Array of { date: 'YYYY-MM-DD', staffing: [ { hour, requiredAgents } ] }
 * @param opts
 *   weeks            how many full 7-day weeks in the rotation (default 3)
 *   shiftLength      shift length in hours (default 9)
 *   startHours       optional array of allowed startHour values to try
 * @returns Array of { startDate, startHour, length, count }
 */
export function assignRotationalShifts(
  forecast,
  { weeks = 3, shiftLength = 9, startHours } = {}
) {
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

  // only allow startDates in the first week
  const firstWeek = allDates.filter(d => {
    const diff = dayjs(d).diff(dayjs(allDates[0]), 'day')
    return diff >= 0 && diff < 7
  })

  // helper: get the five workdays for each of the n weeks
  function getWorkDates(startDate) {
    const dates = []
    for (let w = 0; w < weeks; w++) {
      const base = dayjs(startDate).add(w * 7, 'day')
      for (let i = 0; i < 5; i++) {
        const d = base.add(i, 'day').format('YYYY-MM-DD')
        if (dateSet.has(d)) dates.push(d)
      }
    }
    return dates
  }

  // build all candidate rotation blocks
  const candidates = []
  firstWeek.forEach(startDate => {
    const workDates = getWorkDates(startDate)
    if (workDates.length < weeks * 5) return

    const hoursToTry = Array.isArray(startHours)
      ? startHours
      : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

    hoursToTry.forEach(startHour => {
      const cover = []
      workDates.forEach(d => {
        for (let h = startHour; h < startHour + shiftLength; h++) {
          cover.push(`${d}|${h}`)
        }
      })
      candidates.push({ startDate, startHour, length: shiftLength, cover })
    })
  })

  // greedy pick until all needs are zero
  const solution = []
  const localNeeds = { ...needs }
  while (true) {
    let best = null
    let bestCount = 0

    candidates.forEach(c => {
      const minCount = Math.min(...c.cover.map(k => localNeeds[k] || 0))
      if (minCount > bestCount) {
        best = c
        bestCount = minCount
      }
    })
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
 * Top-level: recommend best start-hours, then return the full coverage solution
 *
 * @param forecast    same as above
 * @param opts        { weeks, shiftLength, topN }
 * @returns { bestStartHours: Array<{startHour, totalAssigned}>, solution }
 */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5 } = {}
) {
  // 1) full greedy run
  const fullSolution = assignRotationalShifts(forecast, { weeks, shiftLength })

  // 2) tally total staff per startHour
  const tally = fullSolution.reduce((acc, { startHour, count }) => {
    acc[startHour] = (acc[startHour] || 0) + count
    return acc
  }, {})

  // 3) sort & pick topN for recommendations
  const bestStartHours = Object.entries(tally)
    .map(([h, totalAssigned]) => ({
      startHour: +h,
      totalAssigned
    }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  // 4) return both recommendations and full coverage
  return {
    bestStartHours,
    solution: fullSolution
  }
}
