import dayjs from '../utils/dayjs.js'

/*
  Waterfall Template Solver

  Buckets:
    B1 00:00 to 09:00  (hours 0..8)
    B2 08:00 to 17:00  (hours 8..16)
    B3 15:00 to 00:00  (hours 15..23)

  Fixed phase plan (start weekday):
    Mon -> B2
    Tue -> B1
    Wed -> B3
    Thu -> B1
    Fri -> B3
    Sat -> B2
    Sun -> B2

  Counts per phase:
    count(phase) = ceil(avg required in its bucket)

  Staff movement:
    Total slots N = sum(counts across phases in Mon..Sun order)
    For cycle c, employee e takes slot (e + c) mod N
    This shifts everyone forward by one slot per cycle, matching your description.

  Cycle definition:
    One cycle is weeks * 7 days, consistent with your existing weeks setting.
*/

const BUCKETS = {
  // Averages:
  // b1: 00:00–07:59  => 0..7
  // b2: 08:00–16:59  => 8..16
  // b3: 17:00–23:59  => 17..23
  //
  // Shift starts stay: 00:00, 08:00, 15:00
  b1: { name: 'Bucket 1', hours: (h) => h >= 0  && h < 8,  startHour: 0  },
  b2: { name: 'Bucket 2', hours: (h) => h >= 8  && h < 17, startHour: 8  },
  b3: { name: 'Bucket 3', hours: (h) => h >= 17 && h < 24, startHour: 15 }
}

const PHASES_MON_TO_SUN = [1, 2, 3, 4, 5, 6, 0] // dayjs: 0 Sun, 1 Mon, ...

const PHASE_TO_BUCKET = {
  1: 'b2', // Mon (Bucket 2 full)
  2: 'b1', // Tue
  3: 'b2', // Wed (Bucket 2 half)
  4: 'b1', // Thu
  5: 'b3', // Fri
  6: 'b2', // Sat (Bucket 2 half)
  0: 'b3'  // Sun
}


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

function buildWeekdayDateMap(firstWeekDates) {
  const map = {}
  for (const d of firstWeekDates) {
    const wd = dayjs(d).day()
    if (map[wd] == null) map[wd] = d
  }
  return map
}

function avgForBucket(needs, bucketFn) {
  let sum = 0
  let n = 0
  for (const k in needs) {
    const [_, hourStr] = k.split('|')
    const h = Number(hourStr)
    if (!bucketFn(h)) continue
    sum += (needs[k] || 0)
    n += 1
  }
  const avg = n ? (sum / n) : 0
  return { avg, n }
}

function ceilInt(x) {
  if (!Number.isFinite(x)) return 0
  return Math.max(0, Math.ceil(x))
}

function objective({ shortfall, over, headcount }) {
  return shortfall * 1_000_000 + over * 10 + headcount
}

function evaluate(needs, cov) {
  let shortfall = 0
  let over = 0
  for (const k in needs) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if (got < req) shortfall += (req - got)
    else over += (got - req)
  }
  return { shortfall, over }
}

function addHourKey(dayStr, hour) {
  if (hour < 24) return `${dayStr}|${hour}`
  const nextDay = dayjs(dayStr).add(1, 'day').format('YYYY-MM-DD')
  return `${nextDay}|${hour - 24}`
}

function getWorkDates(startDateStr, weeks) {
  const out = []
  for (let w = 0; w < weeks; w++) {
    const base = dayjs(startDateStr).add(w * 7, 'day')
    for (let d = 0; d < 5; d++) {
      out.push(base.add(d, 'day').format('YYYY-MM-DD'))
    }
  }
  return out
}

function pickBreakHour({
  dayStr,
  startHour,
  shiftLength,
  needs,
  cov,
  breakWindowMin = 2,
  breakWindowMax = 5
}) {
  // Choose a lunch hour that creates the least pain
  // This works across midnight too
  const candidates = []

  for (let off = breakWindowMin; off <= breakWindowMax; off++) {
    const h = startHour + off
    const k = addHourKey(dayStr, h)

    const req = needs[k] || 0
    const got = cov[k] || 0

    // Lunch removes 1 from that hour, so projected got is got
    // We prefer hours where we have slack
    const slack = got - req
    candidates.push({ h, slack })
  }

  candidates.sort((a, b) => b.slack - a.slack || a.h - b.h)
  return candidates[0]?.h ?? (startHour + 4)
}

function applyShiftCoverage({
  cov,
  needs,
  dayStr,
  startHour,
  shiftLength,
  breakHour
}) {
  for (let h = startHour; h < startHour + shiftLength; h++) {
    const k = addHourKey(dayStr, h)
    if (h === breakHour) continue
    cov[k] = (cov[k] || 0) + 1
  }
}

function buildSlots(phaseCounts) {
  // Slots are phases repeated by their lane counts, ordered Mon..Sun
  const slots = []
  for (const phase of PHASES_MON_TO_SUN) {
    const cnt = phaseCounts[phase] || 0
    for (let i = 0; i < cnt; i++) slots.push(phase)
  }
  return slots
}

function collapseBlocksForUi({ phaseCounts, weekdayDateMap, shiftLength }) {
  // UI blocks show cycle 0 lane templates
  const blocks = []
  for (const phase of PHASES_MON_TO_SUN) {
    const bucketKey = PHASE_TO_BUCKET[phase]
    const startDate = weekdayDateMap[phase]
    if (!startDate) continue

    const startHour = BUCKETS[bucketKey].startHour
    const count = phaseCounts[phase] || 0
    if (count <= 0) continue

    blocks.push({
      startDate,
      startHour,
      breakOffset: 4,
      length: shiftLength,
      count,
      patternIndex: phase
    })
  }

  blocks.sort((a, b) =>
    (a.patternIndex ?? 0) - (b.patternIndex ?? 0) ||
    a.startHour - b.startHour
  )

  return blocks
}

export function solveWaterfallTemplate(
  forecast,
  {
    weeks = 3,
    shiftLength = 9
  } = {}
) {
  const t0 = Date.now()

  const { needs, allDates } = makeNeedsMap(forecast)
  const firstWeek = getFirstWeek(allDates)
  const weekdayDateMap = buildWeekdayDateMap(firstWeek)

  // Bucket averages
  const a1 = avgForBucket(needs, BUCKETS.b1.hours).avg
  const a2 = avgForBucket(needs, BUCKETS.b2.hours).avg
  const a3 = avgForBucket(needs, BUCKETS.b3.hours).avg

  let b1 = ceilInt(a1)
  let b2Main = ceilInt(a2)   // Mon -> Fri (the “nice” day shift)
  let b3 = ceilInt(a3)

  // Nice to have: bucket 2 must be largest so Mon to Fri is the nicest shift
  const maxOther = Math.max(b1, b3)
  let forcedBucket2 = false
  if (b2Main < maxOther) {
    b2Main = maxOther
    forcedBucket2 = true
  }

  // Half the day shifts that are NOT Mon->Fri:
  // Your b2 phases are: Mon(1), Sat(6), Sun(0)
  // Mon gets full b2Main. Sat/Sun get half (rounded up).
  const b2Other = ceilInt(b2Main / 2)

  const phaseCounts = {}
  for (const phase of PHASES_MON_TO_SUN) {
    const bk = PHASE_TO_BUCKET[phase]

    if (bk === 'b1') {
      phaseCounts[phase] = b1
    } else if (bk === 'b3') {
      phaseCounts[phase] = b3
    } else {
      // bk === 'b2'
      // Full only for Monday phase (1)
      // Half only for Wednesday phase (3) and Saturday phase (6)
      phaseCounts[phase] = (phase === 1) ? b2Main : b2Other
    }
  }

  const slots = buildSlots(phaseCounts)
  const headcount = slots.length

  // Build coverage by simulating staff movement across cycles
  const cov = Object.create(null)

  const horizonStart = allDates[0]
  const horizonEnd = allDates[allDates.length - 1]
  const start = dayjs(horizonStart)
  const end = dayjs(horizonEnd)

  const cycleDays = weeks * 7
  const totalDays = end.diff(start, 'day') + 1
  const cycles = Math.max(1, Math.ceil(totalDays / cycleDays))

  // For each cycle, each employee takes the slot (e + cycle) mod N
  // Slot gives phase, phase gives bucket and start day
  for (let ci = 0; ci < cycles; ci++) {
    for (let e = 0; e < headcount; e++) {
      const slotPhase = slots[(e + ci) % headcount]
      const bucketKey = PHASE_TO_BUCKET[slotPhase]
      const startHour = BUCKETS[bucketKey].startHour
      const baseStart = weekdayDateMap[slotPhase]
      if (!baseStart) continue

      const startDate = dayjs(baseStart).add(ci * cycleDays, 'day')

      const workDates = getWorkDates(startDate.format('YYYY-MM-DD'), weeks)

      for (const dtStr of workDates) {
        const d = dayjs(dtStr)
        if (d.isBefore(start, 'day')) continue
        if (d.isAfter(end, 'day')) continue

        const dayStr = d.format('YYYY-MM-DD')

        const breakHour = pickBreakHour({
          dayStr,
          startHour,
          shiftLength,
          needs,
          cov
        })

        applyShiftCoverage({
          cov,
          needs,
          dayStr,
          startHour,
          shiftLength,
          breakHour
        })
      }
    }
  }

  const ev = evaluate(needs, cov)
  const obj = objective({ ...ev, headcount })

  const solution = collapseBlocksForUi({ phaseCounts, weekdayDateMap, shiftLength })

  return {
    solution,
    plan: {
      slots,
      phaseCounts,
      phaseToBucket: PHASE_TO_BUCKET,
      bucketCounts: { b1, b2Main, b2Other, b3 },
      bucketAvgs: { b1: a1, b2: a2, b3: a3 },
      bucketStartHours: { b1: BUCKETS.b1.startHour, b2: BUCKETS.b2.startHour, b3: BUCKETS.b3.startHour },
      weeks,
      shiftLength
    },
    meta: {
      method: 'waterfall-template',
      feasible: ev.shortfall === 0,
      headcount,
      shortfall: ev.shortfall,
      over: ev.over,
      objective: obj,
      forcedBucket2Largest: forcedBucket2,
      timeMs: Date.now() - t0
    }
  }
}

// Convenience wrapper matching your existing route response
export function autoAssignRotations(forecast, opts = {}) {
  const { solution, plan, meta } = solveWaterfallTemplate(forecast, opts)

  const tally = (solution || []).reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + (b.count || 0)
    return acc
  }, {})

  const bestStartHours = Object.entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, 5)

  return { bestStartHours, solution, plan, meta }
}
