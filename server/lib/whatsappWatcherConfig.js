import prisma from './prisma.js'
import { parseHourThresholds, safeStr } from './watcherUtils.js'

const CONFIG_KEY = 'whatsapp_watchers'
const CACHE_TTL_MS = 30 * 1000

const DEFAULT_VIP_TAG_RULES = [
  {
    key: 'vip-carrier-down',
    tag: String(process.env.VIP_TAG || 'iris_vip_carrier_down').trim(),
    title: 'VIP alert | Carrier down',
    reason: 'carrier-down tag',
    includePriority: true
  },
  {
    key: 'rise-traffic-drop',
    tag: String(process.env.VIP_RISE_TRAFFIC_TAG || 'iris_rise_traffic').trim(),
    title: 'VIP alert | RISE traffic drop',
    reason: 'rise-traffic tag',
    includePriority: false
  }
].filter((rule) => rule.tag)

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function parseBoolean(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false
  }
  return fallback
}

function parseOptionalString(value, fallback = '', maxLength = 500) {
  const text = safeStr(value).trim()
  if (!text) return fallback
  return text.slice(0, maxLength)
}

function parseNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(parsed, min), max)
}

function parseWholeNumber(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  return Math.round(parseNumber(value, fallback, { min, max }))
}

function parseThresholds(value, fallback) {
  if (Array.isArray(value)) {
    return parseHourThresholds(value.join(','), fallback)
  }
  return parseHourThresholds(value, fallback)
}

function normalizeGroupIdValue(value) {
  const text = safeStr(value).trim()
  if (!text) return ''
  return text.includes('@') ? text : `${text}@g.us`
}

function parseGroupIds(value, fallback = []) {
  const incoming = Array.isArray(value)
    ? value
    : safeStr(value)
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean)

  const resolved = incoming.length ? incoming : (Array.isArray(fallback) ? fallback : [fallback])

  return [...new Set(
    resolved
      .map((item) => normalizeGroupIdValue(item))
      .filter(Boolean)
  )].slice(0, 25)
}

function buildDefaultConfig() {
  return {
    nld: {
      enabled: true,
      groupIds: parseGroupIds(
        process.env.WHATSAPP_NLD_GROUP_IDS || process.env.WHATSAPP_NLD_GROUP_ID || '',
        []
      ),
      pollMs: Number(process.env.NLD_POLL_MS || 5 * 60 * 1000),
      windowMinutes: Number(process.env.NLD_WINDOW_MINUTES || 60),
      breachThresholdsHours: parseHourThresholds(
        process.env.NLD_BREACH_THRESHOLDS_HOURS,
        [4, 8, 12, 24]
      ),
      partialLookbackHours: Number(process.env.NLD_PARTIAL_LOOKBACK_HOURS || 24),
      clusterWindowHours: Number(process.env.NLD_CLUSTER_WINDOW_HOURS || 3),
      clusterMinEvents: Number(process.env.NLD_CLUSTER_MIN_EVENTS || 3),
      notLoggedMinutes: Number(process.env.NLD_NOT_LOGGED_MINUTES || 30),
      resolvedLookbackHours: Number(process.env.NLD_RESOLVED_LOOKBACK_HOURS || 24),
      templates: {
        recentTitle: 'NLD outage logged',
        breachTitle: 'NLD outage aging breach',
        resolvedTitle: 'NLD outage resolved',
        partialClusterTitle: 'Partial NLD cluster detected',
        partialNotLoggedTitle: 'Partial NLD not linked to outage',
        breachAction: 'escalate and request outage update',
        partialClusterAction: 'validate common cause and log or link outage if needed',
        partialNotLoggedAction: 'log outage or link to existing outage'
      }
    },
    backhaul: {
      enabled: true,
      groupIds: parseGroupIds(
        process.env.WHATSAPP_BACKHAUL_GROUP_IDS || process.env.WHATSAPP_BACKHAUL_GROUP_ID || '',
        []
      ),
      pollMs: Number(process.env.BACKHAUL_POLL_MS || 5 * 60 * 1000),
      lookbackHours: Number(process.env.BACKHAUL_LOOKBACK_HOURS || 4),
      resolvedLookbackHours: Number(process.env.BACKHAUL_RESOLVED_LOOKBACK_HOURS || 24),
      tag: String(process.env.BACKHAUL_TAG || 'iris_backhaul_down').trim(),
      breachThresholdsHours: parseHourThresholds(
        process.env.BACKHAUL_BREACH_THRESHOLDS_HOURS,
        [4, 8, 12, 24]
      ),
      templates: {
        newTitle: 'Backhaul alert',
        breachTitle: 'Backhaul aging breach',
        resolvedTitle: 'Backhaul resolved',
        newAction: 'validate backhaul impact and update stakeholders',
        breachAction: 'chase update or escalate carrier follow-up'
      }
    },
    majorOutage: {
      enabled: true,
      groupIds: parseGroupIds(
        process.env.WHATSAPP_MAJOR_OUTAGE_GROUP_IDS || process.env.WHATSAPP_MAJOR_OUTAGE_GROUP_ID || '',
        []
      ),
      pollMs: Number(process.env.MAJOR_OUTAGE_POLL_MS || 5 * 60 * 1000),
      lookbackHours: Number(process.env.MAJOR_OUTAGE_LOOKBACK_HOURS || 4),
      resolvedLookbackHours: Number(process.env.MAJOR_OUTAGE_RESOLVED_LOOKBACK_HOURS || 24),
      breachThresholdsHours: parseHourThresholds(
        process.env.MAJOR_OUTAGE_BREACH_THRESHOLDS_HOURS,
        [2, 4, 8, 12]
      ),
      templates: {
        newTitle: 'Major outage logged',
        breachTitle: 'Major outage aging breach',
        resolvedTitle: 'Major outage resolved',
        newAction: 'validate customer impact and keep stakeholders updated',
        breachAction: 'chase outage update or escalate restoration actions'
      }
    },
    vip: {
      enabled: true,
      groupIds: parseGroupIds(
        process.env.WHATSAPP_VIP_GROUP_IDS || process.env.WHATSAPP_VIP_GROUP_ID || '',
        []
      ),
      pollMs: Number(process.env.VIP_POLL_MS || 2 * 60 * 1000),
      lookbackHours: Number(process.env.VIP_LOOKBACK_HOURS || 2),
      orgId: String(process.env.VIP_ORG_ID || '42757142385041').trim(),
      templates: {
        orgTitle: 'VIP ticket logged | Telemedia',
        orgReason: 'organization match'
      },
      tagRules: DEFAULT_VIP_TAG_RULES
    }
  }
}

function sanitizeTagRule(rule, fallbackRule = {}, index = 0) {
  const fallback = fallbackRule || {}
  const keyBase = parseOptionalString(rule?.key, parseOptionalString(fallback.key, `rule-${index + 1}`), 80)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-+|-+$/g, '') || `rule-${index + 1}`

  return {
    key: keyBase,
    tag: parseOptionalString(rule?.tag, parseOptionalString(fallback.tag, ''), 120),
    title: parseOptionalString(rule?.title, parseOptionalString(fallback.title, 'VIP alert'), 180),
    reason: parseOptionalString(rule?.reason, parseOptionalString(fallback.reason, ''), 180),
    includePriority: parseBoolean(rule?.includePriority, parseBoolean(fallback.includePriority, true))
  }
}

function sanitizeConfig(input = {}, defaults = buildDefaultConfig()) {
  const source = input && typeof input === 'object' ? input : {}
  const vipFallbackRules = defaults.vip.tagRules || []
  const vipIncomingRules = Array.isArray(source.vip?.tagRules) ? source.vip.tagRules : vipFallbackRules

  return {
    nld: {
      enabled: parseBoolean(source.nld?.enabled, defaults.nld.enabled),
      groupIds: parseGroupIds(source.nld?.groupIds ?? source.nld?.groupId, defaults.nld.groupIds),
      pollMs: parseWholeNumber(source.nld?.pollMs, defaults.nld.pollMs, { min: 30 * 1000, max: 60 * 60 * 1000 }),
      windowMinutes: parseWholeNumber(source.nld?.windowMinutes, defaults.nld.windowMinutes, { min: 5, max: 24 * 60 }),
      breachThresholdsHours: parseThresholds(source.nld?.breachThresholdsHours, defaults.nld.breachThresholdsHours),
      partialLookbackHours: parseWholeNumber(source.nld?.partialLookbackHours, defaults.nld.partialLookbackHours, { min: 1, max: 24 * 14 }),
      clusterWindowHours: parseWholeNumber(source.nld?.clusterWindowHours, defaults.nld.clusterWindowHours, { min: 1, max: 24 * 7 }),
      clusterMinEvents: parseWholeNumber(source.nld?.clusterMinEvents, defaults.nld.clusterMinEvents, { min: 2, max: 50 }),
      notLoggedMinutes: parseWholeNumber(source.nld?.notLoggedMinutes, defaults.nld.notLoggedMinutes, { min: 5, max: 24 * 60 }),
      resolvedLookbackHours: parseWholeNumber(source.nld?.resolvedLookbackHours, defaults.nld.resolvedLookbackHours, { min: 1, max: 24 * 14 }),
      templates: {
        recentTitle: parseOptionalString(source.nld?.templates?.recentTitle, defaults.nld.templates.recentTitle, 180),
        breachTitle: parseOptionalString(source.nld?.templates?.breachTitle, defaults.nld.templates.breachTitle, 180),
        resolvedTitle: parseOptionalString(source.nld?.templates?.resolvedTitle, defaults.nld.templates.resolvedTitle, 180),
        partialClusterTitle: parseOptionalString(source.nld?.templates?.partialClusterTitle, defaults.nld.templates.partialClusterTitle, 180),
        partialNotLoggedTitle: parseOptionalString(source.nld?.templates?.partialNotLoggedTitle, defaults.nld.templates.partialNotLoggedTitle, 180),
        breachAction: parseOptionalString(source.nld?.templates?.breachAction, defaults.nld.templates.breachAction, 220),
        partialClusterAction: parseOptionalString(source.nld?.templates?.partialClusterAction, defaults.nld.templates.partialClusterAction, 220),
        partialNotLoggedAction: parseOptionalString(source.nld?.templates?.partialNotLoggedAction, defaults.nld.templates.partialNotLoggedAction, 220)
      }
    },
    backhaul: {
      enabled: parseBoolean(source.backhaul?.enabled, defaults.backhaul.enabled),
      groupIds: parseGroupIds(source.backhaul?.groupIds ?? source.backhaul?.groupId, defaults.backhaul.groupIds),
      pollMs: parseWholeNumber(source.backhaul?.pollMs, defaults.backhaul.pollMs, { min: 30 * 1000, max: 60 * 60 * 1000 }),
      lookbackHours: parseWholeNumber(source.backhaul?.lookbackHours, defaults.backhaul.lookbackHours, { min: 1, max: 24 * 14 }),
      resolvedLookbackHours: parseWholeNumber(source.backhaul?.resolvedLookbackHours, defaults.backhaul.resolvedLookbackHours, { min: 1, max: 24 * 14 }),
      tag: parseOptionalString(source.backhaul?.tag, defaults.backhaul.tag, 120),
      breachThresholdsHours: parseThresholds(source.backhaul?.breachThresholdsHours, defaults.backhaul.breachThresholdsHours),
      templates: {
        newTitle: parseOptionalString(source.backhaul?.templates?.newTitle, defaults.backhaul.templates.newTitle, 180),
        breachTitle: parseOptionalString(source.backhaul?.templates?.breachTitle, defaults.backhaul.templates.breachTitle, 180),
        resolvedTitle: parseOptionalString(source.backhaul?.templates?.resolvedTitle, defaults.backhaul.templates.resolvedTitle, 180),
        newAction: parseOptionalString(source.backhaul?.templates?.newAction, defaults.backhaul.templates.newAction, 220),
        breachAction: parseOptionalString(source.backhaul?.templates?.breachAction, defaults.backhaul.templates.breachAction, 220)
      }
    },
    majorOutage: {
      enabled: parseBoolean(source.majorOutage?.enabled, defaults.majorOutage.enabled),
      groupIds: parseGroupIds(source.majorOutage?.groupIds ?? source.majorOutage?.groupId, defaults.majorOutage.groupIds),
      pollMs: parseWholeNumber(source.majorOutage?.pollMs, defaults.majorOutage.pollMs, { min: 30 * 1000, max: 60 * 60 * 1000 }),
      lookbackHours: parseWholeNumber(source.majorOutage?.lookbackHours, defaults.majorOutage.lookbackHours, { min: 1, max: 24 * 14 }),
      resolvedLookbackHours: parseWholeNumber(source.majorOutage?.resolvedLookbackHours, defaults.majorOutage.resolvedLookbackHours, { min: 1, max: 24 * 14 }),
      breachThresholdsHours: parseThresholds(source.majorOutage?.breachThresholdsHours, defaults.majorOutage.breachThresholdsHours),
      templates: {
        newTitle: parseOptionalString(source.majorOutage?.templates?.newTitle, defaults.majorOutage.templates.newTitle, 180),
        breachTitle: parseOptionalString(source.majorOutage?.templates?.breachTitle, defaults.majorOutage.templates.breachTitle, 180),
        resolvedTitle: parseOptionalString(source.majorOutage?.templates?.resolvedTitle, defaults.majorOutage.templates.resolvedTitle, 180),
        newAction: parseOptionalString(source.majorOutage?.templates?.newAction, defaults.majorOutage.templates.newAction, 220),
        breachAction: parseOptionalString(source.majorOutage?.templates?.breachAction, defaults.majorOutage.templates.breachAction, 220)
      }
    },
    vip: {
      enabled: parseBoolean(source.vip?.enabled, defaults.vip.enabled),
      groupIds: parseGroupIds(source.vip?.groupIds ?? source.vip?.groupId, defaults.vip.groupIds),
      pollMs: parseWholeNumber(source.vip?.pollMs, defaults.vip.pollMs, { min: 30 * 1000, max: 60 * 60 * 1000 }),
      lookbackHours: parseWholeNumber(source.vip?.lookbackHours, defaults.vip.lookbackHours, { min: 1, max: 24 * 14 }),
      orgId: parseOptionalString(source.vip?.orgId, defaults.vip.orgId, 60),
      templates: {
        orgTitle: parseOptionalString(source.vip?.templates?.orgTitle, defaults.vip.templates.orgTitle, 180),
        orgReason: parseOptionalString(source.vip?.templates?.orgReason, defaults.vip.templates.orgReason, 180)
      },
      tagRules: vipIncomingRules
        .map((rule, index) => sanitizeTagRule(rule, vipFallbackRules[index] || vipFallbackRules[0] || {}, index))
        .filter((rule) => rule.tag)
    }
  }
}

let cacheValue = null
let cacheAt = 0
let warnedLoadFailure = false

function setCache(value) {
  cacheValue = clone(value)
  cacheAt = Date.now()
}

export function getWhatsappWatcherConfigDefaults() {
  return sanitizeConfig({}, buildDefaultConfig())
}

export function invalidateWhatsappWatcherConfigCache() {
  cacheValue = null
  cacheAt = 0
}

export async function getWhatsappWatcherConfig({ forceFresh = false } = {}) {
  const defaults = getWhatsappWatcherConfigDefaults()

  if (!forceFresh && cacheValue && (Date.now() - cacheAt) < CACHE_TTL_MS) {
    return clone(cacheValue)
  }

  try {
    const row = await prisma.automationSetting.findUnique({
      where: { key: CONFIG_KEY }
    })

    const next = sanitizeConfig(row?.value || {}, defaults)
    setCache(next)
    warnedLoadFailure = false
    return clone(next)
  } catch (error) {
    if (!warnedLoadFailure) {
      console.warn('[WATCHER CONFIG] Falling back to defaults:', error?.message || error)
      warnedLoadFailure = true
    }
    setCache(defaults)
    return clone(defaults)
  }
}

export async function saveWhatsappWatcherConfig(input, updatedBy = null) {
  const next = sanitizeConfig(input, getWhatsappWatcherConfigDefaults())

  await prisma.automationSetting.upsert({
    where: { key: CONFIG_KEY },
    update: {
      value: next,
      updatedBy: parseOptionalString(updatedBy, '', 180) || null
    },
    create: {
      key: CONFIG_KEY,
      value: next,
      updatedBy: parseOptionalString(updatedBy, '', 180) || null
    }
  })

  setCache(next)
  warnedLoadFailure = false
  return clone(next)
}

export const WHATSAPP_WATCHER_CONFIG_META = {
  key: CONFIG_KEY,
  refreshBehavior: 'Changes apply on the next watcher poll on the automation server.',
  templateScope: 'Template fields currently control alert titles, reasons, and action lines while keeping the body layout standardized for readability.',
  routingScope: 'Each watcher can route to one or more WhatsApp groups. Paste one JID per line or use the live group directory below.'
}
