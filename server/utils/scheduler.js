import dayjs from '../utils/dayjs.js'

/* -------------------------------------------------------------- *
 * assignRotationalShifts
 * Enumerates candidate blocks: startDate × startHour × breakOffset
 * Greedy assigns 1 head at a time, then PRUNES redundant heads,
 * then collapses into blocks with count <= splitSize so lunches
 * can stagger.
 * -------------------------------------------------------------- */

export function assignRotationalShifts(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    startHours,              // optional whitelist from caller
    maxStaff,
    splitSize = 2            // lunch staggering group size (does NOT change headcount)
  } = {}
) {
  /* ---------- 1) unmet-need map + date sets ------------------- */
  const needs = {}
  const allDates = []

  forecast.forEach(d => {
    if (!Array.isArray(d.staffing)) return
    allDates.push(d.date)
    d.staffing.forEach(({ hour, requiredAgents }) => {
      needs[`${d.date}|${hour}`] = requiredAgents
    })
  })

  allDates.sort()
  const dateSet = new Set(allDates)

  /* ---------- 2) first-week range (anchor candidates) --------- */
  const firstWeek = allDates.filter(d => dayjs(d).diff(allDates[0], 'day') < 7)

  /* ---------- 3) hours we’re willing to start ----------------- */
  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h) // 0..15 when shiftLength=9

  /* ---------- 4) helper: on-duty dates for a startDate -------- */
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

  /* ---------- 5) build EVERY candidate triple ----------------- */
  const candidates = []
  const candByKey = new Map() // key -> candidate

  for (const startDate of firstWeek) {
    const workDates = getWorkDates(startDate)
    if (workDates.length < 5 * weeks) continue

    for (const startHour of hoursToTry) {
      const maxOffset = Math.min(5, shiftLength - 1)
      for (let off = 2; off <= maxOffset; off++) {
        const cover = []
        const breakHours = new Set()

        workDates.forEach(d => {
          // lunch hour NOT covered
          breakHours.add(`${d}|${startHour + off}`)
          for (let h = startHour; h < startHour + shiftLength; h++) {
            if (h === startHour + off) continue
            cover.push(`${d}|${h}`)
          }
        })

        const cand = {
          startDate,
          startHour,
          breakOffset: off,
          length: shiftLength,
          cover,
          breakHours
        }

        const key = `${startDate}|${startHour}|${off}`
        candidates.push(cand)
        candByKey.set(key, cand)
      }
    }
  }

  /* ---------- 6) greedy selection ----------------------------- */
  const localNeeds = { ...needs }
  const assignments = []

  while (true) {
    if (typeof maxStaff === 'number' && assignments.length >= maxStaff) break

    let best = null
    let bestScore = 0

    for (const c of candidates) {
      const sc = c.cover.reduce((s, k) => s + (localNeeds[k] || 0), 0)
      if (sc > bestScore) {
        best = c
        bestScore = sc
      }
    }

    if (!best || bestScore === 0) break

    assignments.push({
      startDate: best.startDate,
      startHour: best.startHour,
      breakOffset: best.breakOffset
    })

    best.cover.forEach(k => {
      localNeeds[k] = Math.max(0, (localNeeds[k] || 0) - 1)
    })
  }

  /* ---------- 7) OPTIONAL: demand-aware “ensure day exists” --- */
  // Only add a starter block for a first-week day if that day has ANY demand
  // across its rotation window, and only if it doesn't already exist.
  for (const startDate of firstWeek) {
    const exists = assignments.some(a => a.startDate === startDate)
    if (exists) continue

    // is there any demand at all on this rotation window?
    const workDates = getWorkDates(startDate)
    const hasAnyDemand = workDates.some(d => {
      for (let h = 0; h < 24; h++) {
        if ((needs[`${d}|${h}`] || 0) > 0) return true
      }
      return false
    })
    if (!hasAnyDemand) continue

    // choose best startHour/off for this day based on needs
    let bestCombo = null
    let bestScore = -1
    for (const h of hoursToTry) {
      const maxOff = Math.min(5, shiftLength - 1)
      for (let off = 2; off <= maxOff; off++) {
        const score = workDates.reduce((s, d) => {
          for (let x = h; x < h + shiftLength; x++) {
            if (x === h + off) continue
            s += needs[`${d}|${x}`] || 0
          }
          return s
        }, 0)
        if (score > bestScore) {
          bestScore = score
          bestCombo = { h, off }
        }
      }
    }

    if (bestCombo && bestScore > 0) {
      // respect maxStaff if provided
      if (typeof maxStaff === 'number' && assignments.length >= maxStaff) break
      assignments.push({
        startDate,
        startHour: bestCombo.h,
        breakOffset: bestCombo.off
      })
    }
  }

  /* ---------- 8) PRUNE redundant heads (safe trim) ----------- */
  // Build coverage map from assignments
  const coverage = {}
  function applyDelta(a, delta) {
    const key = `${a.startDate}|${a.startHour}|${a.breakOffset}`
    const cand = candByKey.get(key)
    if (!cand) return
    for (const k of cand.cover) {
      coverage[k] = (coverage[k] || 0) + delta
    }
  }

  assignments.forEach(a => applyDelta(a, +1))

  function canRemove(a) {
    const key = `${a.startDate}|${a.startHour}|${a.breakOffset}`
    const cand = candByKey.get(key)
    if (!cand) return false

    for (const k of cand.cover) {
      const after = (coverage[k] || 0) - 1
      const req = needs[k] || 0
      if (after < req) return false
    }
    return true
  }

  // Iteratively remove removable assignments (prefer those added later)
  let changed = true
  while (changed) {
    changed = false
    for (let i = assignments.length - 1; i >= 0; i--) {
      const a = assignments[i]
      if (!canRemove(a)) continue

      applyDelta(a, -1)
      assignments.splice(i, 1)
      changed = true
    }
  }

  /* ---------- 9) collapse into solution blocks (splitSize) ---- */
  const solution = []
  const tally = new Map()
  const order = []

  for (const a of assignments) {
    const key = `${a.startDate}|${a.startHour}|${a.breakOffset}`
    if (!tally.has(key)) order.push(key)
    tally.set(key, (tally.get(key) || 0) + 1)
  }

  for (const key of order) {
    const [startDate, startHourStr, breakOffsetStr] = key.split('|')
    const startHour = Number(startHourStr)
    const breakOffset = Number(breakOffsetStr)
    let remaining = tally.get(key)

    while (remaining > 0) {
      const chunk = Math.min(splitSize, remaining)
      solution.push({
        startDate,
        startHour,
        breakOffset,
        length: shiftLength,
        count: chunk,
        patternIndex: dayjs(startDate).day()
      })
      remaining -= chunk
    }
  }

  solution.sort((a, b) =>
    (a.patternIndex ?? 0) - (b.patternIndex ?? 0) ||
    a.startHour - b.startHour
  )

  return solution
}

/* ---------- autoAssignRotations ------------------------------ */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5, maxStaff, splitSize = 2 } = {}
) {
  const solution = assignRotationalShifts(
    forecast,
    { weeks, shiftLength, maxStaff, splitSize }
  )

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
