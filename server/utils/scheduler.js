// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Assign staff for an N-week 5-on/2-off rotation,
 * greedily by unmet-need sum, then ensure one block per first-week date.
 */
export function assignRotationalShifts(
  forecast,
  { weeks = 3, shiftLength = 9, startHours, maxStaff } = {}
) {
  // 1) build unmet-needs map + list of all dates
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

  // 2) first-week window (day 0–6)
  const firstWeek = allDates.filter(d => {
    const diff = dayjs(d).diff(allDates[0], 'day')
    return diff >= 0 && diff < 7
  })

  // 3) start hours to try
  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

  // 4) helper: get the “on” days (clamped to forecast) for a startDate
  function getWorkDates(startDate) {
    const out = []
    for (let w = 0; w < weeks; w++) {
      const base = dayjs(startDate).add(w * 7, 'day')
      for (let i = 0; i < 5; i++) {
        const dd = base.add(i, 'day').format('YYYY-MM-DD')
        if (dateSet.has(dd)) out.push(dd)
      }
    }
    return out
  }

  // 5) build all fully-coverable candidates
  const candidates = firstWeek.flatMap(startDate => {
    const workDates = getWorkDates(startDate)
    if (workDates.length < weeks * 5) return []
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

  // 6) greedy assign one agent at a time (honouring maxStaff if set)
  const localNeeds = { ...needs }
  const assignments = []
  while (true) {
    // stop if we've reached the user-specified staff cap
    if (typeof maxStaff === 'number' && assignments.length >= maxStaff) {
      break
    }

    let best = null, bestScore = 0
    for (const c of candidates) {
      const sc = c.cover.reduce((sum, k) => sum + (localNeeds[k] || 0), 0)
      if (sc > bestScore) {
        best = c
        bestScore = sc
      }
    }
    if (!best || bestScore === 0) break

    assignments.push({
      startDate: best.startDate,
      startHour: best.startHour
    })
    best.cover.forEach(k => {
      localNeeds[k] = Math.max(0, (localNeeds[k] || 0) - 1)
    })
  }

  // 7) collapse into blocks
  const solutionMap = {}
  assignments.forEach(({ startDate, startHour }) => {
    const key = `${startDate}|${startHour}`
    if (!solutionMap[key]) {
      solutionMap[key] = {
        startDate,
        startHour,
        length: shiftLength,
        count: 0,
        patternIndex: dayjs(startDate).day()
      }
    }
    solutionMap[key].count++
  })

  // 8) padding: ensure every first-week date has at least one block
  firstWeek.forEach(startDate => {
    const exists = Object.values(solutionMap)
      .some(b => b.startDate === startDate)
    if (!exists) {
      const workDates = getWorkDates(startDate)
      const padCands = hoursToTry.map(startHour => {
        const cover = []
        workDates.forEach(d => {
          for (let h = startHour; h < startHour + shiftLength; h++) {
            cover.push(`${d}|${h}`)
          }
        })
        return { startDate, startHour, length: shiftLength, cover }
      })
      let top = padCands[0]
      let topScore = top.cover.reduce((s, k) => s + (needs[k] || 0), 0)
      for (const c of padCands.slice(1)) {
        const sc = c.cover.reduce((s, k) => s + (needs[k] || 0), 0)
        if (sc > topScore) {
          top = c; topScore = sc
        }
      }
      const key = `${top.startDate}|${top.startHour}`
      solutionMap[key] = {
        startDate: top.startDate,
        startHour: top.startHour,
        length: top.length,
        count: 1,
        patternIndex: dayjs(top.startDate).day()
      }
    }
  })

  // 9) sort by weekday → hour
  const solution = Object.values(solutionMap)
  solution.sort((a, b) =>
    a.patternIndex - b.patternIndex ||
    a.startHour    - b.startHour
  )

  return solution
}


/**
 * Top-level: run solver + return top-N startHour picks.
 */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5, maxStaff } = {}
) {
  // hand maxStaff through to the core solver
  const solution = assignRotationalShifts(
    forecast,
    { weeks, shiftLength, maxStaff }
  )

  // tally counts by hour
  const tally = solution.reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + b.count
    return acc
  }, {})

  const bestStartHours = Object.entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  return { bestStartHours, solution }
}
