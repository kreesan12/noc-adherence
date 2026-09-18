import { loadCircuitMonitoringRows } from './nldCircuitState.js'
import { buildDriftMetrics } from './nldTicketStaging.js'
import { makeAuthHeader } from './watcherUtils.js'

const enabled = () => process.env.NLD_DRIFT_ZENDESK_ENABLED === '1'
const formId = Number(process.env.NLD_DRIFT_ZENDESK_FORM_ID || '17789401807761')
const groupId = Number(process.env.NLD_DRIFT_ZENDESK_GROUP_ID || '7058581292305')

const fmt = (value) => value == null ? 'N/A' : `${Number(value).toFixed(1)} dBm`
const fmtDelta = (value) => value == null ? 'N/A' : `${value >= 0 ? '+' : ''}${Number(value).toFixed(1)} dBm`
const sideNames = (row) => ({ A: row.nodeA || 'Node A', B: row.nodeB || 'Node B' })
const breachedSides = (metrics) => ['A', 'B'].filter((side) => (side === 'A' ? metrics.worseA : metrics.worseB) >= 2)
const circuitTag = (id) => `nld_drift_circuit_${id}`
const sideTag = (side) => `nld_drift_side_${side.toLowerCase()}`
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[character]))

function headers() {
  const { ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN } = process.env
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) throw new Error('Zendesk environment is not configured')
  return { base: `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`, headers: { Authorization: makeAuthHeader(ZENDESK_EMAIL, ZENDESK_API_TOKEN), 'Content-Type': 'application/json' } }
}

function buildSubject(row, metrics, sides, replacementFor) {
  const names = sideNames(row)
  const sideText = sides.map((side) => `Side ${side} - ${names[side]}`).join(' | ')
  const worst = Math.max(...sides.map((side) => side === 'A' ? metrics.worseA : metrics.worseB))
  return `NLD Light Drift | ${row.circuitId} | ${sideText} | ${worst.toFixed(1)} dBm worse${replacementFor ? ` | replaces #${replacementFor}` : ''}`
}

export function buildComment(row, metrics, sides, replacementFor) {
  const names = sideNames(row)
  const rows = ['A', 'B'].map((side) => {
    const reference = side === 'A' ? metrics.initA : metrics.initB
    const current = side === 'A' ? metrics.currA : metrics.currB
    const delta = side === 'A' ? metrics.deltaA : metrics.deltaB
    const worse = side === 'A' ? metrics.worseA : metrics.worseB
    const isBreached = sides.includes(side)
    return `<tr><td><strong>Side ${side}</strong></td><td>${escapeHtml(names[side])}</td><td>${fmt(reference)}</td><td>${fmt(current)}</td><td>${fmtDelta(delta)}${worse ? ` (${worse.toFixed(1)} dBm worse)` : ''}</td><td>${isBreached ? '<strong>BREACHED</strong><br>At least 2.0 dBm worse' : 'Within threshold'}</td></tr>`
  }).join('')
  const replacement = replacementFor
    ? `<p><strong>Linked active ticket:</strong> This replaces <a href="https://frogfoot.zendesk.com/agent/tickets/${replacementFor}">#${replacementFor}</a>, because an additional circuit side has breached. Action both together, update the vendor, then merge the older ticket into this one.</p>`
    : ''
  const actionSides = sides.map((side) => `Side ${side} - ${escapeHtml(names[side])}`).join(' and ')
  return `<div dir="auto">
<h2>NLD light-level drift detected</h2>
<p><strong>Circuit ID:</strong> ${escapeHtml(row.circuitId)}<br>
<strong>NLD group:</strong> ${escapeHtml(row.nldGroup || 'Unassigned')}<br>
<strong>Monitoring source:</strong> IRIS OPR daily level feed<br>
<strong>Measurement time:</strong> ${escapeHtml(row.displayAsOf || 'Not recorded')}</p>
<h3>Level comparison</h3>
<table><thead><tr><th>Side</th><th>Node</th><th>Reference level</th><th>Current level</th><th>Change</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>
${replacement}
<h3>Required action</h3>
<ol><li>Investigate ${actionSides}.</li><li>Update the relevant vendor with the findings.</li><li>Record the outcome and recovery levels on this ticket.</li></ol>
</div>`
}

async function activeTicketsByCircuit() {
  const { base, headers: requestHeaders } = headers()
  const response = await fetch(`${base}/search/export.json?filter[type]=ticket&page[size]=100&query=${encodeURIComponent('type:ticket status<solved tags:nld_drift -tags:nld_drift_test')}`, { headers: requestHeaders })
  if (!response.ok) throw new Error(`Zendesk active-ticket search failed: ${response.status}`)
  const { results = [] } = await response.json()
  const indexed = new Map()
  results.forEach((ticket) => {
    const tag = (ticket.tags || []).find((value) => /^nld_drift_circuit_\d+$/.test(value))
    if (tag) indexed.set(Number(tag.replace('nld_drift_circuit_', '')), ticket)
  })
  return indexed
}

async function createTicket(row, metrics, sides, replacementFor = null) {
  const { base, headers: requestHeaders } = headers()
  const subject = buildSubject(row, metrics, sides, replacementFor)
  const body = buildComment(row, metrics, sides, replacementFor)
  const ticket = {
    subject,
    comment: { html_body: body, public: false },
    ticket_form_id: formId,
    group_id: groupId,
    type: 'task',
    priority: 'high',
    tags: ['nld_drift', circuitTag(row.id), ...sides.map(sideTag)],
    custom_fields: [
      { id: 5551743762321, value: 'internal_monitoring' },
      { id: 5552203644433, value: 'outage_impacttype_degraded' },
      { id: 5552674828049, value: 0 },
      { id: 6715159991185, value: 'outage_servicetype_nld' },
      { id: 20591258188945, value: 'pmt_escalation_noc_tier_3' },
      { id: 5551667232273, value: row.circuitId },
      { id: 8997753520273, value: subject }
    ]
  }
  const response = await fetch(`${base}/tickets.json`, { method: 'POST', headers: requestHeaders, body: JSON.stringify({ ticket }) })
  const text = await response.text()
  if (!response.ok) throw new Error(`Zendesk ticket creation failed: ${response.status} ${text}`)
  return { ticket: JSON.parse(text).ticket, subject, body }
}

async function recordTicket(prisma, row, metrics, sides, result, replacementFor) {
  const data = {
    reference: `ZD-${result.ticket.id}`,
    subject: result.subject,
    latestCommentBody: result.body,
    priority: result.ticket.priority || 'high',
    status: String(result.ticket.status || 'new').toUpperCase(),
    groupName: 'PMT',
    ticketType: 'task',
    tags: result.ticket.tags || ['nld_drift'],
    breachSide: sides.join('+'),
    breachLevel: 2,
    initialLightLevel: sides.length === 1 ? (sides[0] === 'A' ? metrics.initA : metrics.initB) : null,
    latestLightLevel: sides.length === 1 ? (sides[0] === 'A' ? metrics.currA : metrics.currB) : null,
    deltaLightLevel: Math.max(...sides.map((side) => side === 'A' ? metrics.worseA : metrics.worseB)),
    openedAt: new Date(),
    escalatedAt: replacementFor ? new Date() : null,
    lastEvaluatedAt: new Date()
  }
  const current = await prisma.stagedZendeskTicket.findUnique({ where: { circuitId: row.id } })
  const comment = { body: result.body, isPublic: false, eventKind: replacementFor ? 'replacement-created' : 'zendesk-created' }
  if (!current) return prisma.stagedZendeskTicket.create({ data: { ...data, circuitId: row.id, comments: { create: comment } } })
  return prisma.stagedZendeskTicket.update({ where: { id: current.id }, data: { ...data, comments: { create: comment } } })
}

export async function syncZendeskDriftTickets(prisma) {
  const rows = await loadCircuitMonitoringRows(prisma)
  const summary = { evaluated: rows.length, created: 0, replacementCreated: 0, updated: 0, skipped: 0, paused: !enabled() }
  if (!enabled()) return summary

  const active = await activeTicketsByCircuit()
  for (const row of rows) {
    const metrics = buildDriftMetrics(row)
    const sides = breachedSides(metrics)
    if (!sides.length) { summary.skipped += 1; continue }
    const current = active.get(row.id)
    const currentSides = new Set((current?.tags || []).filter((tag) => /^nld_drift_side_[ab]$/.test(tag)).map((tag) => tag.slice(-1).toUpperCase()))
    const hasNewSide = current && sides.some((side) => !currentSides.has(side))
    if (current && !hasNewSide) {
      await prisma.stagedZendeskTicket.updateMany({ where: { circuitId: row.id }, data: { status: String(current.status || 'open').toUpperCase(), lastEvaluatedAt: new Date() } })
      summary.updated += 1
      continue
    }
    const result = await createTicket(row, metrics, sides, current?.id || null)
    await recordTicket(prisma, row, metrics, sides, result, current?.id || null)
    if (current) summary.replacementCreated += 1
    else summary.created += 1
  }
  return summary
}
