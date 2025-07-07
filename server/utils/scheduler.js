// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Legacy: generate individual shift blocks to cover a 1-day array of hourly requirements.
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
 * Now picks the block that can staff the **most uniform** demand
 * (i.e. highest min-remaining-need), so we never overshoot.
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

  // 2) prepare sorted list of dates & quick lookup
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

  // 4) greedy selection: pick the block with the largest _minimum_ unmet need
  const solution = []
  while (true) {
    let best = null
    let bestCount = 0

    for (const c of candidates) {
      // how many could we staff on _every_ hour of this block?
      const minCount = Math.min(...c.cover.map(k => needs[k] || 0))
      if (minCount > bestCount) {
        best = c
        bestCount = minCount
      }
    }

    // if nothing left to assign, stop
    if (!best || bestCount === 0) break

    // assign exactly bestCount staff to this block
    solution.push({
      startDate: best.startDate,
      startHour: best.startHour,
      length:    best.length,
      count:     bestCount
    })

    // subtract that many from every hour it covers
    best.cover.forEach(k => {
      needs[k] = Math.max(0, (needs[k] || 0) - bestCount)
    })
  }

  return solution
}
