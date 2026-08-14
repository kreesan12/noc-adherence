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
const T1_TIMER_CACHE_KEY = 'noc_monitoring_t1_timer_cache_v1'
const TICKET_EVENT_WATERMARK_KEY = 'noc_monitoring_ticket_event_watermark_v1'
const T1_INBOUND_ACTIVITY_CACHE_KEY = 'noc_monitoring_t1_inbound_activity_v2'
const SOFT_TTL_MS = Number(process.env.NOC_MONITORING_SNAPSHOT_TTL_MS || 15 * 60 * 1000)
const TELEPHONY_PULSE_TTL_MS = Math.max(1000, Number(process.env.NOC_MONITORING_TELEPHONY_TTL_MS || 3000))
const HARD_STALE_MS = Number(process.env.NOC_MONITORING_HARD_STALE_MS || 6 * 60 * 60 * 1000)
const HISTORY_BUCKET_MINUTES = Math.max(5, Number(process.env.NOC_MONITORING_HISTORY_BUCKET_MINUTES || 15))
const HISTORY_WINDOW_HOURS = Math.max(6, Number(process.env.NOC_MONITORING_HISTORY_WINDOW_HOURS || 72))
const HISTORY_RETENTION_DAYS = Math.max(7, Number(process.env.NOC_MONITORING_HISTORY_RETENTION_DAYS || 45))
const TICKET_EVENT_BOOTSTRAP_DAYS = Math.max(14, Number(process.env.NOC_MONITORING_TICKET_EVENT_BOOTSTRAP_DAYS || 21))
const TICKET_EVENT_RETENTION_DAYS = Math.max(30, Number(process.env.NOC_MONITORING_TICKET_EVENT_RETENTION_DAYS || 90))
const TICKET_EVENT_MAX_PAGES = Math.max(1, Number(process.env.NOC_MONITORING_TICKET_EVENT_MAX_PAGES || 20))
const T1_INBOUND_ACTIVITY_CACHE_TTL_MS = Math.max(15 * 60 * 1000, Number(process.env.NOC_MONITORING_T1_INBOUND_ACTIVITY_TTL_MS || 60 * 60 * 1000))
const T1_INBOUND_ACTIVITY_LOOKBACK_DAYS = Math.max(8, Number(process.env.NOC_MONITORING_T1_INBOUND_ACTIVITY_LOOKBACK_DAYS || 10))
const T1_INBOUND_ACTIVITY_BASELINE_DAYS = Math.max(4, Number(process.env.NOC_MONITORING_T1_INBOUND_ACTIVITY_BASELINE_DAYS || 7))
const T1_INBOUND_ACTIVITY_MAX_SERIES = Math.max(2, Number(process.env.NOC_MONITORING_T1_INBOUND_ACTIVITY_MAX_SERIES || 4))
const MAX_SEARCH_PAGES = Number(process.env.NOC_MONITORING_MAX_SEARCH_PAGES || 8)
const MAX_SEARCH_RESULTS = Number(process.env.NOC_MONITORING_MAX_SEARCH_RESULTS || 2500)
const SEARCH_EXPORT_PAGE_SIZE = Math.max(100, Math.min(1000, Number(process.env.NOC_MONITORING_SEARCH_PAGE_SIZE || 1000)))
const T1_AUDIT_PAGE_SIZE = Math.max(20, Number(process.env.NOC_MONITORING_T1_AUDIT_PAGE_SIZE || 100))
const T1_AUDIT_MAX_PAGES = Math.max(1, Number(process.env.NOC_MONITORING_T1_AUDIT_MAX_PAGES || 8))
const OUTAGE_GROUP_ID = String(process.env.OUTAGE_WATCHER_GROUP_ID || '5160847905297').trim()
const OUTAGE_FORM_NAME = String(process.env.OUTAGE_WATCHER_FORM_NAME || 'Outage Capturing').trim()
const INITIAL_FORM_NAME = String(process.env.NOC_MONITORING_INITIAL_FORM_NAME || 'Frogfoot Initial Form').trim()
const TIER1_GROUP_NAME = String(process.env.NOC_MONITORING_T1_GROUP || 'NOC Tier1 Support').trim()
const TIER2_GROUP_NAME = String(process.env.NOC_MONITORING_T2_GROUP || 'NOC Tier2 Support').trim()
const TIER1_VOICE_QUEUE_NAME = String(process.env.NOC_MONITORING_T1_VOICE_QUEUE || 'NOCTier1_Queue').trim()
const TIER1_P1_SLA_MINUTES = Math.max(5, Number(process.env.NOC_MONITORING_T1_P1_SLA_MINUTES || 30))
const TIER1_P2_SLA_MINUTES = Math.max(15, Number(process.env.NOC_MONITORING_T1_P2_SLA_MINUTES || 60))
const TIER1_P3_SLA_MINUTES = Math.max(15, Number(process.env.NOC_MONITORING_T1_P3_SLA_MINUTES || 90))
const TIER1_P4_SLA_MINUTES = Math.max(15, Number(process.env.NOC_MONITORING_T1_P4_SLA_MINUTES || 90))
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
  olt: '5352900733969',
  nodeName: '5409430025745',
  customerPremisesAlias: '5406464539409',
  subscriberImpact: '5552674828049',
  lastUpdate: '5352766585489',
  serviceType: '6715159991185',
  tier1OperationalState: '5352663380497',
  tier1EscalationPath: '6681896923281',
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
const T1_INBOUND_PRODUCT_SIGNAL_DEFS = [
  { label: 'Frogfoot Access Air', tags: ['ff_air'], productGroup: 'FTTH' },
  { label: 'Access Rise', tags: ['rise'], productGroup: 'FTTH' },
  { label: 'DStv', tags: ['dstv'], productGroup: 'FTTH' },
  { label: 'FTTB', tags: ['t2_fttb'], productGroup: 'FTTB' },
  { label: 'FTTH', tags: ['t2_ftth'], productGroup: 'FTTH' }
]
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
  { key: 'P3 Parked', label: 'P3 parked timer', tone: '#92400e' },
  { key: 'P4 Parked', label: 'P4 parked timer', tone: '#1d4ed8' },
  { key: 'Change', label: 'Change control', tone: '#8b5cf6' },
  { key: 'Other', label: 'Other / uncategorised', tone: '#475569' }
]
const T1_PLAY_POLICY_CONFIG = {
  P1: {
    key: 'P1',
    policyTitle: 'Play Priority 1',
    metricKey: 'reply_time',
    targetMinutes: TIER1_P1_SLA_MINUTES,
    activeStatusOnly: 'new',
    exactClock: true
  },
  P2: {
    key: 'P2',
    policyTitle: 'Play Priority 2',
    metricKey: 'periodic_update_time',
    metricKeys: ['next_reply_time', 'periodic_update_time'],
    targetMinutes: TIER1_P2_SLA_MINUTES,
    exactClock: false
  },
  P3: {
    key: 'P3',
    policyTitle: 'Play Priority 3',
    metricKey: 'periodic_update_time',
    metricKeys: ['periodic_update_time', 'next_reply_time'],
    targetMinutes: TIER1_P3_SLA_MINUTES,
    exactClock: false
  },
  P4: {
    key: 'P4',
    policyTitle: 'Play Priority 4',
    metricKey: 'periodic_update_time',
    metricKeys: ['periodic_update_time', 'next_reply_time'],
    targetMinutes: TIER1_P4_SLA_MINUTES,
    exactClock: false
  }
}
const T1_PLAY_BUCKET_ORDER = ['BREACHED', 'Due <=15m', 'Due <=30m', 'Safe >30m', 'Parked timer', 'Change control', 'No active timer']
const T1_PLAY_BUCKET_TONES = {
  BREACHED: '#dc2626',
  'Due <=15m': '#ea580c',
  'Due <=30m': '#d97706',
  'Safe >30m': '#0f766e',
  'Parked timer': '#475569',
  'Change control': '#8b5cf6',
  'No active timer': '#64748b'
}
const T1_PARKED_TIMER_TAGS = {
  P3: ['p3timer', 'noc_play_p3_start_timer'],
  P4: ['p4timer', 'noc_play_p4_start_timer']
}
const T1_OPERATIONAL_STATE_LABELS = {
  t1_active_support: 'Active support',
  t1_active_support_blitz: 'Active support blitz',
  t1_pending_maintenance: 'Pending maintenance',
  t1_pending_vendor: 'Pending vendor',
  t1_pending_information_from_client: 'Pending client info',
  t1_pending_outage_closure: 'Pending outage closure',
  t1_pending_tier_2: 'Pending Tier 2',
  t1_pending_tier_3: 'Pending Tier 3',
  t1_pending_pmt: 'Pending PMT',
  t1_pending_365: 'Pending 365',
  t1_pending_management: 'Pending management',
  t1_pending_rca: 'Pending RCA',
  t1_pending_coc: 'Pending COC',
  t1_pending_cc: 'Pending change control',
  t1_pending_provisioning: 'Pending provisioning',
  t1_pending_facilities: 'Pending facilities',
  t1_deferred: 'Deferred'
}
const T1_ESCALATION_PATH_LABELS = {
  maintenance_escalation: 'Maintenance',
  'noc_t1-dfa_escalation': 'DFA / vendor',
  'noc-t1_outage_linked': 'Linked outage',
  'noc_t1_outage_linked': 'Linked outage'
}
const T1_WORKFLOW_OWNER_TONES = {
  'With Tier 1': '#0f766e',
  'Waiting on client / ISP': '#ea580c',
  'With maintenance': '#2563eb',
  'With vendor / carrier': '#d97706',
  'Linked outage / closure': '#7c3aed',
  'Deferred / parked': '#475569',
  'Change control': '#8b5cf6',
  'Internal / other': '#64748b',
  'Needs review': '#94a3b8'
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
  { key: 'solidLookupFailure', label: 'Solid lookup failure', tags: ['solid_lookup_isp_failed'], tone: '#f97316' },
  { key: 'mantleLookupFailure', label: 'Mantle lookup failure', tags: ['mantle_lookup_failed'], tone: '#fb923c' },
  { key: 'linkDegraded', label: 'Link online but degraded', tags: ['mantle_degraded'], tone: '#f59e0b' },
  {
    key: 'linkOnline',
    label: 'Link online',
    tone: '#22c55e',
    predicate: (ticket) => hasAnyTag(ticket, ['mantle_enabled']) && !hasAnyTag(ticket, ['mantle_degraded'])
  },
  { key: 'potentialConfigIssue', label: 'Potential config issue', tags: ['mantle_calix_ont_disabled__configuration_required'], tone: '#ef4444' },
  { key: 'sendToMnt', label: 'Send to MNT', tags: ['auto_mnt_escl'], tone: '#2563eb' },
  { key: 'sendToDfa', label: 'Sent to DFA', tags: ['auto_dfa_escl'], tone: '#7c3aed' },
  { key: 'autoOutageLinked', label: 'Auto linked to outage', tags: ['auto_outage_linked'], tone: '#dc2626' },
  { key: 'powerLoss', label: 'Power loss on ONT', tags: ['mantle_power_loss'], tone: '#e11d48' },
  { key: 'autoOutageCatch', label: 'Auto outage catch', tags: ['auto_outage_catch'], tone: '#ea580c' },
  { key: 'aiMntActivated', label: 'AI MNT active', tags: ['ai_parent_mnt_activated'], tone: '#0f766e' },
  { key: 'aiDfaActivated', label: 'AI DFA active', tags: ['ai_parent_dfa_activated'], tone: '#0891b2' },
  { key: 'zeroTouchAi', label: 'Zero-touch AI', tags: ['zero_touch_ai'], tone: '#16a34a' }
]

let refreshPromise = null
let telephonyPulseCache = null
let telephonyPulsePromise = null

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
  if (!Array.isArray(tags) || !tags.length) return false
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

function classifyT1SlaProduct(ticket) {
  const serviceTypeValue = asText(cf(ticket, FIELD_IDS.serviceType)).toLowerCase()
  if (hasAnyTag(ticket, ['ff_air']) || serviceTypeValue.includes('air')) return 'FF Air'
  if (hasAnyTag(ticket, TICKET_PRODUCT_TAGS.FTTB)) return 'FTTB'
  if (hasAnyTag(ticket, ['t2_ftth', 'rise', 'dstv']) || serviceTypeValue.includes('ftth') || serviceTypeValue.includes('home') || serviceTypeValue.includes('rise')) return 'FTTH'
  return classifyTicketProduct(ticket)
}

function classifyT1InboundProductSignal(ticket) {
  const serviceTypeValue = asText(cf(ticket, FIELD_IDS.serviceType))
  const normalizedServiceType = serviceTypeValue.toLowerCase()

  for (const definition of T1_INBOUND_PRODUCT_SIGNAL_DEFS) {
    if (hasAnyTag(ticket, definition.tags)) {
      return {
        label: definition.label,
        productGroup: definition.productGroup
      }
    }
  }

  if (serviceTypeValue && !['unknown', 'n/a', 'na', 'none'].includes(normalizedServiceType)) {
    return {
      label: humanizeFieldChoice(serviceTypeValue),
      productGroup: classifyTicketProduct(ticket)
    }
  }

  const productGroup = classifyTicketProduct(ticket)
  return {
    label: productGroup,
    productGroup
  }
}

function isChangeControlTicket(ticket) {
  return hasAnyTag(ticket, [TIER1_CHANGE_CONTROL_TAG])
}

function hasT1ParkedTimer(ticket, laneKey) {
  const tags = T1_PARKED_TIMER_TAGS[laneKey] || []
  return hasAnyTag(ticket, tags)
}

function classifyT1ActionLevel(ticket) {
  if (hasAnyTag(ticket, ['play_p1'])) return 'P1'
  if (hasAnyTag(ticket, ['play_p2'])) return 'P2'
  if (hasAnyTag(ticket, ['play_p3'])) return 'P3'
  if (hasAnyTag(ticket, ['play_p4', 'isp_frac_auto'])) return 'P4'
  if (hasT1ParkedTimer(ticket, 'P3')) return 'P3 Parked'
  if (hasT1ParkedTimer(ticket, 'P4')) return 'P4 Parked'
  if (isChangeControlTicket(ticket)) return 'Change'
  return 'Other'
}

function formatT1OperationalState(value) {
  const raw = asText(value).toLowerCase()
  if (!raw) return ''
  if (T1_OPERATIONAL_STATE_LABELS[raw]) return T1_OPERATIONAL_STATE_LABELS[raw]
  return humanizeFieldChoice(raw.replace(/^t1[_-]?/, ''))
}

function classifyT1OperationalState(ticket, pLevel, status) {
  const normalizedStatus = normalizeStatus(status || ticket?.status)
  if (pLevel === 'Change') return 'Change control'
  if (pLevel === 'P3 Parked' || pLevel === 'P4 Parked') return 'Deferred'
  if (normalizedStatus === 'new') return 'New / unattended'
  if (normalizedStatus === 'pending') return 'Pending review'
  if (normalizedStatus === 'hold') return 'On hold'
  if (normalizedStatus === 'open') return 'Active support'
  if (normalizedStatus === 'solved') return 'Solved / cleanup'
  if (normalizedStatus === 'closed') return 'Closed / cleanup'
  return 'Needs review'
}

function formatT1EscalationPath(value) {
  const raw = asText(value).toLowerCase()
  if (!raw) return ''
  if (T1_ESCALATION_PATH_LABELS[raw]) return T1_ESCALATION_PATH_LABELS[raw]
  return humanizeFieldChoice(raw.replace(/^noc[_-]?t1[_-]?/, ''))
}

function classifyT1EscalationPath(ticket, pLevel, escalationPathKey = '') {
  const explicitValue = formatT1EscalationPath(escalationPathKey || cf(ticket, FIELD_IDS.tier1EscalationPath))
  if (explicitValue) return explicitValue

  switch (pLevel) {
    case 'P1':
      return 'Tier 1 desk'
    case 'P2':
      return 'ISP / customer'
    case 'P3':
      return 'Vendor / carrier'
    case 'P4':
      return 'MNT / automation'
    case 'Change':
      return 'Change control'
    default:
      return 'Tier 1 review'
  }
}

function classifyT1WorkflowOwner({ operationalStateKey, escalationPathKey, pLevel, status }) {
  const op = asText(operationalStateKey).toLowerCase()
  const esc = asText(escalationPathKey).toLowerCase()
  const normalizedStatus = normalizeStatus(status)

  if (pLevel === 'Change') return 'Change control'
  if (pLevel === 'P3 Parked' || pLevel === 'P4 Parked' || op === 't1_deferred') return 'Deferred / parked'
  if (op === 't1_active_support' || op === 't1_active_support_blitz') return 'With Tier 1'
  if (op === 't1_pending_information_from_client') return 'Waiting on client / ISP'
  if (op === 't1_pending_maintenance') return 'With maintenance'
  if (op === 't1_pending_vendor' || esc === 'noc_t1-dfa_escalation') return 'With vendor / carrier'
  if (op === 't1_pending_outage_closure' || esc === 'noc-t1_outage_linked' || esc === 'noc_t1_outage_linked') return 'Linked outage / closure'
  if ([
    't1_pending_tier_2',
    't1_pending_tier_3',
    't1_pending_pmt',
    't1_pending_365',
    't1_pending_management',
    't1_pending_rca',
    't1_pending_coc',
    't1_pending_cc',
    't1_pending_provisioning',
    't1_pending_facilities'
  ].includes(op)) return 'Internal / other'
  if (esc === 'maintenance_escalation') return 'With maintenance'
  if (!op && normalizedStatus === 'new') return 'With Tier 1'
  if (!op && ['open', 'pending', 'hold'].includes(normalizedStatus)) return 'Needs review'
  return 'Needs review'
}

function classifyT1AutomationRoutes(ticket) {
  return T1_AUTOMATION_ROUTE_RULES.filter((rule) => {
    if (typeof rule.predicate === 'function') return rule.predicate(ticket)
    return hasAnyTag(ticket, rule.tags || [])
  })
}

function summarizeRuleHits(rows, rules, accessor = (row) => row) {
  return rules.map((rule) => ({
    key: rule.key,
    label: rule.label,
    tone: rule.tone,
    count: rows.filter((row) => {
      const value = accessor(row)
      if (typeof rule.predicate === 'function') return rule.predicate(value)
      return hasAnyTag(value, rule.tags)
    }).length
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

function classifyDueBucket(remainingMinutes, pLevel, clockActive, parkedTimerActive = false) {
  if (pLevel === 'Change') return 'Change control'
  if (parkedTimerActive) return 'Parked timer'
  if (!clockActive || !Number.isFinite(Number(remainingMinutes))) return 'No active timer'
  if (remainingMinutes <= 0) return 'BREACHED'
  if (remainingMinutes <= 15) return 'Due <=15m'
  if (remainingMinutes <= 30) return 'Due <=30m'
  return 'Safe >30m'
}

function buildAgeMinutes(stamp, now = dayjs()) {
  const value = dayjs(stamp)
  return value.isValid() ? now.diff(value, 'minute', true) : null
}

function getT1PlayPolicy(pLevel) {
  return T1_PLAY_POLICY_CONFIG[pLevel] || null
}

function getT1PlayMetricKeys(policyOrLevel) {
  const policy = typeof policyOrLevel === 'string'
    ? getT1PlayPolicy(policyOrLevel)
    : policyOrLevel
  if (!policy) return []
  return Array.isArray(policy.metricKeys) && policy.metricKeys.length
    ? policy.metricKeys
    : policy.metricKey
      ? [policy.metricKey]
      : []
}

function buildApproxT1PlayClock(ticket, pLevel, status, now = dayjs()) {
  const policy = getT1PlayPolicy(pLevel)
  if (!policy) {
    return {
      playPolicyTitle: '',
      playMetricKey: '',
      playTargetMinutes: null,
      playClockActive: false,
      playClockExact: false,
      playClockSource: '',
      timerAnchorAt: null,
      timerAnchorMode: '',
      timerElapsedMinutes: null,
      remainingMinutes: null,
      remainingHours: null,
      dueBucket: classifyDueBucket(null, pLevel, false)
    }
  }

  const normalizedStatus = normalizeStatus(status || ticket?.status)
  if (policy.activeStatusOnly && normalizedStatus !== policy.activeStatusOnly) {
    return {
      playPolicyTitle: policy.policyTitle,
      playMetricKey: policy.metricKey,
      playTargetMinutes: policy.targetMinutes,
      playClockActive: false,
      playClockExact: policy.exactClock,
      playClockSource: 'P1 reply-time clock only applies while the ticket is still untouched in the new state.',
      timerAnchorAt: ticket.updated_at || ticket.created_at || null,
      timerAnchorMode: 'first-touch-cleared',
      timerElapsedMinutes: null,
      remainingMinutes: null,
      remainingHours: null,
      dueBucket: classifyDueBucket(null, pLevel, false)
    }
  }

  const timerAnchorAt = pLevel === 'P1'
    ? (ticket.created_at || null)
    : firstText(ticket.updated_at, ticket.created_at)
  const timerElapsedMinutes = buildAgeMinutes(timerAnchorAt, now)
  const remainingMinutes = Number.isFinite(Number(timerElapsedMinutes))
    ? Number((policy.targetMinutes - timerElapsedMinutes).toFixed(1))
    : null
  const remainingHours = Number.isFinite(Number(remainingMinutes))
    ? Number((remainingMinutes / 60).toFixed(2))
    : null

  return {
    playPolicyTitle: policy.policyTitle,
    playMetricKey: policy.metricKey,
    playTargetMinutes: policy.targetMinutes,
    playClockActive: Number.isFinite(Number(timerElapsedMinutes)),
    playClockExact: policy.exactClock,
    playClockSource: policy.exactClock
      ? 'Zendesk first-response play clock anchored to ticket creation until the first desk touch.'
      : 'Zendesk periodic-update play clock approximated from the last ticket update on the cached live snapshot path.',
    timerAnchorAt,
    timerAnchorMode: policy.exactClock ? 'created_at' : 'updated_at',
    timerElapsedMinutes,
    remainingMinutes,
    remainingHours,
    dueBucket: classifyDueBucket(remainingMinutes, pLevel, Number.isFinite(Number(timerElapsedMinutes)))
  }
}

function buildExactCachedT1PlayClock(ticket, pLevel, status, timerCacheRow, now = dayjs()) {
  const policy = getT1PlayPolicy(pLevel)
  if (!policy || !timerCacheRow?.timerAnchorAt) return null

  const normalizedStatus = normalizeStatus(status || ticket?.status)
  if (policy.activeStatusOnly && normalizedStatus !== policy.activeStatusOnly) {
    return {
      playPolicyTitle: policy.policyTitle,
      playMetricKey: timerCacheRow.playMetricKey || policy.metricKey,
      playTargetMinutes: Number(timerCacheRow.playTargetMinutes || policy.targetMinutes),
      playClockActive: false,
      playClockExact: true,
      playClockSource: 'Zendesk ticket audit cache shows this play clock is not currently active.',
      timerAnchorAt: timerCacheRow.timerAnchorAt,
      timerAnchorMode: timerCacheRow.timerAnchorMode || 'audit_change',
      timerElapsedMinutes: null,
      remainingMinutes: null,
      remainingHours: null,
      dueBucket: classifyDueBucket(null, pLevel, false)
    }
  }

  const timerElapsedMinutes = buildAgeMinutes(timerCacheRow.timerAnchorAt, now)
  const playTargetMinutes = Number(timerCacheRow.playTargetMinutes || policy.targetMinutes)
  const remainingMinutes = Number.isFinite(Number(timerElapsedMinutes))
    ? Number((playTargetMinutes - timerElapsedMinutes).toFixed(1))
    : null
  const remainingHours = Number.isFinite(Number(remainingMinutes))
    ? Number((remainingMinutes / 60).toFixed(2))
    : null

  return {
    playPolicyTitle: timerCacheRow.playPolicyTitle || policy.policyTitle,
    playMetricKey: timerCacheRow.playMetricKey || policy.metricKey,
    playTargetMinutes,
    playClockActive: true,
    playClockExact: true,
    playClockSource: 'Zendesk ticket audits cached on the backend keep this play clock anchored to the latest real timer reset.',
    timerAnchorAt: timerCacheRow.timerAnchorAt,
    timerAnchorMode: timerCacheRow.timerAnchorMode || 'audit_change',
    timerElapsedMinutes,
    remainingMinutes,
    remainingHours,
    dueBucket: classifyDueBucket(remainingMinutes, pLevel, true)
  }
}

function buildParkedT1PlayClock(pLevel) {
  return {
    playPolicyTitle: '',
    playMetricKey: '',
    playTargetMinutes: null,
    playClockActive: false,
    playClockExact: true,
    playClockSource: 'This ticket is parked on the pre-play timer and has not entered the live P3/P4 lane yet.',
    timerAnchorAt: null,
    timerAnchorMode: 'parked_timer',
    timerElapsedMinutes: null,
    remainingMinutes: null,
    remainingHours: null,
    dueBucket: classifyDueBucket(null, pLevel, false, true)
  }
}

function buildT1PlayClock(ticket, pLevel, status, now = dayjs(), timerCacheRow = null) {
  if (pLevel === 'P3 Parked' || pLevel === 'P4 Parked') {
    return buildParkedT1PlayClock(pLevel)
  }

  const exactRow = buildExactCachedT1PlayClock(ticket, pLevel, status, timerCacheRow, now)
  if (exactRow) return exactRow

  return buildApproxT1PlayClock(ticket, pLevel, status, now)
}

function buildT1ActionRow(ticket, now = dayjs(), timerCacheRow = null) {
  const base = buildTicketBase(ticket, now)
  const product = classifyTicketProduct(ticket)
  const slaProduct = classifyT1SlaProduct(ticket)
  const pLevel = classifyT1ActionLevel(ticket)
  const automationRoutes = classifyT1AutomationRoutes(ticket)
  const status = normalizeStatus(ticket.status)
  const operationalStateKey = asText(cf(ticket, FIELD_IDS.tier1OperationalState)).toLowerCase()
  const escalationPathKey = asText(cf(ticket, FIELD_IDS.tier1EscalationPath)).toLowerCase()
  const operationalState = formatT1OperationalState(operationalStateKey) || classifyT1OperationalState(ticket, pLevel, status)
  const escalationPath = classifyT1EscalationPath(ticket, pLevel, escalationPathKey)
  const workflowOwner = classifyT1WorkflowOwner({ operationalStateKey, escalationPathKey, pLevel, status })
  const playClock = buildT1PlayClock(ticket, pLevel, status, now, timerCacheRow)
  const p1ActionBreached = pLevel === 'P1' && playClock.playClockActive && Number(playClock.remainingMinutes) <= 0

  return {
    ...base,
    product,
    slaProduct,
    pLevel,
    operationalStateKey,
    operationalState,
    escalationPathKey,
    escalationPath,
    workflowOwner,
    parkedTimerActive: pLevel === 'P3 Parked' || pLevel === 'P4 Parked',
    serviceType: firstText(cf(ticket, FIELD_IDS.serviceType), 'Unknown'),
    region: firstText(cf(ticket, FIELD_IDS.region), 'Unknown region'),
    olt: firstText(cf(ticket, FIELD_IDS.olt), 'Unknown OLT'),
    nodeName: firstText(cf(ticket, FIELD_IDS.nodeName), 'Unknown node'),
    customerPremisesAlias: firstText(cf(ticket, FIELD_IDS.customerPremisesAlias), ''),
    organizationLabel: firstText(base.organizationName, base.organizationId ? `Org ${base.organizationId}` : '', 'Unknown organisation'),
    ...playClock,
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

function formatDayKeyLabel(dayKey) {
  const parsed = dayjs(dayKey)
  return parsed.isValid() ? parsed.format('DD MMM') : String(dayKey || '')
}

function listRecentDayKeys(now = dayjs(), totalDays = T1_INBOUND_ACTIVITY_LOOKBACK_DAYS) {
  return Array.from({ length: totalDays }, (_, index) => (
    formatYmdInTz(now.subtract((totalDays - 1) - index, 'day').toDate())
  ))
}

function isCachedPayloadFresh(payload, ttlMs) {
  const generatedAt = payload?.generatedAt ? Date.parse(payload.generatedAt) : NaN
  return Number.isFinite(generatedAt) && (Date.now() - generatedAt) <= ttlMs
}

function serviceTypeLabelForTicket(ticket) {
  return firstText(cf(ticket, FIELD_IDS.serviceType), classifyTicketProduct(ticket), 'Unknown')
}

function buildTier1InboundActivityQuery(startDayKey, endDayKey) {
  return `tags:request_type_noc_tier_1 form:"${INITIAL_FORM_NAME}" created>=${startDayKey}T00:00:00Z created<=${endDayKey}T23:59:59Z`
}

function detectInboundSpike(currentCount, baselineCounts = []) {
  const safeCounts = baselineCounts
    .map((value) => asNumber(value, 0))
    .filter((value) => Number.isFinite(value) && value >= 0)

  if (!safeCounts.length) {
    return {
      flagged: currentCount >= 8,
      severity: currentCount >= 14 ? 'high' : 'warning',
      baselineAvg: 0,
      baselineMax: 0,
      ratio: currentCount > 0 ? Number.POSITIVE_INFINITY : 0,
      deltaCount: currentCount
    }
  }

  const baselineAvg = safeCounts.reduce((sum, value) => sum + value, 0) / safeCounts.length
  const baselineMax = Math.max(...safeCounts, 0)
  const deltaCount = currentCount - baselineAvg
  const ratio = baselineAvg > 0 ? currentCount / baselineAvg : Number.POSITIVE_INFINITY
  const warningThreshold = baselineAvg < 1.5
    ? Math.max(6, baselineMax + 4)
    : Math.max(Math.ceil(baselineAvg * 1.75), baselineMax + 4, Math.ceil(baselineAvg + 5))
  const highThreshold = baselineAvg < 1.5
    ? Math.max(12, baselineMax + 8)
    : Math.max(Math.ceil(baselineAvg * 2.5), baselineMax + 8, Math.ceil(baselineAvg + 8))

  const flagged = currentCount >= warningThreshold && deltaCount >= 4
  const severity = currentCount >= highThreshold && deltaCount >= 8 ? 'high' : 'warning'

  return {
    flagged,
    severity,
    baselineAvg,
    baselineMax,
    ratio,
    deltaCount
  }
}

function buildInboundAnomalyThresholds(reference = {}) {
  const baselineAvg = asNumber(reference.baselineAvg, 0)
  const baselineMax = asNumber(reference.baselineMax, 0)
  const count = asNumber(reference.count, 0)

  return {
    sustainThreshold: Math.max(
      Math.ceil(baselineAvg * 1.75),
      baselineMax + 2,
      Math.ceil(count * 0.6),
      12
    ),
    elevatedThreshold: Math.max(
      Math.ceil(baselineAvg * 1.3),
      baselineMax + 1,
      8
    ),
    settledThreshold: Math.max(
      Math.ceil(baselineAvg * 1.1),
      baselineMax,
      4
    ),
    highThreshold: Math.max(
      Math.ceil(baselineAvg * 2.5),
      baselineMax + 6,
      Math.ceil(count * 0.8),
      18
    )
  }
}

function detectSustainedInboundSpike(currentCount, priorSpike = null) {
  if (!priorSpike) {
    return {
      flagged: false,
      severity: 'warning',
      baselineAvg: 0,
      baselineMax: 0,
      ratio: 0,
      deltaCount: 0
    }
  }

  const thresholds = buildInboundAnomalyThresholds(priorSpike)
  const baselineAvg = asNumber(priorSpike.baselineAvg, 0)
  const baselineMax = asNumber(priorSpike.baselineMax, 0)
  const deltaCount = currentCount - baselineAvg
  const ratio = baselineAvg > 0 ? currentCount / baselineAvg : Number.POSITIVE_INFINITY
  const flagged = currentCount >= thresholds.sustainThreshold
  const severity = currentCount >= thresholds.highThreshold ? 'high' : 'warning'

  return {
    flagged,
    severity,
    baselineAvg,
    baselineMax,
    ratio,
    deltaCount,
    ...thresholds
  }
}

function classifyInboundAnomalyLifecycle(anomaly, countsByDay = {}, dayKeys = [], completedDayKeys = []) {
  const countText = (value) => String(asNumber(value, 0))
  const thresholds = buildInboundAnomalyThresholds(anomaly)
  const latestCompletedDayKey = completedDayKeys[completedDayKeys.length - 1] || anomaly.dayKey
  const latestCompletedCount = asNumber(countsByDay?.[latestCompletedDayKey], 0)
  const currentDayKey = dayKeys[dayKeys.length - 1] || latestCompletedDayKey
  const currentDayCount = currentDayKey !== latestCompletedDayKey ? asNumber(countsByDay?.[currentDayKey], 0) : null
  const currentDayLabel = currentDayKey && currentDayKey !== latestCompletedDayKey
    ? `${formatDayKeyLabel(currentDayKey)} so far`
    : ''

  let statusKey = anomaly.mode === 'sustained' ? 'sustained' : 'fresh'
  let statusLabel = anomaly.mode === 'sustained' ? 'Sustained high' : 'Fresh breakout'
  let statusTone = anomaly.severity === 'high' ? '#dc2626' : '#d97706'
  let statusDetail = anomaly.mode === 'sustained'
    ? `${anomaly.productType} stayed elevated into ${anomaly.dayLabel}.`
    : `${anomaly.productType} broke out on ${anomaly.dayLabel}.`

  if (latestCompletedDayKey > anomaly.dayKey) {
    if (latestCompletedCount >= thresholds.sustainThreshold) {
      statusKey = 'ongoing'
      statusLabel = 'Still high'
      statusTone = '#dc2626'
      statusDetail = `${formatDayKeyLabel(latestCompletedDayKey)} remained elevated at ${countText(latestCompletedCount)} against a pre-spike max of ${countText(anomaly.baselineMax)}.`
    } else if (latestCompletedCount >= thresholds.elevatedThreshold) {
      statusKey = 'cooling'
      statusLabel = 'Cooling'
      statusTone = '#f97316'
      statusDetail = `${formatDayKeyLabel(latestCompletedDayKey)} dropped below the peak but remained elevated at ${countText(latestCompletedCount)}.`
    } else {
      statusKey = 'died_off'
      statusLabel = 'Died off'
      statusTone = '#64748b'
      statusDetail = `${formatDayKeyLabel(latestCompletedDayKey)} settled back toward baseline at ${countText(latestCompletedCount)}.`
    }
  } else if (currentDayCount !== null) {
    if (currentDayCount >= thresholds.sustainThreshold) {
      statusKey = 'ongoing'
      statusLabel = 'Still high today'
      statusTone = '#dc2626'
      statusDetail = `${currentDayLabel} remains elevated at ${countText(currentDayCount)}.`
    } else if (currentDayCount >= thresholds.elevatedThreshold) {
      statusKey = 'cooling'
      statusLabel = 'Cooling today'
      statusTone = '#f97316'
      statusDetail = `${currentDayLabel} is lower than the spike but still elevated at ${countText(currentDayCount)}.`
    } else if (currentDayCount > 0 && currentDayCount <= thresholds.settledThreshold) {
      statusKey = 'died_off'
      statusLabel = 'Dropped off today'
      statusTone = '#64748b'
      statusDetail = `${currentDayLabel} has dropped back near baseline at ${countText(currentDayCount)}.`
    }
  }

  if (currentDayCount !== null && latestCompletedDayKey > anomaly.dayKey) {
    if (currentDayCount >= thresholds.sustainThreshold) {
      statusDetail += ` ${currentDayLabel} is still high at ${countText(currentDayCount)}.`
    } else if (currentDayCount >= thresholds.elevatedThreshold) {
      statusDetail += ` ${currentDayLabel} is cooling at ${countText(currentDayCount)}.`
    } else if (currentDayCount > 0) {
      statusDetail += ` ${currentDayLabel} is now back down at ${countText(currentDayCount)}.`
    }
  }

  return {
    statusKey,
    statusLabel,
    statusTone,
    statusDetail,
    latestCompletedDayKey,
    latestCompletedDayLabel: formatDayKeyLabel(latestCompletedDayKey),
    latestCompletedCount,
    currentDayKey: currentDayCount !== null ? currentDayKey : '',
    currentDayLabel,
    currentDayCount
  }
}

function anomalyTone(severity) {
  return severity === 'high' ? '#dc2626' : '#d97706'
}

function buildTier1InboundActivityPayload(rawTickets = [], now = dayjs()) {
  const dayKeys = listRecentDayKeys(now, T1_INBOUND_ACTIVITY_LOOKBACK_DAYS)
  const dayKeySet = new Set(dayKeys)
  const dailyTotals = new Map(dayKeys.map((dayKey) => [dayKey, 0]))
  const signalDayCounts = new Map()
  const signalProductCounts = new Map()

  for (const ticket of rawTickets) {
    const createdAt = firstText(ticket?.created_at)
    if (!createdAt) continue
    const dayKey = formatYmdInTz(new Date(createdAt))
    if (!dayKeySet.has(dayKey)) continue

    const signal = classifyT1InboundProductSignal(ticket)
    const signalLabel = signal.label
    const productGroup = signal.productGroup || classifyTicketProduct(ticket)
    dailyTotals.set(dayKey, asNumber(dailyTotals.get(dayKey), 0) + 1)

    if (!signalDayCounts.has(signalLabel)) {
      signalDayCounts.set(signalLabel, new Map(dayKeys.map((value) => [value, 0])))
    }
    if (!signalProductCounts.has(signalLabel)) {
      signalProductCounts.set(signalLabel, new Map())
    }

    const counts = signalDayCounts.get(signalLabel)
    counts.set(dayKey, asNumber(counts.get(dayKey), 0) + 1)

    const products = signalProductCounts.get(signalLabel)
    products.set(productGroup, asNumber(products.get(productGroup), 0) + 1)
  }

  const serviceRows = Array.from(signalDayCounts.entries())
    .map(([signalLabel, counts]) => {
      const countEntries = dayKeys.map((dayKey) => ({
        dayKey,
        label: formatDayKeyLabel(dayKey),
        count: asNumber(counts.get(dayKey), 0)
      }))
      const dominantProduct = Array.from(signalProductCounts.get(signalLabel)?.entries() || [])
        .sort((left, right) => right[1] - left[1])[0]?.[0] || 'Other'
      const total = countEntries.reduce((sum, row) => sum + row.count, 0)
      const peak = countEntries.reduce((max, row) => Math.max(max, row.count), 0)

      return {
        key: signalLabel,
        label: signalLabel,
        productType: signalLabel,
        signalLabel,
        serviceType: signalLabel,
        productGroup: dominantProduct,
        total,
        peak,
        countsByDay: Object.fromEntries(countEntries.map((row) => [row.dayKey, row.count])),
        countEntries
      }
    })
    .sort((left, right) => {
      if (right.total !== left.total) return right.total - left.total
      if (right.peak !== left.peak) return right.peak - left.peak
      return String(left.productType).localeCompare(String(right.productType))
    })

  const completedDayKeys = dayKeys.slice(0, -1)
  const focusDayKeys = completedDayKeys.slice(-2)
  const anomalies = []

  for (const row of serviceRows) {
    let priorFlaggedSpike = null
    for (const focusDayKey of focusDayKeys) {
      const focusIndex = completedDayKeys.indexOf(focusDayKey)
      if (focusIndex < 0) continue

      const priorDayKeys = completedDayKeys
        .slice(Math.max(0, focusIndex - T1_INBOUND_ACTIVITY_BASELINE_DAYS), focusIndex)
      if (!priorDayKeys.length) continue

      const baselineCounts = priorDayKeys.map((dayKey) => asNumber(row.countsByDay[dayKey], 0))
      const currentCount = asNumber(row.countsByDay[focusDayKey], 0)
      if (!currentCount) continue

      const spike = detectInboundSpike(currentCount, baselineCounts)
      let anomaly = null

      if (spike.flagged) {
        const ratioText = Number.isFinite(spike.ratio) ? `${spike.ratio.toFixed(1)}x` : 'new spike'
        anomaly = {
          key: `${row.productType}:${focusDayKey}`,
          label: row.productType,
          productType: row.productType,
          signalLabel: row.productType,
          serviceType: row.productType,
          productGroup: row.productGroup,
          dayKey: focusDayKey,
          dayLabel: formatDayKeyLabel(focusDayKey),
          count: currentCount,
          baselineAvg: Number(spike.baselineAvg.toFixed(1)),
          baselineMax: spike.baselineMax,
          deltaCount: Math.round(spike.deltaCount),
          ratio: Number.isFinite(spike.ratio) ? Number(spike.ratio.toFixed(2)) : null,
          severity: spike.severity,
          tone: anomalyTone(spike.severity),
          mode: 'breakout',
          detail: `${formatDayKeyLabel(focusDayKey)}: ${currentCount} tickets vs avg ${spike.baselineAvg.toFixed(1)} across the prior ${baselineCounts.length} days (prev max ${spike.baselineMax}, ${ratioText}).`
        }
      } else {
        const sustained = detectSustainedInboundSpike(currentCount, priorFlaggedSpike)
        if (sustained.flagged) {
          const ratioText = Number.isFinite(sustained.ratio) ? `${sustained.ratio.toFixed(1)}x` : 'new spike'
          anomaly = {
            key: `${row.productType}:${focusDayKey}:sustained`,
            label: row.productType,
            productType: row.productType,
            signalLabel: row.productType,
            serviceType: row.productType,
            productGroup: row.productGroup,
            dayKey: focusDayKey,
            dayLabel: formatDayKeyLabel(focusDayKey),
            count: currentCount,
            baselineAvg: Number(sustained.baselineAvg.toFixed(1)),
            baselineMax: sustained.baselineMax,
            deltaCount: Math.round(sustained.deltaCount),
            ratio: Number.isFinite(sustained.ratio) ? Number(sustained.ratio.toFixed(2)) : null,
            severity: sustained.severity,
            tone: anomalyTone(sustained.severity),
            mode: 'sustained',
            referenceDayKey: priorFlaggedSpike?.dayKey || '',
            referenceDayLabel: priorFlaggedSpike?.dayLabel || '',
            referenceCount: asNumber(priorFlaggedSpike?.count, 0),
            detail: `${formatDayKeyLabel(focusDayKey)}: ${currentCount} tickets stayed high after the ${priorFlaggedSpike?.dayLabel || 'prior'} breakout (${priorFlaggedSpike?.count || 0}), still vs baseline avg ${sustained.baselineAvg.toFixed(1)} and prior max ${sustained.baselineMax} (${ratioText}).`
          }
        }
      }

      if (anomaly) {
        anomalies.push(anomaly)
        priorFlaggedSpike = anomaly
      }
    }
  }

  const serviceRowByProductType = new Map(serviceRows.map((row) => [row.productType, row]))

  const anomalyRows = anomalies.map((anomaly) => ({
    ...anomaly,
    ...classifyInboundAnomalyLifecycle(
      anomaly,
      serviceRowByProductType.get(anomaly.productType)?.countsByDay || {},
      dayKeys,
      completedDayKeys
    )
  }))

  anomalyRows.sort((left, right) => {
    const severityRank = { high: 0, warning: 1 }
    const statusRank = { ongoing: 0, sustained: 1, fresh: 2, cooling: 3, died_off: 4 }
    const leftRank = severityRank[left.severity] ?? 9
    const rightRank = severityRank[right.severity] ?? 9
    if (leftRank !== rightRank) return leftRank - rightRank
    const leftStatusRank = statusRank[left.statusKey] ?? 9
    const rightStatusRank = statusRank[right.statusKey] ?? 9
    if (leftStatusRank !== rightStatusRank) return leftStatusRank - rightStatusRank
    if (String(right.dayKey) !== String(left.dayKey)) return String(right.dayKey).localeCompare(String(left.dayKey))
    if (right.deltaCount !== left.deltaCount) return right.deltaCount - left.deltaCount
    if ((right.ratio || 0) !== (left.ratio || 0)) return (right.ratio || 0) - (left.ratio || 0)
    return right.count - left.count
  })

  const focusServices = Array.from(new Set([
    ...anomalyRows.map((row) => row.productType),
    ...serviceRows.map((row) => row.productType)
  ])).slice(0, T1_INBOUND_ACTIVITY_MAX_SERIES)

  const trendRows = dayKeys.map((dayKey) => {
    const row = {
      dayKey,
      label: formatDayKeyLabel(dayKey),
      total: asNumber(dailyTotals.get(dayKey), 0)
    }
    focusServices.forEach((serviceType, index) => {
      const serviceRow = serviceRows.find((entry) => entry.productType === serviceType)
      row[`series_${index + 1}`] = asNumber(serviceRow?.countsByDay?.[dayKey], 0)
    })
    return row
  })

  const trendServices = focusServices.map((serviceType, index) => {
    const matchingAnomaly = anomalyRows.find((row) => row.productType === serviceType)
    const palette = ['#dc2626', '#f97316', '#22c55e', '#38bdf8', '#8b5cf6']
    return {
      key: `series_${index + 1}`,
      label: serviceType,
      tone: matchingAnomaly?.tone || palette[index % palette.length]
    }
  })

  return {
    generatedAt: now.toISOString(),
    lookbackDays: T1_INBOUND_ACTIVITY_LOOKBACK_DAYS,
    baselineDays: T1_INBOUND_ACTIVITY_BASELINE_DAYS,
    dayKeys,
    dailyTotals: dayKeys.map((dayKey) => ({
      dayKey,
      label: formatDayKeyLabel(dayKey),
      count: asNumber(dailyTotals.get(dayKey), 0)
    })),
    serviceRows: serviceRows.slice(0, 18),
    anomalies: anomalyRows.slice(0, 18),
    trendRows,
    trendServices
  }
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

function humanizeFieldChoice(value) {
  const text = asText(value)
  if (!text) return ''

  const uppercaseWords = new Set(['p1', 'p2', 'p3', 'p4', 'fttb', 'ftth', 'mnt', 'dfa', 'isp', 'nld', 'vip', 'noc'])

  return text
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase()
      if (uppercaseWords.has(normalized)) return normalized.toUpperCase()
      return normalized.charAt(0).toUpperCase() + normalized.slice(1)
    })
    .join(' ')
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
    organizationName: firstText(ticket.organization_name, ticket.organization?.name, ticket.organization?.details?.name, ''),
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
  nextUrl.searchParams.set('page[size]', String(SEARCH_EXPORT_PAGE_SIZE))

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

async function fetchZendeskTicketAudits(ticketId) {
  const headers = makeZendeskHeaders()
  let nextUrl = new URL(`https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}/audits.json`)
  nextUrl.searchParams.set('per_page', String(T1_AUDIT_PAGE_SIZE))

  const audits = []
  let page = 0

  while (nextUrl && page < T1_AUDIT_MAX_PAGES) {
    const data = await fetchJsonWithTimeout(nextUrl.toString(), { headers, timeoutMs: 30000 })
    const batch = Array.isArray(data?.audits) ? data.audits : []
    audits.push(...batch)

    const nextPage = asText(data?.next_page)
    nextUrl = nextPage ? new URL(nextPage) : null
    page += 1
  }

  return audits
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

function buildTelephonyQueueWaitingSummary(telephony) {
  return [...(telephony?.queues || [])]
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
}

function buildTelephonyMissedAgentSummary(telephony) {
  return [...(telephony?.agents || [])]
    .map((row) => ({
      key: `${row.name || 'Unknown'}-${row.queue || 'No queue'}`,
      label: row.name || 'Unknown agent',
      tone: '#dc2626',
      count: asNumber(row.missedCalls, 0),
      queue: row.queue || 'No queue'
    }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count)
}

function findTier1VoiceQueue(telephony) {
  return (telephony?.queues || []).find((row) => String(row.name || '').toLowerCase() === TIER1_VOICE_QUEUE_NAME.toLowerCase())
    || (telephony?.queues || []).find((row) => String(row.name || '').toLowerCase().includes(TIER1_VOICE_QUEUE_NAME.toLowerCase()))
    || null
}

function buildTelephonyPulsePayload(telephony) {
  const tier1VoiceQueue = findTier1VoiceQueue(telephony)
  return {
    generatedAt: new Date().toISOString(),
    available: Boolean(telephony?.available),
    reason: telephony?.reason || '',
    summary: telephony?.summary || null,
    queues: (telephony?.queues || []).slice(0, 100),
    agents: (telephony?.agents || []).slice(0, 100),
    hourly: (telephony?.hourly || []).slice(0, 48),
    queueWaitingSummary: buildTelephonyQueueWaitingSummary(telephony).slice(0, 24),
    missedAgentSummary: buildTelephonyMissedAgentSummary(telephony).slice(0, 24),
    tier1: tier1VoiceQueue ? {
      queueName: tier1VoiceQueue.name || TIER1_VOICE_QUEUE_NAME,
      waiting: asNumber(tier1VoiceQueue.waiting, 0),
      answered: asNumber(tier1VoiceQueue.answered, 0),
      missed: asNumber(tier1VoiceQueue.missed, 0),
      avgAnswerSeconds: asNumber(tier1VoiceQueue.avgAnswerSeconds, 0),
      maxQueueSeconds: asNumber(tier1VoiceQueue.maxQueueSeconds, 0),
      slaBreached: asNumber(tier1VoiceQueue.maxQueueSeconds, 0) > TIER1_VOICE_SLA_SECONDS
    } : null
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
    t1WorkflowOwnerSummary: Array.isArray(snapshot?.trends?.t1WorkflowOwnerSummary) ? snapshot.trends.t1WorkflowOwnerSummary : [],
    t1EscalationPathSummary: Array.isArray(snapshot?.trends?.t1EscalationPathSummary) ? snapshot.trends.t1EscalationPathSummary : [],
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

async function readJsonAutomationSetting(key) {
  const row = await prisma.automationSetting.findUnique({ where: { key } })
  return row?.value && typeof row.value === 'object' ? row.value : null
}

async function writeJsonAutomationSetting(key, value, updatedBy = 'system') {
  await prisma.automationSetting.upsert({
    where: { key },
    update: {
      value,
      updatedBy: asText(updatedBy) || 'system'
    },
    create: {
      key,
      value,
      updatedBy: asText(updatedBy) || 'system'
    }
  })
}

async function getTier1InboundActivitySnapshot(now = dayjs(), requestedBy = 'system') {
  const cached = await readJsonAutomationSetting(T1_INBOUND_ACTIVITY_CACHE_KEY)
  if (isCachedPayloadFresh(cached, T1_INBOUND_ACTIVITY_CACHE_TTL_MS)) {
    return cached
  }

  const dayKeys = listRecentDayKeys(now, T1_INBOUND_ACTIVITY_LOOKBACK_DAYS)
  const query = buildTier1InboundActivityQuery(dayKeys[0], dayKeys[dayKeys.length - 1])
  const rawTickets = await fetchZendeskExport(query)
  const payload = buildTier1InboundActivityPayload(rawTickets, now)
  await writeJsonAutomationSetting(T1_INBOUND_ACTIVITY_CACHE_KEY, payload, requestedBy)
  return payload
}

function extractLatestAuditPlayClock(ticket, pLevel, audits = []) {
  const policy = getT1PlayPolicy(pLevel)
  if (!policy || policy.exactClock) return null

  const metricFields = new Set(getT1PlayMetricKeys(policy))
  const candidates = []

  for (const audit of audits) {
    const createdAt = asText(audit?.created_at)
    if (!createdAt) continue

    for (const event of audit?.events || []) {
      if (String(event?.type) !== 'Change') continue
      const fieldName = asText(event?.field_name)
      if (metricFields.has(fieldName) && event?.value) {
        const targetMinutes = Number(event?.value?.minutes || policy.targetMinutes)
        candidates.push({
          ticketId: String(ticket.id),
          pLevel,
          playPolicyTitle: policy.policyTitle,
          playMetricKey: fieldName || policy.metricKey,
          playTargetMinutes: targetMinutes,
          timerAnchorAt: createdAt,
          timerAnchorMode: `audit_${fieldName}`,
          playClockExact: true,
          playClockSource: 'Zendesk ticket audits cached on the backend keep this play clock anchored to the latest real timer reset.',
          lastTicketUpdatedAt: ticket.updated_at || null,
          lastAuditCreatedAt: createdAt
        })
      } else if (fieldName === 'sla_policy' && asText(event?.value) === policy.policyTitle) {
        candidates.push({
          ticketId: String(ticket.id),
          pLevel,
          playPolicyTitle: policy.policyTitle,
          playMetricKey: policy.metricKey,
          playTargetMinutes: policy.targetMinutes,
          timerAnchorAt: createdAt,
          timerAnchorMode: 'audit_sla_policy',
          playClockExact: true,
          playClockSource: 'Zendesk ticket audits cached on the backend keep this play clock anchored to the latest real timer reset.',
          lastTicketUpdatedAt: ticket.updated_at || null,
          lastAuditCreatedAt: createdAt
        })
      }
    }
  }

  if (!candidates.length) return null
  return candidates.sort((left, right) => Date.parse(right.timerAnchorAt) - Date.parse(left.timerAnchorAt))[0]
}

async function syncTier1TimerCache(rawTier1OpenTickets, requestedBy = 'system') {
  const existingCache = await readJsonAutomationSetting(T1_TIMER_CACHE_KEY)
  const existingMap = existingCache?.byTicketId && typeof existingCache.byTicketId === 'object'
    ? existingCache.byTicketId
    : {}

  const candidateTickets = rawTier1OpenTickets.filter((ticket) => ['P2', 'P3', 'P4'].includes(classifyT1ActionLevel(ticket)))
  const nextByTicketId = {}

  for (const ticket of candidateTickets) {
    const ticketId = String(ticket.id)
    const pLevel = classifyT1ActionLevel(ticket)
    const cached = existingMap[ticketId]

    if (
      cached
      && cached.pLevel === pLevel
      && asText(cached.lastTicketUpdatedAt) === asText(ticket.updated_at)
      && asText(cached.timerAnchorAt)
    ) {
      nextByTicketId[ticketId] = cached
      continue
    }

    const audits = await fetchZendeskTicketAudits(ticket.id).catch(() => [])
    const exactClock = extractLatestAuditPlayClock(ticket, pLevel, audits)

    if (exactClock) {
      nextByTicketId[ticketId] = exactClock
      continue
    }

    if (cached?.timerAnchorAt) {
      nextByTicketId[ticketId] = {
        ...cached,
        pLevel,
        lastTicketUpdatedAt: ticket.updated_at || null
      }
    }
  }

  const nextCache = {
    syncedAt: new Date().toISOString(),
    byTicketId: nextByTicketId
  }

  await writeJsonAutomationSetting(T1_TIMER_CACHE_KEY, nextCache, requestedBy)
  return nextByTicketId
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

async function collectLiveSnapshot(requestedBy = 'system') {
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
    telephony,
    t1InboundActivity
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
    }),
    safe('tier1-inbound-activity', () => getTier1InboundActivitySnapshot(now, requestedBy), {
      generatedAt: null,
      lookbackDays: T1_INBOUND_ACTIVITY_LOOKBACK_DAYS,
      baselineDays: T1_INBOUND_ACTIVITY_BASELINE_DAYS,
      dayKeys: [],
      dailyTotals: [],
      serviceRows: [],
      anomalies: [],
      trendRows: [],
      trendServices: []
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

  const t1TimerCacheByTicketId = await safe('tier1-timer-cache', () => syncTier1TimerCache(rawTier1OpenTickets, requestedBy), {})
  const tier1Tickets = sortByAgeDesc(
    rawTier1OpenTickets.map((ticket) => buildT1ActionRow(ticket, now, t1TimerCacheByTicketId[String(ticket.id)] || null))
  )
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
    const trackedRows = rows.filter((row) => row.playClockActive)
    const breached = trackedRows.filter((row) => row.dueBucket === 'BREACHED').length
    const dueSoon = trackedRows.filter((row) => ['Due <=15m', 'Due <=30m'].includes(row.dueBucket)).length
    const safe = Math.max(0, trackedRows.length - breached - dueSoon)
    return {
      key: definition.key,
      label: definition.label,
      tone: definition.tone,
      count: rows.length,
      breached,
      dueSoon,
      safe,
      tracked: trackedRows.length,
      noActiveTimer: rows.filter((row) => !row.playClockActive).length,
      playPolicyTitle: rows.find((row) => row.playPolicyTitle)?.playPolicyTitle || '',
      playTargetMinutes: rows.find((row) => Number.isFinite(Number(row.playTargetMinutes)))?.playTargetMinutes || null,
      fttb: rows.filter((row) => row.product === 'FTTB').length,
      ftth: rows.filter((row) => row.product === 'FTTH').length,
      other: rows.filter((row) => row.product === 'Other').length
    }
  })

  const t1ProductSummary = summarizeRowsByKey(tier1Tickets, 'product', { FTTB: '#0f766e', FTTH: '#2563eb', Other: '#64748b' })
  const t1StatusSummary = summarizeRowsByKey(tier1Tickets, 'status', T1_STATUS_TONES)
  const t1OperationalStateSummary = summarizeRowsByKey(tier1Tickets, 'operationalState', {
    'Active support': '#0f766e',
    'Active support blitz': '#14b8a6',
    'Pending maintenance': '#2563eb',
    'Pending vendor': '#d97706',
    'Pending client info': '#ea580c',
    'Pending outage closure': '#7c3aed',
    Deferred: '#475569',
    'Change control': '#8b5cf6',
    'Pending Tier 2': '#475569',
    'Pending Tier 3': '#475569',
    'Pending PMT': '#475569',
    'Pending 365': '#475569',
    'Pending management': '#475569',
    'Pending RCA': '#475569',
    'Pending COC': '#475569',
    'Pending change control': '#475569',
    'Pending provisioning': '#475569',
    'Pending facilities': '#475569',
    'Pending review': '#475569',
    'On hold': '#7c3aed',
    'New / unattended': '#dc2626',
    'Solved / cleanup': '#16a34a',
    'Closed / cleanup': '#475569',
    'Needs review': '#64748b'
  })
  const t1EscalationPathSummary = summarizeRowsByKey(tier1Tickets, 'escalationPath', {
    'Tier 1 desk': '#0f766e',
    Maintenance: '#2563eb',
    'DFA / vendor': '#d97706',
    'Linked outage': '#7c3aed',
    'ISP / customer': '#ea580c',
    'Vendor / carrier': '#d97706',
    'Change control': '#8b5cf6',
    'Tier 1 review': '#475569'
  })
  const t1WorkflowOwnerSummary = summarizeRowsByKey(tier1Tickets, 'workflowOwner', T1_WORKFLOW_OWNER_TONES)
  const t1DueBucketSummary = T1_PLAY_BUCKET_ORDER.map((bucket) => ({
    key: bucket,
    label: bucket,
    tone: T1_PLAY_BUCKET_TONES[bucket] || '#64748b',
    count: tier1Tickets.filter((row) => row.dueBucket === bucket).length
  }))
  const t1UrgentRows = sortByAgeDesc(
    tier1Tickets.filter((row) => ['BREACHED', 'Due <=15m', 'Due <=30m'].includes(row.dueBucket))
  )
  const t1P1UnattendedRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.pLevel === 'P1' && normalizeStatus(row.status) === 'new')
  )
  const t1P1BreachedRows = t1P1UnattendedRows.filter((row) => row.p1ActionBreached)
  const t1ChangeControlRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.pLevel === 'Change')
  )
  const t1DeskRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.workflowOwner === 'With Tier 1')
  )
  const t1MaintenanceRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.workflowOwner === 'With maintenance')
  )
  const t1ClientPendingRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.workflowOwner === 'Waiting on client / ISP')
  )
  const t1ParkedRows = sortByAgeDesc(
    tier1Tickets.filter((row) => row.parkedTimerActive || row.workflowOwner === 'Deferred / parked')
  )
  const t1AutomationOpenSummary = summarizeRuleHits(rawTier1OpenTickets, T1_AUTOMATION_ROUTE_RULES)
  const t1AutomationCreatedTodaySummary = summarizeRuleHits(rawTier1CreatedToday, T1_AUTOMATION_ROUTE_RULES)
  const t1InboundAnomalies = Array.isArray(t1InboundActivity?.anomalies) ? t1InboundActivity.anomalies : []
  const t1InboundFocus = t1InboundAnomalies[0] || null
  const t1InboundLatest = [...t1InboundAnomalies].sort((left, right) => String(right.dayKey || '').localeCompare(String(left.dayKey || '')))[0] || null

  const t2ActiveRows = tier2Tickets.filter((row) => !['pending', 'new'].includes(normalizeStatus(row.status)))
  const t2PartySummary = summarizeRowsByKey(t2ActiveRows, 'party')
  const t2ProductSummary = summarizeRowsByKey(tier2Tickets, 'product', { FTTB: '#0f766e', FTTH: '#2563eb', Other: '#64748b' })
  const t2ServiceTypeSummary = summarizeRowsByKey(tier2Tickets, 'serviceType')
  const t2AgeBucketSummary = summarizeAgeBuckets(tier2Tickets)
  const outageRegionImpactSummary = summarizeTotalsByKey(outageRows, 'region', 'subscriberImpact')
  const outageServiceTypeSummary = summarizeRowsByKey(outageRows, 'serviceType')
  const backhaulOwnerSummary = summarizeRowsByKey(backhaulRows, 'owner')
  const telephonyQueueWaitingSummary = buildTelephonyQueueWaitingSummary(telephony)
  const telephonyMissedAgentSummary = buildTelephonyMissedAgentSummary(telephony)
  const tier1VoiceQueue = findTier1VoiceQueue(telephony)
  const tier1VoiceAgents = (telephony.agents || []).filter((row) => {
    const queue = String(row.queue || '').toLowerCase()
    const targetQueue = String(tier1VoiceQueue?.name || TIER1_VOICE_QUEUE_NAME).toLowerCase()
    return queue && targetQueue && queue.includes(targetQueue)
  })

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
    tier1PlayClockTracked: tier1Tickets.filter((row) => row.playClockActive).length,
    tier1PlayClockBreached: tier1Tickets.filter((row) => row.dueBucket === 'BREACHED').length,
    tier1PlayClockDueSoon: tier1Tickets.filter((row) => ['Due <=15m', 'Due <=30m'].includes(row.dueBucket)).length,
    tier1ParkedTimers: t1ParkedRows.length,
    tier1ChangeControlOpen: t1ChangeControlRows.length,
    tier1WithDesk: t1DeskRows.length,
    tier1WithMaintenance: t1MaintenanceRows.length,
    tier1WaitingClient: t1ClientPendingRows.length,
    tier1LinkedOutage: tier1Tickets.filter((row) => row.workflowOwner === 'Linked outage / closure').length,
    tier1WithVendor: tier1Tickets.filter((row) => row.workflowOwner === 'With vendor / carrier').length,
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
    telephonyTier1AgentTotal: tier1VoiceAgents.length,
    telephonyTier1AgentLoggedIn: tier1VoiceAgents.filter((row) => row.loggedIn).length,
    telephonyTier1AgentRegistered: tier1VoiceAgents.filter((row) => row.registered).length,
    telephonyTier1AgentBusy: tier1VoiceAgents.filter((row) => asNumber(row.activeCalls, 0) > 0).length,
    telephonyTier1SlaBreached: tier1VoiceQueue
      ? asNumber(tier1VoiceQueue.maxQueueSeconds, 0) > TIER1_VOICE_SLA_SECONDS
        || asNumber(tier1VoiceQueue.avgAnswerSeconds, 0) > TIER1_VOICE_SLA_SECONDS
      : null,
    t1InboundAnomalyCount: t1InboundAnomalies.length,
    t1InboundHighAnomalyCount: t1InboundAnomalies.filter((row) => row.severity === 'high').length,
    t1InboundSustainedCount: t1InboundAnomalies.filter((row) => row.mode === 'sustained').length,
    t1InboundFocusLabel: t1InboundFocus?.serviceType || '',
    t1InboundFocusDayKey: t1InboundFocus?.dayKey || '',
    t1InboundFocusDayLabel: t1InboundFocus?.dayLabel || '',
    t1InboundFocusCount: asNumber(t1InboundFocus?.count, 0),
    t1InboundFocusMode: t1InboundFocus?.mode || '',
    t1InboundFocusStatusKey: t1InboundFocus?.statusKey || '',
    t1InboundFocusStatusLabel: t1InboundFocus?.statusLabel || '',
    t1InboundFocusStatusTone: t1InboundFocus?.statusTone || '',
    t1InboundFocusStatusDetail: t1InboundFocus?.statusDetail || '',
    t1InboundLatestDayKey: t1InboundLatest?.dayKey || '',
    t1InboundLatestDayLabel: t1InboundLatest?.dayLabel || '',
    t1InboundLatestCount: asNumber(t1InboundLatest?.count, 0)
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
      t1WorkflowOwnerSummary,
      t1EscalationPathSummary,
      t1DueBucketSummary,
      t1AutomationOpenSummary,
      t1AutomationCreatedTodaySummary,
      t1ReceivedComparisonSeries: t1ReceivedComparisonSeries.slice(0, 24),
      t1SolvedComparisonSeries: t1SolvedComparisonSeries.slice(0, 24),
      t1InboundDailyTotals: Array.isArray(t1InboundActivity?.dailyTotals) ? t1InboundActivity.dailyTotals : [],
      t1InboundAnomalyTrendRows: Array.isArray(t1InboundActivity?.trendRows) ? t1InboundActivity.trendRows : [],
      t1InboundAnomalyTrendServices: Array.isArray(t1InboundActivity?.trendServices) ? t1InboundActivity.trendServices : [],
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
      t1WorkflowOwnerSummary,
      t1EscalationPathSummary,
      t1AutomationOpenSummary,
      t1AutomationCreatedTodaySummary,
      t1InboundAnomalies: t1InboundAnomalies.slice(0, 12),
      t1InboundDailyTotals: Array.isArray(t1InboundActivity?.dailyTotals) ? t1InboundActivity.dailyTotals : [],
      t1InboundServiceRows: Array.isArray(t1InboundActivity?.serviceRows) ? t1InboundActivity.serviceRows : [],
      tier1DeskTickets: t1DeskRows.slice(0, 150),
      tier1MaintenanceTickets: t1MaintenanceRows.slice(0, 150),
      tier1ClientPendingTickets: t1ClientPendingRows.slice(0, 150),
      tier1ParkedTickets: t1ParkedRows.slice(0, 150),
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
  return readJsonAutomationSetting(SNAPSHOT_KEY)
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
    const snapshot = await collectLiveSnapshot(requestedBy)
    await writeJsonAutomationSetting(SNAPSHOT_KEY, snapshot, requestedBy)
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

export async function getNocMonitoringTelephonyPulse({ forceFresh = false } = {}) {
  const cachedAt = Date.parse(telephonyPulseCache?.generatedAt || '')
  const cacheFresh = !forceFresh
    && telephonyPulseCache
    && Number.isFinite(cachedAt)
    && (Date.now() - cachedAt) <= TELEPHONY_PULSE_TTL_MS

  if (cacheFresh) {
    return telephonyPulseCache
  }

  if (telephonyPulsePromise) return telephonyPulsePromise

  telephonyPulsePromise = (async () => {
    try {
      const telephony = await fetchTelephonySnapshot()
      const pulse = buildTelephonyPulsePayload(telephony)
      telephonyPulseCache = pulse
      return pulse
    } catch (error) {
      const pulse = buildTelephonyPulsePayload({
        available: false,
        reason: error?.message || 'Telephony pulse unavailable.',
        queues: [],
        agents: [],
        hourly: [],
        summary: null
      })
      telephonyPulseCache = pulse
      return pulse
    } finally {
      telephonyPulsePromise = null
    }
  })()

  return telephonyPulsePromise
}

export function getNocMonitoringConfigMeta() {
  return {
    snapshotKey: SNAPSHOT_KEY,
    staleAfterMs: SOFT_TTL_MS,
    searchExportPageSize: SEARCH_EXPORT_PAGE_SIZE,
    telephonyPulseTtlMs: TELEPHONY_PULSE_TTL_MS,
    hardStaleMs: HARD_STALE_MS,
    historyBucketMinutes: HISTORY_BUCKET_MINUTES,
    historyWindowHours: HISTORY_WINDOW_HOURS,
    historyRetentionDays: HISTORY_RETENTION_DAYS,
    t1InboundActivityCacheTtlMs: T1_INBOUND_ACTIVITY_CACHE_TTL_MS,
    dashboardNote: 'This dashboard reads from a cached backend snapshot so the browser stays light and Zendesk does not get hammered by repeated live panel queries.',
    telephonyConfigured: Boolean(ILLATION_STATS_URL),
    telephonyAuthConfigured: Boolean(ILLATION_AUTH_HEADER || ILLATION_BEARER_TOKEN || ILLATION_API_KEY || ILLATION_ALLOW_ANON)
  }
}
