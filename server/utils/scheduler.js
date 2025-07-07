// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Legacy: generate individual shift blocks to cover a 1-day array of hourly requirements.
 * (Kept here in case you still need it for one-off/day-view charts.)
 */
export function generateShifts(requirements, shiftLength = 9) {
  const coverage = Array(requirements.length).fill(0)
  const shifts   = []

  while (coverage.some((c, i) => c < requirements[i].requiredAgents)) {
    const h      = coverage.findIndex((c, i) => c < requirements[i].requiredAgents)
    const needed = requirements[h].requiredAgents - coverage[h]

    for (let i = 0; i < needed; i++) {
      shifts.push({ startHour: h, length: shiftLength })
      for (let k = h; k < Math.min(coverage.length, h + shiftLength); k++) {
        coverage[k] += 1
      }
    }
  }

  return shifts
}

/**
 * Greedy block-cover solver over a multi-day forecast.
 *
 * @param forecast    Array of { date: 'YYYY-MM-DD', staffing: [ { hour, requiredAgents } ] }
 * @param options     { windowDays, shiftLength }
 * @returns solution  Array of { startDate, startHour, length, count }
 */
export function assignShifts(
  forecast,
  { windowDays = 5, shiftLength = 9 } = {}
) {
  // 1) build a flat “needs” map: needs["YYYY-MM-DD|h"] → requiredAgents
  const needs = {}
  forecast.forEach(day => {
    if (!Array.isArray(day.staffing)) return
    day.staffing.forEach(({ hour, requiredAgents }) => {
      needs[`${day.date}|${hour}`] = requiredAgents
    })
  })

  // 2) prepare sorted list of dates and quick lookup
  const dates = forecast.map(d => d.date).sort()
  const dateSet = new Set(dates)

  // 3) enumerate every candidate block of windowDays × shiftLength
  const candidates = []
  for (const startDate of dates) {
    // build the date window
    const windowDates = Array.from({ length: windowDays }, (_, i) =>
      dayjs(startDate).add(i, 'day').format('YYYY-MM-DD')
    )
    // skip if window spills outside our forecast
    if (!windowDates.every(d => dateSet.has(d))) continue

    // each possible startHour
    for (let startHour = 0; startHour <= 24 - shiftLength; startHour++) {
      // collect all covered keys
      const cover = []
      for (const d of windowDates) {
        for (let h = startHour; h < startHour + shiftLength; h++) {
          cover.push(`${d}|${h}`)
        }
      }
      candidates.push({ startDate, startHour, length: shiftLength, cover })
    }
  }

  // 4) greedy selection: pick block covering the hour with highest unmet need
  const solution = []
  while (true) {
    let best = null
    let bestScore = 0

    for (const c of candidates) {
      // score = max(need) over this block’s hours
      const score = Math.max(0, ...c.cover.map(k => needs[k] || 0))
      if (score > bestScore) {
        best = c
        bestScore = score
      }
    }

    // no more unmet need
    if (!best || bestScore === 0) break

    // assign exactly bestScore staff to that block
    solution.push({
      startDate: best.startDate,
      startHour: best.startHour,
      length:    best.length,
      count:     bestScore
    })

    // subtract that many from every hour in the block
    best.cover.forEach(k => {
      needs[k] = Math.max(0, (needs[k] || 0) - bestScore)
    })
  }

  return solution
}
