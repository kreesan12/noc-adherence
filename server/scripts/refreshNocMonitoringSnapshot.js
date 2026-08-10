import { loadServerEnv } from '../lib/loadEnv.js'
import { refreshNocMonitoringSnapshot } from '../lib/nocMonitoring.js'

loadServerEnv()

const args = parseArgs(process.argv.slice(2))
const historyHours = parseHistoryHours(args.historyHours)
const requestedBy = String(args.requestedBy || 'systemd-warm-cache').trim()

try {
  const { snapshot, freshness, history } = await refreshNocMonitoringSnapshot(requestedBy, { historyHours })
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      requestedBy,
      generatedAt: snapshot?.generatedAt || null,
      dayKey: snapshot?.summary?.dayKey || null,
      tier1Open: snapshot?.summary?.tier1Open ?? null,
      tier2Open: snapshot?.summary?.tier2Open ?? null,
      majorOutageOpen: snapshot?.summary?.majorOutageOpen ?? null,
      voiceWaiting: snapshot?.summary?.telephonyWaiting ?? null,
      historyPoints: history?.series?.liveSnapshotCounts?.length || 0,
      freshnessMs: freshness?.ageMs ?? null
    })}\n`
  )
} catch (error) {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (!token.startsWith('--')) continue

    const key = token.slice(2)
    const next = argv[index + 1]
    if (!next || next.startsWith('--')) {
      parsed[key] = true
      continue
    }

    parsed[key] = next
    index += 1
  }

  return parsed
}

function parseHistoryHours(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return undefined
  return Math.min(24 * 14, Math.max(6, Math.round(parsed)))
}
