import dayjs from 'dayjs'

export function asNumber(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function parseHourThresholds(raw, fallback) {
  if (!raw) return [...fallback]

  const values = String(raw)
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)

  return values.length ? [...new Set(values)].sort((a, b) => a - b) : [...fallback]
}

export function makeTtlCache(ttlMs, maxKeys) {
  const map = new Map()

  function prune() {
    const now = Date.now()

    for (const [key, expiresAt] of map.entries()) {
      if (expiresAt <= now) map.delete(key)
    }

    while (map.size > maxKeys) {
      const firstKey = map.keys().next().value
      map.delete(firstKey)
    }
  }

  function has(key) {
    prune()
    const expiresAt = map.get(key)
    if (!expiresAt) return false
    if (expiresAt <= Date.now()) {
      map.delete(key)
      return false
    }
    return true
  }

  function add(key) {
    prune()
    map.set(key, Date.now() + ttlMs)
  }

  return {
    add,
    has,
    prune,
    size: () => map.size
  }
}

export function makeAuthHeader(email, token) {
  const auth = Buffer.from(`${email}/token:${token}`, 'utf8').toString('base64')
  return `Basic ${auth}`
}

export async function fetchJsonWithTimeout(url, { headers, timeoutMs = 25000 } = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { headers, signal: controller.signal })
    const text = await response.text()

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText} - ${text}`)
    }

    return JSON.parse(text)
  } finally {
    clearTimeout(timeout)
  }
}

export function zendeskAgentTicketLink(subdomain, id) {
  return `https://${subdomain}.zendesk.com/agent/tickets/${id}`
}

export function safeStr(value) {
  return value === null || value === undefined ? '' : String(value)
}

export function compactText(value, maxLength = 96) {
  const text = safeStr(value).replace(/\s+/g, ' ').trim()
  if (!text) return ''
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`
}

export function formatAgeMinutes(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return 'Unknown'
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`
  return `${(minutes / 1440).toFixed(1)}d`
}

export function formatAgeHours(value) {
  const hours = Number(value)
  if (!Number.isFinite(hours)) return 'Unknown'
  if (hours < 24) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

export function formatTimestamp(value) {
  const date = dayjs(value)
  return date.isValid() ? date.format('DD MMM HH:mm') : 'Unknown'
}

export function formatPlural(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function isResolvedStatus(status) {
  const value = safeStr(status).toLowerCase()
  return value === 'solved' || value === 'closed'
}
