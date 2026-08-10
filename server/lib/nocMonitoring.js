import dayjs from 'dayjs'
import prisma from './prisma.js'
import { fetchJsonWithTimeout, makeAuthHeader, zendeskAgentTicketLink, compactText } from './watcherUtils.js'
import { getWhatsappWatcherConfig } from './whatsappWatcherConfig.js'
import {
  buildOutageRouteIndex,
  findPartialClusters,
  findPartialNotLogged,
  normalizeRoute,
  transformPartialNldAlerts
} from './nldEventUtils.js'

const SNAPSHOT_KEY = 'noc_monitoring_snapshot_v1'
const SOFT_TTL_MS = Number(process.env.NOC_MONITORING_SNAPSHOT_TTL_MS || 15 * 60 * 1000)
const HARD_STALE_MS = Number(process.env.NOC_MONITORING_HARD_STALE_MS || 6 * 60 * 60 * 1000)
const HISTORY_BUCKET_MINUTES = Math.max(5, Number(process.env.NOC_MONITORING_HISTORY_BUCKET_MINUTES || 15))
const HISTORY_WINDOW_HOURS = Math.max(6, Number(process.env.NOC_MONITORING_HISTORY_WINDOW_HOURS || 72))
const HISTORY_RETENTION_DAYS = Math.max(7, Number(process.env.NOC_MONITORING_HISTORY_RETENTION_DAYS || 45))
const MAX_SEARCH_PAGES = Number(process.env.NOC_MONITORING_MAX_SEARCH_PAGES || 8)
const MAX_SEARCH_RESULTS = Number(process.env.NOC_MONITORING_MAX_SEARCH_RESULTS || 2500)
const OUTAGE_GROUP_ID = String(process.env.OUTAGE_WATCHER_GROUP_ID || '5160847905297').trim()
const OUTAGE_FORM_NAME = String(process.env.OUTAGE_WATCHER_FORM_NAME || 'Outage Capturing').trim()
const INITIAL_FORM_NAME = String(process.env.NOC_MONITORING_INITIAL_FORM_NAME || 'Frogfoot Initial Form').trim()
const TIER1_GROUP_NAME = String(process.env.NOC_MONITORING_T1_GROUP || 'NOC Tier1 Support').trim()
const TIER2_GROUP_NAME = String(process.env.NOC_MONITORING_T2_GROUP || 'NOC Tier2 Support').trim()
const TIER1_VOICE_QUEUE_NAME = String(process.env.NOC_MONITORING_T1_VOICE_QUEUE || 'NOCTier1_Queue').trim()
const TIER1_P1_SLA_MINUTES = Math.max(5, Number(process.env.NOC_MONITORING_T1_P1_SLA_MINUTES || 30))
const TIER1_VOICE_SLA_SECONDS = Math.max(5, Number(process.env.NOC_MONITORING_T1_VOICE_SLA_SECONDS || 20))
const TIER1_CHANGE_CONTROL_TAG = String(process.env.NOC_MONITORING_T1_CHANGE_CONTROL_TAG || 'noc_change_checks').trim().toLowerCase()
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

const MONITORING_TIMEZONE = String(process.env.NOC_MONITORING_TIMEZONE || 'Africa/Johannesburg').trim()
const TICKET_PRODUCT_TAGS = {
  FTTB: ['t2_fttb'],
  FTTH: ['t2_ftth', 'ff_air', 'dstv', 'rise']
}
const T2_PARTY_TAG_RULES = [
  { label: 'DFA', tags: ['noc_t2-dfa_escalation'] },
  { label: 'Liquid', tags: ['noc_t2-liquid_escalation'] },
  { label: 'LA', tags: ['noc_t2-link_africa'] },
  { label: 'CCC', tags: ['noc_t2-ccc'] },
  { label: 'Linked to Outage', tags: ['noc_t2-outage_linked', 'noc_outages_escalation_clone'] },
  { label: 'MNT', tags: ['maintenance_escalation_clone'] },
  { label: 'Tier 3', tags: ['noc_t3_escalation'] },
  { label: 'PMT', tags: ['noc_t2-pmt_escalation'] },
  { label: 'DD', tags: ['noc_t2-dimension_data_escalation'] },
  { label: 'Wiocc', tags: ['noc_t2-wiocc_escalation'] },
  { label: 'Faircom', tags: ['noc_t2-faircom/faircape_escalation'] },
  { label: 'WAN', tags: ['noc_t2-waterfall_access_node_escalation'] },
  { label: 'Comsol', tags: ['noc_t2-comsol_escalation'] },
  { label: 'Seacom', tags: ['noc_t2-seacom_escalation'] },
  { label: 'FCC', tags: ['noc_t2-fcc_escalation'] },
  { label: 'CMC', tags: ['noc_t2-cmc_escalation'] }
]
const OUTAGE_PRIORITY_DEFS = [
  { key: 'new_unassigned', label: 'New / unattended', tone: '#334155' },
  { key: 'p1', label: 'P1 alerts', tone: '#dc2626' },
  { key: 'p2', label: 'P2 alerts', tone: '#ea580c' },
  { key: 'p3', label: 'P3 / southbound', tone: '#d97706' },
  { key: 'p4', label: 'P4 alerts', tone: '#2563eb' },
  { key: 'power', label: 'Power alerts', tone: '#7c3aed' }
]
const T1_ACTION_DEFS = [
  { key: 'P1', label: 'P1 new / unattended', tone: '#dc2626' },
  { key: 'P2', label: 'P2 ISP waiting', tone: '#ea580c' },
  { key: 'P3', label: 'P3 FTTB vendor update', tone: '#d97706' },
  { key: 'P4', label: 'P4 FTTH MNT update', tone: '#2563eb' },
  { key: 'Change', label: 'Change control', tone: '#8b5cf6' },
  { key: 'Other', label: 'Other / uncategorised', tone: '#475569' }
]
const T1_DUE_BUCKET_ORDER = ['BREACHED', 'Due <=2h', 'Due <=4h', 'Due 4-8h', 'Due 8-24h', 'Safe >24h', 'Change control', 'Other/No SLA']
const T1_DUE_BUCKET_TONES = {
  BREACHED: '#dc2626',
  'Due <=2h': '#ea580c',
  'Due <=4h': '#f97316',
  'Due 4-8h': '#d97706',
  'Due 8-24h': '#0284c7',
  'Safe >24h': '#0f766e',
  'Change control': '#8b5cf6',
  'Other/No SLA': '#64748b'
}
const AGE_BUCKET_DEFS = [
  { key: '<=2h', label: '<=2h', maxHours: 2, tone: '#22c55e' },
  { key: '2-4h', label: '2-4h', minHours: 2, maxHours: 4, tone: '#84cc16' },
  { key: '4-8h', label: '4-8h', minHours: 4, maxHours: 8, tone: '#eab308' },
  { key: '8-24h', label: '8-24h', minHours: 8, maxHours: 24, tone: '#f97316' },
  { key: '24-48h', label: '24-48h', minHours: 24, maxHours: 48, tone: '#ef4444' },
  { key: '>48h', label: '>48h', minHours: 48, tone: '#991b1b' }
]
const T1_STATUS_TONES = {
  new: '#dc2626',
  open: '#0ea5e9',
  pending: '#f97316',
  hold: '#8b5cf6',
  solved: '#16a34a',
  closed: '#475569',
  unknown: '#64748b'
}
const T1_AUTOMATION_ROUTE_RULES = [
  { key: 'outageLinked', label: 'Outage linked', tags: ['noc_outages_escalation_clone', 'noc_t2-outage_linked'], tone: '#f97316' },
  { key: 'mnt', label: 'MNT', tags: ['maintenance_escalation_clone'], tone: '#2563eb' },
  { key: 'dfa', label: 'DFA', tags: ['noc_t2-dfa_escalation'], tone: '#14b8a6' },
  { key: 'liquid', label: 'Liquid', tags: ['noc_t2-liquid_escalation'], tone: '#7c3aed' },
  { key: 'tier3', label: 'Tier 3', tags: ['noc_t3_escalation'], tone: '#334155' },
  { key: 'pmt', label: 'PMT', tags: ['noc_t2-pmt_escalation'], tone: '#0891b2' }
]

let refreshPromise = null

function formatYmdInTz(date = new Date(), timeZone = MONITORING_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value || '0000'
  const month = parts.find((part) => part.type === 'month')?.value || '01'
  const day = parts.find((part) => part.type === 'day')?.value || '01'
  return `${year}-${month}-${day}`
}

function hourKeyInTz(value, timeZone = MONITORING_TIMEZONE) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    hour12: false
  }).formatToParts(date)
  return parts.find((part) => part.type === 'hour')?.value || null
}

function tagSet(ticket) {
  return new Set(Array.isArray(ticket?.tags) ? ticket.tags.map((tag) => String(tag).toLowerCase()) : [])
}

function hasAnyTag(ticket, tags) {
  const present = tagSet(ticket)
  return tags.some((tag) => present.has(String(tag).toLowerCase()))
}

function tagMatches(ticket, fragment) {
  const needle = String(fragment || '').trim().toLowerCase()
  if (!needle) return false
  return Array.from(tagSet(ticket)).some((tag) => tag.includes(needle))
}

function classifyTicketProduct(ticket) {
  if (hasAnyTag(ticket, TICKET_PRODUCT_TAGS.FTTB)) return 'FTTB'
  if (hasAnyTag(ticket, TICKET_PRODUCT_TAGS.FTTH)) return 'FTTH'
  return 'Other'
}

function isChangeControlTicket(ticket) {
  return hasAnyTag(ticket, [TIER1_CHANGE_CONTROL_TAG])
}

function classifyT1ActionLevel(ticket) {
  if (hasAnyTag(ticket, ['play_p1'])) return 'P1'
  if (hasAnyTag(ticket, ['play_p2'])) return 'P2'
  if (hasAnyTag(ticket, ['play_p3'])) return 'P3'
  if (hasAnyTag(ticket, ['play_p4', 'isp_frac_auto'])) return 'P4'
  if (isChangeControlTicket(ticket)) return 'Change'
  return 'Other'
}

function classifyT1OperationalState(ticket, pLevel, status) {
  const normalizedStatus = normalizeStatus(status || ticket?.status)
  if (pLevel === 'P1') return normalizedStatus === 'new' ? 'New / unattended' : 'P1 in progress'
  if (pLevel === 'P2') return 'ISP follow-up'
  if (pLevel === 'P3') return 'Vendor update'
  if (pLevel === 'P4') return 'MNT / automation'
  if (pLevel === 'Change') return 'Change control'
  if (normalizedStatus === 'pending') return 'Pending'
  if (normalizedStatus === 'open') return 'In progress'
  return 'Other'
}

function classifyT1AutomationRoutes(ticket) {
  return T1_AUTOMATION_ROUTE_RULES.filter((rule) => hasAnyTag(ticket, rule.tags))
}

function summarizeRuleHits(rows, rules, accessor = (row) => row) {
  return rules.map((rule) => ({
    key: rule.key,
    label: rule.label,
    tone: rule.tone,
    count: rows.filter((row) => hasAnyTag(accessor(row), rule.tags)).length
  }))
}

function classifyT2Party(ticket) {
  for (const rule of T2_PARTY_TAG_RULES) {
    if (hasAnyTag(ticket, rule.tags)) return rule.label
  }
  return 'with T2'
}

function classifyOutagePriority(ticket) {
  if (normalizeStatus(ticket.status) === 'new' && !ticket.assignee_id) return 'new_unassigned'
  if (hasAnyTag(ticket, ['temp_alert', 'network_alert']) && hasAnyTag(ticket, ['nam_priority_p1'])) return 'p1'
  if (hasAnyTag(ticket, ['network_alert']) && hasAnyTag(ticket, ['nam_priority_p2'])) return 'p2'
  if (hasAnyTag(ticket, ['soutbound_alert', 'network_alert']) && hasAnyTag(ticket, ['nam_priority_p3'])) return 'p3'
  if (hasAnyTag(ticket, ['network_alert']) && hasAnyTag(ticket, ['nam_priority_p4'])) return 'p4'
  if (hasAnyTag(ticket, ['power_alert'])) return 'power'
  return ''
}

function t1SlaHoursForProduct(product) {
  if (product === 'FTTB') return 24
  if (product === 'FTTH') return 48
  return 0
}

function classifyDueBucket(remainingHours, slaHours, pLevel) {
  if (pLevel === 'Change') return 'Change control'
  if (!slaHours) return 'Other/No SLA'
  if (remainingHours <= 0) return 'BREACHED'
  if (remainingHours <= 2) return 'Due <=2h'
  if (remainingHours <= 4) return 'Due <=4h'
  if (remainingHours <= 8) return 'Due 4-8h'
  if (remainingHours <= 24) return 'Due 8-24h'
  return 'Safe >24h'
}

function buildT1ActionRow(ticket, now = dayjs()) {
  const base = buildTicketBase(ticket, now)
  const product = classifyTicketProduct(ticket)
  const pLevel = classifyT1ActionLevel(ticket)
  const slaHours = t1SlaHoursForProduct(product)
  const remainingHours = slaHours ? Number((slaHours - base.ageHours).toFixed(1)) : null
  const automationRoutes = classifyT1AutomationRoutes(ticket)
  const status = normalizeStatus(ticket.status)
  const p1ActionBreached = pLevel === 'P1' && status === 'new' && base.ageHours >= (TIER1_P1_SLA_MINUTES / 60)

  return {
    ...base,
    product,
    pLevel,
    operationalState: classifyT1OperationalState(ticket, pLevel, status),
    serviceType: firstText(cf(ticket, FIELD_IDS.serviceType), 'Unknown'),
    slaHours,
    remainingHours,
    dueBucket: classifyDueBucket(remainingHours ?? null, slaHours, pLevel),
    automationRoutes: automationRoutes.map((rule) => rule.label),
    automationRouteCount: automationRoutes.length,
    p1ActionBreached,
    p1ActionTargetMinutes: TIER1_P1_SLA_MINUTES,
    subject: compactText(ticket.subject || '', 160)
  }
}

function buildT2TicketRow(ticket, now = dayjs()) {
  const base = buildTicketBase(ticket, now)
  return {
    ...base,
    product: classifyTicketProduct(ticket),
    serviceType: firstText(cf(ticket, FIELD_IDS.serviceType), 'Unknown'),
    party: classifyT2Party(ticket),
    handover: hasAnyTag(ticket, ['handover_ticket_macro'])
  }
}

function buildHourlyTicketSeries(rows, stampField, labelPrefix = '') {
  const buckets = new Map(Array.from({ length: 24 }, (_, hour) => [String(hour).padStart(2, '0'), 0]))
  rows.forEach((row) => {
    const hourKey = hourKeyInTz(row?.[stampField])
    if (hourKey && buckets.has(hourKey)) {
      buckets.set(hourKey, buckets.get(hourKey) + 1)
    }
  })

  let cumulative = 0
  return Array.from(buckets.entries()).map(([hour, count]) => {
    cumulative += count
    return {
      hour,
      label: `${labelPrefix}${hour}:00`,
      count,
      cumulative
    }
  })
}

function mergeHourlySeriesByKey(seriesConfig, valueField = 'cumulative') {
  if (!Array.isArray(seriesConfig) || !seriesConfig.length) return []
  const template = seriesConfig[0]?.rows || []
  return template.map((row, index) => {
    const merged = {
      hour: row.hour,
      label: row.label
    }
    for (const config of seriesConfig) {
      merged[config.key] = asNumber(config.rows?.[index]?.[valueField], 0)
    }
    return merged
  })
}

function summarizeRowsByKey(rows, keyField, toneMap = {}, { sortDesc = true } = {}) {
  const map = new Map()
  rows.forEach((row) => {
    const key = firstText(row?.[keyField], 'Unknown')
    const current = map.get(key) || { key, label: key, count: 0, tone: toneMap[key] || '#0f766e' }
    current.count += 1
    map.set(key, current)
  })

  const values = Array.from(map.values())
  values.sort((left, right) => sortDesc ? right.count - left.count : left.count - right.count)
  return values
}

function summarizeTotalsByKey(rows, keyField, valueField, toneMap = {}, { sortDesc = true } = {}) {
  const map = new Map()
  rows.forEach((row) => {
    const key = firstText(row?.[keyField], 'Unknown')
    const current = map.get(key) || {
      key,
      label: key,
      count: 0,
      rowCount: 0,
      tone: toneMap[key] || '#0f766e'
    }
    current.count += asNumber(row?.[valueField], 0)
    current.rowCount += 1
    map.set(key, current)
  })

  const values = Array.from(map.values())
  values.sort((left, right) => sortDesc ? right.count - left.count : left.count - right.count)
  return values
}

function summarizeAgeBuckets(rows, field = 'ageHours', defs = AGE_BUCKET_DEFS) {
  return defs.map((definition) => {
    const count = rows.filter((row) => {
      const value = asNumber(row?.[field], 0)
      if (definition.minHours !== undefined && value < definition.minHours) return false
      if (definition.maxHours !== undefined && value > definition.maxHours) return false
      return true
    }).length

    return {
      key: definition.key,
      label: definition.label,
      tone: definition.tone,
      count
    }
  })
}

function buildTicketTimelineMeta(now = dayjs()) {
  const dayKey = formatYmdInTz(now.toDate())
  return {
    timezone: MONITORING_TIMEZONE,
    dayKey
  }
}

function buildDayWindowQuery(field, dayKey) {
  return `${field}>=${dayKey}T00:00:00Z ${field}<=${dayKey}T23:59:59Z`
}

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

async function fetchPartialNldAlertsRaw() {
  return fetchZendeskExport(
    'type:ticket tags:iris_partial_nld created>=30daysago -tags:"partial_nld_alert_duplicate_solved"'
  )
}

async function fetchTelephonySnapshot() {
  if (!ILLATION_STATS_URL) {
    return {
      available: false,
      reason: 'Telephony snapshot is not configured yet.',
      queues: [],
      agents: [],
      hourly: [],
      summary: null
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
      agents: [],
      hourly: [],
      summary: null
    }
  }

  const data = await fetchJsonWithTimeout(ILLATION_STATS_URL, { headers, timeoutMs: 20000 })
  const root = data?.data || {}
  const queueRoot = root.queues
  const topLevelAgents = root.agents || []
  const hourlyRoot = Array.isArray(root.hourly) ? root.hourly : []

  const queues = Array.isArray(queueRoot)
    ? queueRoot
    : Object.entries(queueRoot || {})
        .filter(([key, value]) => key !== 'agents' && value && typeof value === 'object')
        .map(([key, value]) => ({ key, ...value }))

  const flattenedQueueAgents = Array.isArray(queues)
    ? queues.flatMap((queue) => (Array.isArray(queue.agents) ? queue.agents.map((agent) => ({ queue_name: queue.queue_name || queue.name || queue.key || '', ...agent })) : []))
    : []

  const agents = Array.isArray(topLevelAgents)
    ? topLevelAgents
    : Object.entries(topLevelAgents || {}).map(([key, value]) => ({ key, ...value }))

  const normalizedQueues = queues.map((row, index) => ({
    id: row.id || row.key || `queue-${index + 1}`,
    name: firstText(row.name, row.queue_name, row.key, `Queue ${index + 1}`),
    waiting: asNumber(row.waiting ?? row.calls_waiting ?? row.waiting_calls ?? row.queue_waiting, 0),
    active: asNumber(row.active ?? row.in_call ?? row.calls_active ?? row.agents_busy, 0),
    answered: asNumber(row.answered ?? row.calls_answered ?? row.answered_calls, 0),
    missed: asNumber(row.missed ?? row.calls_missed ?? row.missed_calls, 0),
    avgAnswerSeconds: asNumber(row.avg_answer_seconds ?? row.average_answer_time ?? row.avg_answer_time, 0),
    avgTalkSeconds: asNumber(row.avg_talk_time, 0),
    maxQueueSeconds: asNumber(row.max_queue_seconds ?? row.max_time_caller_in_queue ?? row.longest_wait_seconds, 0),
    sla: asNumber(row.sla, 0),
    totalCalls: asNumber(row.total_calls, 0),
    registeredAgents: asNumber(row.registered_agents, 0),
    waitingAgents: asNumber(row.waiting_agents, 0)
  }))

  const agentSource = flattenedQueueAgents.length ? flattenedQueueAgents : agents
  const normalizedAgents = agentSource.map((row, index) => ({
    id: row.id || row.extension || row.key || `agent-${index + 1}`,
    name: firstText(row.name, row.agent_name, row.extension, `Agent ${index + 1}`),
    state: firstText(row.state, row.status, 'unknown'),
    queue: firstText(row.queue, row.queue_name, ''),
    activeCalls: asNumber(row.active_calls ?? row.calls_active ?? row.active, 0),
    loggedIn: Boolean(row.logged_in),
    registered: Boolean(row.registered),
    inboundCalls: asNumber(row.inbound_calls, 0),
    missedCalls: asNumber(row.missed_calls, 0),
    timeInState: firstText(row.time_in_state, '')
  }))

  const normalizedHourly = hourlyRoot.map((row, index) => ({
    id: row.hour || `hour-${index + 1}`,
    hour: firstText(row.hour, String(index).padStart(2, '0')),
    received: asNumber(row.received, 0),
    abandoned: asNumber(row.abandoned, 0),
    avgTalkSeconds: asNumber(row.aht ?? row.avg_talk_time, 0)
  }))

  return {
    available: true,
    queues: normalizedQueues,
    agents: normalizedAgents,
    hourly: normalizedHourly,
    summary: {
      avgTalkSeconds: asNumber(root.avg_talk_time, 0),
      avgAnswerSeconds: asNumber(root.avg_answer_time, 0),
      avgAbandonSeconds: asNumber(root.avg_abandon_time, 0),
      abandonRate: asNumber(root.abandon_rate, 0),
      callsAnswered: asNumber(root.calls_answered, 0),
      callsMissed: asNumber(root.calls_missed, 0),
      callsWaiting: asNumber(root.calls_waiting, 0),
      customerCallCount: asNumber(root.customer_call_count, 0),
      maxQueueSeconds: asNumber(root.max_time_caller_in_queue, 0)
    }
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

function clampHistoryHours(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return HISTORY_WINDOW_HOURS
  return Math.min(24 * 14, Math.max(6, Math.round(parsed)))
}

function floorToHistoryBucket(dateValue) {
  const date = new Date(dateValue || Date.now())
  if (Number.isNaN(date.getTime())) return new Date()
  const bucketMs = HISTORY_BUCKET_MINUTES * 60 * 1000
  return new Date(Math.floor(date.getTime() / bucketMs) * bucketMs)
}

function formatHistoryLabel(dateValue) {
  const stamp = dayjs(dateValue)
  return stamp.isValid() ? stamp.format('DD MMM HH:mm') : '--'
}

function buildHistoryPayload(snapshot) {
  return {
    generatedAt: snapshot?.generatedAt || new Date().toISOString(),
    summary: snapshot?.summary || {},
    lanes: Array.isArray(snapshot?.lanes)
      ? snapshot.lanes.map((row) => ({
          key: row.key,
          label: row.label,
          openCount: asNumber(row.openCount, 0),
          agedCount: asNumber(row.agedCount, 0),
          impactCount: asNumber(row.impactCount, 0),
          highestAgeHours: asNumber(row.highestAgeHours, 0),
          tone: row.tone || ''
        }))
      : [],
    outagePrioritySummary: Array.isArray(snapshot?.trends?.outagePrioritySummary) ? snapshot.trends.outagePrioritySummary : [],
    t1ActionSummary: Array.isArray(snapshot?.trends?.t1ActionSummary) ? snapshot.trends.t1ActionSummary : [],
    t1DueBucketSummary: Array.isArray(snapshot?.trends?.t1DueBucketSummary) ? snapshot.trends.t1DueBucketSummary : [],
    t1ProductSummary: Array.isArray(snapshot?.trends?.t1ProductSummary) ? snapshot.trends.t1ProductSummary : [],
    t2AgeBucketSummary: Array.isArray(snapshot?.trends?.t2AgeBucketSummary) ? snapshot.trends.t2AgeBucketSummary : [],
    t2PartySummary: Array.isArray(snapshot?.trends?.t2PartySummary) ? snapshot.trends.t2PartySummary.slice(0, 12) : [],
    t2ProductSummary: Array.isArray(snapshot?.trends?.t2ProductSummary) ? snapshot.trends.t2ProductSummary : [],
    t2ServiceTypeSummary: Array.isArray(snapshot?.trends?.t2ServiceTypeSummary) ? snapshot.trends.t2ServiceTypeSummary.slice(0, 12) : [],
    outageRegionImpactSummary: Array.isArray(snapshot?.trends?.outageRegionImpactSummary) ? snapshot.trends.outageRegionImpactSummary.slice(0, 12) : [],
    outageServiceTypeSummary: Array.isArray(snapshot?.trends?.outageServiceTypeSummary) ? snapshot.trends.outageServiceTypeSummary.slice(0, 12) : [],
    backhaulOwnerSummary: Array.isArray(snapshot?.trends?.backhaulOwnerSummary) ? snapshot.trends.backhaulOwnerSummary.slice(0, 12) : [],
    partialRouteSummary: Array.isArray(snapshot?.trends?.partialRouteSummary) ? snapshot.trends.partialRouteSummary.slice(0, 12) : [],
    tier1VoiceQueue: snapshot?.collections?.tier1VoiceQueue || null,
    telephonyMeta: snapshot?.collections?.telephonyMeta || null
  }
}

function buildHistoryRowInput(snapshot, requestedBy = 'system') {
  const capturedAt = new Date(snapshot?.generatedAt || Date.now())
  const bucketStart = floorToHistoryBucket(capturedAt)
  const summary = snapshot?.summary || {}

  return {
    bucketKey: bucketStart.toISOString(),
    bucketStart,
    capturedAt,
    requestedBy: asText(requestedBy) || 'system',
    totalLiveTickets: asNumber(summary.majorOutageOpen, 0) + asNumber(summary.nldOutageOpen, 0) + asNumber(summary.backhaulOpen, 0) + asNumber(summary.vipOpen, 0) + asNumber(summary.tier1Open, 0) + asNumber(summary.tier2Open, 0),
    majorOutageOpen: asNumber(summary.majorOutageOpen, 0),
    majorOutageSubscribers: asNumber(summary.majorOutageSubscribers, 0),
    nldOutageOpen: asNumber(summary.nldOutageOpen, 0),
    nldOutageSubscribers: asNumber(summary.nldOutageSubscribers, 0),
    backhaulOpen: asNumber(summary.backhaulOpen, 0),
    vipOpen: asNumber(summary.vipOpen, 0),
    tier1Open: asNumber(summary.tier1Open, 0),
    tier1UrgentOpen: Array.isArray(snapshot?.collections?.tier1UrgentTickets) ? snapshot.collections.tier1UrgentTickets.length : 0,
    tier2Open: asNumber(summary.tier2Open, 0),
    tier2NewUnassigned: asNumber(summary.tier2NewUnassigned, 0),
    tier2HandoverOpen: asNumber(summary.t2HandoverOpen, 0),
    outageNewUnassigned: asNumber(summary.outageNewUnassigned, 0),
    outageP1: asNumber(summary.outageP1, 0),
    outageP2: asNumber(summary.outageP2, 0),
    outageP3: asNumber(summary.outageP3, 0),
    outageP4: asNumber(summary.outageP4, 0),
    outagePower: asNumber(summary.outagePower, 0),
    nldPartialEventCount: asNumber(summary.nldPartialEventCount, 0),
    nldPartialClusterCount: asNumber(summary.nldPartialClusterCount, 0),
    nldPartialNotLoggedCount: asNumber(summary.nldPartialNotLoggedCount, 0),
    skippedCount: asNumber(summary.skippedCount, 0),
    telephonyQueues: asNumber(summary.telephonyQueues, 0),
    telephonyWaiting: summary.telephonyWaiting === null || summary.telephonyWaiting === undefined ? null : asNumber(summary.telephonyWaiting, 0),
    telephonyAnswered: summary.telephonyAnswered === null || summary.telephonyAnswered === undefined ? null : asNumber(summary.telephonyAnswered, 0),
    telephonyMissed: summary.telephonyMissed === null || summary.telephonyMissed === undefined ? null : asNumber(summary.telephonyMissed, 0),
    telephonyAbandonRate: summary.telephonyAbandonRate === null || summary.telephonyAbandonRate === undefined ? null : asNumber(summary.telephonyAbandonRate, 0),
    telephonyAvgAnswerSeconds: summary.telephonyAvgAnswerSeconds === null || summary.telephonyAvgAnswerSeconds === undefined ? null : asNumber(summary.telephonyAvgAnswerSeconds, 0),
    payload: buildHistoryPayload(snapshot)
  }
}

async function persistHistorySnapshot(snapshot, requestedBy = 'system') {
  const historyRow = buildHistoryRowInput(snapshot, requestedBy)
  const retentionCutoff = dayjs().subtract(HISTORY_RETENTION_DAYS, 'day').toDate()

  await prisma.nocMonitoringSnapshotHistory.upsert({
    where: { bucketKey: historyRow.bucketKey },
    update: {
      bucketStart: historyRow.bucketStart,
      capturedAt: historyRow.capturedAt,
      requestedBy: historyRow.requestedBy,
      totalLiveTickets: historyRow.totalLiveTickets,
      majorOutageOpen: historyRow.majorOutageOpen,
      majorOutageSubscribers: historyRow.majorOutageSubscribers,
      nldOutageOpen: historyRow.nldOutageOpen,
      nldOutageSubscribers: historyRow.nldOutageSubscribers,
      backhaulOpen: historyRow.backhaulOpen,
      vipOpen: historyRow.vipOpen,
      tier1Open: historyRow.tier1Open,
      tier1UrgentOpen: historyRow.tier1UrgentOpen,
      tier2Open: historyRow.tier2Open,
      tier2NewUnassigned: historyRow.tier2NewUnassigned,
      tier2HandoverOpen: historyRow.tier2HandoverOpen,
      outageNewUnassigned: historyRow.outageNewUnassigned,
      outageP1: historyRow.outageP1,
      outageP2: historyRow.outageP2,
      outageP3: historyRow.outageP3,
      outageP4: historyRow.outageP4,
      outagePower: historyRow.outagePower,
      nldPartialEventCount: historyRow.nldPartialEventCount,
      nldPartialClusterCount: historyRow.nldPartialClusterCount,
      nldPartialNotLoggedCount: historyRow.nldPartialNotLoggedCount,
      skippedCount: historyRow.skippedCount,
      telephonyQueues: historyRow.telephonyQueues,
      telephonyWaiting: historyRow.telephonyWaiting,
      telephonyAnswered: historyRow.telephonyAnswered,
      telephonyMissed: historyRow.telephonyMissed,
      telephonyAbandonRate: historyRow.telephonyAbandonRate,
      telephonyAvgAnswerSeconds: historyRow.telephonyAvgAnswerSeconds,
      payload: historyRow.payload
    },
    create: historyRow
  })

  await prisma.nocMonitoringSnapshotHistory.deleteMany({
    where: {
      bucketStart: {
        lt: retentionCutoff
      }
    }
  })
}

function normalizeHistoryRows(rows) {
  return rows.map((row) => ({
    bucketStart: row.bucketStart,
    bucketStartIso: row.bucketStart.toISOString(),
    label: formatHistoryLabel(row.bucketStart),
    totalLiveTickets: row.totalLiveTickets,
    majorOutageOpen: row.majorOutageOpen,
    majorOutageSubscribers: row.majorOutageSubscribers,
    nldOutageOpen: row.nldOutageOpen,
    nldOutageSubscribers: row.nldOutageSubscribers,
    totalOutageSubscribers: row.majorOutageSubscribers + row.nldOutageSubscribers,
    backhaulOpen: row.backhaulOpen,
    vipOpen: row.vipOpen,
    tier1Open: row.tier1Open,
    tier1UrgentOpen: row.tier1UrgentOpen,
    tier2Open: row.tier2Open,
    tier2NewUnassigned: row.tier2NewUnassigned,
    tier2HandoverOpen: row.tier2HandoverOpen,
    outageNewUnassigned: row.outageNewUnassigned,
    outageP1: row.outageP1,
    outageP2: row.outageP2,
    outageP3: row.outageP3,
    outageP4: row.outageP4,
    outagePower: row.outagePower,
    nldPartialEventCount: row.nldPartialEventCount,
    nldPartialClusterCount: row.nldPartialClusterCount,
    nldPartialNotLoggedCount: row.nldPartialNotLoggedCount,
    skippedCount: row.skippedCount,
    telephonyQueues: row.telephonyQueues,
    telephonyWaiting: row.telephonyWaiting ?? 0,
    telephonyAnswered: row.telephonyAnswered ?? 0,
    telephonyMissed: row.telephonyMissed ?? 0,
    telephonyAbandonRate: row.telephonyAbandonRate ?? null,
    telephonyAvgAnswerSeconds: row.telephonyAvgAnswerSeconds ?? null
  }))
}

function buildHistoryResponse(rows, requestedHours = HISTORY_WINDOW_HOURS) {
  const points = normalizeHistoryRows(rows)
  return {
    windowHours: clampHistoryHours(requestedHours),
    bucketMinutes: HISTORY_BUCKET_MINUTES,
    retentionDays: HISTORY_RETENTION_DAYS,
    pointCount: points.length,
    latestBucketStart: points.length ? points[points.length - 1].bucketStartIso : null,
    series: {
      lanePressure: points.map((row) => ({
        bucketStart: row.bucketStartIso,
        label: row.label,
        totalLiveTickets: row.totalLiveTickets,
        majorOutageOpen: row.majorOutageOpen,
        nldOutageOpen: row.nldOutageOpen,
        backhaulOpen: row.backhaulOpen,
        vipOpen: row.vipOpen,
        tier1Open: row.tier1Open,
        tier2Open: row.tier2Open
      })),
      subscriberImpact: points.map((row) => ({
        bucketStart: row.bucketStartIso,
        label: row.label,
        majorOutageSubscribers: row.majorOutageSubscribers,
        nldOutageSubscribers: row.nldOutageSubscribers,
        totalSubscribers: row.totalOutageSubscribers
      })),
      outagePriority: points.map((row) => ({
        bucketStart: row.bucketStartIso,
        label: row.label,
        newUnassigned: row.outageNewUnassigned,
        p1: row.outageP1,
        p2: row.outageP2,
        p3: row.outageP3,
        p4: row.outageP4,
        power: row.outagePower
      })),
      tier1: points.map((row) => ({
        bucketStart: row.bucketStartIso,
        label: row.label,
        open: row.tier1Open,
        urgent: row.tier1UrgentOpen
      })),
      tier2: points.map((row) => ({
        bucketStart: row.bucketStartIso,
        label: row.label,
        open: row.tier2Open,
        unattended: row.tier2NewUnassigned,
        handover: row.tier2HandoverOpen
      })),
      nldPartials: points.map((row) => ({
        bucketStart: row.bucketStartIso,
        label: row.label,
        events: row.nldPartialEventCount,
        clusters: row.nldPartialClusterCount,
        notLogged: row.nldPartialNotLoggedCount
      })),
      telephony: points.map((row) => ({
        bucketStart: row.bucketStartIso,
        label: row.label,
        waiting: row.telephonyWaiting,
        answered: row.telephonyAnswered,
        missed: row.telephonyMissed,
        abandonRate: row.telephonyAbandonRate,
        avgAnswerSeconds: row.telephonyAvgAnswerSeconds
      })),
      tier1VoiceQueue: points.map((row, index) => {
        const source = rows[index]?.payload?.tier1VoiceQueue || {}
        return {
          bucketStart: row.bucketStartIso,
          label: row.label,
          waiting: asNumber(source.waiting, 0),
          answered: asNumber(source.answered, 0),
          missed: asNumber(source.missed, 0),
          avgAnswerSeconds: source.avgAnswerSeconds === null || source.avgAnswerSeconds === undefined ? null : asNumber(source.avgAnswerSeconds, 0),
          maxQueueSeconds: source.maxQueueSeconds === null || source.maxQueueSeconds === undefined ? null : asNumber(source.maxQueueSeconds, 0)
        }
      })
    }
  }
}

async function readHistoryWindow(hours = HISTORY_WINDOW_HOURS) {
  const safeHours = clampHistoryHours(hours)
  const windowStart = dayjs().subtract(safeHours, 'hour').toDate()
  const rows = await prisma.nocMonitoringSnapshotHistory.findMany({
    where: {
      bucketStart: {
        gte: windowStart
      }
    },
    orderBy: {
      bucketStart: 'asc'
    }
  })

  return buildHistoryResponse(rows, safeHours)
}

async function collectLiveSnapshot() {
  const warnings = []
  const now = dayjs()
  const timelineMeta = buildTicketTimelineMeta(now)
  const lastWeekDayKey = formatYmdInTz(now.subtract(7, 'day').toDate())
  const previousWeekDayKey = formatYmdInTz(now.subtract(14, 'day').toDate())
  const watcherConfig = await getWhatsappWatcherConfig({ forceFresh: true }).catch(() => null)
  const backhaulTag = watcherConfig?.backhaul?.tag || process.env.BACKHAUL_TAG || 'iris_backhaul_down'
  const vipOrgId = watcherConfig?.vip?.orgId || process.env.VIP_ORG_ID || '42757142385041'
  const vipTagRules = Array.isArray(watcherConfig?.vip?.tagRules) ? watcherConfig.vip.tagRules : []
  const nldPartialLookbackHours = Number(watcherConfig?.nld?.partialLookbackHours || 30)
  const nldClusterWindowHours = Number(watcherConfig?.nld?.clusterWindowHours || 6)
  const nldClusterMinEvents = Number(watcherConfig?.nld?.clusterMinEvents || 3)
  const nldNotLoggedMinutes = Number(watcherConfig?.nld?.notLoggedMinutes || 30)

  async function safe(label, fn, fallback) {
    try {
      return await fn()
    } catch (error) {
      warnings.push({ source: label, message: error?.message || String(error) })
      return fallback
    }
  }

  const [
    rawOutages,
    rawBackhaulTickets,
    rawVipOrgTickets,
    rawTier1OpenTickets,
    rawTier2OpenTickets,
    rawTier2UnassignedTickets,
    rawTier1CreatedToday,
    rawTier1CreatedLastWeek,
    rawTier1CreatedPreviousWeek,
    rawTier1SolvedToday,
    rawTier1SolvedLastWeek,
    rawTier1SolvedPreviousWeek,
    rawTier2CreatedToday,
    rawTier2CreatedLastWeek,
    rawTier2CreatedPreviousWeek,
    rawTier2SolvedToday,
    rawTier2SolvedLastWeek,
    rawTier2SolvedPreviousWeek,
    rawPartialNldTickets,
    rawSkips,
    telephony
  ] = await Promise.all([
    safe('outages', () => fetchZendeskExport(`group:${OUTAGE_GROUP_ID} form:"${OUTAGE_FORM_NAME}" status<solved`), []),
    safe('backhaul', () => fetchZendeskExport(`form:"NOC Alert Management" type:ticket status<solved tags:"${backhaulTag}"`), []),
    safe('vip-org', () => fetchZendeskExport(`type:ticket status<solved organization_id:${vipOrgId}`), []),
    safe('tier1', () => fetchZendeskExport(`group:"${TIER1_GROUP_NAME}" form:"${INITIAL_FORM_NAME}" status<solved`), []),
    safe('tier2', () => fetchZendeskExport(`group:"${TIER2_GROUP_NAME}" form:"${INITIAL_FORM_NAME}" status<solved`), []),
    safe('tier2-unassigned', () => fetchZendeskExport(`assignee:none status:new tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}"`), []),
    safe('tier1-created-today', () => fetchZendeskExport(`tags:request_type_noc_tier_1 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('created', timelineMeta.dayKey)}`), []),
    safe('tier1-created-last-week', () => fetchZendeskExport(`tags:request_type_noc_tier_1 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('created', lastWeekDayKey)}`), []),
    safe('tier1-created-previous-week', () => fetchZendeskExport(`tags:request_type_noc_tier_1 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('created', previousWeekDayKey)}`), []),
    safe('tier1-solved-today', () => fetchZendeskExport(`tags:request_type_noc_tier_1 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('solved', timelineMeta.dayKey)}`), []),
    safe('tier1-solved-last-week', () => fetchZendeskExport(`tags:request_type_noc_tier_1 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('solved', lastWeekDayKey)}`), []),
    safe('tier1-solved-previous-week', () => fetchZendeskExport(`tags:request_type_noc_tier_1 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('solved', previousWeekDayKey)}`), []),
    safe('tier2-created-today', () => fetchZendeskExport(`tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}" status<closed ${buildDayWindowQuery('created', timelineMeta.dayKey)}`), []),
    safe('tier2-created-last-week', () => fetchZendeskExport(`tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}" status<closed ${buildDayWindowQuery('created', lastWeekDayKey)}`), []),
    safe('tier2-created-previous-week', () => fetchZendeskExport(`tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}" status<closed ${buildDayWindowQuery('created', previousWeekDayKey)}`), []),
    safe('tier2-solved-today', () => fetchZendeskExport(`tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('solved', timelineMeta.dayKey)}`), []),
    safe('tier2-solved-last-week', () => fetchZendeskExport(`tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('solved', lastWeekDayKey)}`), []),
    safe('tier2-solved-previous-week', () => fetchZendeskExport(`tags:request_type_noc_tier_2 form:"${INITIAL_FORM_NAME}" ${buildDayWindowQuery('solved', previousWeekDayKey)}`), []),
    safe('nld-partials', () => fetchPartialNldAlertsRaw(), []),
    safe('skips', () => fetchZendeskSkips(), []),
    safe('telephony', () => fetchTelephonySnapshot(), {
      available: false,
      reason: 'Telephony snapshot unavailable.',
      queues: [],
      agents: []
    })
  ])

  const outageRows = rawOutages.map((ticket) => buildOutageRow(ticket, now))
  const nldOutages = sortByAgeDesc(outageRows.filter((ticket) => isNldOutage(ticket)))
  const majorOutages = sortByAgeDesc(outageRows.filter((ticket) => !isNldOutage(ticket)))

  const backhaulRows = sortByAgeDesc(rawBackhaulTickets.map((ticket) => buildBackhaulRow(ticket, now)))

  const vipOrgRows = rawVipOrgTickets.map((ticket) => ({
    ...buildTicketBase(ticket, now),
    sourceLabels: ['VIP Org']
  }))

  const vipRuleRows = (
    await Promise.all(
      vipTagRules.map(async (rule) => {
        const tag = asText(rule.tag)
        if (!tag) return []
        const tickets = await safe(`vip-tag-${tag}`, () => fetchZendeskExport(`type:ticket status<solved tags:${tag}`), [])
        return tickets.map((ticket) => ({
          ...buildTicketBase(ticket, now),
          sourceLabels: [rule.title || tag],
          vipRuleKey: rule.key || tag
        }))
      })
    )
  ).flat()

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

  const tier1Tickets = sortByAgeDesc(rawTier1OpenTickets.map((ticket) => buildT1ActionRow(ticket, now)))
  const tier2Tickets = sortByAgeDesc(rawTier2OpenTickets.map((ticket) => buildT2TicketRow(ticket, now)))
  const tier2NewUnassignedRows = sortByAgeDesc(rawTier2UnassignedTickets.map((ticket) => buildT2TicketRow(ticket, now)))
  const tier2NewUnassigned = tier2NewUnassignedRows.length
  const tier2HandoverRows = sortByAgeDesc(tier2Tickets.filter((row) => row.handover))

  const skippedTickets = sortByAgeDesc(
    rawSkips.map((row) => ({
      ...row,
      ageHours: buildAgeHours(row.createdAt, now)
    }))
  )

  const outagePriorityCollections = {
    new_unassigned: sortByAgeDesc(
      rawOutages
        .filter((ticket) => normalizeStatus(ticket.status) === 'new' && !ticket.assignee_id)
        .map((ticket) => buildOutageRow(ticket, now))
    ),
    p1: sortByAgeDesc(
      rawOutages
        .filter((ticket) => normalizeStatus(ticket.status) === 'new' && !ticket.assignee_id && hasAnyTag(ticket, ['temp_alert', 'network_alert']) && hasAnyTag(ticket, ['nam_priority_p1']))
        .map((ticket) => buildOutageRow(ticket, now))
    ),
    p2: sortByAgeDesc(
      rawOutages
        .filter((ticket) => normalizeStatus(ticket.status) === 'new' && !ticket.assignee_id && hasAnyTag(ticket, ['network_alert']) && hasAnyTag(ticket, ['nam_priority_p2']))
        .map((ticket) => buildOutageRow(ticket, now))
    ),
    p3: sortByAgeDesc(
      rawOutages
        .filter((ticket) => normalizeStatus(ticket.status) === 'new' && hasAnyTag(ticket, ['soutbound_alert', 'network_alert']) && hasAnyTag(ticket, ['nam_priority_p3']))
        .map((ticket) => buildOutageRow(ticket, now))
    ),
    p4: sortByAgeDesc(
      rawOutages
        .filter((ticket) => normalizeStatus(ticket.status) === 'new' && !ticket.assignee_id && hasAnyTag(ticket, ['network_alert']) && hasAnyTag(ticket, ['nam_priority_p4']))
        .map((ticket) => buildOutageRow(ticket, now))
    ),
    power: sortByAgeDesc(
      rawOutages
        .filter((ticket) => normalizeStatus(ticket.status) === 'new' && !ticket.assignee_id && hasAnyTag(ticket, ['power_alert']))
        .map((ticket) => buildOutageRow(ticket, now))
    )
  }

  const outagePrioritySummary = OUTAGE_PRIORITY_DEFS.map((definition) => {
    const rows = outagePriorityCollections[definition.key] || []
    const oldest = sortByAgeDesc(rows)[0]
    return {
      key: definition.key,
      label: definition.label,
      tone: definition.tone,
      count: rows.length,
      highestAgeHours: Number((oldest?.ageHours || 0).toFixed(1))
    }
  })

  const t1ActionSummary = T1_ACTION_DEFS.map((definition) => {
    const rows = tier1Tickets.filter((row) => row.pLevel === definition.key)
    return {
      key: definition.key,
      label: definition.label,
      tone: definition.tone,
      count: rows.length,
      fttb: rows.filter((row) => row.product === 'FTTB').length,
      ftth: rows.filter((row) => row.product === 'FTTH').length,
      other: rows.filter((row) => row.product === 'Other').length
    }
  })

  const t1ProductSummary = summarizeRowsByKey(tier1Tickets, 'product', { FTTB: '#0f766e', FTTH: '#2563eb', Other: '#64748b' })
  const t1StatusSummary = summarizeRowsByKey(tier1Tickets, 'status', T1_STATUS_TONES)
  const t1OperationalStateSummary = summarizeRowsByKey(tier1Tickets, 'operationalState', {
    'New / unattended': '#dc2626',
    'P1 in progress': '#f97316',
    'ISP follow-up': '#ea580c',
    'Vendor update': '#d97706',
    'MNT / automation': '#2563eb',
    'Change control': '#8b5cf6',
    Pending: '#475569',
    'In progress': '#0ea5e9',
    Other: '#64748b'
  })
  const t1DueBucketSummary = T1_DUE_BUCKET_ORDER.map((bucket) => ({
    key: bucket,
    label: bucket,
    tone: T1_DUE_BUCKET_TONES[bucket] || '#64748b',
    count: tier1Tickets.filter((row) => row.dueBucket === bucket).length
  }))
  const t1UrgentRows = sortByAgeDesc(
    tier1Tickets.filter((row) => ['BREACHED', 'Due <=2h', 'Due <=4h'].includes(row.dueBucket))
  )
  const t1P1UnattendedRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.pLevel === 'P1' && normalizeStatus(row.status) === 'new')
  )
  const t1P1BreachedRows = t1P1UnattendedRows.filter((row) => row.p1ActionBreached)
  const t1ChangeControlRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.pLevel === 'Change')
  )
  const t1AutomationOpenSummary = summarizeRuleHits(rawTier1OpenTickets, T1_AUTOMATION_ROUTE_RULES)
  const t1AutomationCreatedTodaySummary = summarizeRuleHits(rawTier1CreatedToday, T1_AUTOMATION_ROUTE_RULES)

  const t2ActiveRows = tier2Tickets.filter((row) => !['pending', 'new'].includes(normalizeStatus(row.status)))
  const t2PartySummary = summarizeRowsByKey(t2ActiveRows, 'party')
  const t2ProductSummary = summarizeRowsByKey(tier2Tickets, 'product', { FTTB: '#0f766e', FTTH: '#2563eb', Other: '#64748b' })
  const t2ServiceTypeSummary = summarizeRowsByKey(tier2Tickets, 'serviceType')
  const t2AgeBucketSummary = summarizeAgeBuckets(tier2Tickets)
  const outageRegionImpactSummary = summarizeTotalsByKey(outageRows, 'region', 'subscriberImpact')
  const outageServiceTypeSummary = summarizeRowsByKey(outageRows, 'serviceType')
  const backhaulOwnerSummary = summarizeRowsByKey(backhaulRows, 'owner')
  const telephonyQueueWaitingSummary = [...(telephony.queues || [])]
    .map((row) => ({
      key: row.name || 'Unknown queue',
      label: row.name || 'Unknown queue',
      tone: '#0891b2',
      count: asNumber(row.waiting, 0),
      active: asNumber(row.active, 0),
      answered: asNumber(row.answered, 0),
      missed: asNumber(row.missed, 0)
    }))
    .sort((left, right) => right.count - left.count)
  const telephonyMissedAgentSummary = [...(telephony.agents || [])]
    .map((row) => ({
      key: `${row.name || 'Unknown'}-${row.queue || 'No queue'}`,
      label: row.name || 'Unknown agent',
      tone: '#dc2626',
      count: asNumber(row.missedCalls, 0),
      queue: row.queue || 'No queue'
    }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count)
  const tier1VoiceQueue = (telephony.queues || []).find((row) => String(row.name || '').toLowerCase() === TIER1_VOICE_QUEUE_NAME.toLowerCase())
    || (telephony.queues || []).find((row) => String(row.name || '').toLowerCase().includes(TIER1_VOICE_QUEUE_NAME.toLowerCase()))
    || null

  const t1ReceivedHourlyRaw = buildHourlyTicketSeries(rawTier1CreatedToday, 'created_at')
  const t1ReceivedLastWeekHourlyRaw = buildHourlyTicketSeries(rawTier1CreatedLastWeek, 'created_at')
  const t1ReceivedPreviousWeekHourlyRaw = buildHourlyTicketSeries(rawTier1CreatedPreviousWeek, 'created_at')
  const t1SolvedHourlyRaw = buildHourlyTicketSeries(rawTier1SolvedToday.map((row) => ({ ...row, solvedStamp: row.solved_at || row.updated_at })), 'solvedStamp')
  const t1SolvedLastWeekHourlyRaw = buildHourlyTicketSeries(rawTier1SolvedLastWeek.map((row) => ({ ...row, solvedStamp: row.solved_at || row.updated_at })), 'solvedStamp')
  const t1SolvedPreviousWeekHourlyRaw = buildHourlyTicketSeries(rawTier1SolvedPreviousWeek.map((row) => ({ ...row, solvedStamp: row.solved_at || row.updated_at })), 'solvedStamp')
  const t2ReceivedHourlyRaw = buildHourlyTicketSeries(rawTier2CreatedToday, 'created_at')
  const t2ReceivedLastWeekHourlyRaw = buildHourlyTicketSeries(rawTier2CreatedLastWeek, 'created_at')
  const t2ReceivedPreviousWeekHourlyRaw = buildHourlyTicketSeries(rawTier2CreatedPreviousWeek, 'created_at')
  const t2SolvedHourlyRaw = buildHourlyTicketSeries(rawTier2SolvedToday.map((row) => ({ ...row, solvedStamp: row.solved_at || row.updated_at })), 'solvedStamp')
  const t2SolvedLastWeekHourlyRaw = buildHourlyTicketSeries(rawTier2SolvedLastWeek.map((row) => ({ ...row, solvedStamp: row.solved_at || row.updated_at })), 'solvedStamp')
  const t2SolvedPreviousWeekHourlyRaw = buildHourlyTicketSeries(rawTier2SolvedPreviousWeek.map((row) => ({ ...row, solvedStamp: row.solved_at || row.updated_at })), 'solvedStamp')
  const hourlySeries = t1ReceivedHourlyRaw.map((row, index) => ({
    hour: row.hour,
    label: row.label,
    t1Received: row.count,
    t1Solved: t1SolvedHourlyRaw[index]?.count || 0,
    t2Received: t2ReceivedHourlyRaw[index]?.count || 0,
    t2Solved: t2SolvedHourlyRaw[index]?.count || 0
  }))
  const t1ReceivedComparisonSeries = mergeHourlySeriesByKey([
    { key: 'today', rows: t1ReceivedHourlyRaw },
    { key: 'lastWeek', rows: t1ReceivedLastWeekHourlyRaw },
    { key: 'previousWeek', rows: t1ReceivedPreviousWeekHourlyRaw }
  ])
  const t1SolvedComparisonSeries = mergeHourlySeriesByKey([
    { key: 'today', rows: t1SolvedHourlyRaw },
    { key: 'lastWeek', rows: t1SolvedLastWeekHourlyRaw },
    { key: 'previousWeek', rows: t1SolvedPreviousWeekHourlyRaw }
  ])
  const t2ReceivedComparisonSeries = mergeHourlySeriesByKey([
    { key: 'today', rows: t2ReceivedHourlyRaw },
    { key: 'lastWeek', rows: t2ReceivedLastWeekHourlyRaw },
    { key: 'previousWeek', rows: t2ReceivedPreviousWeekHourlyRaw }
  ])
  const t2SolvedComparisonSeries = mergeHourlySeriesByKey([
    { key: 'today', rows: t2SolvedHourlyRaw },
    { key: 'lastWeek', rows: t2SolvedLastWeekHourlyRaw },
    { key: 'previousWeek', rows: t2SolvedPreviousWeekHourlyRaw }
  ])

  const partialEvents = transformPartialNldAlerts(rawPartialNldTickets, {
    partialLookbackHours: nldPartialLookbackHours,
    zendeskSubdomain: ZENDESK_SUBDOMAIN
  }).map((row) => ({
    ...row,
    routeLabel: firstText(row.nldRoute, row.partialCircuit, 'Unknown route')
  }))
  const partialRouteSummary = summarizeRowsByKey(partialEvents, 'routeLabel')
  const partialClusters = findPartialClusters(partialEvents, {
    nowMs: Date.now(),
    clusterWindowHours: nldClusterWindowHours,
    clusterMinEvents: nldClusterMinEvents
  }).map((cluster) => ({
    ...cluster,
    routeLabel: cluster.routeKey,
    eventCount: cluster.events.length,
    circuitCount: new Set(cluster.events.map((event) => event.circuit)).size
  }))
  const outageIndex = buildOutageRouteIndex(nldOutages)
  const partialNotLogged = findPartialNotLogged(partialEvents, outageIndex, {
    partialNotLoggedMinutes: nldNotLoggedMinutes
  }).map((row) => ({
    ...row,
    routeLabel: firstText(row.nldRoute, row.partialCircuit, 'Unknown route')
  }))

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
    tier1P1Unattended: t1P1UnattendedRows.length,
    tier1P1Breached: t1P1BreachedRows.length,
    tier1ChangeControlOpen: t1ChangeControlRows.length,
    tier2Open: tier2Tickets.length,
    tier2NewUnassigned,
    t2HandoverOpen: tier2HandoverRows.length,
    t1ReceivedToday: rawTier1CreatedToday.length,
    t1ReceivedLastWeek: rawTier1CreatedLastWeek.length,
    t1ReceivedPreviousWeek: rawTier1CreatedPreviousWeek.length,
    t1SolvedToday: rawTier1SolvedToday.length,
    t1SolvedLastWeek: rawTier1SolvedLastWeek.length,
    t1SolvedPreviousWeek: rawTier1SolvedPreviousWeek.length,
    t2ReceivedToday: rawTier2CreatedToday.length,
    t2ReceivedLastWeek: rawTier2CreatedLastWeek.length,
    t2ReceivedPreviousWeek: rawTier2CreatedPreviousWeek.length,
    t2SolvedToday: rawTier2SolvedToday.length,
    t2SolvedLastWeek: rawTier2SolvedLastWeek.length,
    t2SolvedPreviousWeek: rawTier2SolvedPreviousWeek.length,
    outageNewUnassigned: outagePriorityCollections.new_unassigned.length,
    outageP1: outagePriorityCollections.p1.length,
    outageP2: outagePriorityCollections.p2.length,
    outageP3: outagePriorityCollections.p3.length,
    outageP4: outagePriorityCollections.p4.length,
    outagePower: outagePriorityCollections.power.length,
    nldPartialEventCount: partialEvents.length,
    nldPartialClusterCount: partialClusters.length,
    nldPartialNotLoggedCount: partialNotLogged.length,
    skippedCount: skippedTickets.length,
    timezone: timelineMeta.timezone,
    dayKey: timelineMeta.dayKey,
    telephonyAnswered: telephony.summary?.callsAnswered ?? null,
    telephonyMissed: telephony.summary?.callsMissed ?? null,
    telephonyAbandonRate: telephony.summary?.abandonRate ?? null,
    telephonyAvgAnswerSeconds: telephony.summary?.avgAnswerSeconds ?? null,
    telephonyWaiting: telephony.available ? telephony.queues.reduce((total, row) => total + asNumber(row.waiting, 0), 0) : null,
    telephonyQueues: telephony.available ? telephony.queues.length : 0,
    telephonyTier1QueueName: tier1VoiceQueue?.name || TIER1_VOICE_QUEUE_NAME,
    telephonyTier1Waiting: tier1VoiceQueue ? asNumber(tier1VoiceQueue.waiting, 0) : null,
    telephonyTier1Answered: tier1VoiceQueue ? asNumber(tier1VoiceQueue.answered, 0) : null,
    telephonyTier1Missed: tier1VoiceQueue ? asNumber(tier1VoiceQueue.missed, 0) : null,
    telephonyTier1AvgAnswerSeconds: tier1VoiceQueue ? asNumber(tier1VoiceQueue.avgAnswerSeconds, 0) : null,
    telephonyTier1MaxQueueSeconds: tier1VoiceQueue ? asNumber(tier1VoiceQueue.maxQueueSeconds, 0) : null,
    telephonyTier1SlaBreached: tier1VoiceQueue
      ? asNumber(tier1VoiceQueue.maxQueueSeconds, 0) > TIER1_VOICE_SLA_SECONDS
        || asNumber(tier1VoiceQueue.avgAnswerSeconds, 0) > TIER1_VOICE_SLA_SECONDS
      : null
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
    trends: {
      hourlySeries: hourlySeries.slice(0, 24),
      outagePrioritySummary,
      outageRegionImpactSummary: outageRegionImpactSummary.slice(0, 12),
      outageServiceTypeSummary: outageServiceTypeSummary.slice(0, 12),
      backhaulOwnerSummary: backhaulOwnerSummary.slice(0, 12),
      t1ActionSummary,
      t1ProductSummary,
      t1StatusSummary,
      t1OperationalStateSummary,
      t1DueBucketSummary,
      t1AutomationOpenSummary,
      t1AutomationCreatedTodaySummary,
      t1ReceivedComparisonSeries: t1ReceivedComparisonSeries.slice(0, 24),
      t1SolvedComparisonSeries: t1SolvedComparisonSeries.slice(0, 24),
      t2ReceivedComparisonSeries: t2ReceivedComparisonSeries.slice(0, 24),
      t2SolvedComparisonSeries: t2SolvedComparisonSeries.slice(0, 24),
      t2AgeBucketSummary,
      t2PartySummary: t2PartySummary.slice(0, 16),
      t2ProductSummary,
      t2ServiceTypeSummary: t2ServiceTypeSummary.slice(0, 16),
      telephonyQueueWaitingSummary: telephonyQueueWaitingSummary.slice(0, 16),
      telephonyMissedAgentSummary: telephonyMissedAgentSummary.slice(0, 16),
      partialRouteSummary: partialRouteSummary.slice(0, 16)
    },
    collections: {
      majorOutages: majorOutages.slice(0, 200),
      nldOutages: nldOutages.slice(0, 200),
      backhauls: backhaulRows.slice(0, 200),
      vipTickets: vipTickets.slice(0, 200),
      tier1Tickets: tier1Tickets.slice(0, 300),
      tier1UrgentTickets: t1UrgentRows.slice(0, 150),
      tier1P1UnattendedTickets: t1P1UnattendedRows.slice(0, 150),
      tier1P1BreachedTickets: t1P1BreachedRows.slice(0, 150),
      tier1ChangeControlTickets: t1ChangeControlRows.slice(0, 150),
      tier2Tickets: tier2Tickets.slice(0, 300),
      tier2NewUnassignedTickets: tier2NewUnassignedRows.slice(0, 150),
      tier2HandoverTickets: tier2HandoverRows.slice(0, 150),
      outagePriorityTickets: {
        newUnassigned: outagePriorityCollections.new_unassigned.slice(0, 150),
        p1: outagePriorityCollections.p1.slice(0, 150),
        p2: outagePriorityCollections.p2.slice(0, 150),
        p3: outagePriorityCollections.p3.slice(0, 150),
        p4: outagePriorityCollections.p4.slice(0, 150),
        power: outagePriorityCollections.power.slice(0, 150)
      },
      outageRegionImpactSummary: outageRegionImpactSummary.slice(0, 24),
      outageServiceTypeSummary: outageServiceTypeSummary.slice(0, 24),
      backhaulOwnerSummary: backhaulOwnerSummary.slice(0, 24),
      t1ProductSummary,
      t1StatusSummary,
      t1OperationalStateSummary,
      t1AutomationOpenSummary,
      t1AutomationCreatedTodaySummary,
      t2PartySummary: t2PartySummary.slice(0, 24),
      t2ProductSummary,
      t2ServiceTypeSummary: t2ServiceTypeSummary.slice(0, 24),
      t2AgeBucketSummary,
      nldPartialEvents: sortByAgeDesc(partialEvents).slice(0, 300),
      nldPartialClusters: partialClusters.slice(0, 100),
      nldPartialNotLogged: sortByAgeDesc(partialNotLogged).slice(0, 150),
      skippedTickets: skippedTickets.slice(0, 200),
      telephonyQueues: (telephony.queues || []).slice(0, 100),
      telephonyAgents: (telephony.agents || []).slice(0, 100),
      telephonyHourly: (telephony.hourly || []).slice(0, 48),
      tier1VoiceQueue,
      telephonyQueueWaitingSummary: telephonyQueueWaitingSummary.slice(0, 24),
      telephonyMissedAgentSummary: telephonyMissedAgentSummary.slice(0, 24),
      telephonyMeta: {
        available: !!telephony.available,
        reason: telephony.reason || '',
        summary: telephony.summary || null
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

export async function refreshNocMonitoringSnapshot(requestedBy = 'system', { historyHours = HISTORY_WINDOW_HOURS } = {}) {
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
    await persistHistorySnapshot(snapshot, requestedBy)
    const history = await readHistoryWindow(historyHours)

    return {
      snapshot,
      freshness: getFreshness(snapshot),
      history
    }
  })().finally(() => {
    refreshPromise = null
  })

  return refreshPromise
}

export async function getNocMonitoringSnapshot({ autoRefresh = true, historyHours = HISTORY_WINDOW_HOURS } = {}) {
  const snapshot = await readStoredSnapshot()
  const freshness = getFreshness(snapshot)

  if (!snapshot) {
    return refreshNocMonitoringSnapshot('bootstrap', { historyHours })
  }

  if (autoRefresh && freshness.stale && !refreshPromise) {
    void refreshNocMonitoringSnapshot('background-refresh', { historyHours }).catch(() => {})
  }

  const history = await readHistoryWindow(historyHours)

  return {
    snapshot,
    freshness,
    history
  }
}

export function getNocMonitoringConfigMeta() {
  return {
    snapshotKey: SNAPSHOT_KEY,
    staleAfterMs: SOFT_TTL_MS,
    hardStaleMs: HARD_STALE_MS,
    historyBucketMinutes: HISTORY_BUCKET_MINUTES,
    historyWindowHours: HISTORY_WINDOW_HOURS,
    historyRetentionDays: HISTORY_RETENTION_DAYS,
    dashboardNote: 'This dashboard reads from a cached backend snapshot so the browser stays light and Zendesk does not get hammered by repeated live panel queries.',
    telephonyConfigured: Boolean(ILLATION_STATS_URL),
    telephonyAuthConfigured: Boolean(ILLATION_AUTH_HEADER || ILLATION_BEARER_TOKEN || ILLATION_API_KEY || ILLATION_ALLOW_ANON)
  }
}
