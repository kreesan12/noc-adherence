// server/utils/scheduler.js

/**
 * Generate minimal shift blocks for coverage, with 9h shifts (incl. 1h lunch).
 * Returns an array of { startHour, length }
 */
export function generateShifts(requirements, shiftLength = 9) {
  const coverage = Array(24).fill(0)
  const shifts   = []

  while (coverage.some((c, h) => c < requirements[h].requiredAgents)) {
    const h      = coverage.findIndex((c, idx) => c < requirements[idx].requiredAgents)
    const needed = requirements[h].requiredAgents - coverage[h]

    for (let i = 0; i < needed; i++) {
      shifts.push({ startHour: h, length: shiftLength })
      for (let k = h; k < Math.min(24, h + shiftLength); k++) {
        coverage[k] += 1
      }
    }
  }

  return shifts
}

/**
 * (Future) Assign shift blocks to distinct employees,
 * enforcing:
 * - max 45h/week (incl. breaks)
 * - at least 48h between shifts
 * - 9h shift length (1h lunch)
 *
 * This stub returns unassigned shifts; a real assignment
 * would track each employee’s total hours and last end time.
 */
export function assignShifts(shiftBlocks, {
  shiftLength = 9,
  lunchBreak  = 1,
  maxWeeklyHours = 45,
  minRestHours   = 48
} = {}) {
  // TODO: implement employee‐level assignment algorithm
  return shiftBlocks
}
