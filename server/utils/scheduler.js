import dayjs from '../utils/dayjs.js'

/* -------------------------------------------------------------- *
 * Scheduler: greedy baseline + time-bounded multi-restart search.
 *
 * IMPORTANT FIXES:
 * 1) Per-restart improvement budget:
 *    localImprove() gets a restart-local budget so restart #1
 *    cannot consume the entire global time limit.
 *
 * 2) Restarts are respected:
 *    If timeLimitMs > 0 -> stop by time, but also stop when
 *    restarts reach greedyRestarts (unless greedyRestarts = 0).
 *
 * 3) Repair move (surplus to breach):
 *    During local improvement, occasionally perform a targeted move
 *    that removes coverage from the most overstaffed portions and
 *    reallocates it to the biggest shortfalls.
 *
 * NOTE:
 * "exact" here means: explore many randomized greedy builds
 * + stochastic local improvement for as long as allowed.
 * It is not literal enumeration of all combinations.
 * -------------------------------------------------------------- */

function makeNeedsMap(forecast) {
  const needs = {}
  const allDates = []

  forecast.forEach(d => {
    if (!Array.isArray(d.staffing)) return
    allDates.push(d.date)
    d.staffing.forEach(({ hour, requiredAgents }) => {
      needs[`${d.date}|${hour}`] = Number(requiredAgents || 0)
    })
  })

  allDates.sort()
  return { needs, allDates, dateSet: new Set(allDates) }
}

function getFirstWeek(allDates) {
  if (!allDates.length) return []
  const first = allDates[0]
  return allDates.filter(d => dayjs(d).diff(first, 'day') < 7)
}

function getWorkDates(startDate, weeks, dateSet) {
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

function buildCandidates({ firstWeek, weeks, shiftLength, hoursToTry, dateSet }) {
  const candidates = []

  for (const startDate of firstWeek) {
    const workDates = getWorkDates(startDate, weeks, dateSet)
    if (workDates.length < 5 * weeks) continue

    for (const startHour of hoursToTry) {
      const maxOffset = Math.min(5, shiftLength - 1) // lunch within 5h and inside shift
      for (let off = 2; off <= maxOffset; off++) {
        const cover = []
        const breakHours = new Set()

        for (const d of workDates) {
          const lunchHour = startHour + off
          breakHours.add(`${d}|${lunchHour}`)

          for (let h = startHour; h < startHour + shiftLength; h++) {
            if (h === lunchHour) continue
            cover.push(`${d}|${h}`)
          }
        }

        candidates.push({
          startDate,
          startHour,
          breakOffset: off,
          length: shiftLength,
          cover,
          breakHours
        })
      }
    }
  }

  return candidates
}

function scoreCandidate(candidate, localNeeds) {
  let s = 0
  for (const k of candidate.cover) s += (localNeeds[k] || 0)
  return s
}

function weightedPickTopK(topK, temperature = 1.0) {
  let sum = 0
  const weights = topK.map(x => {
    const w = Math.exp((x.score || 0) / Math.max(1e-9, temperature))
    sum += w
    return w
  })
  let r = Math.random() * sum
  for (let i = 0; i < topK.length; i++) {
    r -= weights[i]
    if (r <= 0) return topK[i].c
  }
  return topK[topK.length - 1].c
}

function evaluateSolution(assignments, candidates, needs, needKeys) {
  const cov = Object.create(null)
  for (const idx of assignments) {
    const c = candidates[idx]
    for (const k of c.cover) cov[k] = (cov[k] || 0) + 1
  }

  let shortfall = 0
  let over = 0

  const keys = needKeys || Object.keys(needs)
  for (const k of keys) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if (got < req) shortfall += (req - got)
    else over += (got - req)
  }

  return { shortfall, over, headcount: assignments.length }
}

function objective({ shortfall, over, headcount }) {
  return shortfall * 1_000_000 + over * 10 + headcount * 1
}

function greedyBuild({
  candidates,
  needs,
  maxStaff,
  randomize = false,
  topK = 10,
  temperature = 1.0
}) {
  const localNeeds = { ...needs }
  const assignments = []

  while (assignments.length < maxStaff) {
    let bestScore = 0
    let best = null

    if (!randomize) {
      for (let i = 0; i < candidates.length; i++) {
        const sc = scoreCandidate(candidates[i], localNeeds)
        if (sc > bestScore) { bestScore = sc; best = i }
      }
      if (best == null || bestScore === 0) break
      assignments.push(best)
    } else {
      const scored = []
      for (let i = 0; i < candidates.length; i++) {
        const sc = scoreCandidate(candidates[i], localNeeds)
        if (sc <= 0) continue
        scored.push({ i, score: sc })
      }
      if (!scored.length) break
      scored.sort((a, b) => b.score - a.score)

      const slice = scored.slice(0, Math.min(topK, scored.length))
        .map(x => ({ c: x.i, score: x.score }))

      const picked = weightedPickTopK(slice, temperature)
      best = picked
      bestScore = scoreCandidate(candidates[best], localNeeds)
      if (bestScore === 0) break
      assignments.push(best)
    }

    const chosen = candidates[assignments[assignments.length - 1]]
    for (const k of chosen.cover) {
      localNeeds[k] = Math.max(0, (localNeeds[k] || 0) - 1)
    }
  }

  return assignments
}

function buildCoverage(assignments, candidates) {
  const cov = Object.create(null)
  for (const idx of assignments) {
    const c = candidates[idx]
    for (const k of c.cover) cov[k] = (cov[k] || 0) + 1
  }
  return cov
}

function buildDeficitNeedsFromCoverage(needs, cov, needKeys) {
  const deficitNeeds = Object.create(null)
  const keys = needKeys || Object.keys(needs)
  for (const k of keys) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    const def = req - got
    if (def > 0) deficitNeeds[k] = def
  }
  return deficitNeeds
}

function removalScoreForCandidate(candidate, cov, needs) {
  // Higher is better to remove
  let s = 0
  for (const k of candidate.cover) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if (got > req) s += (got - req)
    else if (got < req) s -= (req - got) * 5
  }
  // Prefer removing broader shifts when they sit on surplus (e.g. 8 to 5)
  s += candidate.cover.length * 0.05
  return s
}

function addScoreForCandidate(candidate, cov, needs) {
  // Higher is better to add
  let s = 0
  for (const k of candidate.cover) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if (got < req) s += (req - got) * 5
    else if (got > req) s -= (got - req) * 1
  }
  return s
}

function applyCandidateDelta(cand, cov, delta) {
  for (const k of cand.cover) {
    cov[k] = (cov[k] || 0) + delta
    if (cov[k] <= 0) delete cov[k]
  }
}

// One targeted repair: remove from surplus-heavy assignment, re-add to best deficit-heavy candidate
function repairMove({
  candidates,
  needs,
  needKeys,
  assignments,
  cov,
  topK = 25
}) {
  if (!assignments.length) return null

  // Pick position to change: best to remove from surplus-heavy coverage
  let bestPos = -1
  let bestRemoveScore = -Infinity
  for (let p = 0; p < assignments.length; p++) {
    const c = candidates[assignments[p]]
    const sc = removalScoreForCandidate(c, cov, needs)
    if (sc > bestRemoveScore) {
      bestRemoveScore = sc
      bestPos = p
    }
  }
  if (bestPos < 0) return null

  const oldIdx = assignments[bestPos]
  const oldCand = candidates[oldIdx]

  // Remove old, then compute deficits
  applyCandidateDelta(oldCand, cov, -1)
  const deficitNeeds = buildDeficitNeedsFromCoverage(needs, cov, needKeys)

  // If no deficit, undo and stop (we are feasible already)
  if (!Object.keys(deficitNeeds).length) {
    applyCandidateDelta(oldCand, cov, +1)
    return null
  }

  // Find best candidate to add based on deficit coverage, then refine with addScore
  const scored = []
  for (let i = 0; i < candidates.length; i++) {
    const sc = scoreCandidate(candidates[i], deficitNeeds)
    if (sc <= 0) continue
    scored.push({ i, score: sc })
  }

  if (!scored.length) {
    applyCandidateDelta(oldCand, cov, +1)
    return null
  }

  scored.sort((a, b) => b.score - a.score)
  const slice = scored.slice(0, Math.min(topK, scored.length))

  let bestNewIdx = null
  let bestAddScore = -Infinity

  for (const x of slice) {
    const cand = candidates[x.i]
    const sc = addScoreForCandidate(cand, cov, needs)
    if (sc > bestAddScore) {
      bestAddScore = sc
      bestNewIdx = x.i
    }
  }

  // If the best add does not help, undo
  if (bestNewIdx == null || bestAddScore <= 0) {
    applyCandidateDelta(oldCand, cov, +1)
    return null
  }

  // Apply new
  assignments[bestPos] = bestNewIdx
  applyCandidateDelta(candidates[bestNewIdx], cov, +1)

  return { changedPos: bestPos, oldIdx, newIdx: bestNewIdx }
}

function localImprove({
  candidates,
  needs,
  needKeys,
  startAssignments,
  budgetMs
}) {
  const startLocal = Date.now()

  let best = startAssignments.slice()
  let cov = buildCoverage(best, candidates)

  let bestEval = evaluateSolution(best, candidates, needs, needKeys)
  let bestObj = objective(bestEval)

  const nCand = candidates.length
  const n = best.length
  if (n === 0) return { best, bestEval, bestObj, iters: 0 }

  let iters = 0

  const REPAIR_EVERY = 60
  const REPAIR_TOPK = 30

  while (true) {
    iters++
    if (budgetMs > 0 && (Date.now() - startLocal) >= budgetMs) break

    // Occasionally do a targeted repair move:
    if (iters % REPAIR_EVERY === 0 && bestEval.shortfall > 0) {
      const beforeObj = bestObj

      const move = repairMove({
        candidates,
        needs,
        needKeys,
        assignments: best,
        cov,
        topK: REPAIR_TOPK
      })

      if (move) {
        const ev = evaluateSolution(best, candidates, needs, needKeys)
        const obj = objective(ev)

        // Accept if it improves, else sometimes keep to escape local traps
        const accept = obj <= beforeObj || Math.random() < 0.15
        if (accept) {
          bestEval = ev
          bestObj = obj
        } else {
          // revert
          applyCandidateDelta(candidates[move.newIdx], cov, -1)
          best[move.changedPos] = move.oldIdx
          applyCandidateDelta(candidates[move.oldIdx], cov, +1)
        }
      }

      continue
    }

    // Default random swap move:
    const pos = Math.floor(Math.random() * n)
    const newIdx = Math.floor(Math.random() * nCand)
    const oldIdx = best[pos]
    if (oldIdx === newIdx) continue

    // Apply swap to coverage incrementally
    const oldCand = candidates[oldIdx]
    const newCand = candidates[newIdx]

    applyCandidateDelta(oldCand, cov, -1)
    applyCandidateDelta(newCand, cov, +1)

    const trial = best.slice()
    trial[pos] = newIdx

    const ev = evaluateSolution(trial, candidates, needs, needKeys)
    const obj = objective(ev)

    const delta = obj - bestObj
    const accept = delta <= 0 || Math.random() < Math.exp(-delta / 5000)

    if (accept) {
      best = trial
      bestEval = ev
      bestObj = obj
      // cov already matches accepted state
    } else {
      // revert cov
      applyCandidateDelta(newCand, cov, -1)
      applyCandidateDelta(oldCand, cov, +1)
    }
  }

  return { best, bestEval, bestObj, iters }
}

function collapseAssignments(assignments, candidates, shiftLength, splitSize) {
  const solution = []
  const tally = new Map()
  const order = []

  for (const idx of assignments) {
    const c = candidates[idx]
    const key = `${c.startDate}|${c.startHour}|${c.breakOffset}`
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

/* -------------------------------------------------------------- *
 * Optional helper: linear cap search (+1) to avoid spikes
 * This is only used if you call it or enable autoFindCap.
 * -------------------------------------------------------------- */
export function findMinimalCapLinear({
  candidates,
  needs,
  needKeys,
  startCap = 1,
  maxCap = 999999
}) {
  let cap = Math.max(1, startCap)
  while (cap <= maxCap) {
    const assignments = greedyBuild({
      candidates,
      needs,
      maxStaff: cap,
      randomize: false
    })
    const ev = evaluateSolution(assignments, candidates, needs, needKeys)
    if (ev.shortfall === 0) return { cap, ev }
    cap += 1
  }
  return { cap: null, ev: null }
}

/* -------------------------------------------------------------- *
 * assignRotationalShifts
 * -------------------------------------------------------------- */
export function assignRotationalShifts(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    startHours,
    maxStaff,
    splitSize = 999,

    exact = false,
    timeLimitMs = 0,
    greedyRestarts = 15,

    // Optional: avoid external cap search spikes by doing +1 search here
    autoFindCap = false,
    autoFindCapStart = 1,
    autoFindCapMax = 999999
  } = {}
) {
  const t0 = Date.now()

  const { needs, allDates, dateSet } = makeNeedsMap(forecast)
  const needKeys = Object.keys(needs)
  const firstWeek = getFirstWeek(allDates)

  const hoursToTry = Array.isArray(startHours) && startHours.length
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

  const candidates = buildCandidates({
    firstWeek,
    weeks,
    shiftLength,
    hoursToTry,
    dateSet
  })

  let cap = (typeof maxStaff === 'number' && maxStaff > 0) ? maxStaff : 999999

  if (autoFindCap && !(typeof maxStaff === 'number' && maxStaff > 0)) {
    const found = findMinimalCapLinear({
      candidates,
      needs,
      needKeys,
      startCap: autoFindCapStart,
      maxCap: autoFindCapMax
    })
    if (found.cap != null) cap = found.cap
  }

  // Non-exact: one deterministic greedy build
  if (!exact) {
    const assignments = greedyBuild({
      candidates,
      needs,
      maxStaff: cap,
      randomize: false
    })

    const solution = collapseAssignments(assignments, candidates, shiftLength, splitSize)
    const ev = evaluateSolution(assignments, candidates, needs, needKeys)

    return {
      solution,
      meta: {
        method: 'greedy',
        candidates: candidates.length,
        cap,
        headcount: ev.headcount,
        shortfall: ev.shortfall,
        over: ev.over,
        timeMs: Date.now() - t0
      }
    }
  }

  // Exact-search: many restarts + improvement, bounded by time AND restart count
  let bestAssignments = []
  let bestEval = { shortfall: Infinity, over: Infinity, headcount: 0 }
  let bestObj = Infinity

  let restarts = 0
  let improveItersTotal = 0

  const hardStop = () => timeLimitMs > 0 && (Date.now() - t0) >= timeLimitMs

  // greedyRestarts:
  //   0 => unlimited (timeLimitMs must be > 0, or this could run forever)
  const restartLimit = (typeof greedyRestarts === 'number' && greedyRestarts >= 0)
    ? greedyRestarts
    : 15

  while (!hardStop() && (restartLimit === 0 || restarts < restartLimit)) {
    restarts++

    const remainingMs = timeLimitMs > 0
      ? Math.max(0, timeLimitMs - (Date.now() - t0))
      : 0

    const restartsLeft = restartLimit === 0
      ? 1
      : Math.max(1, restartLimit - restarts + 1)

    // Per-restart improvement budget:
    // - If time-limited: split remaining time roughly across remaining restarts
    // - If not time-limited: cap each restart improvement to keep moving
    const improveBudgetMs = timeLimitMs > 0
      ? Math.max(250, Math.floor(remainingMs / restartsLeft))
      : 2500

    // diversify: more random early, greedier later
    const temp = restartLimit === 0
      ? 1.0
      : Math.max(0.5, 2.0 - (restarts / Math.max(1, restartLimit)) * 1.5)

    const seed = greedyBuild({
      candidates,
      needs,
      maxStaff: cap,
      randomize: true,
      topK: 12,
      temperature: temp
    })

    const improved = localImprove({
      candidates,
      needs,
      needKeys,
      startAssignments: seed,
      budgetMs: improveBudgetMs
    })
    improveItersTotal += improved.iters

    const ev = improved.bestEval
    const obj = improved.bestObj

    if (obj < bestObj) {
      bestObj = obj
      bestAssignments = improved.best
      bestEval = ev
    }

    // quick exit if perfectly feasible and no over at all
    if (bestEval.shortfall === 0 && bestEval.over === 0) break
  }

  const solution = collapseAssignments(bestAssignments, candidates, shiftLength, splitSize)

  return {
    solution,
    meta: {
      method: 'exact-search',
      candidates: candidates.length,
      cap,
      restarts,
      improveItersTotal,
      headcount: bestEval.headcount,
      shortfall: bestEval.shortfall,
      over: bestEval.over,
      objective: bestObj,
      timeMs: Date.now() - t0
    }
  }
}

/* -------------------------------------------------------------- *
 * autoAssignRotations
 * -------------------------------------------------------------- */
export function autoAssignRotations(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    topN = 5,
    maxStaff,
    splitSize = 999,

    exact = false,
    timeLimitMs = 0,
    greedyRestarts = 15,

    // pass through optional cap search
    autoFindCap = false,
    autoFindCapStart = 1,
    autoFindCapMax = 999999,

    startHours
  } = {}
) {
  const { solution, meta } = assignRotationalShifts(
    forecast,
    {
      weeks,
      shiftLength,
      maxStaff,
      splitSize,
      exact,
      timeLimitMs,
      greedyRestarts,
      autoFindCap,
      autoFindCapStart,
      autoFindCapMax,
      startHours
    }
  )

  const tally = solution.reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + b.count
    return acc
  }, {})

  const bestStartHours = Object.entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  return { bestStartHours, solution, meta }
}
