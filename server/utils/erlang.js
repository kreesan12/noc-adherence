// server/utils/erlang.js
import dayjs from '../utils/dayjs.js'

/**
 * Erlang C formula
 * A = offered traffic in Erlangs (callsPerHour * AHT in hours)
 * N = number of agents
 * returns probability a caller must wait (P(wait > 0))
 */
export function erlangC(A, N) {
  let invFact = 1
  let sum = 1

  for (let k = 1; k < N; k++) {
    invFact = invFact * (A / k)
    sum += invFact
  }

  // Guard: if A >= N, formula becomes unstable (1 - A/N <= 0)
  if (A >= N) return 1

  const P0 = 1 / (sum + invFact * (A / N) / (1 - A / N))
  const PC = (invFact * (A / N) * P0) / (1 - A / N)
  return PC
}

/**
 * Compute required agents for a single traffic load.
 * Returns "base agents" for that stream. (We’ll apply shrinkage once later.)
 */
export function requiredAgents({
  callsPerHour,
  ahtSeconds,
  targetServiceLevel,
  serviceThresholdSeconds,
  shrinkage
}) {
  // If there is no work, require 0 before minimum staffing rules are applied elsewhere
  if (!callsPerHour || callsPerHour <= 0) return 0

  const A = callsPerHour * (ahtSeconds / 3600)
  if (A <= 0) return 0

  for (let N = 1; N < 500; N++) {
    if (A >= N) continue // guard

    const PC = erlangC(A, N)
    const expTerm = Math.exp(- (N - A) * (serviceThresholdSeconds / ahtSeconds))
    const SL = 1 - PC * expTerm

    if (SL >= targetServiceLevel) {
      return Math.ceil(N / (1 - (shrinkage || 0)))
    }
  }

  throw new Error("Couldn't meet service level with N < 500")
}

/**
 * Build 24-hour staffing array for one date.
 * Uses ACTUAL rows when present; otherwise FORECAST rows.
 * excludeAutomation subtracts auto processed ticket counts.
 *
 * IMPORTANT:
 * - We compute calls and tickets base requirement WITHOUT shrinkage,
 *   then apply shrinkage ONCE to the combined requirement.
 * - Then enforce minimum 2 total.
 */
export async function computeDayStaffing({
  prisma,
  role,
  date,
  callAhtSeconds,
  ticketAhtSeconds,
  serviceLevel,
  thresholdSeconds,
  shrinkage,
  excludeAutomation = false
}) {
  const start = dayjs(date).startOf('day').toDate()
  const end = dayjs(date).endOf('day').toDate()

  /* 1) get rows */
  const actualRows = await prisma.volumeActual.findMany({
    where: { role, date: { gte: start, lte: end } }
  })

  const rows = actualRows.length
    ? actualRows
    : await prisma.volumeForecast.findMany({
        where: { role, date: { gte: start, lte: end } }
      })

  /* 2) bucket by hour */
  const byHour = {}
  rows.forEach(r => {
    const h = r.hour
    const callsRaw = r.calls ?? r.expectedCalls ?? 0

    const ticketsRaw = r.tickets ?? r.expectedTickets ?? 0
    const autoSum = excludeAutomation
      ? (r.autoDfaLogged ?? 0) +
        (r.autoMntLogged ?? 0) +
        (r.autoOutageLinked ?? 0) +
        (r.autoMntSolved ?? 0)
      : 0

    const ticketsAdj = Math.max(0, ticketsRaw - autoSum)

    byHour[h] = { calls: callsRaw, tickets: ticketsAdj }
  })

  /* 3) staffing each hour */
  return Array.from({ length: 24 }, (_, h) => {
    const { calls = 0, tickets = 0 } = byHour[h] || {}

    // base requirements (no shrinkage here)
    const callBase = requiredAgents({
      callsPerHour: calls,
      ahtSeconds: callAhtSeconds,
      targetServiceLevel: serviceLevel,
      serviceThresholdSeconds: thresholdSeconds,
      shrinkage: 0
    })

    const ticketBase = requiredAgents({
      callsPerHour: tickets,
      ahtSeconds: ticketAhtSeconds,
      targetServiceLevel: serviceLevel,
      serviceThresholdSeconds: thresholdSeconds,
      shrinkage: 0
    })

    const baseTotal = callBase + ticketBase

    // apply shrinkage once to combined
    const withShrink = Math.ceil(baseTotal / (1 - shrinkage))

    // enforce minimum total = 2
    const requiredTotal = Math.max(2, withShrink)

    return {
      hour: h,
      calls,
      tickets,
      requiredAgents: requiredTotal
    }
  })
}
