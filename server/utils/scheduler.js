// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Greedy cover solver for a 3-week rotation of 5 days on/2 off + transition day,
 * assigning one agent at a time to the block that covers the largest total unmet need.
 *
 * @param forecast      Array of { date: 'YYYY-MM-DD', staffing: [ { hour, requiredAgents } ] }
 * @param opts
 *   weeks            how many 7-day weeks to include (default 3)
 *   shiftLength      hours per shift (default 9)
 *   startHours       optional array of allowed startHour values
 * @returns Array of { startDate, startHour, length, count }
 */
export function assignRotationalShifts(
  forecast,
  { weeks = 3, shiftLength = 9, startHours } = {}
) {
  // Build unmet‐needs map
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

  // Only allow rotations starting in week-1 of the forecast
  const firstWeek = allDates.filter(d => {
    const diff = dayjs(d).diff(dayjs(allDates[0]), 'day')
    return diff >= 0 && diff < 7
  })

  // Helper: get the 5 “on” days for each week of the rotation
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

  // Build all candidate blocks
  const candidates = firstWeek.flatMap(startDate => {
    const workDates = getWorkDates(startDate)
    if (workDates.length < weeks * 5) return []

    const hoursToTry = Array.isArray(startHours)
      ? startHours
      : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

    return hoursToTry.map(startHour => {
      const cover = []
      workDates.forEach(d => {
        for (let h = startHour; h < startHour + shiftLength; h++) {
          cover.push(`${d}|${h}`)
        }
      })
      return { startDate, startHour, length: shiftLength, cover }
    })
  })

  // Greedy: assign one agent to the block with max total unmet need
  const localNeeds = { ...needs }
  const assignments = []
  while (true) {
    let best = null
    let bestScore = 0

    candidates.forEach(c => {
      const score = c.cover.reduce((sum, k) => sum + (localNeeds[k] || 0), 0)
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    })
    if (!best || bestScore === 0) break

    // assign one agent
    assignments.push({ startDate: best.startDate, startHour: best.startHour })
    best.cover.forEach(k => {
      localNeeds[k] = Math.max(0, (localNeeds[k] || 0) - 1)
    })
  }

  // Collapse into counts per block
  const solutionMap = {}
  assignments.forEach(({ startDate, startHour }) => {
    const key = `${startDate}|${startHour}`
    if (!solutionMap[key]) {
      solutionMap[key] = { startDate, startHour, length: shiftLength, count: 0 }
    }
    solutionMap[key].count++
  })

  return Object.values(solutionMap)
}

/**
 * Top-level helper: runs full coverage solver then recommends top-N startHours
 *
 * @param forecast    same as above
 * @param opts        { weeks, shiftLength, topN }
 * @returns { bestStartHours: [{startHour, totalAssigned}], solution }
 */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5 } = {}
) {
  const solution = assignRotationalShifts(forecast, { weeks, shiftLength })

  // tally by startHour
  const tally = solution.reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + b.count
    return acc
  }, {})

  // pick topN
  const bestStartHours = Object.entries(tally)
    .map(([startHour, totalAssigned]) => ({
      startHour: Number(startHour),
      totalAssigned
    }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  return { bestStartHours, solution }
}
