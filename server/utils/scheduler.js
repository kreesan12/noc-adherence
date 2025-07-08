// server/utils/scheduler.js
import dayjs from 'dayjs'

/**
 * Assign staff for an N-week 5-on/2-off rotation
 * using a greedy seed + local improvement.
 *
 * Improvements compared with the original version
 * – we now SPLIT large blocks so that each block has at most `splitSize`
 *   heads.  That lets the later hill-climb (break-offset search) give
 *   different lunch offsets to sub-blocks and therefore stagger lunches.
 */
export function assignRotationalShifts(
  forecast,
  {
    weeks       = 3,
    shiftLength = 9,
    startHours,
    maxStaff,
    splitSize   = 2          //  NEW ─ max heads per block
  } = {}
) {
  /* 1) unmet-need map + all dates -------------------------------- */
  const needs    = {}
  const allDates = []
  forecast.forEach(day => {
    if (!Array.isArray(day.staffing)) return
    allDates.push(day.date)
    day.staffing.forEach(({ hour, requiredAgents }) => {
      needs[`${day.date}|${hour}`] = requiredAgents
    })
  })
  allDates.sort()
  const dateSet = new Set(allDates)

  /* 2) first-week window ----------------------------------------- */
  const firstWeek = allDates.filter(d =>
    dayjs(d).diff(allDates[0], 'day') < 7
  )

  /* 3) start hours we are willing to try ------------------------- */
  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

  /* 4) helper: on-days for a given first-week startDate ---------- */
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

  /* 5) build every fully coverable candidate block --------------- */
  const candidates = firstWeek.flatMap(startDate => {
    const workDates = getWorkDates(startDate)
    if (workDates.length < weeks * 5) return []
    return hoursToTry.map(startHour => {
      const cover = []
      workDates.forEach(d => {
        for (let h = startHour; h < startHour + shiftLength; h++) {
          cover.push(`${d}|${h}`)
        }
      })
      return { startDate, startHour, length: shiftLength, cover }
    })
  })

  /* 6) greedy assignment ----------------------------------------- */
  const localNeeds  = { ...needs }
  const assignments = []
  while (true) {
    if (typeof maxStaff === 'number' && assignments.length >= maxStaff) break

    let best = null
    let bestScore = 0
    for (const c of candidates) {
      const score = c.cover.reduce((s, k) => s + (localNeeds[k] || 0), 0)
      if (score > bestScore) { best = c; bestScore = score }
    }
    if (!best || bestScore === 0) break

    assignments.push({ startDate: best.startDate, startHour: best.startHour })

    best.cover.forEach(k => { localNeeds[k] = Math.max(0, (localNeeds[k] || 0) - 1) })
  }

  /* 7) collapse into blocks – **split after `splitSize` heads** --- */
  const solution = []
  const counter  = {}   // key → current count in the *current* open block

  assignments.forEach(({ startDate, startHour }) => {
    const key = `${startDate}|${startHour}`
    const current = counter[key] || 0

    if (current === 0 || current >= splitSize) {
      // start a fresh block
      solution.push({
        startDate,
        startHour,
        length: shiftLength,
        count: 1,
        patternIndex: dayjs(startDate).day()
      })
      counter[key] = 1
    } else {
      // append to the most-recent block with that key
      solution[solution.length - 1].count += 1
      counter[key] += 1
    }
  })

  /* 8) make sure every first-week day has at least one block ----- */
  firstWeek.forEach(startDate => {
    const exists = solution.some(b => b.startDate === startDate)
    if (!exists) {
      // pick the hour that covers the most unmet need
      const workDates = getWorkDates(startDate)
      let bestHour   = hoursToTry[0]
      let bestScore  = 0
      hoursToTry.forEach(h => {
        const score = workDates.reduce((sum, d) => {
          for (let x = h; x < h + shiftLength; x++) {
            sum += (needs[`${d}|${x}`] || 0)
          }
          return sum
        }, 0)
        if (score > bestScore) { bestHour = h; bestScore = score }
      })
      solution.push({
        startDate,
        startHour: bestHour,
        length: shiftLength,
        count: 1,
        patternIndex: dayjs(startDate).day()
      })
    }
  })

  /* 9) order by weekday then hour -------------------------------- */
  solution.sort((a, b) =>
    a.patternIndex - b.patternIndex || a.startHour - b.startHour
  )

  return solution
}

/* ---------------------------------------------------------------- *\
   Top-level wrapper (unchanged, except the extra param passthrough)
\* ---------------------------------------------------------------- */
export function autoAssignRotations(
  forecast,
  {
    weeks       = 3,
    shiftLength = 9,
    topN        = 5,
    maxStaff,
    splitSize   = 2         // expose to callers (front-end keeps default)
  } = {}
) {
  const solution = assignRotationalShifts(
    forecast,
    { weeks, shiftLength, maxStaff, splitSize }
  )

  // histogram by startHour
  const tally = solution.reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + b.count
    return acc
  }, {})

  const bestStartHours = Object
    .entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, topN)

  return { bestStartHours, solution }
}
