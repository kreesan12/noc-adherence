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

function evaluateSolution(assignments, candidates, needs) {
  const cov = {}
  for (const idx of assignments) {
    const c = candidates[idx]
    for (const k of c.cover) cov[k] = (cov[k] || 0) + 1
  }

  let shortfall = 0
  let over = 0
  for (const k of Object.keys(needs)) {
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

function localImprove({
  candidates,
  needs,
  startAssignments,
  budgetMs
}) {
  const startLocal = Date.now()

  let best = startAssignments.slice()
  let bestEval = evaluateSolution(best, candidates, needs)
  let bestObj = objective(bestEval)

  const nCand = candidates.length
  const n = best.length
  if (n === 0) return { best, bestEval, bestObj, iters: 0 }

  let iters = 0
  while (true) {
    iters++
    if (budgetMs > 0 && (Date.now() - startLocal) >= budgetMs) break

    const pos = Math.floor(Math.random() * n)
    const newIdx = Math.floor(Math.random() * nCand)
    if (best[pos] === newIdx) continue

    const trial = best.slice()
    trial[pos] = newIdx

    const ev = evaluateSolution(trial, candidates, needs)
    const obj = objective(ev)

    const delta = obj - bestObj
    const accept = delta <= 0 || Math.random() < Math.exp(-delta / 5000)

    if (accept) {
      best = trial
      bestEval = ev
      bestObj = obj
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
    greedyRestarts = 15
  } = {}
) {
  const t0 = Date.now()

  const { needs, allDates, dateSet } = makeNeedsMap(forecast)
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

  const cap = (typeof maxStaff === 'number' && maxStaff > 0) ? maxStaff : 999999

  // Non-exact: one deterministic greedy build
  if (!exact) {
    const assignments = greedyBuild({
      candidates,
      needs,
      maxStaff: cap,
      randomize: false
    })

    const solution = collapseAssignments(assignments, candidates, shiftLength, splitSize)
    const ev = evaluateSolution(assignments, candidates, needs)

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
