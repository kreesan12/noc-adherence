import { nanoid } from 'nanoid'
import { loadCircuitMonitoringRows } from './nldCircuitState.js'

function asNumber(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function calcDelta(init, curr) {
  const a = asNumber(init)
  const b = asNumber(curr)
  if (a == null || b == null) return null
  return b - a
}

function worseMagnitude(delta) {
  if (delta == null) return null
  return delta < 0 ? Math.abs(delta) : 0
}

function fmtDbm(value) {
  const n = asNumber(value)
  return n == null ? 'N/A' : `${n.toFixed(1)} dBm`
}

function fmtTimestamp(value) {
  if (!value) return 'N/A'
  return new Date(value).toISOString()
}

export function buildDriftMetrics(row) {
  const initA = row.initRxSiteA ?? row.initial?.rxSiteA ?? null
  const initB = row.initRxSiteB ?? row.initial?.rxSiteB ?? null
  const currA = row.displayRxA ?? row.currentRxSiteA ?? null
  const currB = row.displayRxB ?? row.currentRxSiteB ?? null

  const deltaA = calcDelta(initA, currA)
  const deltaB = calcDelta(initB, currB)
  const worseA = worseMagnitude(deltaA)
  const worseB = worseMagnitude(deltaB)

  const breachSide = (worseB ?? -1) > (worseA ?? -1) ? 'B' : 'A'
  const chosenInit = breachSide === 'B' ? initB : initA
  const chosenCurr = breachSide === 'B' ? currB : currA
  const maxWorse = Math.max(worseA ?? 0, worseB ?? 0)
  const breachLevel = maxWorse > 2 ? 2 : maxWorse >= 1 ? 1 : 0

  return {
    initA,
    initB,
    currA,
    currB,
    deltaA,
    deltaB,
    worseA,
    worseB,
    breachSide,
    chosenInit,
    chosenCurr,
    maxWorse,
    breachLevel,
    priority: breachLevel === 2 ? 'high' : breachLevel === 1 ? 'normal' : null,
    tags: breachLevel === 2
      ? ['nld_drift_1dbm', 'nld_drift_2dbm']
      : breachLevel === 1
        ? ['nld_drift_1dbm']
        : []
  }
}

function buildTicketSubject(row, metrics) {
  return `NLD Light Drift | ${row.circuitId} | Side ${metrics.breachSide} worsened by ${metrics.maxWorse.toFixed(1)} dBm`
}

function buildCreateComment(row, metrics) {
  const priorityReason = metrics.breachLevel === 2
    ? 'Drift is greater than 2.0 dBm, so the ticket is staged as High priority.'
    : 'Drift is between 1.0 dBm and 2.0 dBm, so the ticket is staged as Normal priority.'

  return [
    'Automated staging ticket created for NLD light-level drift.',
    '',
    `Circuit ID: ${row.circuitId}`,
    `NLD Group: ${row.nldGroup || 'Unassigned'}`,
    `Breached side: ${metrics.breachSide}`,
    `Initial light level: ${fmtDbm(metrics.chosenInit)}`,
    `Latest light level: ${fmtDbm(metrics.chosenCurr)}`,
    `Delta light level: ${metrics.maxWorse.toFixed(1)} dBm worse`,
    `Side A: initial ${fmtDbm(metrics.initA)} | latest ${fmtDbm(metrics.currA)} | delta ${metrics.deltaA == null ? 'N/A' : `${metrics.deltaA.toFixed(1)} dBm`}`,
    `Side B: initial ${fmtDbm(metrics.initB)} | latest ${fmtDbm(metrics.currB)} | delta ${metrics.deltaB == null ? 'N/A' : `${metrics.deltaB.toFixed(1)} dBm`}`,
    `As of: ${fmtTimestamp(row.displayAsOf)}`,
    '',
    priorityReason,
    'Group: NOC Tier3',
    'Type: task',
    `Tags: ${metrics.tags.join(', ')}`
  ].join('\n')
}

function buildEscalationComment(row, metrics, existing) {
  return [
    'Automated staging ticket escalation.',
    '',
    `Circuit ID: ${row.circuitId}`,
    `Priority changed from ${String(existing.priority || 'normal').toUpperCase()} to HIGH.`,
    `Reason: drift worsened beyond 2.0 dBm on side ${metrics.breachSide}.`,
    `Initial light level: ${fmtDbm(metrics.chosenInit)}`,
    `Latest light level: ${fmtDbm(metrics.chosenCurr)}`,
    `Current delta light level: ${metrics.maxWorse.toFixed(1)} dBm worse`,
    `As of: ${fmtTimestamp(row.displayAsOf)}`,
    'Status changed to OPEN.'
  ].join('\n')
}

export async function syncStagedZendeskTickets(prisma) {
  const rows = await loadCircuitMonitoringRows(prisma)
  const existingTickets = await prisma.stagedZendeskTicket.findMany({
    select: {
      id: true,
      circuitId: true,
      priority: true,
      status: true,
      breachLevel: true,
      tags: true
    }
  })

  const existingByCircuitId = new Map(existingTickets.map((ticket) => [ticket.circuitId, ticket]))
  const summary = {
    evaluated: rows.length,
    created: 0,
    escalated: 0,
    updated: 0,
    skipped: 0
  }

  for (const row of rows) {
    const metrics = buildDriftMetrics(row)
    const existing = existingByCircuitId.get(row.id) ?? null

    if (metrics.breachLevel === 0) {
      summary.skipped += 1
      continue
    }

    const subject = buildTicketSubject(row, metrics)

    if (!existing) {
      const commentBody = buildCreateComment(row, metrics)
      const created = await prisma.stagedZendeskTicket.create({
        data: {
          reference: `NLD-${nanoid(10).toUpperCase()}`,
          circuitId: row.id,
          subject,
          latestCommentBody: commentBody,
          priority: metrics.priority,
          status: 'OPEN',
          groupName: 'NOC Tier3',
          ticketType: 'task',
          tags: metrics.tags,
          breachSide: metrics.breachSide,
          breachLevel: metrics.breachLevel,
          initialLightLevel: metrics.chosenInit,
          latestLightLevel: metrics.chosenCurr,
          deltaLightLevel: metrics.maxWorse,
          openedAt: new Date(),
          lastEvaluatedAt: new Date(),
          comments: {
            create: {
              body: commentBody,
              isPublic: true,
              eventKind: 'created'
            }
          }
        }
      })
      existingByCircuitId.set(row.id, created)
      summary.created += 1
      continue
    }

    const shouldEscalate = existing.priority !== 'high' && metrics.breachLevel === 2
    const nextTags = Array.from(new Set([...(existing.tags || []), ...metrics.tags]))
    const nextPriority = existing.priority === 'high' || metrics.breachLevel === 2 ? 'high' : 'normal'
    const updateData = {
      subject,
      priority: nextPriority,
      status: shouldEscalate ? 'OPEN' : existing.status,
      tags: nextTags,
      breachSide: metrics.breachSide,
      breachLevel: Math.max(existing.breachLevel || 0, metrics.breachLevel),
      initialLightLevel: metrics.chosenInit,
      latestLightLevel: metrics.chosenCurr,
      deltaLightLevel: metrics.maxWorse,
      lastEvaluatedAt: new Date()
    }

    if (shouldEscalate) {
      const commentBody = buildEscalationComment(row, metrics, existing)
      await prisma.stagedZendeskTicket.update({
        where: { id: existing.id },
        data: {
          ...updateData,
          escalatedAt: new Date(),
          latestCommentBody: commentBody,
          comments: {
            create: {
              body: commentBody,
              isPublic: true,
              eventKind: 'priority-escalation'
            }
          }
        }
      })
      summary.escalated += 1
    } else {
      await prisma.stagedZendeskTicket.update({
        where: { id: existing.id },
        data: updateData
      })
      summary.updated += 1
    }
  }

  return summary
}
