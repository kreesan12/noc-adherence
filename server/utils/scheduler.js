// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Generate minimal shift blocks for coverage.
 * (Keept for legacy if needed.)
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
 * Assign shift blocks to employees in 5-day consecutive runs.
 *
 * @param shiftBlocks  Array of { date: 'YYYY-MM-DD', startHour, length }
 * @param options      { shiftLength, lunchBreak, maxWeeklyHours, minRestHours }
 * @returns employees  Array of {
 *   id,
 *   shifts: [ { date, startHour, length } × 5 ],
 *   totalHours
 * }
 */
export function assignShifts(
  shiftBlocks,
  {
    shiftLength    = 9,    // hours per shift (incl. 1h lunch)
    lunchBreak     = 1,
    maxWeeklyHours = 45,   // including lunch
    minRestHours   = 48    // between end of last and next start
  } = {}
) {
  // 1) bucket counts by date+pattern
  const reqMap = {}
  shiftBlocks.forEach(({ date, startHour, length }) => {
    reqMap[date] = reqMap[date] || {}
    const key = `${startHour}-${length}`
    reqMap[date][key] = (reqMap[date][key] || 0) + 1
  })

  // sorted list of dates
  const dates = Object.keys(reqMap).sort()
  const employees = []

  // 2) slide 5-day window over dates
  for (let i = 0; i + 4 < dates.length; i++) {
    const windowDates = dates.slice(i, i + 5)

    // for each shift pattern available on the first day
    Object.keys(reqMap[windowDates[0]] || {}).forEach(pattern => {
      const [shStr, lenStr] = pattern.split('-')
      const startHour = +shStr
      const length    = +lenStr

      // find how many we can staff for all 5 days
      let minCount = Infinity
      windowDates.forEach(d => {
        const dayReq = reqMap[d][pattern] || 0
        minCount = Math.min(minCount, dayReq)
      })

      // assign that many employees to this pattern for the 5-day block
      for (let n = 0; n < minCount; n++) {
        const shifts = windowDates.map(d => ({
          date: d,
          startHour,
          length
        }))
        employees.push({
          id:         employees.length + 1,
          shifts,
          totalHours: shifts.reduce((sum, s) => sum + s.length, 0)
        })
      }

      // reduce the requirement counts
      windowDates.forEach(d => {
        reqMap[d][pattern] -= minCount
      })
    })
  }

  return employees
}
