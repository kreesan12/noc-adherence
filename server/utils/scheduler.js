import dayjs from '../utils/dayjs.js'

/* -------------------------------------------------------------- *
 * Scheduler: greedy baseline + time-bounded multi-restart search.
 *
 * New (Option A + C):
 * A) Greedy uses a "net benefit" score:
 *    score = (deficit covered * DEFICIT_W) - (surplus created * OVER_W)
 *    This reduces overlap driven overstaffing.
 *
 *    IMPORTANT: Safety valve added:
 *    If net-benefit scoring stalls while deficits still exist, greedy
 *    falls back to deficit-only scoring to keep progressing.
 *
 * C) Prune pass (feasible only):
 *    Remove any shift that can be removed while remaining feasible.
 *
 * Existing:
 * 1) Per-restart improvement budget
 * 2) Restarts respected
 * 3) Repair move (surplus to breach)
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
      const maxOffset = Math.min(5, shiftLength - 1)
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

function hasNeedInStartWindow(localNeeds, startHour, shiftLength) {
  const end = startHour + shiftLength
  for (const k in localNeeds) {
    const need = localNeeds[k] || 0
    if (need <= 0) continue
    const hour = Number(k.split('|')[1])
    if (hour >= startHour && hour < end) return true
  }
  return false
}

/* -------------------------------------------------------------- *
 * Option A: Net-benefit scoring for greedy
 * -------------------------------------------------------------- */
function netBenefitScoreForCandidate(candidate, cov, needs, {
  deficitWeight = 5,
  overWeight = 10,
  extraOverWeight = 12
} = {}) {
  let deficitCovered = 0
  let overCreated = 0
  let overAlready = 0

  for (const k of candidate.cover) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if (got < req) deficitCovered += 1
    else overCreated += 1
    if (got > req) overAlready += 1
  }

  const score =
    (deficitCovered * deficitWeight) -
    (overCreated * overWeight) -
    (overAlready * Math.max(0, extraOverWeight - overWeight))

  return score
}

function greedyBuild({
  candidates,
  needs,
  maxStaff,
  randomize = false,
  topK = 10,
  temperature = 1.0,

  preferStartHour = 8,
  preferOnlyWhileDemand = true,

  deficitWeight = 5,
  overWeight = 10,
  extraOverWeight = 12
}) {
  const localNeeds = { ...needs }
  const assignments = []
  const cov = Object.create(null)

  // Track total remaining deficit so we can detect "stall while still deficit"
  let remainingDeficit = 0
  for (const k in localNeeds) remainingDeficit += (localNeeds[k] || 0)

  const preferredIdxs = []
  const allIdxs = []
  for (let i = 0; i < candidates.length; i++) {
    allIdxs.push(i)
    if (candidates[i].startHour === preferStartHour) preferredIdxs.push(i)
  }

  const inferredShiftLength = (candidates[0] && candidates[0].length) ? candidates[0].length : 9

  const netScoreFn = (cand) => netBenefitScoreForCandidate(
    cand,
    cov,
    needs,
    { deficitWeight, overWeight, extraOverWeight }
  )

  const applyChosen = (chosen) => {
    for (const k of chosen.cover) {
      cov[k] = (cov[k] || 0) + 1
      const before = localNeeds[k] || 0
      if (before > 0) {
        localNeeds[k] = before - 1
        remainingDeficit -= 1
      }
    }
  }

  while (assignments.length < maxStaff) {
    const usePreferredPool =
      preferStartHour != null &&
      preferredIdxs.length > 0 &&
      (!preferOnlyWhileDemand || hasNeedInStartWindow(localNeeds, preferStartHour, inferredShiftLength))

    const pool = usePreferredPool ? preferredIdxs : allIdxs

    let bestScore = -Infinity
    let best = null

    // -------- deterministic mode --------
    if (!randomize) {
      for (let pi = 0; pi < pool.length; pi++) {
        const i = pool[pi]
        const sc = netScoreFn(candidates[i])
        if (sc > bestScore) { bestScore = sc; best = i }
      }

      if ((best == null || bestScore <= 0) && usePreferredPool) {
        for (let i = 0; i < candidates.length; i++) {
          const sc = netScoreFn(candidates[i])
          if (sc > bestScore) { bestScore = sc; best = i }
        }
      }

      // Safety valve: if net-benefit stalls but deficits remain, fall back to deficit-only
      if (best == null || bestScore <= 0) {
        if (remainingDeficit <= 0) break

        let fbBest = null
        let fbScore = 0
        for (let i = 0; i < candidates.length; i++) {
          const sc = scoreCandidate(candidates[i], localNeeds)
          if (sc > fbScore) { fbScore = sc; fbBest = i }
        }
        if (fbBest == null || fbScore <= 0) break

        best = fbBest
      }

      assignments.push(best)
      applyChosen(candidates[best])
      continue
    }

    // -------- randomized mode --------
    const scored = []
    for (let pi = 0; pi < pool.length; pi++) {
      const i = pool[pi]
      const sc = netScoreFn(candidates[i])
      if (sc <= 0) continue
      scored.push({ i, score: sc })
    }

    if (!scored.length && usePreferredPool) {
      for (let i = 0; i < candidates.length; i++) {
        const sc = netScoreFn(candidates[i])
        if (sc <= 0) continue
        scored.push({ i, score: sc })
      }
    }

    if (!scored.length) {
      // Safety valve in random mode too
      if (remainingDeficit <= 0) break

      let fbBest = null
      let fbScore = 0
      for (let i = 0; i < candidates.length; i++) {
        const sc = scoreCandidate(candidates[i], localNeeds)
        if (sc > fbScore) { fbScore = sc; fbBest = i }
      }
      if (fbBest == null || fbScore <= 0) break

      assignments.push(fbBest)
      applyChosen(candidates[fbBest])
      continue
    }

    scored.sort((a, b) => b.score - a.score)

    const slice = scored.slice(0, Math.min(topK, scored.length))
      .map(x => ({ c: x.i, score: x.score }))

    best = weightedPickTopK(slice, temperature)
    const bestNet = netScoreFn(candidates[best])
    if (bestNet <= 0) {
      if (remainingDeficit <= 0) break

      // Safety valve: deficit-only fallback
      let fbBest = null
      let fbScore = 0
      for (let i = 0; i < candidates.length; i++) {
        const sc = scoreCandidate(candidates[i], localNeeds)
        if (sc > fbScore) { fbScore = sc; fbBest = i }
      }
      if (fbBest == null || fbScore <= 0) break

      best = fbBest
    }

    assignments.push(best)
    applyChosen(candidates[best])
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
  let s = 0
  for (const k of candidate.cover) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if (got > req) s += (got - req)
    else if (got < req) s -= (req - got) * 5
  }

  s += candidate.cover.length * 0.05
  if (candidate.startHour === 8) s += 2
  return s
}

function addScoreForCandidate(candidate, cov, needs) {
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

/* -------------------------------------------------------------- *
 * Option C: Prune pass
 * -------------------------------------------------------------- */
function isRemovalFeasible(candidate, cov, needs) {
  for (const k of candidate.cover) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if ((got - 1) < req) return false
  }
  return true
}

function pruneFeasibleAssignments({
  assignments,
  candidates,
  needs,
  needKeys,
  maxRemovals = 999999
}) {
  const pruned = assignments.slice()
  const cov = buildCoverage(pruned, candidates)

  let removed = 0
  while (removed < maxRemovals) {
    let bestPos = -1
    let bestScore = -Infinity

    for (let p = 0; p < pruned.length; p++) {
      const idx = pruned[p]
      const cand = candidates[idx]

      if (!isRemovalFeasible(cand, cov, needs)) continue
      const sc = removalScoreForCandidate(cand, cov, needs)
      if (sc > bestScore) {
        bestScore = sc
        bestPos = p
      }
    }

    if (bestPos < 0) break
    if (bestScore <= 0) break

    const idx = pruned[bestPos]
    applyCandidateDelta(candidates[idx], cov, -1)
    pruned.splice(bestPos, 1)
    removed += 1
  }

  const ev = evaluateSolution(pruned, candidates, needs, needKeys)
  const obj = objective(ev)
  return { pruned, ev, obj, removed }
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

  applyCandidateDelta(oldCand, cov, -1)
  const deficitNeeds = buildDeficitNeedsFromCoverage(needs, cov, needKeys)

  if (!Object.keys(deficitNeeds).length) {
    applyCandidateDelta(oldCand, cov, +1)
    return null
  }

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

  if (bestNewIdx == null || bestAddScore <= 0) {
    applyCandidateDelta(oldCand, cov, +1)
    return null
  }

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

        const accept = obj <= beforeObj || Math.random() < 0.15
        if (accept) {
          bestEval = ev
          bestObj = obj
        } else {
          applyCandidateDelta(candidates[move.newIdx], cov, -1)
          best[move.changedPos] = move.oldIdx
          applyCandidateDelta(candidates[move.oldIdx], cov, +1)
        }
      }

      continue
    }

    const pos = Math.floor(Math.random() * n)
    const newIdx = Math.floor(Math.random() * nCand)
    const oldIdx = best[pos]
    if (oldIdx === newIdx) continue

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
    } else {
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
      randomize: false,
      preferStartHour: 8
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

  // Non-exact: one deterministic greedy build + prune
  if (!exact) {
    let assignments = greedyBuild({
      candidates,
      needs,
      maxStaff: cap,
      randomize: false,
      preferStartHour: 8
    })

    let ev = evaluateSolution(assignments, candidates, needs, needKeys)

    let prunedInfo = null
    if (ev.shortfall === 0) {
      prunedInfo = pruneFeasibleAssignments({ assignments, candidates, needs, needKeys })
      assignments = prunedInfo.pruned
      ev = prunedInfo.ev
    }

    const solution = collapseAssignments(assignments, candidates, shiftLength, splitSize)

    return {
      solution,
      meta: {
        method: 'greedy',
        candidates: candidates.length,
        cap,
        headcount: ev.headcount,
        shortfall: ev.shortfall,
        over: ev.over,
        prunedRemoved: prunedInfo ? prunedInfo.removed : 0,
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
  let prunedRemovedBest = 0

  const hardStop = () => timeLimitMs > 0 && (Date.now() - t0) >= timeLimitMs

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

    const improveBudgetMs = timeLimitMs > 0
      ? Math.max(250, Math.floor(remainingMs / restartsLeft))
      : 2500

    const temp = restartLimit === 0
      ? 1.0
      : Math.max(0.5, 2.0 - (restarts / Math.max(1, restartLimit)) * 1.5)

    const seed = greedyBuild({
      candidates,
      needs,
      maxStaff: cap,
      randomize: true,
      topK: 12,
      temperature: temp,
      preferStartHour: 8
    })

    const improved = localImprove({
      candidates,
      needs,
      needKeys,
      startAssignments: seed,
      budgetMs: improveBudgetMs
    })
    improveItersTotal += improved.iters

    let curAssignments = improved.best
    let curEval = improved.bestEval
    let curObj = improved.bestObj
    let curPrunedRemoved = 0

    if (curEval.shortfall === 0) {
      const prunedInfo = pruneFeasibleAssignments({
        assignments: curAssignments,
        candidates,
        needs,
        needKeys
      })
      curAssignments = prunedInfo.pruned
      curEval = prunedInfo.ev
      curObj = prunedInfo.obj
      curPrunedRemoved = prunedInfo.removed
    }

    if (curObj < bestObj) {
      bestObj = curObj
      bestAssignments = curAssignments
      bestEval = curEval
      prunedRemovedBest = curPrunedRemoved
    }

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
      prunedRemoved: prunedRemovedBest,
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
