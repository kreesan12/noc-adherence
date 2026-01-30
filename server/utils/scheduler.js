import dayjs from '../utils/dayjs.js'

/* -------------------------------------------------------------- *
 * Candidate = (startDate, startHour, breakOffset)
 * Each selected candidate represents ONE employee assigned to that pattern.
 *
 * We are solving a minimum headcount multi cover:
 * - needs[k] = required agents at k = "YYYY-MM-DD|hour"
 * - each employee covers a set of k values (excluding lunch hour)
 * Goal: minimise number of employees so that for all k: covered[k] >= needs[k]
 *
 * This file provides:
 * - greedy (fast) builder
 * - exact (slow, branch & bound) optimiser that truly retries combinations
 * -------------------------------------------------------------- */

/* ------------------ build base structures --------------------- */
function buildNeedsAndCandidates(forecast, { weeks, shiftLength, startHours } = {}) {
  const needs = {}
  const allDates = []

  forecast.forEach(d => {
    if (!Array.isArray(d.staffing)) return
    allDates.push(d.date)
    d.staffing.forEach(({ hour, requiredAgents }) => {
      needs[`${d.date}|${hour}`] = requiredAgents || 0
    })
  })

  allDates.sort()
  const dateSet = new Set(allDates)
  if (!allDates.length) return { needs, allDates, candidates: [], keys: [] }

  const firstDay = allDates[0]
  const firstWeek = allDates.filter(d => dayjs(d).diff(firstDay, 'day') < 7)

  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h) // default 0..15 for 9h

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

  const candidates = []
  for (const startDate of firstWeek) {
    const workDates = getWorkDates(startDate)
    if (workDates.length < 5 * weeks) continue

    for (const startHour of hoursToTry) {
      const maxOffset = Math.min(5, shiftLength - 1)
      for (let off = 2; off <= maxOffset; off++) {
        const cover = []
        for (const d of workDates) {
          for (let h = startHour; h < startHour + shiftLength; h++) {
            if (h === startHour + off) continue
            cover.push(`${d}|${h}`)
          }
        }
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

  const keys = Object.keys(needs).filter(k => needs[k] > 0).sort()
  return { needs, allDates, candidates, keys }
}

/* ------------------ greedy: good upper bound ------------------ */
function greedyUpperBound(needs, candidates, { cap, restarts = 8 } = {}) {
  const keys = Object.keys(needs)

  const scoreCandidate = (c, localNeeds) => {
    let s = 0
    for (const k of c.cover) s += (localNeeds[k] || 0)
    return s
  }

  const apply = (c, localNeeds) => {
    for (const k of c.cover) {
      const cur = localNeeds[k] || 0
      if (cur > 0) localNeeds[k] = cur - 1
    }
  }

  const totalUnmet = (localNeeds) => {
    let t = 0
    for (const k of keys) t += (localNeeds[k] || 0)
    return t
  }

  function runOnce(randomize) {
    const localNeeds = { ...needs }
    const picks = []

    const list = randomize ? [...candidates] : candidates
    if (randomize) {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        const tmp = list[i]
        list[i] = list[j]
        list[j] = tmp
      }
    }

    while (true) {
      if (typeof cap === 'number' && picks.length >= cap) break

      let best = null
      let bestScore = 0

      for (const c of list) {
        const sc = scoreCandidate(c, localNeeds)
        if (sc > bestScore) {
          bestScore = sc
          best = c
        }
      }

      if (!best || bestScore === 0) break
      picks.push(best)
      apply(best, localNeeds)
      if (totalUnmet(localNeeds) === 0) break
    }

    return { picks, unmet: totalUnmet(localNeeds) }
  }

  let best = null
  for (let t = 0; t < Math.max(1, restarts); t++) {
    const r = runOnce(t > 0)
    if (!best) best = r
    else if (r.unmet < best.unmet) best = r
    else if (r.unmet === best.unmet && r.picks.length < best.picks.length) best = r
  }

  return best
}

/* ------------------ exact optimisation (branch & bound) ------- */
function exactMinimise(needs, candidates, {
  timeLimitMs = 0,              // 0 = no limit
  logEvery = 20000,
  initialUpperBound,            // number
  initialSolutionPicks,         // array of candidates
  hardCap,                      // optional: do not exceed
  allowHours = false            // just a label for intent
} = {}) {
  const startTs = Date.now()
  const keys = Object.keys(needs).filter(k => needs[k] > 0)

  // map: key -> candidate indices that cover it
  const keyToCands = new Map()
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]
    for (const k of c.cover) {
      if (!needs[k]) continue
      if (!keyToCands.has(k)) keyToCands.set(k, [])
      keyToCands.get(k).push(i)
    }
  }

  // if some needed key has no covering candidate, impossible
  for (const k of keys) {
    if (!keyToCands.has(k) || keyToCands.get(k).length === 0) {
      return {
        bestHeads: Infinity,
        bestPicks: [],
        nodes: 0,
        timedOut: false,
        impossible: true
      }
    }
  }

  const maxCoverLen = candidates.reduce((m, c) => Math.max(m, c.cover.length), 1)

  // best solution so far
  let bestHeads = typeof initialUpperBound === 'number' ? initialUpperBound : Infinity
  let bestPicks = Array.isArray(initialSolutionPicks) ? [...initialSolutionPicks] : []

  // remaining needs as plain object
  const rem = { ...needs }
  let totalRem = keys.reduce((s, k) => s + (rem[k] || 0), 0)

  // quick lower bound: total remaining divided by maximum cover length
  const lowerBound = (total) => Math.ceil(total / maxCoverLen)

  // small memo: hash => smallest headsUsed seen for that hash
  // (correctness is preserved because we only prune if we have reached this exact state with <= heads)
  const memo = new Map()
  const hashState = () => {
    // state signature: only keys with rem>0
    // yes it’s heavy, but it’s collision-free and exact
    const parts = []
    for (const k of keys) {
      const v = rem[k] || 0
      if (v > 0) parts.push(`${k}:${v}`)
    }
    return parts.join('|')
  }

  // choose next key: most constrained (highest remaining, then smallest candidate list)
  const pickNextKey = () => {
    let bestK = null
    let bestNeed = -1
    let bestCandCount = Infinity
    for (const k of keys) {
      const v = rem[k] || 0
      if (v <= 0) continue
      const cCount = (keyToCands.get(k) || []).length
      if (v > bestNeed || (v === bestNeed && cCount < bestCandCount)) {
        bestNeed = v
        bestCandCount = cCount
        bestK = k
      }
    }
    return bestK
  }

  const applyCandidateIdx = (idx) => {
    const c = candidates[idx]
    const changed = []
    for (const k of c.cover) {
      const cur = rem[k] || 0
      if (cur > 0) {
        rem[k] = cur - 1
        totalRem -= 1
        changed.push(k)
      }
    }
    return changed
  }

  const undo = (changed) => {
    for (const k of changed) {
      rem[k] = (rem[k] || 0) + 1
      totalRem += 1
    }
  }

  let nodes = 0
  let timedOut = false

  function shouldStop() {
    if (timeLimitMs && timeLimitMs > 0) {
      if (Date.now() - startTs > timeLimitMs) return true
    }
    return false
  }

  const curPicks = []

  function dfs(headsUsed) {
    if (shouldStop()) { timedOut = true; return }

    nodes++
    if (logEvery && nodes % logEvery === 0) {
      // eslint-disable-next-line no-console
      console.log(`[EXACT] nodes=${nodes} bestHeads=${bestHeads} headsUsed=${headsUsed} totalRem=${totalRem}`)
    }

    // success
    if (totalRem === 0) {
      if (headsUsed < bestHeads) {
        bestHeads = headsUsed
        bestPicks = [...curPicks]
        // eslint-disable-next-line no-console
        console.log(`[EXACT] ✅ new best headcount = ${bestHeads}`)
      }
      return
    }

    // cap pruning
    if (typeof hardCap === 'number' && headsUsed > hardCap) return
    if (headsUsed >= bestHeads) return

    // lower bound pruning
    const lb = lowerBound(totalRem)
    if (headsUsed + lb >= bestHeads) return

    // memo pruning
    const sig = hashState()
    const prev = memo.get(sig)
    if (prev != null && prev <= headsUsed) return
    memo.set(sig, headsUsed)

    // choose a remaining key to satisfy next
    const k = pickNextKey()
    if (!k) return

    const candIdxs = keyToCands.get(k)
    if (!candIdxs || candIdxs.length === 0) return

    // sort candidates by "gain" (how much unmet they cover right now), descending
    const scored = candIdxs.map(idx => {
      const c = candidates[idx]
      let gain = 0
      for (const kk of c.cover) gain += (rem[kk] || 0) > 0 ? 1 : 0
      return { idx, gain }
    }).sort((a, b) => b.gain - a.gain)

    for (const { idx } of scored) {
      if (headsUsed + 1 >= bestHeads) continue
      if (typeof hardCap === 'number' && headsUsed + 1 > hardCap) continue

      const changed = applyCandidateIdx(idx)
      if (changed.length === 0) { undo(changed); continue }

      curPicks.push(candidates[idx])
      dfs(headsUsed + 1)
      curPicks.pop()

      undo(changed)
      if (timedOut) return
    }
  }

  dfs(0)

  return {
    bestHeads,
    bestPicks,
    nodes,
    timedOut,
    impossible: false
  }
}

/* ------------------ collapse picks into block solution -------- */
function collapsePicksToSolution(picks, { shiftLength, splitSize = 999 } = {}) {
  const tally = new Map()
  const order = []

  for (const p of picks) {
    const key = `${p.startDate}|${p.startHour}|${p.breakOffset}`
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

  return solution
}

/* -------------------------------------------------------------- *
 * PUBLIC API
 * -------------------------------------------------------------- */

export function autoAssignRotations(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    topN = 5,
    startHours,
    maxStaff,
    splitSize = 999,

    // exact optimiser knobs
    exact = false,
    timeLimitMs = 0,           // 0 = no limit (hours)
    greedyRestarts = 10,
    exactLogEvery = 50000
  } = {}
) {
  const { needs, candidates } = buildNeedsAndCandidates(forecast, { weeks, shiftLength, startHours })

  if (!candidates.length) {
    return { bestStartHours: [], solution: [], meta: { headCnt: 0, exact: false } }
  }

  // If not exact: keep your previous greedy behaviour (fast)
  if (!exact) {
    const ub = greedyUpperBound(needs, candidates, { cap: maxStaff, restarts: greedyRestarts })
    const solution = collapsePicksToSolution(
      ub.picks.map(p => ({
        startDate: p.startDate,
        startHour: p.startHour,
        breakOffset: p.breakOffset,
        length: shiftLength,
        cover: p.cover
      })),
      { shiftLength, splitSize }
    )

    const tally = solution.reduce((acc, b) => {
      acc[b.startHour] = (acc[b.startHour] || 0) + b.count
      return acc
    }, {})

    const bestStartHours = Object.entries(tally)
      .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
      .sort((a, b) => b.totalAssigned - a.totalAssigned)
      .slice(0, topN)

    return {
      bestStartHours,
      solution,
      meta: {
        headCnt: ub.picks.length,
        unmet: ub.unmet,
        exact: false
      }
    }
  }

  // EXACT: get a good upper bound first (greedy), then minimise exactly
  const ub = greedyUpperBound(needs, candidates, { cap: maxStaff, restarts: greedyRestarts })
  const initialHeads = ub.unmet === 0 ? ub.picks.length : Infinity

  // eslint-disable-next-line no-console
  console.log(`[EXACT] starting. greedy heads=${ub.picks.length} unmet=${ub.unmet} initialUpper=${initialHeads}`)

  const exactRes = exactMinimise(needs, candidates, {
    timeLimitMs,
    logEvery: exactLogEvery,
    initialUpperBound: initialHeads,
    initialSolutionPicks: ub.unmet === 0 ? ub.picks : [],
    hardCap: typeof maxStaff === 'number' ? maxStaff : undefined
  })

  // If greedy didn't even meet needs and exact couldn't either, return best we have
  const finalPicks =
    (exactRes.bestHeads !== Infinity && exactRes.bestPicks.length)
      ? exactRes.bestPicks
      : ub.picks

  const solution = collapsePicksToSolution(
    finalPicks.map(p => ({
      startDate: p.startDate,
      startHour: p.startHour,
      breakOffset: p.breakOffset,
      length: shiftLength,
      cover: p.cover
    })),
    { shiftLength, splitSize }
  )

  const tally = solution.reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + b.count
    return acc
  }, {})

  const bestStartHours = Object.entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  return {
    bestStartHours,
    solution,
    meta: {
      headCnt: finalPicks.length,
      greedyHeads: ub.picks.length,
      greedyUnmet: ub.unmet,
      exactBestHeads: exactRes.bestHeads,
      exactNodes: exactRes.nodes,
      exactTimedOut: exactRes.timedOut,
      exactImpossible: exactRes.impossible,
      exact: true
    }
  }
}
