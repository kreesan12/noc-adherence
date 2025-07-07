// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Assign staff to cover a 3-week rotation of 5 days on/2 off + transition day,
 * greedy “one agent at a time” by summing unmet need.
 *
 * @param forecast      Array<{ date: 'YYYY-MM-DD', staffing: [{ hour, requiredAgents }] }>
 * @param opts
 *   weeks           Number of 7-day weeks per rotation (default 3)
 *   shiftLength     Hours per shift block (default 9)
 *   startHours      Optional array of allowed startHour values
 * @returns Array<{
 *   startDate: string,
 *   startHour: number,
 *   length: number,
 *   count: number,
 *   patternIndex: number
 * }>
 */
export function assignRotationalShifts(
  forecast,
  { weeks = 3, shiftLength = 9, startHours } = {}
) {
  // 1) Build unmet-needs map
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

  // 2) Only allow rotations starting in the first 7 days
  const firstWeek = allDates.filter(d => {
    const diff = dayjs(d).diff(dayjs(allDates[0]), 'day')
    return diff >= 0 && diff < 7
  })

  // 3) Helper: get the 5 “on” days for each of N weeks
  function getWorkDates(startDate) {
    const dates = []
    for (let w = 0; w < weeks; w++) {
      const base = dayjs(startDate).add(w * 7, 'day')
      for (let i = 0; i < 5; i++) {
        const dd = base.add(i, 'day').format('YYYY-MM-DD')
        if (dateSet.has(dd)) dates.push(dd)
      }
    }
    return dates
  }

  // 4) Build all candidate blocks (startDate × startHour)
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

  // 5) Greedy: assign one agent at a time to the block with max total unmet need
  const localNeeds = { ...needs }
  const assignments = []
  while (true) {
    let best = null
    let bestScore = 0
    for (const c of candidates) {
      const score = c.cover.reduce((sum, k) => sum + (localNeeds[k] || 0), 0)
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }
    if (!best || bestScore === 0) break

    assignments.push({ startDate: best.startDate, startHour: best.startHour })
    best.cover.forEach(k => {
      localNeeds[k] = Math.max(0, (localNeeds[k] || 0) - 1)
    })
  }

  // 6) Collapse into blocks with counts, tagging patternIndex
  const solutionMap = {}
  assignments.forEach(({ startDate, startHour }) => {
    const key = `${startDate}|${startHour}`
    if (!solutionMap[key]) {
      solutionMap[key] = {
        startDate,
        startHour,
        length: shiftLength,
        count: 0,
        // Which 5-day pattern (0=Sunday start, 1=Monday start, …)
        patternIndex: dayjs(startDate).day()
      }
    }
    solutionMap[key].count++
  })

  return Object.values(solutionMap)
}

/**
 * Top-level: returns both the full coverage solution and the top-N start-hour recommendations.
 *
 * @param forecast    Same as above
 * @param opts        { weeks, shiftLength, topN }
 * @returns {{
 *   bestStartHours: Array<{ startHour: number, totalAssigned: number }>,
 *   solution: Array<{
 *     startDate: string,
 *     startHour: number,
 *     length: number,
 *     count: number,
 *     patternIndex: number
 *   }>
 * }}
 */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5 } = {}
) {
  const solution = assignRotationalShifts(forecast, { weeks, shiftLength })

  // Tally total staff per startHour
  const tally = solution.reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + b.count
    return acc
  }, {})

  // Pick topN startHours
  const bestStartHours = Object.entries(tally)
    .map(([h, total]) => ({ startHour: Number(h), totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  return { bestStartHours, solution }
}
