import dayjs from '../utils/dayjs.js'

/* -------------------------------------------------------------- *
 * assignRotationalShifts
 * Enumerates candidate blocks: startDate × startHour × breakOffset
 * Greedy assigns 1 head at a time, then collapses into blocks with
 * count <= splitSize so lunches can stagger.
 * -------------------------------------------------------------- */

export function assignRotationalShifts(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,
    startHours,              // optional whitelist from caller
    maxStaff,
    splitSize = 2            // max heads kept together per block instance
  } = {}
) {
  /* 1) unmet-need map + date sets */
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

  /* 2) first-week range */
  const firstWeek = allDates.filter(d => dayjs(d).diff(allDates[0], 'day') < 7)

  /* 3) hours we’re willing to start */
  const hoursToTry = Array.isArray(startHours)
    ? startHours
    : Array.from({ length: 24 - shiftLength + 1 }, (_, h) => h)

  /* 4) helper: on-duty dates for a startDate */
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

  /* 5) build EVERY candidate triple */
  const candidates = firstWeek.flatMap(startDate => {
    const workDates = getWorkDates(startDate)
    if (workDates.length < 5 * weeks) return []

    return hoursToTry.flatMap(startHour => {
      const maxOffset = Math.min(5, shiftLength - 1)
      return Array.from({ length: maxOffset - 1 }, (_, i) => {
        const off = i + 2 // 2..maxOffset
        const cover = []
        const breakHours = new Set()

        workDates.forEach(d => {
          breakHours.add(`${d}|${startHour + off}`)
          for (let h = startHour; h < startHour + shiftLength; h++) {
            if (h === startHour + off) continue
            cover.push(`${d}|${h}`)
          }
        })

        return {
          startDate,
          startHour,
          breakOffset: off,
          length: shiftLength,
          cover,
          breakHours
        }
      })
    })
  })

  /* 6) greedy selection */
  const localNeeds = { ...needs }
  const assignments = []

  while (true) {
    if (typeof maxStaff === 'number' && assignments.length >= maxStaff) break

    let best = null
    let bestScore = 0

    for (const c of candidates) {
      const sc = c.cover.reduce((s, k) => s + (localNeeds[k] || 0), 0)
      if (sc > bestScore) { best = c; bestScore = sc }
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

  /* 7) collapse with splitSize (FIXED) */
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

  /* 8) ensure every first-week day has one block */
  firstWeek.forEach(startDate => {
    const exists = solution.some(b => b.startDate === startDate)
    if (exists) return

    let bestCombo = null
    let bestScore = -1

    for (const h of hoursToTry) {
      const maxOff = Math.min(5, shiftLength - 1)
      for (let off = 2; off <= maxOff; off++) {
        const score = getWorkDates(startDate).reduce((s, d) => {
          for (let x = h; x < h + shiftLength; x++) {
            if (x === h + off) continue
            s += needs[`${d}|${x}`] || 0
          }
          return s
        }, 0)
        if (score > bestScore) { bestScore = score; bestCombo = { h, off } }
      }
    }

    solution.push({
      startDate,
      startHour: bestCombo.h,
      breakOffset: bestCombo.off,
      length: shiftLength,
      count: 1,
      patternIndex: dayjs(startDate).day()
    })
  })

  solution.sort((a, b) =>
    (a.patternIndex ?? 0) - (b.patternIndex ?? 0) ||
    a.startHour - b.startHour
  )

  return solution
}

/* autoAssignRotations (pass splitSize through) */
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
