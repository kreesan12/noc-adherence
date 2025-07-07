// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Assign staff for a 3-week 5-on/2-off + transition rotation,
 * one agent at a time, greedy by unmet-need sum, and ensure
 * at least one block per first-week start-date.
 */
export function assignRotationalShifts(
  forecast,
  { weeks = 3, shiftLength = 9, startHours } = {}
) {
  // 1) unmet-needs map + allDates
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

  // 2) firstWeek window
  const firstWeek = allDates.filter(d => {
    const diff = dayjs(d).diff(allDates[0], 'day')
    return diff >= 0 && diff < 7
  })

  // 3) hoursToTry
  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

  // 4) helper: 5 on-days per rotation
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

  // 5) build candidates
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

  // 6) greedy one-by-one
  const localNeeds = { ...needs }
  const assignments = []
  while (true) {
    let best, bestScore = 0
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

  // 7) collapse into blocks + patternIndex
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

  // 8) business-rule padding: ensure 1 block for each first-week date
  firstWeek.forEach(startDate => {
    // if missing entirely:
    const found = Object.values(solutionMap)
      .some(b => b.startDate === startDate)
    if (!found) {
      // pick best candidate for that date
      const candForDate = candidates.filter(c => c.startDate === startDate)
      if (candForDate.length) {
        let top = candForDate[0]
        let topScore = top.cover.reduce((sum, k) => sum + (needs[k] || 0), 0)
        for (const c of candForDate.slice(1)) {
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
    }
  })

  // 9) sort by weekday then hour
  const solution = Object.values(solutionMap)
  solution.sort((a, b) =>
    a.patternIndex - b.patternIndex ||
    a.startHour    - b.startHour
  )

  return solution
}

/**
 * Top-level: solver + top-N startHour recs.
 */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5 } = {}
) {
  const solution = assignRotationalShifts(forecast, { weeks, shiftLength })

  // tally
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
