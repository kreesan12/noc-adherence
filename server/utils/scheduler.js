// server/utils/scheduler.js

/**
 * Generate minimal shift blocks for coverage.
 * @param requirements  Array of { hour, requiredAgents }
 * @param shiftLength   Number of hours per shift (incl. breaks)
 */
export function generateShifts(requirements, shiftLength = 9) {
  const coverage = Array(requirements.length).fill(0)
  const shifts   = []

  while (coverage.some((c, i) => c < requirements[i].requiredAgents)) {
    // first hour needing coverage
    const h      = coverage.findIndex((c, i) => c < requirements[i].requiredAgents)
    const needed = requirements[h].requiredAgents - coverage[h]

    // create `needed` shifts starting at h
    for (let i = 0; i < needed; i++) {
      shifts.push({ startHour: h, length: shiftLength })
      // bump coverage for that block
      for (let k = h; k < Math.min(coverage.length, h + shiftLength); k++) {
        coverage[k] += 1
      }
    }
  }

  return shifts
}

/**
 * Assign shift blocks to individual employees, enforcing:
 * - shiftLength (incl. lunch break)
 * - maxWeeklyHours per employee
 * - minRestHours between end of one shift and start of the next
 *
 * @param shiftBlocks   Array of { startHour, length }
 * @param options       { shiftLength, lunchBreak, maxWeeklyHours, minRestHours }
 * @returns employees   Array of { id, shifts: [...], totalHours }
 */
export function assignShifts(
  shiftBlocks,
  {
    shiftLength    = 9,    // hours per shift (including break)
    lunchBreak     = 1,    // hours of break (already inside shiftLength)
    maxWeeklyHours = 45,   // total hours allowed per employee per week
    minRestHours   = 48    // minimum hours between shifts
  } = {}
) {
  const employees = []

  for (const block of shiftBlocks) {
    const { startHour, length } = block
    const endHour = startHour + length

    // try to place with an existing employee
    let placed = false
    for (const emp of employees) {
      // 1) check weekly hours
      const usedHours = emp.shifts.reduce((sum, s) => sum + s.length, 0)
      if (usedHours + length > maxWeeklyHours) {
        continue
      }

      // 2) check rest since last shift
      const lastShift = emp.shifts[emp.shifts.length - 1]
      const lastEnd = lastShift.startHour + lastShift.length
      if (startHour - lastEnd < minRestHours) {
        continue
      }

      // fits → assign
      emp.shifts.push({ startHour, length })
      placed = true
      break
    }

    // if no existing employee can take it, start a new one
    if (!placed) {
      employees.push({
        id:       employees.length + 1,
        shifts:   [{ startHour, length }]
      })
    }
  }

  // annotate totalHours
  for (const emp of employees) {
    emp.totalHours = emp.shifts.reduce((sum, s) => sum + s.length, 0)
  }

  return employees
}
