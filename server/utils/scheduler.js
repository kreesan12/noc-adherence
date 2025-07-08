// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Assign staff for an N-week 5-on/2-off rotation.
 *  • Greedy first pass
 *  • Padding to guarantee 1 block / first-week day
 *  • Hill-climb local search (±1 h OR move to another first-week date)
 */
export function assignRotationalShifts(
  forecast,
  { weeks = 3, shiftLength = 9, startHours, maxStaff } = {}
) {
  /* 1) unmet-need map + helpers ─────────────────────────────── */
  const needs = {}
  const allDates = []
  forecast.forEach(day => {
    if (!Array.isArray(day.staffing)) return
    allDates.push(day.date)
    day.staffing.forEach(({ hour, requiredAgents }) => {
      const hh = ((hour % 24) + 24) % 24   // clamp
      needs[`${day.date}|${hh}`] = requiredAgents
    })
  })
  allDates.sort()
  const dateSet   = new Set(allDates)
  const firstDate = allDates[0]

  const firstWeek = allDates.filter(d =>
    dayjs(d).diff(firstDate, 'day') < 7
  )

  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

  const getWorkDates = startDate => {
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

  /* 2) candidate blocks (24-h safe) ─────────────────────────── */
  const candidates = firstWeek.flatMap(startDate => {
    const workDates = getWorkDates(startDate)
    if (workDates.length < weeks * 5) return []
    return hoursToTry.map(startHour => {
      const cover = []
      workDates.forEach(d => {
        for (let h = 0; h < shiftLength; h++) {
          const hh = startHour + h
          if (hh >= 24) break
          cover.push(`${d}|${hh}`)
        }
      })
      return { startDate, startHour, length: shiftLength, cover }
    })
  })

  /* 3) greedy assignment ────────────────────────────────────── */
  const residual  = { ...needs }
  const assignments = []
  while (true) {
    if (typeof maxStaff === 'number' && assignments.length >= maxStaff) break

    let best = null, bestGain = 0
    for (const c of candidates) {
      let gain = 0
      for (const k of c.cover) gain += Math.min(1, residual[k] || 0)
      if (gain > bestGain) { best = c; bestGain = gain }
    }
    if (!best || bestGain === 0) break

    assignments.push({ startDate: best.startDate, startHour: best.startHour })
    best.cover.forEach(k => { if (residual[k]) residual[k]-- })
  }

  /* 4) padding: ≥1 block per first-week date ────────────────── */
  firstWeek.forEach(startDate => {
    if (assignments.some(a => a.startDate === startDate)) return
    const cands = candidates.filter(c => c.startDate === startDate)
    if (!cands.length) return
    cands.sort((a, b) => {
      const ga = a.cover.reduce((s,k)=>s+(needs[k]||0),0)
      const gb = b.cover.reduce((s,k)=>s+(needs[k]||0),0)
      return gb - ga
    })
    assignments.push({ startDate, startHour: cands[0].startHour })
  })

  /* 5)  LOCAL-SEARCH  (±1 h **or** move to another first-week day) */
  const MAX_LS_ITERS = 30

  const unmet = res => Object.values(res).reduce((s,v)=>s+v,0)

  const currentResidual = list => {
    const res = { ...needs }
    list.forEach(({ startDate, startHour }) => {
      getWorkDates(startDate).forEach(d => {
        for (let h = 0; h < shiftLength; h++) {
          const hh = startHour + h
          if (hh >= 24) break
          const k = `${d}|${hh}`
          if (res[k]) res[k]--
        }
      })
    })
    return res
  }

  /** neighbours: ±1 hour on same day  –OR– same hour on any other first-week date */
  function genNeighbours(block) {
    const nbs = []
    const { startDate, startHour } = block

    // ±1 h on same date
    for (const dH of [-1, 1]) {
      const nh = startHour + dH
      if (nh >= 0 && nh <= 24 - shiftLength) nbs.push({ startDate, startHour: nh })
    }

    // move to other first-week dates (keep hour)
    for (const d of firstWeek) {
      if (d !== startDate) nbs.push({ startDate: d, startHour })
    }
    return nbs
  }

  let resMap = currentResidual(assignments)
  for (let it = 0; it < MAX_LS_ITERS && unmet(resMap) > 0; it++) {
    let improved = false
    for (let i = 0; i < assignments.length; i++) {
      const base = [...assignments]
      const cur  = base[i]
      for (const nb of genNeighbours(cur)) {
        const trial = [...base]
        trial[i]    = nb
        const trialRes = currentResidual(trial)
        if (unmet(trialRes) < unmet(resMap)) {
          assignments[i] = nb
          resMap         = trialRes
          improved       = true
          break
        }
      }
      if (improved) break
    }
    if (!improved) break
  }

  /* 6) Collapse list → blocks & sort ────────────────────────── */
  const solutionMap = {}
  assignments.forEach(({ startDate, startHour }) => {
    const k = `${startDate}|${startHour}`
    if (!solutionMap[k]) {
      solutionMap[k] = {
        startDate,
        startHour,
        length: shiftLength,
        count: 0,
        patternIndex: dayjs(startDate).day()
      }
    }
    solutionMap[k].count++
  })

  const solution = Object.values(solutionMap)
  solution.sort((a,b)=>
    a.patternIndex - b.patternIndex ||
    a.startHour    - b.startHour
  )
  return solution
}

/* ───── Convenience wrapper used by the API route ───────────── */
export function autoAssignRotations(
  forecast,
  { weeks = 3, shiftLength = 9, topN = 5, maxStaff } = {}
) {
  const solution = assignRotationalShifts(
    forecast,
    { weeks, shiftLength, maxStaff }
  )

  const tally = solution.reduce((acc,b)=>{
    acc[b.startHour]=(acc[b.startHour]||0)+b.count
    return acc
  },{})

  const bestStartHours = Object.entries(tally)
    .map(([h,total])=>({ startHour:+h, totalAssigned:total }))
    .sort((a,b)=>b.totalAssigned-a.totalAssigned)
    .slice(0, topN)

  return { bestStartHours, solution }
}
