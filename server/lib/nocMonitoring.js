import dayjs from 'dayjs'
import prisma from './prisma.js'
import { fetchJsonWithTimeout, makeAuthHeader, zendeskAgentTicketLink, compactText } from './watcherUtils.js'
import { getWhatsappWatcherConfig } from './whatsappWatcherConfig.js'

const SNAPSHOT_KEY = 'noc_monitoring_snapshot_v1'
const SOFT_TTL_MS = Number(process.env.NOC_MONITORING_SNAPSHOT_TTL_MS || 15 * 60 * 1000)
const HARD_STALE_MS = Number(process.env.NOC_MONITORING_HARD_STALE_MS || 6 * 60 * 60 * 1000)
const MAX_SEARCH_PAGES = Number(process.env.NOC_MONITORING_MAX_SEARCH_PAGES || 8)
const MAX_SEARCH_RESULTS = Number(process.env.NOC_MONITORING_MAX_SEARCH_RESULTS || 2500)
const OUTAGE_GROUP_ID = String(process.env.OUTAGE_WATCHER_GROUP_ID || '5160847905297').trim()
const OUTAGE_FORM_NAME = String(process.env.OUTAGE_WATCHER_FORM_NAME || 'Outage Capturing').trim()
const INITIAL_FORM_NAME = String(process.env.NOC_MONITORING_INITIAL_FORM_NAME || 'Frogfoot Initial Form').trim()
const TIER1_GROUP_NAME = String(process.env.NOC_MONITORING_T1_GROUP || 'NOC Tier1 Support').trim()
const TIER2_GROUP_NAME = String(process.env.NOC_MONITORING_T2_GROUP || 'NOC Tier2 Support').trim()
const ILLATION_STATS_URL = String(process.env.ILLATION_DASHBOARD_STATS_URL || '').trim()
const ILLATION_AUTH_HEADER = String(process.env.ILLATION_DASHBOARD_AUTH_HEADER || '').trim()
const ILLATION_BEARER_TOKEN = String(process.env.ILLATION_DASHBOARD_BEARER_TOKEN || '').trim()
const ILLATION_API_KEY = String(process.env.ILLATION_DASHBOARD_API_KEY || '').trim()
const ILLATION_ALLOW_ANON = process.env.ILLATION_DASHBOARD_ALLOW_ANON === '1'

const ZENDESK_SUBDOMAIN = process.env.ZENDESK_SUBDOMAIN
const ZENDESK_EMAIL = process.env.ZENDESK_EMAIL
const ZENDESK_API_TOKEN = process.env.ZENDESK_API_TOKEN

const FIELD_IDS = {
  nld: '40137360073617',
  region: '5522811974801',
  subscriberImpact: '5552674828049',
  lastUpdate: '5352766585489',
  serviceType: '6715159991185',
  outageStatus: '4419340564625',
  outageType: '14118200804369',
  outageOwner: '6832283279121',
  dfaRef: '7657855944209',
  liquidRef: '7657816716433',
  liquidCircuit: '8008871186961',
  backhaulOwner: '7456773576081',
  backhaulIssue: '7458181781393',
  backhaulSideA: '7458118254225',
  backhaulSideB: '7458160447505',
  backhaulDfaCircuit: '8145005788433',
  vendorLoggedDate: '16308210688913',
  vendorLoggedTime: '16308235403025',
  impactStartDate: '7890263202833',
  impactStartTime: '7890288590609',
  impactStopDate: '7890308370449',
  impactStopTime: '7890325701649'
}

const LANE_TONES = {
  major_outage: '#dc2626',
  nld_outage: '#f97316',
  backhaul: '#7c3aed',
  vip: '#2563eb',
  tier1: '#0f766e',
  tier2: '#1d4ed8',
  skipped: '#475569'
}

let refreshPromise = null

function makeZendeskHeaders() {
  if (!ZENDESK_SUBDOMAIN || !ZENDESK_EMAIL || !ZENDESK_API_TOKEN) {
    throw new Error('Zendesk environment is not configured on this server.')
  }

  return {
    Authorization: makeAuthHeader(ZENDESK_EMAIL, ZENDESK_API_TOKEN),
    'Content-Type': 'application/json'
  }
}

function cf(ticket, id) {
  const field = (ticket.custom_fields || []).find((item) => String(item.id) === String(id))
  const value = field?.value
  if (Array.isArray(value)) return value[0]
  return value ?? ''
}

function asText(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function asNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeStatus(value) {
  const text = asText(value).toLowerCase()
  return text || 'unknown'
}

function normalizePriority(value) {
  const text = asText(value).toLowerCase()
  return text || 'n/a'
}

function buildAgentLink(ticketId) {
  return zendeskAgentTicketLink(ZENDESK_SUBDOMAIN, ticketId)
}

function buildAgeHours(createdAt, now = dayjs()) {
  const created = dayjs(createdAt)
  return created.isValid() ? now.diff(created, 'hour', true) : 0
}

function formatDateTimeParts(dateValue, timeValue) {
  const datePart = asText(dateValue)
  const timePart = asText(timeValue)
  if (!datePart && !timePart) return ''
  return [datePart, timePart].filter(Boolean).join(' ')
}

function firstText(...values) {
  for (const value of values) {
    const text = asText(value)
    if (text) return text
  }
  return ''
}

function sortByAgeDesc(rows) {
  return [...rows].sort((a, b) => (b.ageHours || 0) - (a.ageHours || 0))
}

function buildTicketBase(ticket, now = dayjs()) {
  return {
    id: ticket.id,
    subject: compactText(ticket.subject || '', 160),
    status: normalizeStatus(ticket.status),
    priority: normalizePriority(ticket.priority),
    assigneeId: ticket.assignee_id || null,
    groupId: ticket.group_id || null,
    organizationId: ticket.organization_id || null,
    createdAt: ticket.created_at,
    updatedAt: ticket.updated_at,
    ageHours: buildAgeHours(ticket.created_at, now),
    url: buildAgentLink(ticket.id)
  }
}

function isNldOutage(ticket) {
  const subject = asText(ticket.subject).toUpperCase()
  if (subject.includes('NLD')) return true
  return !!asText(cf(ticket, FIELD_IDS.nld))
}

function buildOutageRow(ticket, now = dayjs()) {
  const base = buildTicketBase(ticket, now)
  const subscriberImpact = asNumber(cf(ticket, FIELD_IDS.subscriberImpact), 0)
  return {
    ...base,
    region: firstText(cf(ticket, FIELD_IDS.region), 'Unknown region'),
    subscriberImpact,
    serviceType: firstText(cf(ticket, FIELD_IDS.serviceType), 'Unknown'),
    outageStatus: firstText(cf(ticket, FIELD_IDS.outageStatus), base.status),
    outageType: firstText(cf(ticket, FIELD_IDS.outageType), 'Unknown'),
    owner: firstText(cf(ticket, FIELD_IDS.outageOwner), 'Unassigned'),
    lastUpdate: firstText(cf(ticket, FIELD_IDS.lastUpdate), ''),
    route: firstText(cf(ticket, FIELD_IDS.nld), ''),
    dfaRef: firstText(cf(ticket, FIELD_IDS.dfaRef), ''),
    liquidRef: firstText(cf(ticket, FIELD_IDS.liquidRef), ''),
    liquidCircuit: firstText(cf(ticket, FIELD_IDS.liquidCircuit), '')
  }
}

function buildBackhaulRow(ticket, now = dayjs()) {
  const base = buildTicketBase(ticket, now)
  return {
    ...base,
    owner: firstText(cf(ticket, FIELD_IDS.backhaulOwner), 'Unassigned'),
    issue: firstText(cf(ticket, FIELD_IDS.backhaulIssue), 'Unknown'),
    sideA: firstText(cf(ticket, FIELD_IDS.backhaulSideA), ''),
    sideB: firstText(cf(ticket, FIELD_IDS.backhaulSideB), ''),
    dfaRef: firstText(cf(ticket, FIELD_IDS.dfaRef), ''),
    dfaCircuit: firstText(cf(ticket, FIELD_IDS.backhaulDfaCircuit), ''),
    liquidRef: firstText(cf(ticket, FIELD_IDS.liquidRef), ''),
    liquidCircuit: firstText(cf(ticket, FIELD_IDS.liquidCircuit), ''),
    vendorLoggedAt: formatDateTimeParts(cf(ticket, FIELD_IDS.vendorLoggedDate), cf(ticket, FIELD_IDS.vendorLoggedTime)),
    impactStart: formatDateTimeParts(cf(ticket, FIELD_IDS.impactStartDate), cf(ticket, FIELD_IDS.impactStartTime)),
    impactStop: formatDateTimeParts(cf(ticket, FIELD_IDS.impactStopDate), cf(ticket, FIELD_IDS.impactStopTime))
  }
}

function dedupeById(rows) {
  return Array.from(new Map(rows.map((row) => [String(row.id), row])).values())
}

async function fetchZendeskExport(query) {
  let nextUrl = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/search/export.json`)
  nextUrl.searchParams.set('query', query)
  nextUrl.searchParams.set('filter[type]', 'ticket')
  nextUrl.searchParams.set('page[size]', '100')

  const headers = makeZendeskHeaders()
  const results = []
  let page = 0

  while (nextUrl && page < MAX_SEARCH_PAGES && results.length < MAX_SEARCH_RESULTS) {
    const data = await fetchJsonWithTimeout(nextUrl.toString(), { headers, timeoutMs: 25000 })
    const batch = Array.isArray(data?.results) ? data.results : []
    results.push(...batch)

    const hasMore = Boolean(data?.meta?.has_more)
    const nextLink = asText(data?.links?.next)
    nextUrl = hasMore && nextLink ? new URL(nextLink) : null
    page += 1
  }

  return results.slice(0, MAX_SEARCH_RESULTS)
}

async function fetchZendeskSkips() {
  const headers = makeZendeskHeaders()
  const baseUrl = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/skips`)
  baseUrl.searchParams.set('sort_order', 'desc')
  baseUrl.searchParams.set('per_page', '100')

  const rows = []
  let nextUrl = baseUrl
  let page = 0

  while (nextUrl && page < 3) {
    const data = await fetchJsonWithTimeout(nextUrl.toString(), { headers, timeoutMs: 25000 })
    const batch = Array.isArray(data?.skips)
      ? data.skips
      : Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : []

    rows.push(...batch)

    const nextPage = asText(data?.next_page)
    nextUrl = nextPage ? new URL(nextPage) : null
    page += 1
  }

  return rows.map((row, index) => {
    const ticketId = row.ticket_id || row.ticket?.id || row.id || null
    return {
      id: row.id || ticketId || `skip-${index + 1}`,
      ticketId,
      reason: firstText(row.reason, row.comment, row.description, 'Skip reason not supplied'),
      createdAt: row.created_at || row.updated_at || null,
      updatedAt: row.updated_at || row.created_at || null,
      status: firstText(row.ticket?.status, ''),
      subject: compactText(firstText(row.ticket?.subject, row.subject, ''), 160),
      skippedBy: firstText(row.user?.name, row.assignee?.name, ''),
      url: ticketId ? buildAgentLink(ticketId) : ''
    }
  })
}

async function fetchTelephonySnapshot() {
  if (!ILLATION_STATS_URL) {
    return {
      available: false,
      reason: 'Telephony snapshot is not configured yet.',
      queues: [],
      agents: []
    }
  }

  const headers = {}
  if (ILLATION_AUTH_HEADER) {
    headers.Authorization = ILLATION_AUTH_HEADER
  } else if (ILLATION_BEARER_TOKEN) {
    headers.Authorization = `Bearer ${ILLATION_BEARER_TOKEN}`
  }

  if (ILLATION_API_KEY) {
    headers['x-api-key'] = ILLATION_API_KEY
  }

  if (!Object.keys(headers).length && !ILLATION_ALLOW_ANON) {
    return {
      available: false,
      reason: 'Telephony snapshot needs auth headers before it can be queried from Ops Hub.',
      queues: [],
      agents: []
    }
  }

  const data = await fetchJsonWithTimeout(ILLATION_STATS_URL, { headers, timeoutMs: 20000 })
  const queueRoot = data?.data?.queues
  const agentRoot = data?.data?.queues?.agents || data?.data?.agents || []

  const queues = Array.isArray(queueRoot)
    ? queueRoot
    : Object.entries(queueRoot || {})
        .filter(([key, value]) => key !== 'agents' && value && typeof value === 'object')
        .map(([key, value]) => ({ key, ...value }))

  const agents = Array.isArray(agentRoot)
    ? agentRoot
    : Object.entries(agentRoot || {}).map(([key, value]) => ({ key, ...value }))

  const normalizedQueues = queues.map((row, index) => ({
    id: row.id || row.key || `queue-${index + 1}`,
    name: firstText(row.name, row.queue_name, row.key, `Queue ${index + 1}`),
    waiting: asNumber(row.waiting ?? row.calls_waiting ?? row.waiting_calls ?? row.queue_waiting, 0),
    active: asNumber(row.active ?? row.in_call ?? row.calls_active ?? row.agents_busy, 0),
    answered: asNumber(row.answered ?? row.calls_answered ?? row.answered_calls, 0),
    missed: asNumber(row.missed ?? row.calls_missed ?? row.missed_calls, 0),
    avgAnswerSeconds: asNumber(row.avg_answer_seconds ?? row.average_answer_time ?? row.avg_answer_time, 0)
  }))

  const normalizedAgents = agents.map((row, index) => ({
    id: row.id || row.extension || row.key || `agent-${index + 1}`,
    name: firstText(row.name, row.agent_name, row.extension, `Agent ${index + 1}`),
    state: firstText(row.state, row.status, 'unknown'),
    queue: firstText(row.queue, row.queue_name, ''),
    activeCalls: asNumber(row.active_calls ?? row.calls_active ?? row.active, 0)
  }))

  return {
    available: true,
    queues: normalizedQueues,
    agents: normalizedAgents
  }
}

function sumSubscriberImpact(rows) {
  return rows.reduce((total, row) => total + asNumber(row.subscriberImpact, 0), 0)
}

function laneSummary(key, label, rows, tone, { agedThresholdHours = 4, impactField = null } = {}) {
  const sorted = sortByAgeDesc(rows)
  const highestAge = sorted[0]?.ageHours || 0
  const agedCount = rows.filter((row) => asNumber(row.ageHours, 0) >= agedThresholdHours).length
  const impactCount = impactField ? rows.reduce((total, row) => total + asNumber(row[impactField], 0), 0) : 0

  return {
    key,
    label,
    tone,
    openCount: rows.length,
    agedCount,
    agedThresholdHours,
    highestAgeHours: Number(highestAge.toFixed(1)),
    impactCount,
    topSubject: sorted[0]?.subject || '',
    topTicketId: sorted[0]?.id || null,
    topUrl: sorted[0]?.url || ''
  }
}

function buildSpotlights({ majorOutages, nldOutages, backhauls, vipTickets, tier2Tickets, skippedTickets, telephony }) {
  const cards = []
  const topMajor = sortByAgeDesc(majorOutages)[0]
  const topNld = [...nldOutages].sort((a, b) => (b.subscriberImpact || 0) - (a.subscriberImpact || 0))[0]
  const topBackhaul = sortByAgeDesc(backhauls)[0]
  const topVip = sortByAgeDesc(vipTickets)[0]
  const topTier2 = sortByAgeDesc(tier2Tickets)[0]
  const topSkip = sortByAgeDesc(skippedTickets.map((row) => ({ ...row, ageHours: buildAgeHours(row.createdAt) })))[0]
  const waitingQueue = [...(telephony?.queues || [])].sort((a, b) => (b.waiting || 0) - (a.waiting || 0))[0]

  if (topMajor) {
    cards.push({
      key: 'major',
      title: 'Major outage spotlight',
      badge: topMajor.region,
      tone: LANE_TONES.major_outage,
      message: `${topMajor.subject || `Ticket #${topMajor.id}`} has been open for ${topMajor.ageHours.toFixed(1)}h with ${topMajor.subscriberImpact} subscribers impacted.`,
      url: topMajor.url
    })
  }

  if (topNld) {
    cards.push({
      key: 'nld',
      title: 'NLD impact spotlight',
      badge: topNld.route || 'NLD',
      tone: LANE_TONES.nld_outage,
      message: `${topNld.subject || `Ticket #${topNld.id}`} is currently the heaviest NLD outage at ${topNld.subscriberImpact} subscribers impacted.`,
      url: topNld.url
    })
  }

  if (topBackhaul) {
    cards.push({
      key: 'backhaul',
      title: 'Backhaul watch',
      badge: topBackhaul.issue || 'Backhaul',
      tone: LANE_TONES.backhaul,
      message: `${topBackhaul.subject || `Ticket #${topBackhaul.id}`} has been open for ${topBackhaul.ageHours.toFixed(1)}h. ${topBackhaul.owner ? `Owner: ${topBackhaul.owner}.` : ''}`.trim(),
      url: topBackhaul.url
    })
  }

  if (topVip) {
    cards.push({
      key: 'vip',
      title: 'VIP watch',
      badge: topVip.sourceLabels?.join(', ') || 'VIP',
      tone: LANE_TONES.vip,
      message: `${topVip.subject || `Ticket #${topVip.id}`} is the oldest live VIP-linked ticket at ${topVip.ageHours.toFixed(1)}h open.`,
      url: topVip.url
    })
  }

  if (topTier2) {
    cards.push({
      key: 'tier2',
      title: 'Tier 2 backlog watch',
      badge: topTier2.status,
      tone: LANE_TONES.tier2,
      message: `${topTier2.subject || `Ticket #${topTier2.id}`} is currently the oldest Tier 2 ticket at ${topTier2.ageHours.toFixed(1)}h open.`,
      url: topTier2.url
    })
  }

  if (topSkip) {
    cards.push({
      key: 'skip',
      title: 'Queue hygiene',
      badge: 'Skipped',
      tone: LANE_TONES.skipped,
      message: `${topSkip.subject || `Ticket #${topSkip.ticketId || topSkip.id}`} is the oldest visible skip item, with reason: ${topSkip.reason}.`,
      url: topSkip.url
    })
  }

  if (waitingQueue) {
    cards.push({
      key: 'telephony',
      title: 'Call queue pressure',
      badge: waitingQueue.name,
      tone: '#059669',
      message: `${waitingQueue.name} currently shows ${waitingQueue.waiting} waiting calls and ${waitingQueue.active} active calls.`,
      url: ''
    })
  }

  return cards.slice(0, 6)
}

async function collectLiveSnapshot() {
  const warnings = []
  const now = dayjs()
  const watcherConfig = await getWhatsappWatcherConfig({ forceFresh: true }).catch(() => null)
  const backhaulTag = watcherConfig?.backhaul?.tag || process.env.BACKHAUL_TAG || 'iris_backhaul_down'
  const vipOrgId = watcherConfig?.vip?.orgId || process.env.VIP_ORG_ID || '42757142385041'
  const vipTagRules = Array.isArray(watcherConfig?.vip?.tagRules) ? watcherConfig.vip.tagRules : []

  async function safe(label, fn, fallback) {
    try {
      return await fn()
    } catch (error) {
      warnings.push({ source: label, message: error?.message || String(error) })
      return fallback
    }
  }

  const rawOutages = await safe(
    'outages',
    () => fetchZendeskExport(`group:${OUTAGE_GROUP_ID} form:"${OUTAGE_FORM_NAME}" status<solved`),
    []
  )
  const outageRows = rawOutages.map((ticket) => buildOutageRow(ticket, now))
  const nldOutages = sortByAgeDesc(outageRows.filter((ticket) => isNldOutage(ticket)))
  const majorOutages = sortByAgeDesc(outageRows.filter((ticket) => !isNldOutage(ticket)))

  const backhaulRows = sortByAgeDesc(
    (await safe(
      'backhaul',
      () => fetchZendeskExport(`form:"NOC Alert Management" type:ticket status<solved tags:"${backhaulTag}"`),
      []
    )).map((ticket) => buildBackhaulRow(ticket, now))
  )

  const vipOrgRows = (await safe(
    'vip-org',
    () => fetchZendeskExport(`type:ticket status<solved organization_id:${vipOrgId}`),
    []
  )).map((ticket) => ({
    ...buildTicketBase(ticket, now),
    sourceLabels: ['VIP Org']
  }))

  const vipRuleRows = []
  for (const rule of vipTagRules) {
    const tag = asText(rule.tag)
    if (!tag) continue

    const tickets = await safe(
      `vip-tag-${tag}`,
      () => fetchZendeskExport(`type:ticket status<solved tags:${tag}`),
      []
    )

    tickets.forEach((ticket) => {
      vipRuleRows.push({
        ...buildTicketBase(ticket, now),
        sourceLabels: [rule.title || tag],
        vipRuleKey: rule.key || tag
      })
    })
  }

  const vipTickets = sortByAgeDesc(
    dedupeById([...vipOrgRows, ...vipRuleRows]).map((row) => {
      const allSources = [
        ...(vipOrgRows.find((item) => String(item.id) === String(row.id))?.sourceLabels || []),
        ...vipRuleRows.filter((item) => String(item.id) === String(row.id)).flatMap((item) => item.sourceLabels || [])
      ]
      return {
        ...row,
        sourceLabels: [...new Set(allSources)].filter(Boolean)
      }
    })
  )

  const tier1Tickets = sortByAgeDesc(
    (await safe(
      'tier1',
      () => fetchZendeskExport(`group:"${TIER1_GROUP_NAME}" form:"${INITIAL_FORM_NAME}" status<solved`),
      []
    )).map((ticket) => buildTicketBase(ticket, now))
  )

  const tier2Tickets = sortByAgeDesc(
    (await safe(
      'tier2',
      () => fetchZendeskExport(`group:"${TIER2_GROUP_NAME}" form:"${INITIAL_FORM_NAME}" status<solved`),
      []
    )).map((ticket) => buildTicketBase(ticket, now))
  )

  const tier2NewUnassigned = (await safe(
    'tier2-unassigned',
    () => fetchZendeskExport(`assignee:none status:new tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}"`),
    []
  )).length

  const skippedTickets = sortByAgeDesc(
    (await safe('skips', () => fetchZendeskSkips(), [])).map((row) => ({
      ...row,
      ageHours: buildAgeHours(row.createdAt, now)
    }))
  )

  const telephony = await safe('telephony', () => fetchTelephonySnapshot(), {
    available: false,
    reason: 'Telephony snapshot unavailable.',
    queues: [],
    agents: []
  })

  const lanes = [
    laneSummary('major_outage', 'Major outages', majorOutages, LANE_TONES.major_outage, { agedThresholdHours: 2, impactField: 'subscriberImpact' }),
    laneSummary('nld_outage', 'NLD outages', nldOutages, LANE_TONES.nld_outage, { agedThresholdHours: 4, impactField: 'subscriberImpact' }),
    laneSummary('backhaul', 'Backhauls', backhaulRows, LANE_TONES.backhaul, { agedThresholdHours: 4 }),
    laneSummary('vip', 'VIP', vipTickets, LANE_TONES.vip, { agedThresholdHours: 2 }),
    laneSummary('tier1', 'Tier 1', tier1Tickets, LANE_TONES.tier1, { agedThresholdHours: 8 }),
    laneSummary('tier2', 'Tier 2', tier2Tickets, LANE_TONES.tier2, { agedThresholdHours: 8 }),
    laneSummary('skipped', 'Skipped', skippedTickets, LANE_TONES.skipped, { agedThresholdHours: 24 })
  ]

  const summary = {
    majorOutageOpen: majorOutages.length,
    majorOutageSubscribers: sumSubscriberImpact(majorOutages),
    nldOutageOpen: nldOutages.length,
    nldOutageSubscribers: sumSubscriberImpact(nldOutages),
    backhaulOpen: backhaulRows.length,
    vipOpen: vipTickets.length,
    tier1Open: tier1Tickets.length,
    tier2Open: tier2Tickets.length,
    tier2NewUnassigned,
    skippedCount: skippedTickets.length,
    telephonyWaiting: telephony.available ? telephony.queues.reduce((total, row) => total + asNumber(row.waiting, 0), 0) : null,
    telephonyQueues: telephony.available ? telephony.queues.length : 0
  }

  return {
    generatedAt: now.toISOString(),
    source: 'zendesk_cached_snapshot',
    staleAfterMs: SOFT_TTL_MS,
    warnings,
    summary,
    lanes,
    spotlights: buildSpotlights({
      majorOutages,
      nldOutages,
      backhauls: backhaulRows,
      vipTickets,
      tier2Tickets,
      skippedTickets,
      telephony
    }),
    collections: {
      majorOutages: majorOutages.slice(0, 200),
      nldOutages: nldOutages.slice(0, 200),
      backhauls: backhaulRows.slice(0, 200),
      vipTickets: vipTickets.slice(0, 200),
      tier1Tickets: tier1Tickets.slice(0, 200),
      tier2Tickets: tier2Tickets.slice(0, 200),
      skippedTickets: skippedTickets.slice(0, 200),
      telephonyQueues: (telephony.queues || []).slice(0, 100),
      telephonyAgents: (telephony.agents || []).slice(0, 100),
      telephonyMeta: {
        available: !!telephony.available,
        reason: telephony.reason || ''
      }
    }
  }
}

async function readStoredSnapshot() {
  const row = await prisma.automationSetting.findUnique({ where: { key: SNAPSHOT_KEY } })
  return row?.value && typeof row.value === 'object' ? row.value : null
}

function getFreshness(snapshot) {
  if (!snapshot?.generatedAt) {
    return {
      hasSnapshot: false,
      ageMs: null,
      stale: true,
      hardStale: true,
      staleAfterMs: SOFT_TTL_MS
    }
  }

  const ageMs = Math.max(0, Date.now() - Date.parse(snapshot.generatedAt))
  return {
    hasSnapshot: true,
    ageMs,
    stale: ageMs > SOFT_TTL_MS,
    hardStale: ageMs > HARD_STALE_MS,
    staleAfterMs: SOFT_TTL_MS
  }
}

export async function refreshNocMonitoringSnapshot(requestedBy = 'system') {
  if (refreshPromise) return refreshPromise

  refreshPromise = (async () => {
    const snapshot = await collectLiveSnapshot()
    await prisma.automationSetting.upsert({
      where: { key: SNAPSHOT_KEY },
      update: {
        value: snapshot,
        updatedBy: asText(requestedBy) || 'system'
      },
      create: {
        key: SNAPSHOT_KEY,
        value: snapshot,
        updatedBy: asText(requestedBy) || 'system'
      }
    })

    return {
      snapshot,
      freshness: getFreshness(snapshot)
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export async function getNocMonitoringSnapshot({ autoRefresh = true } = {}) {
  const snapshot = await readStoredSnapshot()
  const freshness = getFreshness(snapshot)

  if (!snapshot) {
    return refreshNocMonitoringSnapshot('bootstrap')
  }

  if (autoRefresh && freshness.stale && !refreshPromise) {
    void refreshNocMonitoringSnapshot('background-refresh').catch(() => {})
  }

  return {
    snapshot,
    freshness
  }
}

export function getNocMonitoringConfigMeta() {
  return {
    snapshotKey: SNAPSHOT_KEY,
    staleAfterMs: SOFT_TTL_MS,
    hardStaleMs: HARD_STALE_MS,
    dashboardNote: 'This dashboard reads from a cached backend snapshot so the browser stays light and Zendesk does not get hammered by repeated live panel queries.',
    telephonyConfigured: Boolean(ILLATION_STATS_URL),
    telephonyAuthConfigured: Boolean(ILLATION_AUTH_HEADER || ILLATION_BEARER_TOKEN || ILLATION_API_KEY || ILLATION_ALLOW_ANON)
  }
}
