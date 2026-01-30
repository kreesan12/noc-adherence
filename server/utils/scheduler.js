import dayjs from '../utils/dayjs.js'

/* -------------------------------------------------------------- *
 * assignRotationalShifts
 * Enumerates candidate blocks: startDate × startHour × breakOffset
 * Greedy assigns 1 head at a time (up to maxStaff), then prunes
 * redundant picks.
 *
 * Returns:
 * - solution: collapsed blocks with counts
 * - meta: { unmet, headcount, assignments }
 * -------------------------------------------------------------- */

export function assignRotationalShifts(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    startHours,                 // optional whitelist
    maxStaff,                   // cap on heads (assignments)
    splitSize = 999,            // chunk size when collapsing counts
    restarts = 12,              // randomized greedy restarts
    prune = true                // remove redundant assignments
  } = {}
) {
  /* 1) unmet-need map + dates */
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
  if (!allDates.length) {
    return { solution: [], meta: { unmet: 0, headcount: 0, assignments: [] } }
  }

  /* 2) first-week range used as allowable startDate anchors */
  const firstDay = allDates[0]
  const firstWeek = allDates.filter(d => dayjs(d).diff(firstDay, 'day') < 7)

  /* 3) allowed start hours (default: every possible for shiftLength) */
  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h) // 0..15 for 9h

  /* 4) rotation work dates: weeks * (5-on) spaced by 7 days */
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

  /* 5) candidates: startDate × startHour × breakOffset (2..5) */
  const candidates = []
  for (const startDate of firstWeek) {
    const workDates = getWorkDates(startDate)
    if (workDates.length < 5 * weeks) continue

    for (const startHour of hoursToTry) {
      const maxOffset = Math.min(5, shiftLength - 1)
      for (let off = 2; off <= maxOffset; off++) {
        const cover = []
        workDates.forEach(d => {
          for (let h = startHour; h < startHour + shiftLength; h++) {
            if (h === startHour + off) continue // lunch hour not covered
            cover.push(`${d}|${h}`)
          }
        })

        candidates.push({
          startDate,
          startHour,
          breakOffset: off,
          length: shiftLength,
          cover
        })
      }
    }
  }

  if (!candidates.length) {
    return { solution: [], meta: { unmet: 0, headcount: 0, assignments: [] } }
  }

  function totalUnmet(localNeeds) {
    let t = 0
    for (const k in localNeeds) t += (localNeeds[k] || 0)
    return t
  }

  function applyCandidate(c, localNeeds) {
    for (const k of c.cover) {
      const cur = localNeeds[k] || 0
      if (cur > 0) localNeeds[k] = cur - 1
    }
  }

  function scoreCandidate(c, localNeeds) {
    let sc = 0
    for (const k of c.cover) sc += (localNeeds[k] || 0)
    return sc
  }

  /* prune: remove assignments that are not needed to meet needs */
  function pruneAssignments(assignments) {
    const coverCounts = {}
    for (const a of assignments) {
      for (const k of a.cover) coverCounts[k] = (coverCounts[k] || 0) + 1
    }

    // remove low impact picks first
    const scored = assignments.map((a, idx) => {
      let tight = 0
      for (const k of a.cover) {
        const req = needs[k] || 0
        const cov = coverCounts[k] || 0
        if (cov <= req) tight += 1
      }
      return { idx, tight }
    }).sort((x, y) => x.tight - y.tight)

    const removed = new Set()

    for (const s of scored) {
      if (removed.has(s.idx)) continue
      const a = assignments[s.idx]

      let ok = true
      for (const k of a.cover) {
        const req = needs[k] || 0
        const cov = coverCounts[k] || 0
        if (cov - 1 < req) { ok = false; break }
      }
      if (!ok) continue

      for (const k of a.cover) coverCounts[k] = (coverCounts[k] || 0) - 1
      removed.add(s.idx)
    }

    return assignments.filter((_, idx) => !removed.has(idx))
  }

  /* One greedy attempt, optionally randomized for tie diversity */
  function runGreedy(randomize) {
    const localNeeds = { ...needs }
    const assignments = []

    const candList = randomize ? [...candidates] : candidates
    if (randomize) {
      for (let i = candList.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = candList[i]
        candList[i] = candList[j]
        candList[j] = tmp
      }
    }

    while (true) {
      if (typeof maxStaff === 'number' && assignments.length >= maxStaff) break

      let best = null
      let bestScore = 0

      for (const c of candList) {
        const sc = scoreCandidate(c, localNeeds)
        if (sc > bestScore) {
          best = c
          bestScore = sc
        }
      }

      if (!best || bestScore === 0) break

      assignments.push(best)
      applyCandidate(best, localNeeds)
    }

    const pruned = prune ? pruneAssignments(assignments) : assignments
    // unmet after greedy loop, not after prune, so recompute unmet precisely
    // by simulating coverage of pruned assignments
    const recompute = { ...needs }
    for (const a of pruned) applyCandidate(a, recompute)
    const unmet = totalUnmet(recompute)

    return { assignments: pruned, unmet }
  }

  /* multi restart: pick best by unmet asc, then headcount asc */
  const tries = Math.max(1, Number(restarts) || 1)
  let bestRun = null

  for (let t = 0; t < tries; t++) {
    const r = runGreedy(t > 0)
    if (!bestRun) bestRun = r
    else if (r.unmet < bestRun.unmet) bestRun = r
    else if (r.unmet === bestRun.unmet && r.assignments.length < bestRun.assignments.length) bestRun = r
  }

  const assignments = bestRun.assignments

  /* collapse into blocks with splitSize */
  const tally = new Map()
  const order = []
  for (const a of assignments) {
    const key = `${a.startDate}|${a.startHour}|${a.breakOffset}`
    if (!tally.has(key)) order.push(key)
    tally.set(key, (tally.get(key) || 0) + 1)
  }

  const solution = []
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

  return {
    solution,
    meta: {
      unmet: bestRun.unmet,
      headcount: assignments.length,
      assignments
    }
  }
}

/* -------------------------------------------------------------- *
 * optimizeRotationalShifts
 * This is the "ladder" you described:
 * - Find feasible headcount H
 * - Try H-1 from scratch (many restarts)
 * - Keep going down until infeasible
 * - Return last feasible solution
 * -------------------------------------------------------------- */
export function optimizeRotationalShifts(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    startHours,
    splitSize = 999,
    restartsPerCap = 24,
    prune = true,
    maxCap = 5000
  } = {}
) {
  // feasibility test at a specific cap
  function solveAtCap(cap) {
    const { solution, meta } = assignRotationalShifts(forecast, {
      weeks,
      shiftLength,
      startHours,
      maxStaff: cap,
      splitSize,
      restarts: restartsPerCap,
      prune
    })
    return { solution, meta, feasible: meta.unmet === 0 }
  }

  // Step 1: find any feasible headcount (doubling)
  let cap = 1
  let best = solveAtCap(cap)

  while (!best.feasible && cap < maxCap) {
    cap *= 2
    best = solveAtCap(cap)
  }

  // If still not feasible, return best attempt
  if (!best.feasible) {
    return { bestStartHours: [], solution: best.solution, meta: best.meta }
  }

  // Step 2: ladder down one by one, recomputing from scratch each time
  let lastFeasible = best
  for (let nextCap = cap - 1; nextCap >= 1; nextCap--) {
    const attempt = solveAtCap(nextCap)
    if (attempt.feasible) {
      lastFeasible = attempt
    } else {
      break
    }
  }

  const solution = lastFeasible.solution

  const tally = solution.reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + b.count
    return acc
  }, {})

  const bestStartHours = Object.entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, 5)

  return { bestStartHours, solution, meta: lastFeasible.meta }
}

/* -------------------------------------------------------------- *
 * autoAssignRotations
 * If optimizeHeadcount = true, uses the ladder optimiser.
 * Else returns one run at the provided cap.
 * -------------------------------------------------------------- */
export function autoAssignRotations(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    topN = 5,
    maxStaff,
    splitSize = 999,
    restarts = 12,
    prune = true,
    optimizeHeadcount = false,
    restartsPerCap = 24
  } = {}
) {
  if (optimizeHeadcount) {
    const out = optimizeRotationalShifts(forecast, {
      weeks,
      shiftLength,
      splitSize,
      restartsPerCap,
      prune
    })
    // respect topN on the output
    out.bestStartHours = (out.bestStartHours || []).slice(0, topN)
    return out
  }

  const { solution } = assignRotationalShifts(forecast, {
    weeks,
    shiftLength,
    maxStaff,
    splitSize,
    restarts,
    prune
  })

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
