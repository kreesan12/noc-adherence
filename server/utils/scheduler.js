// server/utils/scheduler.js
export function generateShifts(requirements, shiftLength = 8) {
  // requirements: [{ hour: 0…23, requiredAgents }]
  const coverage = Array(24).fill(0)
  const shifts   = []

  // while any hour is under-covered
  while (coverage.some((c, h) => c < requirements[h].requiredAgents)) {
    // first hour needing coverage
    const h = coverage.findIndex((c, idx) => c < requirements[idx].requiredAgents)
    // how many more agents needed at hour h
    const needed = requirements[h].requiredAgents - coverage[h]

    // create `needed` shifts starting at hour h
    for (let i = 0; i < needed; i++) {
      shifts.push({ startHour: h, length: shiftLength })
      // bump coverage for each hour in that block
      for (let k = h; k < Math.min(24, h + shiftLength); k++) {
        coverage[k] += 1
      }
    }
  }

  return shifts
}
