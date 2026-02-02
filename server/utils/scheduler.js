import dayjs from '../utils/dayjs.js'

/* -------------------------------------------------------------- *
 * Option D: Waterfall lane template with constrained rotations
 *
 * Concepts:
 * - 7 phases (Mon-Fri, Tue-Sat, Wed-Sun, Thu-Mon, Fri-Tue, Sat-Wed, Sun-Thu)
 * - Lanes have a phase0 and waterfall: phase = (phase0 + cycleIndex) mod 7
 * - Shift types: day, late, grave (startHour fixed per type)
 *
 * Rotation pools:
 * - For grave requirement G and rotateAfter K cycles:
 *   pool size = G * (K + 1)
 *   each cycle, exactly G tracks are on grave, the rest of that pool is on day
 *   tracks rotate roles cyclically, so staff rotate without creating 7 grave patterns
 *
 * Same for late with requirement L and rotateAfter KLate
 *
 * Day base staff D are always day (no special rotation)
 *
 * Solver:
 * - Search over small ranges for G, L
 * - For each, compute minimal D by greedy increment until feasible
 * - Choose best by objective: shortfall huge, then over, then headcount
 *
 * Output:
 * - tracks: explicit track list (each track has phase0, pool, slotIndex)
 * - blocks: aggregated view for UI (cycle 0 only, approximate)
 * - meta: details
 * -------------------------------------------------------------- */

const SHIFT_TYPES_DEFAULT = {
  grave: { startHour: 0, breakOffset: 4 },
  day:   { startHour: 8, breakOffset: 4 },
  late:  { startHour: 15, breakOffset: 4 }
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

function getWorkDates(startDate, weeks, dateSet) {
  const out = []
  for (let w = 0; w < weeks; w++) {
    const base = dayjs(startDate).add(w * 7, 'day')
    for (let i = 0; i < 5; i++) {
      const dd = base.add(i, 'day').format('YYYY-MM-DD')
      if (!dateSet || dateSet.has(dd)) out.push(dd)
    }
  }
  return out
}

function evaluateCoverageAgainstNeeds(needs, cov, needKeys) {
  let shortfall = 0
  let over = 0
  const keys = needKeys || Object.keys(needs)

  for (const k of keys) {
    const req = needs[k] || 0
    const got = cov[k] || 0
    if (got < req) shortfall += (req - got)
    else over += (got - req)
  }
  return { shortfall, over }
}

function objectiveEval({ shortfall, over, headcount }) {
  return shortfall * 1_000_000 + over * 10 + headcount * 1
}

function hoursInRangeInclusive(h, lo, hi) {
  return h >= lo && h <= hi
}

function estimateSpecialNeed(needs, needKeys, { coreHours }) {
  let sum = 0
  let n = 0
  let peak = 0

  const keys = needKeys || Object.keys(needs)
  for (const k of keys) {
    const [_, hourStr] = k.split('|')
    const h = Number(hourStr)
    if (!coreHours.some(([a, b]) => hoursInRangeInclusive(h, a, b))) continue

    const req = needs[k] || 0
    sum += req
    n += 1
    if (req > peak) peak = req
  }

  const avg = n ? (sum / n) : 0
  return { avg, peak }
}

/* -------------------------------------------------------------- *
 * Track model
 * -------------------------------------------------------------- *
 * track:
 * - id
 * - phase0 (0..6)
 * - pool: 'grave' | 'late' | 'day'
 * - slotIndex: number (index in its pool)
 *
 * Rotation in pool:
 * - grave pool has G active grave per cycle, rest day
 * - late pool has L active late per cycle, rest day
 * - day pool always day
 *
 * For pool with size = R * (K + 1):
 * - define groupSize = R
 * - groupCount = K + 1
 * - groupIndex0 = floor(slotIndex / groupSize) in [0..K]
 * - for cycle ci:
 *     groupIndex = (groupIndex0 + ci) mod groupCount
 *     if groupIndex == 0 -> special shift this cycle
 *     else -> day shift this cycle
 * -------------------------------------------------------------- */

function shiftTypeForTrackAtCycle(track, ci, rotationConfig) {
  if (track.pool === 'day') return 'day'

  const cfg = track.pool === 'grave' ? rotationConfig.grave : rotationConfig.late
  const R = cfg.required
  const K = cfg.rotateAfterCycles
  const groupSize = Math.max(1, R)
  const groupCount = K + 1

  const groupIndex0 = Math.floor(track.slotIndex / groupSize)
  const groupIndex = (groupIndex0 + ci) % groupCount

  if (groupIndex === 0) return track.pool
  return 'day'
}

function phaseForTrackAtCycle(track, ci) {
  return (track.phase0 + ci) % 7
}

function applyShiftCoverageForDay({
  cov,
  dayStr,
  startHour,
  shiftLength,
  breakOffset
}) {
  const lunchHour = startHour + breakOffset

  for (let h = startHour; h < startHour + shiftLength; h++) {
    if (h >= 24) break
    if (h === lunchHour) continue
    const k = `${dayStr}|${h}`
    cov[k] = (cov[k] || 0) + 1
  }
}

function buildCoverageForTracks({
  tracks,
  needs,
  needKeys,
  weeks,
  shiftLength,
  weekdayDateMap,
  dateSet,
  rotationConfig,
  shiftTypes,
  horizonStart,
  horizonEnd
}) {
  const cov = Object.create(null)

  const start = dayjs(horizonStart)
  const end = dayjs(horizonEnd)
  const totalDays = end.diff(start, 'day') + 1
  const cycleDays = weeks * 7
  const cycles = Math.max(1, Math.ceil(totalDays / cycleDays))

  for (let ci = 0; ci < cycles; ci++) {
    for (const track of tracks) {
      const phase = phaseForTrackAtCycle(track, ci)
      const baseStart = weekdayDateMap[phase]
      if (!baseStart) continue

      const shiftType = shiftTypeForTrackAtCycle(track, ci, rotationConfig)
      const st = shiftTypes[shiftType] || shiftTypes.day

      const workDates = getWorkDates(baseStart, weeks, null)

      for (const dtStr of workDates) {
        const actualDay = dayjs(dtStr).add(ci * cycleDays, 'day')
        if (actualDay.isBefore(start, 'day')) continue
        if (actualDay.isAfter(end, 'day')) continue

        const dayStr = actualDay.format('YYYY-MM-DD')
        if (dateSet && !dateSet.has(dayStr)) continue

        applyShiftCoverageForDay({
          cov,
          dayStr,
          startHour: st.startHour,
          shiftLength,
          breakOffset: st.breakOffset
        })
      }
    }
  }

  const ev = evaluateCoverageAgainstNeeds(needs, cov, needKeys)
  return { cov, ev }
}

/* -------------------------------------------------------------- *
 * Track builder helpers
 * -------------------------------------------------------------- */

function distributePhases(count, phaseSeed = 0) {
  const phases = []
  for (let i = 0; i < count; i++) phases.push((phaseSeed + i) % 7)
  return phases
}

function buildTracksForPlan({
  graveRequired,
  lateRequired,
  dayBase,
  graveRotateAfterCycles,
  lateRotateAfterCycles,
  phaseSeed = 0
}) {
  const tracks = []
  let id = 1

  // grave pool
  if (graveRequired > 0) {
    const size = graveRequired * (graveRotateAfterCycles + 1)
    const phases = distributePhases(size, phaseSeed)
    for (let i = 0; i < size; i++) {
      tracks.push({
        id: id++,
        pool: 'grave',
        required: graveRequired,
        rotateAfterCycles: graveRotateAfterCycles,
        slotIndex: i,
        phase0: phases[i]
      })
    }
  }

  // late pool
  if (lateRequired > 0) {
    const size = lateRequired * (lateRotateAfterCycles + 1)
    const phases = distributePhases(size, phaseSeed + 2)
    for (let i = 0; i < size; i++) {
      tracks.push({
        id: id++,
        pool: 'late',
        required: lateRequired,
        rotateAfterCycles: lateRotateAfterCycles,
        slotIndex: i,
        phase0: phases[i]
      })
    }
  }

  // day base
  if (dayBase > 0) {
    const phases = distributePhases(dayBase, phaseSeed + 4)
    for (let i = 0; i < dayBase; i++) {
      tracks.push({
        id: id++,
        pool: 'day',
        slotIndex: i,
        phase0: phases[i]
      })
    }
  }

  return tracks
}

function aggregateBlocksForUiCycle0({
  tracks,
  weeks,
  shiftLength,
  weekdayDateMap,
  rotationConfig,
  shiftTypes
}) {
  // For UI only: approximate blocks for cycle 0
  // Group by (phase0, shiftType at cycle0)
  const tally = new Map()

  for (const tr of tracks) {
    const phase = tr.phase0
    const shiftType = shiftTypeForTrackAtCycle(tr, 0, rotationConfig)
    const st = shiftTypes[shiftType] || shiftTypes.day

    const startDate = weekdayDateMap[phase]
    if (!startDate) continue

    const key = `${startDate}|${st.startHour}|${st.breakOffset}`
    tally.set(key, (tally.get(key) || 0) + 1)
  }

  const blocks = []
  for (const [key, count] of tally.entries()) {
    const [startDate, startHourStr, breakOffsetStr] = key.split('|')
    blocks.push({
      startDate,
      startHour: Number(startHourStr),
      breakOffset: Number(breakOffsetStr),
      length: shiftLength,
      count,
      patternIndex: dayjs(startDate).day()
    })
  }

  blocks.sort((a, b) =>
    (a.patternIndex ?? 0) - (b.patternIndex ?? 0) ||
    a.startHour - b.startHour
  )

  return blocks
}

/* -------------------------------------------------------------- *
 * Main Waterfall planner
 * -------------------------------------------------------------- */

export function assignWaterfallShifts(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,

    // Shift type definitions
    shiftTypes = SHIFT_TYPES_DEFAULT,

    // Rotation policy
    graveRotateAfterCycles = 2, // K
    lateRotateAfterCycles = 2,  // K

    // Search limits
    maxDayBase = 500,
    searchPad = 2,
    maxPlanChecks = 500,

    // Phase seed
    phaseSeed = 0
  } = {}
) {
  const t0 = Date.now()

  const { needs, allDates, dateSet } = makeNeedsMap(forecast)
  const needKeys = Object.keys(needs)
  const firstWeek = getFirstWeek(allDates)
  const weekdayDateMap = buildWeekdayDateMap(firstWeek)

  const horizonStart = allDates[0]
  const horizonEnd = allDates[allDates.length - 1]

  // Estimate special requirements from core hour ranges
  const graveEst = estimateSpecialNeed(needs, needKeys, { coreHours: [[0, 6]] })
  const lateEst = estimateSpecialNeed(needs, needKeys, { coreHours: [[16, 23]] })

  const graveBase = Math.max(1, Math.ceil(graveEst.avg))
  const lateBase = Math.max(0, Math.ceil(lateEst.avg))

  const graveRange = []
  for (let g = Math.max(1, graveBase - searchPad); g <= graveBase + searchPad; g++) graveRange.push(g)

  const lateRange = []
  for (let l = Math.max(0, lateBase - searchPad); l <= lateBase + searchPad; l++) lateRange.push(l)

  let checks = 0
  let best = null

  // Rotation config object used by simulation
  function makeRotationConfig(graveRequired, lateRequired) {
    return {
      grave: { required: graveRequired, rotateAfterCycles: graveRotateAfterCycles },
      late: { required: lateRequired, rotateAfterCycles: lateRotateAfterCycles }
    }
  }

  // For each G, L, find minimal D via incremental search
  for (const G of graveRange) {
    for (const L of lateRange) {
      const rotationConfig = makeRotationConfig(G, L)

      // lower bound for day base, start at 0 and climb
      let D = 0
      let foundForThisGL = null

      while (D <= maxDayBase) {
        checks++
        if (checks > maxPlanChecks) break

        const tracks = buildTracksForPlan({
          graveRequired: G,
          lateRequired: L,
          dayBase: D,
          graveRotateAfterCycles,
          lateRotateAfterCycles,
          phaseSeed
        })

        const headcount = tracks.length

        const { ev } = buildCoverageForTracks({
          tracks,
          needs,
          needKeys,
          weeks,
          shiftLength,
          weekdayDateMap,
          dateSet,
          rotationConfig,
          shiftTypes,
          horizonStart,
          horizonEnd
        })

        const planEval = { ...ev, headcount }
        const obj = objectiveEval(planEval)

        if (ev.shortfall === 0) {
          foundForThisGL = { tracks, rotationConfig, eval: planEval, obj, G, L, D }
          break
        }

        D += 1
      }

      if (checks > maxPlanChecks) break
      if (!foundForThisGL) continue

      if (!best || foundForThisGL.obj < best.obj) {
        best = foundForThisGL
      }
    }
    if (checks > maxPlanChecks) break
  }

  if (!best) {
    return {
      solution: [],
      tracks: [],
      meta: {
        method: 'waterfall',
        feasible: false,
        checks,
        timeMs: Date.now() - t0,
        note: 'No feasible plan found within search limits'
      }
    }
  }

  const blocks = aggregateBlocksForUiCycle0({
    tracks: best.tracks,
    weeks,
    shiftLength,
    weekdayDateMap,
    rotationConfig: best.rotationConfig,
    shiftTypes
  })

  return {
    solution: blocks, // for UI tables
    tracks: best.tracks,
    meta: {
      method: 'waterfall',
      feasible: best.eval.shortfall === 0,
      checks,
      timeMs: Date.now() - t0,

      weeks,
      shiftLength,

      graveRequired: best.G,
      lateRequired: best.L,
      dayBase: best.D,

      graveRotateAfterCycles,
      lateRotateAfterCycles,

      headcount: best.eval.headcount,
      shortfall: best.eval.shortfall,
      over: best.eval.over,
      objective: best.obj
    }
  }
}

/* -------------------------------------------------------------- *
 * Backwards compatible wrapper
 * If you already call assignRotationalShifts from your route,
 * this keeps the same name but uses waterfall by default when
 * exact is true or when mode === 'waterfall' is passed by route.
 * -------------------------------------------------------------- */

export function assignRotationalShifts(
  forecast,
  {
    weeks = 3,
    shiftLength = 9,

    // new
    mode = 'waterfall',
    shiftTypes = SHIFT_TYPES_DEFAULT,
    graveRotateAfterCycles = 2,
    lateRotateAfterCycles = 2,

    // old fields still accepted but ignored in waterfall mode
    startHours,
    maxStaff,
    splitSize = 999,
    exact = false,
    timeLimitMs = 0,
    greedyRestarts = 15
  } = {}
) {
  if (mode === 'waterfall' || exact) {
    return assignWaterfallShifts(forecast, {
      weeks,
      shiftLength,
      shiftTypes,
      graveRotateAfterCycles,
      lateRotateAfterCycles
    })
  }

  // If you ever want to keep the old solver as another mode,
  // you can add it here later.
  return assignWaterfallShifts(forecast, {
    weeks,
    shiftLength,
    shiftTypes,
    graveRotateAfterCycles,
    lateRotateAfterCycles
  })
}

export function autoAssignRotations(
  forecast,
  opts = {}
) {
  const { solution, tracks, meta } = assignRotationalShifts(forecast, opts)

  // In waterfall mode, start hours are policy fixed
  const tally = (solution || []).reduce((acc, b) => {
    acc[b.startHour] = (acc[b.startHour] || 0) + (b.count || 0)
    return acc
  }, {})

  const bestStartHours = Object.entries(tally)
    .map(([h, total]) => ({ startHour: +h, totalAssigned: total }))
    .sort((a, b) => b.totalAssigned - a.totalAssigned)
    .slice(0, 5)

  return { bestStartHours, solution, tracks, meta }
}
