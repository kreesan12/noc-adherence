// server/utils/erlang.js
import dayjs      from '../utils/dayjs.js'

/**
 * Erlang C formula
 * A = offered traffic in Erlangs (callsPerHour * AHT in hours)
 * N = number of agents
 * returns probability a caller must wait (P(wait > 0))
 */
export function erlangC(A, N) {
  let invFact = 1
  let sum     = 1
  for (let k = 1; k < N; k++) {
    invFact = invFact * (A / k)
    sum    += invFact
  }
  const P0 = 1 / (sum + invFact * (A / N) / (1 - A / N))
  const PC = (invFact * (A / N) * P0) / (1 - A / N)
  return PC
}

/**
 * Compute required agents for a single traffic load
 * @param callsPerHour
 * @param ahtSeconds
 * @param targetServiceLevel e.g. 0.8 for 80%
 * @param serviceThresholdSeconds
 * @param shrinkage e.g. 0.3 for 30%
 */
export function requiredAgents({
  callsPerHour,
  ahtSeconds,
  targetServiceLevel,
  serviceThresholdSeconds,
  shrinkage
}) {
  // traffic intensity in Erlangs
  const A = callsPerHour * (ahtSeconds / 3600)

  // brute‐force search for smallest N that meets SL
  for (let N = 1; N < 500; N++) {
    const PC = erlangC(A, N)
    // P(wait ≤ T) = 1 – P(wait > T)
    // P(wait > T) = PC * exp(-(N – A) * T / AHT)
    const expTerm = Math.exp(- (N - A) * (serviceThresholdSeconds / ahtSeconds))
    const SL      = 1 - PC * expTerm

    if (SL >= targetServiceLevel) {
      // account for shrinkage
      return Math.ceil(N / (1 - shrinkage))
    }
  }

  throw new Error("Couldn't meet service level with N < 500")
}

/**
 * Compute per‐hour staffing requirements for one date
 * @param prisma          Prisma client
 * @param role            team/role name string
 * @param date            'YYYY-MM-DD'
 * @param callAhtSeconds
 * @param ticketAhtSeconds
 * @param serviceLevel
 * @param thresholdSeconds
 * @param shrinkage
 * @returns [{ hour, calls, tickets, requiredAgents }]
 */
/**
 * Build 24-hour staffing array for one date.
 * Uses ACTUAL rows when present; otherwise FORECAST rows.
 * @param excludeAutomation  when true, subtracts auto-processed
 *                           ticket counts (DFA/MNT/Outage) from total.
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
  excludeAutomation = false    // NEW – default off
}) {
  const start = dayjs(date).startOf('day').toDate()
  const end   = dayjs(date).endOf('day').toDate()

  /* 1️⃣  get rows */
  const actualRows = await prisma.volumeActual.findMany({
    where: { role, date: { gte: start, lte: end } }
  })

  const rows = actualRows.length
    ? actualRows
    : await prisma.volumeForecast.findMany({
        where: { role, date: { gte: start, lte: end } }
      })

  /* 2️⃣  bucket by hour */
  const byHour = {}
  rows.forEach(r => {
    const h        = r.hour
    const callsRaw = r.calls ?? r.expectedCalls ?? 0

    /* tickets w/ optional automation stripping */
    const ticketsRaw = r.tickets ?? r.expectedTickets ?? 0
    const autoSum    = excludeAutomation
      ? (r.autoDfaLogged        ?? 0) +
        (r.autoMntLogged        ?? 0) +
        (r.autoOutageLinked     ?? 0)
      : 0
    const ticketsAdj = Math.max(0, ticketsRaw - autoSum)

    byHour[h] = {
      calls:   callsRaw,
      tickets: ticketsAdj
    }
  })

  /* 3️⃣  staffing for each hour */
  return Array.from({ length: 24 }, (_, h) => {
    const { calls = 0, tickets = 0 } = byHour[h] || {}

    const callAgents = requiredAgents({
      callsPerHour:            calls,
      ahtSeconds:              callAhtSeconds,
      targetServiceLevel:      serviceLevel,
      serviceThresholdSeconds: thresholdSeconds,
      shrinkage
    })

    const ticketAgents = requiredAgents({
      callsPerHour:            tickets,
      ahtSeconds:              ticketAhtSeconds,
      targetServiceLevel:      serviceLevel,
      serviceThresholdSeconds: thresholdSeconds,
      shrinkage
    })

    return {
      hour:           h,
      calls,
      tickets,
      requiredAgents: callAgents + ticketAgents
    }
  })
}