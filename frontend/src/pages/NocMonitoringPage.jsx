import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Link,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import LanRoundedIcon from '@mui/icons-material/LanRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import CrisisAlertRoundedIcon from '@mui/icons-material/CrisisAlertRounded'
import RouteRoundedIcon from '@mui/icons-material/RouteRounded'
import CallRoundedIcon from '@mui/icons-material/CallRounded'
import dayjs from 'dayjs'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { fetchNocMonitoringSnapshot, refreshNocMonitoringSnapshot } from '../api/nocMonitoring'
import { PageShell } from '../components/ui/PageScaffold'
import {
  AnalyticsChartFallback,
  AnalyticsLoadingBlock,
  AnalyticsMetricCard as MetricCard,
  AnalyticsSectionCard as SectionCard
} from '../components/ui/AnalyticsPrimitives'

const ACCENT = '#0f766e'
const OPS_BG = '#07111f'
const OPS_PANEL = 'rgba(9, 18, 34, 0.86)'
const OPS_PANEL_SOFT = 'rgba(13, 26, 48, 0.74)'
const OPS_BORDER = 'rgba(148, 163, 184, 0.18)'
const OPS_TEXT = '#e5eef8'
const OPS_MUTED = 'rgba(203, 213, 225, 0.72)'
const OPS_GRID = 'rgba(148, 163, 184, 0.16)'
const DEFAULT_HISTORY_HOURS = 72
const DASHBOARD_METRIC_ROOT_SX = {
  p: 1.05,
  borderRadius: 3.1,
  backdropFilter: 'blur(14px)',
  color: OPS_TEXT,
  border: `1px solid ${OPS_BORDER}`,
  bgcolor: 'rgba(8, 15, 30, 0.82)',
  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.96) 0%, rgba(9, 18, 34, 0.88) 100%)',
  boxShadow: '0 18px 36px rgba(2, 6, 23, 0.26)'
}
const DASHBOARD_METRIC_VALUE_SX = {
  fontSize: '1.12rem',
  color: '#ffffff'
}
const DASHBOARD_SECTION_ROOT_SX = {
  borderRadius: 3.4,
  color: OPS_TEXT,
  border: `1px solid ${OPS_BORDER}`,
  background: 'linear-gradient(180deg, rgba(11, 21, 39, 0.98) 0%, rgba(7, 17, 31, 0.96) 100%)',
  boxShadow: '0 22px 44px rgba(2, 6, 23, 0.32)',
  '& > .MuiStack-root': {
    borderBottomColor: 'rgba(148, 163, 184, 0.14)',
    background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.94) 0%, rgba(15, 23, 42, 0.68) 100%)'
  },
  '& > .MuiStack-root .MuiTypography-subtitle2': {
    color: '#f8fafc'
  },
  '& > .MuiStack-root .MuiTypography-body2': {
    color: `${OPS_MUTED} !important`
  },
  '& .MuiTableCell-root': {
    color: OPS_TEXT,
    borderColor: 'rgba(148, 163, 184, 0.12)'
  },
  '& .MuiTableRow-root:hover': {
    backgroundColor: 'rgba(30, 41, 59, 0.28)'
  },
  '& .MuiChip-root': {
    borderColor: 'rgba(148, 163, 184, 0.2)'
  }
}
const DASHBOARD_SECTION_BODY_SX = {
  px: 1.05,
  py: 0.95
}
const CONTROL_METRIC_ROOT_SX = {
  ...DASHBOARD_METRIC_ROOT_SX,
  p: 0.9,
  minHeight: 0
}
const CONTROL_METRIC_VALUE_SX = {
  ...DASHBOARD_METRIC_VALUE_SX,
  fontSize: '1rem'
}
const T1_ACTION_TONE_MAP = {
  P1: '#dc2626',
  P2: '#ea580c',
  P3: '#d97706',
  P4: '#2563eb',
  Change: '#8b5cf6',
  Other: '#64748b'
}
const T1_DUE_BUCKET_TONE_MAP = {
  BREACHED: '#dc2626',
  'Due <=2h': '#ea580c',
  'Due <=4h': '#f97316',
  'Due 4-8h': '#d97706',
  'Due 8-24h': '#0284c7',
  'Safe >24h': '#0f766e',
  'Change control': '#8b5cf6',
  'Other/No SLA': '#64748b'
}
const T1_OPERATIONAL_STATE_TONE_MAP = {
  'New / unattended': '#dc2626',
  'P1 in progress': '#f97316',
  'ISP follow-up': '#ea580c',
  'Vendor update': '#d97706',
  'MNT / automation': '#2563eb',
  'Change control': '#8b5cf6',
  Pending: '#475569',
  'In progress': '#0ea5e9',
  Other: '#64748b'
}

function formatCount(value) {
  return new Intl.NumberFormat('en-ZA').format(Number(value || 0))
}

function formatAgeHours(value) {
  const hours = Number(value)
  if (!Number.isFinite(hours)) return '--'
  if (hours < 24) return `${hours.toFixed(1)}h`
  return `${(hours / 24).toFixed(1)}d`
}

function formatSnapshotAge(ageMs) {
  const minutes = Math.max(0, Math.round(Number(ageMs || 0) / 60000))
  if (minutes < 60) return `${minutes}m old`
  const hours = minutes / 60
  if (hours < 24) return `${hours.toFixed(1)}h old`
  return `${(hours / 24).toFixed(1)}d old`
}

function formatStamp(value) {
  if (!value) return '--'
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed.format('DD MMM YYYY HH:mm') : '--'
}

function formatSeconds(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds)) return '--'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = seconds / 60
  return `${minutes.toFixed(1)}m`
}

function formatPercent(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  return `${numeric.toFixed(1)}%`
}

function formatSignedDelta(value, suffix = '') {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return '--'
  const rounded = Math.round(numeric)
  const sign = rounded > 0 ? '+' : ''
  return `${sign}${rounded}${suffix}`
}

function findHistoryPointNear(rows, targetTs, toleranceMinutes = 20) {
  if (!Array.isArray(rows) || !rows.length || !targetTs) return null
  const target = dayjs(targetTs)
  if (!target.isValid()) return null

  let best = null
  let bestDistance = Number.POSITIVE_INFINITY

  for (const row of rows) {
    const stamp = dayjs(row.bucketStart)
    if (!stamp.isValid()) continue
    const distance = Math.abs(stamp.diff(target, 'minute'))
    if (distance <= toleranceMinutes && distance < bestDistance) {
      best = row
      bestDistance = distance
    }
  }

  return best
}

function severityColor(status) {
  switch (String(status || '').toLowerCase()) {
    case 'new':
      return 'error'
    case 'open':
      return 'warning'
    case 'pending':
      return 'info'
    case 'hold':
    case 'on-hold':
      return 'secondary'
    default:
      return 'default'
  }
}

function priorityColor(priority) {
  switch (String(priority || '').toLowerCase()) {
    case 'urgent':
    case 'high':
      return 'error'
    case 'normal':
      return 'warning'
    case 'low':
      return 'success'
    default:
      return 'default'
  }
}

function ExternalTicketLink({ href, label = 'Open' }) {
  if (!href) return <Typography variant="caption" sx={{ color: OPS_MUTED }}>No link</Typography>
  return (
    <Link href={href} target="_blank" rel="noreferrer" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35, color: '#7dd3fc' }}>
      {label}
      <OpenInNewRoundedIcon sx={{ fontSize: 14 }} />
    </Link>
  )
}

function SignalChip({ label, tone = '#64748b' }) {
  return (
    <Chip
      size="small"
      label={label}
      sx={{
        height: 22,
        fontWeight: 700,
        color: '#f8fafc',
        bgcolor: alpha(tone, 0.18),
        border: `1px solid ${alpha(tone, 0.36)}`,
        '& .MuiChip-label': {
          px: 0.95
        }
      }}
    />
  )
}

function SpotlightCard({ item }) {
  return (
    <Box
      sx={{
        p: 1.05,
        borderRadius: 2.6,
        border: `1px solid ${alpha(item.tone, 0.28)}`,
        color: OPS_TEXT,
        background: `linear-gradient(180deg, ${alpha(item.tone, 0.2)} 0%, rgba(10,18,33,0.94) 100%)`,
        boxShadow: '0 12px 26px rgba(2, 6, 23, 0.24)'
      }}
    >
      <Stack spacing={0.7}>
        <Stack direction="row" spacing={0.65} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {item.title}
          </Typography>
          {item.badge ? <Chip size="small" label={item.badge} sx={{ bgcolor: alpha(item.tone, 0.2), color: '#f8fafc', fontWeight: 700, border: `1px solid ${alpha(item.tone, 0.35)}` }} /> : null}
        </Stack>
        <Typography variant="body2" sx={{ color: OPS_MUTED }}>
          {item.message}
        </Typography>
        {item.url ? (
          <ExternalTicketLink href={item.url} label="Open ticket" />
        ) : (
          <Typography variant="caption" sx={{ color: OPS_MUTED }}>
            Snapshot insight
          </Typography>
        )}
      </Stack>
    </Box>
  )
}

function MonitoringTable({ rows, columns, emptyMessage = 'No rows available.' }) {
  return (
    <Box sx={{ overflowX: 'auto', borderRadius: 2.4, border: `1px solid ${OPS_BORDER}`, background: OPS_PANEL_SOFT }}>
      <Table size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.key} sx={{ fontWeight: 800, whiteSpace: 'nowrap', color: '#f8fafc', bgcolor: 'rgba(15,23,42,0.78)' }}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length ? rows.map((row, index) => (
            <TableRow key={row.id || row.ticketId || row.routeLabel || `${index}-${row.label || 'row'}`} hover>
              {columns.map((column) => (
                <TableCell key={column.key} sx={{ verticalAlign: 'top' }}>
                  {column.render ? column.render(row) : row[column.key]}
                </TableCell>
              ))}
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <Typography variant="body2" sx={{ py: 1, color: OPS_MUTED }}>
                  {emptyMessage}
                </Typography>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Box>
  )
}

function VerticalBarChart({ rows, dataKey, emptyMessage, colorMap = {}, height = 250 }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={height} message={emptyMessage} />
  }

  return (
    <Box sx={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPS_GRID} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: OPS_MUTED }} stroke={OPS_GRID} interval={0} angle={-10} textAnchor="end" height={56} />
          <YAxis tick={{ fontSize: 11, fill: OPS_MUTED }} stroke={OPS_GRID} />
          <Tooltip />
          <Bar dataKey={dataKey} radius={[8, 8, 0, 0]}>
            {rows.map((row) => (
              <Cell key={row.key || row.label} fill={colorMap[row.key] || row.tone || ACCENT} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

function HorizontalBarChart({ rows, dataKey, emptyMessage, colorMap = {}, height = 260 }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={height} message={emptyMessage} />
  }

  return (
    <Box sx={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 10, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke={OPS_GRID} />
          <XAxis type="number" tick={{ fontSize: 11, fill: OPS_MUTED }} stroke={OPS_GRID} />
          <YAxis
            type="category"
            dataKey="label"
            tick={{ fontSize: 11, fill: OPS_MUTED }}
            stroke={OPS_GRID}
            width={120}
            tickFormatter={(value) => String(value || '').slice(0, 20)}
          />
          <Tooltip />
          <Bar dataKey={dataKey} radius={[0, 8, 8, 0]}>
            {rows.map((row) => (
              <Cell key={row.key || row.label} fill={colorMap[row.key] || row.tone || ACCENT} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

function MultiLineChartPanel({ rows, lines, emptyMessage, height = 260 }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={height} message={emptyMessage} />
  }

  return (
    <Box sx={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPS_GRID} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: OPS_MUTED }} stroke={OPS_GRID} interval={2} />
          <YAxis tick={{ fontSize: 11, fill: OPS_MUTED }} stroke={OPS_GRID} />
          <Tooltip />
          <Legend wrapperStyle={{ color: OPS_MUTED }} />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  )
}

function SummaryStatBlock({ rows, emptyMessage = 'No summary data is available.' }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={180} message={emptyMessage} />
  }

  return (
    <Stack spacing={0.8}>
      {rows.map((row) => (
        <Stack key={row.key || row.label} direction="row" spacing={0.8} alignItems="center" justifyContent="space-between" sx={{ borderBottom: `1px solid ${OPS_GRID}`, pb: 0.55 }}>
          <Stack direction="row" spacing={0.6} alignItems="center" sx={{ minWidth: 0 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: row.tone || ACCENT, flexShrink: 0 }} />
            <Typography variant="body2" sx={{ fontWeight: 600, color: OPS_TEXT }} noWrap>
              {row.label}
            </Typography>
          </Stack>
          <Typography variant="body2" sx={{ fontWeight: 800, color: '#f8fafc' }}>
            {formatCount(row.count)}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}

function CompactBreakdownList({ rows, emptyMessage = 'No summary data is available.', total = null, secondaryText, maxRows = null }) {
  const visibleRows = Array.isArray(rows) ? (maxRows ? rows.slice(0, maxRows) : rows) : []
  if (!visibleRows.length) {
    return <AnalyticsChartFallback minHeight={180} message={emptyMessage} />
  }

  const derivedTotal = Number(total ?? visibleRows.reduce((sum, row) => sum + Number(row.count || 0), 0))

  return (
    <Stack spacing={0.9}>
      {visibleRows.map((row) => {
        const count = Number(row.count || 0)
        const percent = derivedTotal > 0 ? Math.min(100, (count / derivedTotal) * 100) : 0
        const secondary = typeof secondaryText === 'function' ? secondaryText(row) : row.detail

        return (
          <Box
            key={row.key || row.label}
            sx={{
              p: 0.85,
              borderRadius: 2.2,
              border: `1px solid ${alpha(row.tone || ACCENT, 0.18)}`,
              bgcolor: alpha(row.tone || ACCENT, 0.08)
            }}
          >
            <Stack spacing={0.55}>
              <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0 }}>
                  <Box sx={{ width: 9, height: 9, borderRadius: 999, bgcolor: row.tone || ACCENT, flexShrink: 0 }} />
                  <Typography variant="body2" sx={{ fontWeight: 700, color: OPS_TEXT }} noWrap>
                    {row.label}
                  </Typography>
                </Stack>
                <SignalChip label={formatCount(count)} tone={row.tone || ACCENT} />
              </Stack>
              <Box
                sx={{
                  height: 6,
                  borderRadius: 999,
                  bgcolor: 'rgba(148, 163, 184, 0.12)',
                  overflow: 'hidden'
                }}
              >
                <Box
                  sx={{
                    width: `${percent}%`,
                    height: '100%',
                    borderRadius: 999,
                    bgcolor: row.tone || ACCENT
                  }}
                />
              </Box>
              {secondary ? (
                <Typography variant="caption" sx={{ color: OPS_MUTED }}>
                  {secondary}
                </Typography>
              ) : null}
            </Stack>
          </Box>
        )
      })}
    </Stack>
  )
}

function OpsAlert({ severity = 'info', children }) {
  return (
    <Alert
      severity={severity}
      sx={{
        borderRadius: 2.4,
        border: `1px solid ${OPS_BORDER}`,
        bgcolor: 'rgba(15, 23, 42, 0.78)',
        color: OPS_TEXT,
        '& .MuiAlert-icon': {
          color: '#f8fafc'
        },
        '& .MuiAlert-message': {
          color: OPS_TEXT
        }
      }}
    >
      {children}
    </Alert>
  )
}

function MetricStrip({ items }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
        gap: 1
      }}
    >
      {items.map((item) => (
        <MetricCard
          key={item.label}
          label={item.label}
          value={item.value}
          subtext={item.subtext}
          tone={item.tone}
          icon={item.icon}
          rootSx={item.rootSx || DASHBOARD_METRIC_ROOT_SX}
          valueSx={item.valueSx || DASHBOARD_METRIC_VALUE_SX}
        />
      ))}
    </Box>
  )
}

function OpsSection(props) {
  return (
    <SectionCard
      rootSx={DASHBOARD_SECTION_ROOT_SX}
      bodySx={DASHBOARD_SECTION_BODY_SX}
      {...props}
    />
  )
}

export default function NocMonitoringPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState(null)
  const [tab, setTab] = useState('overview')

  const loadSnapshot = useCallback(async () => {
    setError('')
    setLoading(true)
    try {
      const next = await fetchNocMonitoringSnapshot({ historyHours: DEFAULT_HISTORY_HOURS })
      setPayload(next)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Unable to load the monitoring snapshot.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const next = await refreshNocMonitoringSnapshot({ historyHours: DEFAULT_HISTORY_HOURS })
      setPayload(next)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Unable to refresh the monitoring snapshot.')
    } finally {
      setRefreshing(false)
    }
  }, [])

  const snapshot = payload?.snapshot
  const freshness = payload?.freshness
  const history = payload?.history || { series: {} }
  const meta = payload?.meta
  const summary = snapshot?.summary || {}
  const lanes = snapshot?.lanes || []
  const spotlights = snapshot?.spotlights || []
  const warnings = snapshot?.warnings || []
  const trends = snapshot?.trends || {}
  const collections = snapshot?.collections || {}
  const telephonySummary = collections?.telephonyMeta?.summary || null

  const stats = useMemo(() => [
    {
      label: 'Snapshot',
      value: freshness?.hasSnapshot ? formatSnapshotAge(freshness.ageMs) : 'bootstrapping',
      helper: snapshot?.generatedAt ? formatStamp(snapshot.generatedAt) : 'first live snapshot will be generated on load'
    },
    {
      label: 'Ops day',
      value: summary.dayKey || '--',
      helper: summary.timezone || 'Africa/Johannesburg'
    },
    {
      label: 'Live tickets',
      value: formatCount((summary.majorOutageOpen || 0) + (summary.nldOutageOpen || 0) + (summary.backhaulOpen || 0) + (summary.vipOpen || 0) + (summary.tier1Open || 0) + (summary.tier2Open || 0)),
      helper: 'major outage, NLD, backhaul, VIP, Tier 1, and Tier 2 combined'
    },
    {
      label: 'Subscriber impact',
      value: formatCount((summary.majorOutageSubscribers || 0) + (summary.nldOutageSubscribers || 0)),
      helper: 'open outage subscribers across major + NLD lanes'
    }
  ], [freshness, snapshot, summary])

  const laneChartData = useMemo(
    () => lanes.map((lane) => ({
      key: lane.key,
      label: lane.label,
      openCount: lane.openCount,
      agedCount: lane.agedCount,
      impactCount: lane.impactCount,
      tone: lane.tone
    })),
    [lanes]
  )

  const impactChartData = useMemo(
    () => laneChartData.filter((lane) => lane.impactCount > 0),
    [laneChartData]
  )

  const outagePrioritySummary = trends.outagePrioritySummary || []
  const outageRegionImpactSummary = trends.outageRegionImpactSummary || []
  const outageServiceTypeSummary = trends.outageServiceTypeSummary || []
  const backhaulOwnerSummary = trends.backhaulOwnerSummary || []
  const t1ActionSummary = trends.t1ActionSummary || []
  const t1ProductSummary = trends.t1ProductSummary || []
  const t1StatusSummary = trends.t1StatusSummary || []
  const t1OperationalStateSummary = trends.t1OperationalStateSummary || []
  const t1DueBucketSummary = trends.t1DueBucketSummary || []
  const t1AutomationOpenSummary = trends.t1AutomationOpenSummary || []
  const t1AutomationCreatedTodaySummary = trends.t1AutomationCreatedTodaySummary || []
  const t1ReceivedComparisonSeries = trends.t1ReceivedComparisonSeries || []
  const t1SolvedComparisonSeries = trends.t1SolvedComparisonSeries || []
  const t2ReceivedComparisonSeries = trends.t2ReceivedComparisonSeries || []
  const t2SolvedComparisonSeries = trends.t2SolvedComparisonSeries || []
  const t2AgeBucketSummary = trends.t2AgeBucketSummary || []
  const t2PartySummary = trends.t2PartySummary || []
  const t2ProductSummary = trends.t2ProductSummary || []
  const t2ServiceTypeSummary = trends.t2ServiceTypeSummary || []
  const telephonyQueueWaitingSummary = trends.telephonyQueueWaitingSummary || []
  const telephonyMissedAgentSummary = trends.telephonyMissedAgentSummary || []
  const partialRouteSummary = trends.partialRouteSummary || []
  const hourlySeries = trends.hourlySeries || []
  const historyLanePressure = history?.series?.lanePressure || []
  const historySubscriberImpact = history?.series?.subscriberImpact || []
  const historyOutagePriority = history?.series?.outagePriority || []
  const historyTier1 = history?.series?.tier1 || []
  const historyTier2 = history?.series?.tier2 || []
  const historyNldPartials = history?.series?.nldPartials || []
  const historyTelephony = history?.series?.telephony || []
  const historyTier1VoiceQueue = history?.series?.tier1VoiceQueue || []
  const historyWindowLabel = `${history?.windowHours || meta?.historyWindowHours || DEFAULT_HISTORY_HOURS}h`
  const tier1VoiceQueue = collections?.tier1VoiceQueue || null

  const overviewMetrics = useMemo(() => ([
    {
      label: 'Major outages',
      value: formatCount(summary.majorOutageOpen),
      subtext: `${formatCount(summary.majorOutageSubscribers)} subscribers impacted`,
      tone: '#dc2626',
      icon: <NotificationsActiveRoundedIcon fontSize="small" />
    },
    {
      label: 'NLD + partials',
      value: formatCount((summary.nldOutageOpen || 0) + (summary.nldPartialEventCount || 0)),
      subtext: `${formatCount(summary.nldOutageOpen || 0)} open NLD outages | ${formatCount(summary.nldPartialEventCount || 0)} partial events`,
      tone: '#f97316',
      icon: <LanRoundedIcon fontSize="small" />
    },
    {
      label: 'Tier 1',
      value: formatCount(summary.tier1Open),
      subtext: `${formatCount(summary.t1ReceivedToday || 0)} received today | ${formatCount(summary.t1SolvedToday || 0)} solved today`,
      tone: '#0f766e',
      icon: <SupportAgentRoundedIcon fontSize="small" />
    },
    {
      label: 'Tier 2',
      value: formatCount(summary.tier2Open),
      subtext: `${formatCount(summary.t2ReceivedToday || 0)} received today | ${formatCount(summary.t2SolvedToday || 0)} solved today`,
      tone: '#1d4ed8',
      icon: <SupportAgentRoundedIcon fontSize="small" />
    },
    {
      label: 'Backhaul + VIP',
      value: formatCount((summary.backhaulOpen || 0) + (summary.vipOpen || 0)),
      subtext: `${formatCount(summary.backhaulOpen || 0)} backhaul | ${formatCount(summary.vipOpen || 0)} VIP`,
      tone: '#7c3aed',
      icon: <MonitorHeartRoundedIcon fontSize="small" />
    },
    {
      label: 'Outage priority',
      value: formatCount((summary.outageP1 || 0) + (summary.outageP2 || 0) + (summary.outageP3 || 0) + (summary.outageP4 || 0) + (summary.outagePower || 0)),
      subtext: `${formatCount(summary.outageNewUnassigned || 0)} new or unattended | ${formatCount(summary.outagePower || 0)} power`,
      tone: '#ea580c',
      icon: <CrisisAlertRoundedIcon fontSize="small" />
    },
    {
      label: 'Voice queues',
      value: telephonySummary ? formatCount(summary.telephonyQueues || 0) : '--',
      subtext: telephonySummary ? `${formatCount(summary.telephonyWaiting || 0)} waiting | ${formatCount(summary.telephonyAnswered || 0)} answered today` : 'Illation feed not configured yet',
      tone: '#0891b2',
      icon: <CallRoundedIcon fontSize="small" />
    },
    {
      label: 'Skipped hygiene',
      value: formatCount(summary.skippedCount || 0),
      subtext: 'kept separate from the main ops flow for now',
      tone: '#475569',
      icon: <WarningAmberRoundedIcon fontSize="small" />
    }
  ]), [summary, telephonySummary])

  const tier1VoiceWeekCompare = useMemo(() => {
    const latest = historyTier1VoiceQueue?.[historyTier1VoiceQueue.length - 1]
    if (!latest?.bucketStart) return { lastWeek: null, previousWeek: null }
    return {
      lastWeek: findHistoryPointNear(historyTier1VoiceQueue, dayjs(latest.bucketStart).subtract(7, 'day').toISOString()),
      previousWeek: findHistoryPointNear(historyTier1VoiceQueue, dayjs(latest.bucketStart).subtract(14, 'day').toISOString())
    }
  }, [historyTier1VoiceQueue])

  const tier1ComparisonMetrics = useMemo(() => ([
    {
      label: 'Tickets received',
      value: formatCount(summary.t1ReceivedToday || 0),
      subtext: `7d ${formatCount(summary.t1ReceivedLastWeek || 0)} | 14d ${formatCount(summary.t1ReceivedPreviousWeek || 0)}`,
      tone: '#0f766e',
      icon: <InsightsRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    },
    {
      label: 'Tickets solved',
      value: formatCount(summary.t1SolvedToday || 0),
      subtext: `7d ${formatCount(summary.t1SolvedLastWeek || 0)} | 14d ${formatCount(summary.t1SolvedPreviousWeek || 0)}`,
      tone: '#22c55e',
      icon: <SupportAgentRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    },
    {
      label: 'Voice answered',
      value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Answered || 0) : '--',
      subtext: tier1VoiceQueue
        ? `${summary.telephonyTier1QueueName || 'Tier1 queue'} | 7d ${tier1VoiceWeekCompare.lastWeek ? formatCount(tier1VoiceWeekCompare.lastWeek.answered || 0) : '--'} | 14d ${tier1VoiceWeekCompare.previousWeek ? formatCount(tier1VoiceWeekCompare.previousWeek.answered || 0) : '--'}`
        : 'Tier 1 voice queue history is building from current snapshots',
      tone: '#0891b2',
      icon: <CallRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    },
    {
      label: 'Automation touched',
      value: formatCount((t1AutomationCreatedTodaySummary || []).reduce((total, row) => total + Number(row.count || 0), 0)),
      subtext: 'Today routes into outage, MNT, DFA, and other automation lanes',
      tone: '#8b5cf6',
      icon: <MonitorHeartRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    }
  ]), [summary, t1AutomationCreatedTodaySummary, tier1VoiceQueue, tier1VoiceWeekCompare])

  const tier1RedFlagMetrics = useMemo(() => ([
    {
      label: 'P1 unattended',
      value: formatCount(summary.tier1P1Unattended || 0),
      subtext: `${formatCount(summary.tier1P1Breached || 0)} above 30m action SLA`,
      tone: (summary.tier1P1Breached || 0) > 0 ? '#dc2626' : '#0f766e',
      icon: <WarningAmberRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    },
    {
      label: 'Tier1 voice waiting',
      value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Waiting || 0) : '--',
      subtext: tier1VoiceQueue
        ? `${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)} max queue | ${summary.telephonyTier1SlaBreached ? 'breached 20s' : 'within 20s SLA'}`
        : 'Tier 1 voice queue not present in current telephony snapshot',
      tone: summary.telephonyTier1SlaBreached ? '#dc2626' : '#0891b2',
      icon: <CallRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    },
    {
      label: 'Open Tier 1',
      value: formatCount(summary.tier1Open || 0),
      subtext: `${formatCount((collections.tier1UrgentTickets || []).length)} urgent | ${formatCount(summary.tier1ChangeControlOpen || 0)} change control`,
      tone: '#1d4ed8',
      icon: <SupportAgentRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    },
    {
      label: 'Queue trend',
      value: historyTier1.length ? formatSignedDelta((historyTier1[historyTier1.length - 1]?.open || 0) - (historyTier1[0]?.open || 0)) : '--',
      subtext: `movement across stored ${historyWindowLabel} monitoring window`,
      tone: '#475569',
      icon: <InsightsRoundedIcon fontSize="small" />,
      rootSx: CONTROL_METRIC_ROOT_SX,
      valueSx: CONTROL_METRIC_VALUE_SX
    }
  ]), [collections, historyTier1, historyWindowLabel, summary, tier1VoiceQueue])

  const t1ActionMixRows = useMemo(
    () => (t1ActionSummary || [])
      .filter((row) => Number(row.count || 0) > 0)
      .map((row) => ({
        ...row,
        detail: `${formatCount(row.fttb || 0)} FTTB | ${formatCount(row.ftth || 0)} FTTH | ${formatCount(row.other || 0)} other`
      })),
    [t1ActionSummary]
  )

  const t1QueueFocusRows = useMemo(() => ([
    {
      key: 'p1-unattended',
      label: 'P1 unattended',
      count: Number(summary.tier1P1Unattended || 0),
      tone: '#dc2626',
      detail: `${formatCount(summary.tier1P1Breached || 0)} already over the 30-minute action SLA`
    },
    {
      key: 'urgent',
      label: 'Urgent queue',
      count: Number((collections.tier1UrgentTickets || []).length),
      tone: '#ea580c',
      detail: 'Breached or due within the next 4 hours'
    },
    {
      key: 'change',
      label: 'Change control',
      count: Number(summary.tier1ChangeControlOpen || 0),
      tone: '#8b5cf6',
      detail: 'Rows carrying the noc_change_checks tag'
    },
    {
      key: 'voice-risk',
      label: 'Voice queue at risk',
      count: summary.telephonyTier1SlaBreached ? Number(summary.telephonyTier1Waiting || 0) : 0,
      tone: summary.telephonyTier1SlaBreached ? '#dc2626' : '#0891b2',
      detail: summary.telephonyTier1SlaBreached
        ? `${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)} max queue time on Tier 1 voice`
        : 'Tier 1 voice is currently within the 20-second response target'
    }
  ]), [collections, summary])

  const t1AutomationOpenRows = useMemo(
    () => (t1AutomationOpenSummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1AutomationOpenSummary]
  )

  const t1AutomationTodayRows = useMemo(
    () => (t1AutomationCreatedTodaySummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1AutomationCreatedTodaySummary]
  )

  const tier2ComparisonMetrics = useMemo(() => ([
    {
      label: 'Tickets received',
      value: formatCount(summary.t2ReceivedToday || 0),
      subtext: `7d ${formatCount(summary.t2ReceivedLastWeek || 0)} | 14d ${formatCount(summary.t2ReceivedPreviousWeek || 0)}`,
      tone: '#1d4ed8',
      icon: <InsightsRoundedIcon fontSize="small" />
    },
    {
      label: 'Tickets solved',
      value: formatCount(summary.t2SolvedToday || 0),
      subtext: `7d ${formatCount(summary.t2SolvedLastWeek || 0)} | 14d ${formatCount(summary.t2SolvedPreviousWeek || 0)}`,
      tone: '#60a5fa',
      icon: <SupportAgentRoundedIcon fontSize="small" />
    },
    {
      label: 'New unattended',
      value: formatCount(summary.tier2NewUnassigned || 0),
      subtext: 'Tier 2 new and unassigned right now',
      tone: '#dc2626',
      icon: <WarningAmberRoundedIcon fontSize="small" />
    },
    {
      label: 'Handover open',
      value: formatCount(summary.t2HandoverOpen || 0),
      subtext: 'live handover macro queue',
      tone: '#ea580c',
      icon: <MonitorHeartRoundedIcon fontSize="small" />
    }
  ]), [summary])

  const priorityRows = useMemo(() => {
    const groups = collections.outagePriorityTickets || {}
    return [
      ...(groups.newUnassigned || []).map((row) => ({ ...row, queueLabel: 'New / unattended' })),
      ...(groups.p1 || []).map((row) => ({ ...row, queueLabel: 'P1' })),
      ...(groups.p2 || []).map((row) => ({ ...row, queueLabel: 'P2' })),
      ...(groups.p3 || []).map((row) => ({ ...row, queueLabel: 'P3 / southbound' })),
      ...(groups.p4 || []).map((row) => ({ ...row, queueLabel: 'P4' })),
      ...(groups.power || []).map((row) => ({ ...row, queueLabel: 'Power' }))
    ]
  }, [collections])

  const majorColumns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'region', label: 'Region' },
    { key: 'subscriberImpact', label: 'Subs', render: (row) => formatCount(row.subscriberImpact) },
    { key: 'serviceType', label: 'Service Type' },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'owner', label: 'Owner' },
    { key: 'lastUpdate', label: 'Last Update', render: (row) => row.lastUpdate || '--' },
    { key: 'subject', label: 'Subject' }
  ], [])

  const priorityColumns = useMemo(() => [
    { key: 'queueLabel', label: 'Queue' },
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'region', label: 'Region' },
    { key: 'subscriberImpact', label: 'Subs', render: (row) => formatCount(row.subscriberImpact) },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'subject', label: 'Subject' }
  ], [])

  const nldColumns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'route', label: 'Route', render: (row) => row.route || '--' },
    { key: 'subscriberImpact', label: 'Subs', render: (row) => formatCount(row.subscriberImpact) },
    { key: 'liquidRef', label: 'Liquid Ref', render: (row) => row.liquidRef || '--' },
    { key: 'liquidCircuit', label: 'Liquid Circuit', render: (row) => row.liquidCircuit || '--' },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'lastUpdate', label: 'Last Update', render: (row) => row.lastUpdate || '--' },
    { key: 'subject', label: 'Subject' }
  ], [])

  const backhaulColumns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'issue', label: 'Issue' },
    { key: 'owner', label: 'Owner' },
    { key: 'sideA', label: 'Side A', render: (row) => row.sideA || '--' },
    { key: 'sideB', label: 'Side B', render: (row) => row.sideB || '--' },
    { key: 'vendorLoggedAt', label: 'Vendor Logged', render: (row) => row.vendorLoggedAt || '--' },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'subject', label: 'Subject' }
  ], [])

  const t1Columns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'status', label: 'Status', render: (row) => <Chip size="small" label={row.status} color={severityColor(row.status)} /> },
    { key: 'priority', label: 'Priority', render: (row) => <Chip size="small" label={row.priority} color={priorityColor(row.priority)} /> },
    { key: 'pLevel', label: 'Action', render: (row) => <SignalChip label={row.pLevel} tone={T1_ACTION_TONE_MAP[row.pLevel] || '#64748b'} /> },
    { key: 'product', label: 'Product' },
    { key: 'serviceType', label: 'Service', render: (row) => row.serviceType || '--' },
    { key: 'operationalState', label: 'Operational State', render: (row) => <SignalChip label={row.operationalState} tone={T1_OPERATIONAL_STATE_TONE_MAP[row.operationalState] || '#64748b'} /> },
    {
      key: 'automationRoutes',
      label: 'Automation',
      render: (row) => row.automationRoutes?.length ? (
        <Stack direction="row" spacing={0.4} useFlexGap flexWrap="wrap">
          {row.automationRoutes.map((route) => (
            <SignalChip key={`${row.id}-${route}`} label={route} tone="#7c3aed" />
          ))}
        </Stack>
      ) : '--'
    },
    { key: 'dueBucket', label: 'Due Bucket', render: (row) => <SignalChip label={row.dueBucket} tone={T1_DUE_BUCKET_TONE_MAP[row.dueBucket] || '#64748b'} /> },
    {
      key: 'remainingHours',
      label: 'Remaining',
      render: (row) => row.remainingHours === null
        ? '--'
        : <Typography variant="body2" sx={{ fontWeight: 800, color: row.remainingHours <= 0 ? '#fca5a5' : row.remainingHours <= 4 ? '#fdba74' : OPS_TEXT }}>{`${row.remainingHours.toFixed(1)}h`}</Typography>
    },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'subject', label: 'Subject' }
  ], [])

  const t2Columns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'status', label: 'Status', render: (row) => <Chip size="small" label={row.status} color={severityColor(row.status)} /> },
    { key: 'priority', label: 'Priority', render: (row) => <Chip size="small" label={row.priority} color={priorityColor(row.priority)} /> },
    { key: 'product', label: 'Product' },
    { key: 'party', label: 'Party' },
    { key: 'handover', label: 'Handover', render: (row) => row.handover ? <Chip size="small" color="warning" label="Handover" /> : '--' },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'updatedAt', label: 'Updated', render: (row) => formatStamp(row.updatedAt) },
    { key: 'subject', label: 'Subject' }
  ], [])

  const nldEventColumns = useMemo(() => [
    { key: 'ticketId', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.ticketUrl} label={`#${row.ticketId}`} /> },
    { key: 'eventGroup', label: 'Event' },
    { key: 'routeLabel', label: 'Route' },
    { key: 'circuit', label: 'Circuit' },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'created_at', label: 'Created', render: (row) => formatStamp(row.created_at) }
  ], [])

  const nldClusterColumns = useMemo(() => [
    { key: 'routeLabel', label: 'Route' },
    { key: 'eventCount', label: 'Events', render: (row) => formatCount(row.eventCount) },
    { key: 'circuitCount', label: 'Circuits', render: (row) => formatCount(row.circuitCount) },
    { key: 'last', label: 'Latest', render: (row) => <ExternalTicketLink href={row.last?.ticketUrl} label={`#${row.last?.ticketId || '--'}`} /> },
    { key: 'created_at', label: 'Latest Time', render: (row) => formatStamp(row.last?.created_at) }
  ], [])

  const queueColumns = useMemo(() => [
    { key: 'name', label: 'Queue' },
    { key: 'waiting', label: 'Waiting', render: (row) => formatCount(row.waiting) },
    { key: 'active', label: 'Active', render: (row) => formatCount(row.active) },
    { key: 'answered', label: 'Answered', render: (row) => formatCount(row.answered) },
    { key: 'missed', label: 'Missed', render: (row) => formatCount(row.missed) },
    { key: 'avgAnswerSeconds', label: 'Avg Answer', render: (row) => formatSeconds(row.avgAnswerSeconds) },
    { key: 'sla', label: 'SLA', render: (row) => formatPercent(row.sla) },
    { key: 'registeredAgents', label: 'Agents', render: (row) => formatCount(row.registeredAgents) }
  ], [])

  const agentColumns = useMemo(() => [
    { key: 'name', label: 'Agent' },
    { key: 'queue', label: 'Queue', render: (row) => row.queue || '--' },
    { key: 'state', label: 'State', render: (row) => <Chip size="small" label={row.state || 'unknown'} color={severityColor(row.state)} /> },
    { key: 'loggedIn', label: 'Logged In', render: (row) => row.loggedIn ? 'Yes' : 'No' },
    { key: 'registered', label: 'Registered', render: (row) => row.registered ? 'Yes' : 'No' },
    { key: 'inboundCalls', label: 'Inbound', render: (row) => formatCount(row.inboundCalls) },
    { key: 'missedCalls', label: 'Missed', render: (row) => formatCount(row.missedCalls) },
    { key: 'timeInState', label: 'Time In State', render: (row) => row.timeInState || '--' }
  ], [])

  const skippedColumns = useMemo(() => [
    { key: 'ticketId', label: 'Ticket', render: (row) => row.ticketId ? <ExternalTicketLink href={row.url} label={`#${row.ticketId}`} /> : row.id },
    { key: 'createdAt', label: 'Created', render: (row) => formatStamp(row.createdAt) },
    { key: 'skippedBy', label: 'Skipped By', render: (row) => row.skippedBy || '--' },
    { key: 'reason', label: 'Reason' },
    { key: 'subject', label: 'Subject' }
  ], [])

  if (loading && !snapshot) {
    return (
      <PageShell
        eyebrow="NOC Monitoring"
        title="NOC Monitoring Hub"
        description="Native monitoring snapshot for outages, tickets, queue hygiene, and operational watchlists."
        accent={ACCENT}
      >
        <AnalyticsLoadingBlock message="Loading the current monitoring snapshot..." />
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="NOC Monitoring"
      title="NOC Monitoring Hub"
      description="A native Ops Hub replacement for the old Grafana view, rebuilt around backend snapshots so the browser stays light while the dashboard keeps expanding toward parity."
      accent={ACCENT}
      actions={(
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.7} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Chip size="small" color={freshness?.hardStale ? 'error' : freshness?.stale ? 'warning' : 'success'} label={freshness?.hasSnapshot ? (freshness?.stale ? 'Snapshot aging' : 'Snapshot fresh') : 'No snapshot'} />
          <Chip size="small" variant="outlined" label={snapshot?.generatedAt ? `Updated ${formatStamp(snapshot.generatedAt)}` : 'Waiting for snapshot'} />
          <Button size="small" variant="contained" startIcon={<RefreshRoundedIcon />} onClick={handleRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
          </Button>
        </Stack>
      )}
      stats={stats}
    >
      <Box
        sx={{
          display: 'grid',
          gap: 1.05,
          p: { xs: 0.8, md: 1 },
          borderRadius: 4,
          border: `1px solid ${OPS_BORDER}`,
          background: [
            `radial-gradient(circle at top left, ${alpha('#0f766e', 0.18)} 0%, transparent 24%)`,
            `radial-gradient(circle at 82% 18%, ${alpha('#1d4ed8', 0.16)} 0%, transparent 22%)`,
            `linear-gradient(180deg, ${OPS_BG} 0%, #0a1426 100%)`
          ].join(','),
          boxShadow: '0 30px 60px rgba(2, 6, 23, 0.24)'
        }}
      >
        {refreshing ? <LinearProgress sx={{ borderRadius: 999, overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.08)' }} /> : null}

        {error ? (
          <OpsAlert severity="error">{error}</OpsAlert>
        ) : null}

        {warnings.length ? (
          <OpsAlert severity="warning">
            {warnings.length} monitoring source{warnings.length === 1 ? '' : 's'} returned partial data. The page still loaded the rest of the snapshot so the team can keep working.
          </OpsAlert>
        ) : null}

        {meta?.dashboardNote ? (
          <OpsAlert severity="info">{meta.dashboardNote}</OpsAlert>
        ) : null}

        <OpsSection
          title="Workspace Views"
          subtitle="Move between overview, outages, Tier 1, Tier 2, NLD events, voice, and skipped hygiene without leaving the same cached snapshot."
          tone={ACCENT}
          minHeight={0}
        >
          <Tabs
            value={tab}
            onChange={(_event, value) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 38,
              '& .MuiTab-root': {
                minHeight: 38,
                color: OPS_MUTED,
                fontWeight: 700,
                textTransform: 'none',
                borderRadius: 2.2
              },
              '& .Mui-selected': {
                color: '#ffffff !important',
                background: 'rgba(30, 41, 59, 0.65)'
              },
              '& .MuiTabs-indicator': {
                height: 3,
                borderRadius: 999,
                backgroundColor: '#34d399'
              }
            }}
          >
            <Tab value="overview" label="Overview" />
            <Tab value="outages" label="Outage Desk" />
            <Tab value="tier1" label="Tier 1" />
            <Tab value="tier2" label="Tier 2" />
            <Tab value="nld" label="NLD Events" />
            <Tab value="voice" label="Voice & Queues" />
            <Tab value="skipped" label="Skipped" />
          </Tabs>
        </OpsSection>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
            gap: 0.9,
            p: 1,
            borderRadius: 3.2,
            border: '1px solid',
            borderColor: alpha('#93c5fd', 0.14),
            background: `linear-gradient(135deg, ${alpha('#0f766e', 0.12)} 0%, ${alpha('#1d4ed8', 0.08)} 56%, rgba(8,15,30,0.92) 100%)`
          }}
        >
        {[
          {
            label: 'Priority lanes live',
            value: formatCount((summary.outageP1 || 0) + (summary.outageP2 || 0) + (summary.outageP3 || 0) + (summary.outageP4 || 0) + (summary.outagePower || 0)),
            helper: `${formatCount(summary.outageNewUnassigned || 0)} unattended outage rows`
          },
          {
            label: 'Tier 1 due now',
            value: formatCount((collections.tier1UrgentTickets || []).length),
            helper: 'breached or due within four hours'
          },
          {
            label: 'Tier 2 handovers',
            value: formatCount(summary.t2HandoverOpen || 0),
            helper: `${formatCount(summary.tier2NewUnassigned || 0)} new unattended alongside handovers`
          },
          {
            label: 'Voice feed',
            value: telephonySummary ? 'live' : 'offline',
            helper: telephonySummary ? `${formatCount(summary.telephonyWaiting || 0)} callers waiting right now` : 'Illation feed not available in this snapshot'
          }
        ].map((item) => (
          <Box
            key={item.label}
            sx={{
              px: 0.95,
              py: 0.85,
              borderRadius: 2.5,
              color: OPS_TEXT,
              background: 'rgba(6, 12, 24, 0.78)',
              backdropFilter: 'blur(10px)',
              boxShadow: 'inset 0 0 0 1px rgba(148,163,184,0.14)'
            }}
          >
            <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.65, color: OPS_MUTED }}>
              {item.label}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 900, mt: 0.1, color: '#ffffff' }}>
              {item.value}
            </Typography>
            <Typography variant="body2" sx={{ color: OPS_MUTED, fontSize: 12.25 }}>
              {item.helper}
            </Typography>
          </Box>
        ))}
        </Box>

      {tab === 'overview' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <MetricStrip items={overviewMetrics} />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.2fr 0.8fr' }, gap: 1.05 }}>
            <OpsSection title="Open Work By Lane" subtitle="Live open counts and aged counts across the core lanes from the current snapshot." tone="#0f766e" minHeight={0}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Open items
                  </Typography>
                  <VerticalBarChart rows={laneChartData} dataKey="openCount" emptyMessage="No lane counts were returned for this snapshot." colorMap={Object.fromEntries(laneChartData.map((lane) => [lane.key, lane.tone]))} />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Aged items beyond lane threshold
                  </Typography>
                  <VerticalBarChart rows={laneChartData} dataKey="agedCount" emptyMessage="No aged items are available in this snapshot." colorMap={Object.fromEntries(laneChartData.map((lane) => [lane.key, lane.tone]))} />
                </Box>
              </Box>
            </OpsSection>

            <OpsSection title="Operational Pressure" subtitle="Impact, outage priority, and partial NLD pressure areas that need fast eyes." tone="#1d4ed8" minHeight={0}>
              <Box sx={{ display: 'grid', gap: 1 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Subscriber impact by lane
                  </Typography>
                  <VerticalBarChart rows={impactChartData} dataKey="impactCount" emptyMessage="No subscriber impact is available right now." colorMap={Object.fromEntries(impactChartData.map((lane) => [lane.key, lane.tone]))} />
                </Box>
                <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`P1 ${formatCount(summary.outageP1 || 0)}`} color="error" />
                  <Chip size="small" label={`P2 ${formatCount(summary.outageP2 || 0)}`} color="warning" />
                  <Chip size="small" label={`P3 ${formatCount(summary.outageP3 || 0)}`} color="warning" />
                  <Chip size="small" label={`P4 ${formatCount(summary.outageP4 || 0)}`} color="info" />
                  <Chip size="small" label={`Power ${formatCount(summary.outagePower || 0)}`} color="secondary" />
                  <Chip size="small" label={`Partial not logged ${formatCount(summary.nldPartialNotLoggedCount || 0)}`} color="default" />
                </Stack>
              </Box>
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.08fr 0.92fr' }, gap: 1.05 }}>
            <OpsSection title="Historical Queue Pressure" subtitle={`Backend snapshot trend across the last ${historyWindowLabel} so the desk can see whether backlog is rising or cooling.`} tone="#1d4ed8" minHeight={0}>
              <MultiLineChartPanel
                rows={historyLanePressure}
                lines={[
                  { key: 'tier1Open', label: 'Tier 1', color: '#0f766e' },
                  { key: 'tier2Open', label: 'Tier 2', color: '#1d4ed8' },
                  { key: 'majorOutageOpen', label: 'Major outages', color: '#dc2626' },
                  { key: 'backhaulOpen', label: 'Backhaul', color: '#7c3aed' }
                ]}
                emptyMessage="Historical queue pressure is still building and will appear after a few refresh buckets land."
              />
            </OpsSection>

            <OpsSection title="Historical Subscriber Impact" subtitle={`Open outage impact over the last ${historyWindowLabel} from persisted monitoring buckets.`} tone="#dc2626" minHeight={0}>
              <MultiLineChartPanel
                rows={historySubscriberImpact}
                lines={[
                  { key: 'majorOutageSubscribers', label: 'Major outage subs', color: '#dc2626' },
                  { key: 'nldOutageSubscribers', label: 'NLD subs', color: '#f97316' },
                  { key: 'totalSubscribers', label: 'Total impacted', color: '#facc15' }
                ]}
                emptyMessage="Historical subscriber impact will light up once more monitoring buckets have been stored."
              />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.95fr 1.05fr' }, gap: 1.05 }}>
            <OpsSection title="Outage Priority Lanes" subtitle="This is the missing Grafana-style alert bucket view pulled into the native snapshot." tone="#dc2626" minHeight={0}>
              <VerticalBarChart rows={outagePrioritySummary} dataKey="count" emptyMessage="No outage priority lanes are active in this snapshot." colorMap={Object.fromEntries(outagePrioritySummary.map((row) => [row.key, row.tone]))} />
            </OpsSection>

            <OpsSection title="Daily Ops Flow" subtitle={`Tier 1 and Tier 2 received versus solved for ${summary.dayKey || 'today'}.`} tone="#0f172a" minHeight={0}>
              <MultiLineChartPanel
                rows={hourlySeries}
                lines={[
                  { key: 't1Received', label: 'T1 received', color: '#0f766e' },
                  { key: 't1Solved', label: 'T1 solved', color: '#22c55e' },
                  { key: 't2Received', label: 'T2 received', color: '#1d4ed8' },
                  { key: 't2Solved', label: 'T2 solved', color: '#60a5fa' }
                ]}
                emptyMessage="No Tier 1 or Tier 2 intake data is available for the current ops day."
              />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
            <OpsSection title="Partial NLD Routes" subtitle="Top partial-NLD routes from the live event feed in the current lookback window." tone="#f97316" minHeight={0}>
              <VerticalBarChart rows={partialRouteSummary.slice(0, 10)} dataKey="count" emptyMessage="No partial NLD routes were returned for the current lookback window." />
            </OpsSection>

            <OpsSection title="Operational Spotlights" subtitle="The strongest live watch items pulled from the latest snapshot." tone="#0f172a" minHeight={0}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 0.95 }}>
                {spotlights.length ? spotlights.map((item) => <SpotlightCard key={item.key} item={item} />) : (
                  <AnalyticsChartFallback minHeight={220} message="No spotlight items are available for this snapshot." />
                )}
              </Box>
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.05 }}>
            <OpsSection title="Outage Impact By Region" subtitle="Subscriber-impact concentration by outage region." tone="#dc2626" minHeight={0}>
              <HorizontalBarChart rows={outageRegionImpactSummary} dataKey="count" emptyMessage="No outage region impact is available right now." />
            </OpsSection>

            <OpsSection title="Tier 2 Service Mix" subtitle="Current Tier 2 open work grouped by service type." tone="#1d4ed8" minHeight={0}>
              <HorizontalBarChart rows={t2ServiceTypeSummary} dataKey="count" emptyMessage="No Tier 2 service-type split is available right now." />
            </OpsSection>

            <OpsSection title="Voice Queue Pressure" subtitle="Waiting callers by queue from the telephony snapshot." tone="#0891b2" minHeight={0}>
              <HorizontalBarChart rows={telephonyQueueWaitingSummary} dataKey="count" emptyMessage="No queue waiting data is available right now." />
            </OpsSection>
          </Box>
        </Box>
      ) : null}

      {tab === 'outages' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <MetricStrip
            items={outagePrioritySummary.map((row) => ({
              label: row.label,
              value: formatCount(row.count),
              subtext: `Oldest active ${formatAgeHours(row.highestAgeHours)}`,
              tone: row.tone,
              icon: <CrisisAlertRoundedIcon fontSize="small" />
            }))}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
            <OpsSection title="Outage Desk Pressure Trend" subtitle={`Major outage, NLD, and backhaul load captured over the last ${historyWindowLabel}.`} tone="#dc2626" minHeight={0}>
              <MultiLineChartPanel
                rows={historyLanePressure}
                lines={[
                  { key: 'majorOutageOpen', label: 'Major outages', color: '#dc2626' },
                  { key: 'nldOutageOpen', label: 'NLD outages', color: '#f97316' },
                  { key: 'backhaulOpen', label: 'Backhaul', color: '#7c3aed' }
                ]}
                emptyMessage="Historical outage desk pressure will appear as more backend buckets are stored."
              />
            </OpsSection>

            <OpsSection title="Outage Priority Trend" subtitle={`Priority-lane movement over the last ${historyWindowLabel} from the persisted monitoring cache.`} tone="#ea580c" minHeight={0}>
              <MultiLineChartPanel
                rows={historyOutagePriority}
                lines={[
                  { key: 'newUnassigned', label: 'New / unattended', color: '#94a3b8' },
                  { key: 'p1', label: 'P1', color: '#dc2626' },
                  { key: 'p2', label: 'P2', color: '#f97316' },
                  { key: 'p3', label: 'P3', color: '#d97706' },
                  { key: 'p4', label: 'P4', color: '#2563eb' },
                  { key: 'power', label: 'Power', color: '#7c3aed' }
                ]}
                emptyMessage="Historical outage-priority movement will appear after a few stored refresh buckets."
              />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.05 }}>
            <OpsSection title="Impact By Region" subtitle="Subscriber impact rolled up by outage region." tone="#dc2626" minHeight={0}>
              <HorizontalBarChart rows={outageRegionImpactSummary} dataKey="count" emptyMessage="No outage-region impact data is available right now." />
            </OpsSection>

            <OpsSection title="Outage Service Split" subtitle="Open outage rows grouped by service type." tone="#f97316" minHeight={0}>
              <HorizontalBarChart rows={outageServiceTypeSummary} dataKey="count" emptyMessage="No outage service-type summary is available right now." />
            </OpsSection>

            <OpsSection title="Backhaul Owner Load" subtitle="Current open backhaul tickets by working owner." tone="#7c3aed" minHeight={0}>
              <HorizontalBarChart rows={backhaulOwnerSummary} dataKey="count" emptyMessage="No backhaul owner summary is available right now." />
            </OpsSection>
          </Box>

          <OpsSection title="Priority Queue Detail" subtitle="Native replacement for the Grafana P1/P2/P3/P4 and power alert tables." tone="#dc2626" minHeight={0}>
            <MonitoringTable rows={priorityRows} columns={priorityColumns} emptyMessage="No outage priority rows are active right now." />
          </OpsSection>

          <OpsSection title="Major Outage Desk" subtitle="Open non-NLD outage capturing tickets, ranked by age." tone="#dc2626" minHeight={0}>
            <MonitoringTable rows={collections.majorOutages || []} columns={majorColumns} emptyMessage="No major outage rows are open right now." />
          </OpsSection>

          <OpsSection title="NLD Outage Desk" subtitle="Open NLD outage capturing tickets with subscriber impact and last update context." tone="#f97316" minHeight={0}>
            <MonitoringTable rows={collections.nldOutages || []} columns={nldColumns} emptyMessage="No open NLD outage rows are visible right now." />
          </OpsSection>

          <OpsSection title="Backhaul Desk" subtitle="Open backhaul tickets driven off the configured backhaul tag." tone="#7c3aed" minHeight={0}>
            <MonitoringTable rows={collections.backhauls || []} columns={backhaulColumns} emptyMessage="No backhaul tickets are open right now." />
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'tier1' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.95fr 0.95fr 1.1fr' }, gap: 1.05 }}>
            <OpsSection title="Action Mix" subtitle="Live Tier 1 queue grouped by the working action lanes so the desk can see what type of work is piling up." tone="#0f766e" minHeight={0}>
              <CompactBreakdownList rows={t1ActionMixRows} total={summary.tier1Open || 0} emptyMessage="No Tier 1 action mix is available right now." />
            </OpsSection>

            <OpsSection title="Queue Focus" subtitle="The live Tier 1 hotspots that need immediate operator attention right now." tone="#dc2626" minHeight={0}>
              <CompactBreakdownList rows={t1QueueFocusRows} emptyMessage="No Tier 1 focus signals are available right now." />
            </OpsSection>

            <OpsSection title="Automation Routing" subtitle="How much of the current and today-created Tier 1 work is already tagged into downstream automated lanes." tone="#8b5cf6" minHeight={0}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: OPS_MUTED, display: 'block', mb: 0.55 }}>
                    Open queue
                  </Typography>
                  <CompactBreakdownList rows={t1AutomationOpenRows} emptyMessage="No open Tier 1 rows currently show tracked automation routing tags." />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: OPS_MUTED, display: 'block', mb: 0.55 }}>
                    Created today
                  </Typography>
                  <CompactBreakdownList rows={t1AutomationTodayRows} emptyMessage="No Tier 1 intake rows have hit the tracked automation routes yet today." />
                </Box>
              </Box>
            </OpsSection>
          </Box>

          <MetricStrip items={tier1ComparisonMetrics} />
          <MetricStrip items={tier1RedFlagMetrics} />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
            <OpsSection title="Tier 1 Queue Trend" subtitle={`Persisted queue pressure across the last ${historyWindowLabel}, focused on total open work and urgent SLA rows.`} tone="#0f766e" minHeight={0}>
              <MultiLineChartPanel
                rows={historyTier1}
                lines={[
                  { key: 'open', label: 'Open queue', color: '#0f766e' },
                  { key: 'urgent', label: 'Urgent / due now', color: '#dc2626' }
                ]}
                emptyMessage="Tier 1 historical pressure will appear after a few stored monitoring buckets."
              />
            </OpsSection>

            <OpsSection title="Tier 1 Voice Queue Trend" subtitle={`Live ${summary.telephonyTier1QueueName || 'Tier 1 voice'} queue pressure over the stored ${historyWindowLabel} monitoring window.`} tone="#0891b2" minHeight={0}>
              <MultiLineChartPanel
                rows={historyTier1VoiceQueue}
                lines={[
                  { key: 'waiting', label: 'Waiting', color: '#dc2626' },
                  { key: 'answered', label: 'Answered', color: '#0891b2' },
                  { key: 'missed', label: 'Missed', color: '#7c3aed' }
                ]}
                emptyMessage="Tier 1 voice queue history will appear as more telephony snapshots are stored."
              />
            </OpsSection>

            <OpsSection title="Ticket Intake Compare" subtitle={`Today versus the same weekday on ${summary.dayKey ? 'the last two weeks' : 'prior periods'} for Tier 1 received tickets.`} tone="#0f766e" minHeight={0}>
              <MultiLineChartPanel
                rows={t1ReceivedComparisonSeries}
                lines={[
                  { key: 'today', label: 'Today', color: '#0f766e' },
                  { key: 'lastWeek', label: '7 days ago', color: '#22c55e' },
                  { key: 'previousWeek', label: '14 days ago', color: '#86efac' }
                ]}
                emptyMessage="No Tier 1 received comparison data is available right now."
              />
            </OpsSection>

            <OpsSection title="Ticket Solved Compare" subtitle="Today versus the same weekday on the last two weeks for Tier 1 solved tickets." tone="#16a34a" minHeight={0}>
              <MultiLineChartPanel
                rows={t1SolvedComparisonSeries}
                lines={[
                  { key: 'today', label: 'Today', color: '#16a34a' },
                  { key: 'lastWeek', label: '7 days ago', color: '#4ade80' },
                  { key: 'previousWeek', label: '14 days ago', color: '#bbf7d0' }
                ]}
                emptyMessage="No Tier 1 solved comparison data is available right now."
              />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(4, minmax(0, 1fr))' }, gap: 1.05 }}>
            <OpsSection title="Tier 1 Status Shape" subtitle="How the live unsolved Tier 1 queue is sitting by current ticket status." tone="#0f172a" minHeight={0}>
              <SummaryStatBlock rows={t1StatusSummary} emptyMessage="No Tier 1 status split is available right now." />
            </OpsSection>

            <OpsSection title="Operational State Shape" subtitle="Queue flow state by action type, pending work, change-control, and in-progress ownership." tone="#1d4ed8" minHeight={0}>
              <VerticalBarChart rows={t1OperationalStateSummary} dataKey="count" emptyMessage="No Tier 1 operational-state split is available right now." />
            </OpsSection>

            <OpsSection title="Tier 1 SLA Buckets" subtitle="Open Tier 1 work bucketed by remaining SLA time using the Grafana action-view rules." tone="#0f766e" minHeight={0}>
              <VerticalBarChart rows={t1DueBucketSummary} dataKey="count" emptyMessage="No Tier 1 SLA bucket data is available right now." colorMap={Object.fromEntries(t1DueBucketSummary.map((row) => [row.key, row.tone]))} />
            </OpsSection>

            <OpsSection title="Tier 1 Product Split" subtitle="Current open Tier 1 work grouped by product family." tone="#0f766e" minHeight={0}>
              <SummaryStatBlock rows={t1ProductSummary} emptyMessage="No Tier 1 product split is available right now." />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr 1fr' }, gap: 1.05 }}>
            <OpsSection title="Tier 1 P1 Attention" subtitle="New unattended Tier 1 P1 tickets, with the 30-minute action SLA in mind." tone="#dc2626" minHeight={0}>
              <MonitoringTable rows={collections.tier1P1UnattendedTickets || []} columns={t1Columns} emptyMessage="No unattended Tier 1 P1 tickets are open right now." />
            </OpsSection>

            <OpsSection title="Change Control Queue" subtitle="Tier 1 change-related work separated out so it does not hide inside the generic action queue." tone="#8b5cf6" minHeight={0}>
              <MonitoringTable rows={collections.tier1ChangeControlTickets || []} columns={t1Columns} emptyMessage="No Tier 1 change-control tickets are open right now." />
            </OpsSection>

            <OpsSection title="Tier 1 Due Now" subtitle="Breached and due-soon Tier 1 rows that need close operational attention." tone="#ea580c" minHeight={0}>
              <MonitoringTable rows={collections.tier1UrgentTickets || []} columns={t1Columns} emptyMessage="No breached or due-soon Tier 1 rows are open right now." />
            </OpsSection>
          </Box>

          <OpsSection title="Tier 1 Action View" subtitle="This is the working queue view with P-level, product, and due bucket context in one table." tone="#0f766e" minHeight={0}>
            <MonitoringTable rows={collections.tier1Tickets || []} columns={t1Columns} emptyMessage="No Tier 1 tickets are open right now." />
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'tier2' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <MetricStrip items={tier2ComparisonMetrics} />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
            <OpsSection title="Tier 2 Intake Compare" subtitle="Today versus the same weekday on the last two weeks for Tier 2 received tickets." tone="#1d4ed8" minHeight={0}>
              <MultiLineChartPanel
                rows={t2ReceivedComparisonSeries}
                lines={[
                  { key: 'today', label: 'Today', color: '#1d4ed8' },
                  { key: 'lastWeek', label: '7 days ago', color: '#60a5fa' },
                  { key: 'previousWeek', label: '14 days ago', color: '#bfdbfe' }
                ]}
                emptyMessage="No Tier 2 received comparison data is available right now."
              />
            </OpsSection>

            <OpsSection title="Tier 2 Solved Compare" subtitle="Today versus the same weekday on the last two weeks for Tier 2 solved tickets." tone="#0891b2" minHeight={0}>
              <MultiLineChartPanel
                rows={t2SolvedComparisonSeries}
                lines={[
                  { key: 'today', label: 'Today', color: '#0891b2' },
                  { key: 'lastWeek', label: '7 days ago', color: '#38bdf8' },
                  { key: 'previousWeek', label: '14 days ago', color: '#bae6fd' }
                ]}
                emptyMessage="No Tier 2 solved comparison data is available right now."
              />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.05fr 0.95fr' }, gap: 1.05 }}>
            <OpsSection title="Tier 2 Queue Trend" subtitle={`Open queue, unattended rows, and handover drift over the last ${historyWindowLabel}.`} tone="#1d4ed8" minHeight={0}>
              <MultiLineChartPanel
                rows={historyTier2}
                lines={[
                  { key: 'open', label: 'Open queue', color: '#1d4ed8' },
                  { key: 'unattended', label: 'New / unattended', color: '#dc2626' },
                  { key: 'handover', label: 'Handover', color: '#ea580c' }
                ]}
                emptyMessage="Tier 2 historical queue pressure will appear after more monitoring buckets land."
              />
            </OpsSection>

            <OpsSection title="Tier 2 Daily Flow" subtitle={`Hourly received versus solved flow for ${summary.dayKey || 'today'}.`} tone="#0f172a" minHeight={0}>
              <MultiLineChartPanel
                rows={hourlySeries}
                lines={[
                  { key: 't2Received', label: 'T2 received', color: '#1d4ed8' },
                  { key: 't2Solved', label: 'T2 solved', color: '#60a5fa' }
                ]}
                emptyMessage="No Tier 2 flow data is available for the current ops day."
              />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.86fr 0.86fr 1.28fr' }, gap: 1.05 }}>
            <OpsSection title="Tier 2 Active By Party" subtitle="The Grafana-style party split for active Tier 2 work excluding pending and new." tone="#1d4ed8" minHeight={0}>
              <VerticalBarChart rows={t2PartySummary} dataKey="count" emptyMessage="No active Tier 2 party breakdown is available right now." />
            </OpsSection>

            <OpsSection title="Tier 2 Product Split" subtitle="Open Tier 2 work split by the same product-tag logic used in the Grafana action transforms." tone="#0f172a" minHeight={0}>
              <SummaryStatBlock rows={t2ProductSummary} emptyMessage="No Tier 2 product split is available right now." />
            </OpsSection>

            <OpsSection title="Tier 2 Age Profile" subtitle="Open Tier 2 work bucketed by queue age for a quicker backlog shape view." tone="#0f172a" minHeight={0}>
              <VerticalBarChart rows={t2AgeBucketSummary} dataKey="count" emptyMessage="No Tier 2 age profile is available right now." colorMap={Object.fromEntries(t2AgeBucketSummary.map((row) => [row.key, row.tone]))} />
            </OpsSection>
          </Box>

          <OpsSection title="Tier 2 Service Type" subtitle="Live Tier 2 queue grouped by service type from Zendesk fields." tone="#0891b2" minHeight={0}>
            <HorizontalBarChart rows={t2ServiceTypeSummary} dataKey="count" emptyMessage="No Tier 2 service-type summary is available right now." />
          </OpsSection>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
            <OpsSection title="Tier 2 New / Unassigned" subtitle="Immediate unattended Tier 2 rows from the live snapshot." tone="#dc2626" minHeight={0}>
              <MonitoringTable rows={collections.tier2NewUnassignedTickets || []} columns={t2Columns} emptyMessage="No new or unattended Tier 2 tickets are open right now." />
            </OpsSection>

            <OpsSection title="Tier 2 Handover" subtitle="Open handover rows that used to sit in their own Grafana panel." tone="#ea580c" minHeight={0}>
              <MonitoringTable rows={collections.tier2HandoverTickets || []} columns={t2Columns} emptyMessage="No handover Tier 2 rows are open right now." />
            </OpsSection>
          </Box>

          <OpsSection title="Tier 2 Open Queue" subtitle="Full Tier 2 queue with party and handover context carried into the native hub." tone="#1d4ed8" minHeight={0}>
            <MonitoringTable rows={collections.tier2Tickets || []} columns={t2Columns} emptyMessage="No Tier 2 tickets are open right now." />
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'nld' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <MetricStrip
            items={[
              {
                label: 'Partial events',
                value: formatCount(summary.nldPartialEventCount || 0),
                subtext: 'recent partial-NLD event rows in lookback',
                tone: '#f97316',
                icon: <LanRoundedIcon fontSize="small" />
              },
              {
                label: 'Route clusters',
                value: formatCount(summary.nldPartialClusterCount || 0),
                subtext: 'repeat event clusters on the same route',
                tone: '#dc2626',
                icon: <RouteRoundedIcon fontSize="small" />
              },
              {
                label: 'Not logged',
                value: formatCount(summary.nldPartialNotLoggedCount || 0),
                subtext: 'partial events without an outage ticket match',
                tone: '#ea580c',
                icon: <WarningAmberRoundedIcon fontSize="small" />
              },
              {
                label: 'Open NLD outages',
                value: formatCount(summary.nldOutageOpen || 0),
                subtext: `${formatCount(summary.nldOutageSubscribers || 0)} subscribers impacted`,
                tone: '#0f766e',
                icon: <NotificationsActiveRoundedIcon fontSize="small" />
              }
            ]}
          />

          <OpsSection title="Partial NLD Trend" subtitle={`Events, clusters, and not-logged pressure over the last ${historyWindowLabel}.`} tone="#f97316" minHeight={0}>
            <MultiLineChartPanel
              rows={historyNldPartials}
              lines={[
                { key: 'events', label: 'Partial events', color: '#f97316' },
                { key: 'clusters', label: 'Route clusters', color: '#dc2626' },
                { key: 'notLogged', label: 'Not logged', color: '#eab308' }
              ]}
              emptyMessage="Historical partial-NLD pressure will appear after more stored monitoring buckets are created."
            />
          </OpsSection>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
            <OpsSection title="Partial Route Pressure" subtitle="Top partial-NLD route concentrations from the current event lookback." tone="#f97316" minHeight={0}>
              <VerticalBarChart rows={partialRouteSummary.slice(0, 12)} dataKey="count" emptyMessage="No partial route pressure is available right now." />
            </OpsSection>

            <OpsSection title="Cluster Summary" subtitle="Routes with repeated event activity in the cluster window." tone="#dc2626" minHeight={0}>
              <MonitoringTable rows={collections.nldPartialClusters || []} columns={nldClusterColumns} emptyMessage="No NLD clusters were detected in the current window." />
            </OpsSection>
          </Box>

          <OpsSection title="Partial Not Logged" subtitle="Active partial events that have not matched back to an open outage ticket yet." tone="#ea580c" minHeight={0}>
            <MonitoringTable rows={collections.nldPartialNotLogged || []} columns={nldEventColumns} emptyMessage="No partial events are waiting for outage logging right now." />
          </OpsSection>

          <OpsSection title="Recent Partial NLD Events" subtitle="Recent partial-NLD event rows, including the route and circuit context derived from the alert subject." tone="#0f172a" minHeight={0}>
            <MonitoringTable rows={collections.nldPartialEvents || []} columns={nldEventColumns} emptyMessage="No partial-NLD event rows are available right now." />
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'voice' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <MetricStrip
            items={[
              {
                label: 'Calls answered',
                value: telephonySummary ? formatCount(telephonySummary.callsAnswered || 0) : '--',
                subtext: 'live voice stats from Illation',
                tone: '#0891b2',
                icon: <CallRoundedIcon fontSize="small" />
              },
              {
                label: 'Calls missed',
                value: telephonySummary ? formatCount(telephonySummary.callsMissed || 0) : '--',
                subtext: 'current dashboard day snapshot',
                tone: '#dc2626',
                icon: <WarningAmberRoundedIcon fontSize="small" />
              },
              {
                label: 'Avg answer',
                value: telephonySummary ? formatSeconds(telephonySummary.avgAnswerSeconds || 0) : '--',
                subtext: telephonySummary ? `Abandon rate ${formatPercent(telephonySummary.abandonRate || 0)}` : 'telephony not configured',
                tone: '#0f766e',
                icon: <InsightsRoundedIcon fontSize="small" />
              },
              {
                label: 'Waiting now',
                value: telephonySummary ? formatCount(telephonySummary.callsWaiting || 0) : '--',
                subtext: telephonySummary ? `Max queue ${formatSeconds(telephonySummary.maxQueueSeconds || 0)}` : 'telephony not configured',
                tone: '#7c3aed',
                icon: <MonitorHeartRoundedIcon fontSize="small" />
              }
            ]}
          />

          <OpsSection title="Voice Queue Trend" subtitle={`Waiting, answered, and missed call movement across the last ${historyWindowLabel}.`} tone="#0891b2" minHeight={0}>
            <MultiLineChartPanel
              rows={historyTelephony}
              lines={[
                { key: 'waiting', label: 'Waiting', color: '#7c3aed' },
                { key: 'answered', label: 'Answered', color: '#0891b2' },
                { key: 'missed', label: 'Missed', color: '#dc2626' }
              ]}
              emptyMessage="Historical telephony queue movement will appear once more backend voice snapshots are stored."
            />
          </OpsSection>

          <OpsSection title="Voice Hourly Flow" subtitle="Hourly voice intake, abandon volume, and talk-time pattern from the Illation dashboard stats feed." tone="#0891b2" minHeight={0}>
            <MultiLineChartPanel
              rows={(collections.telephonyHourly || []).map((row) => ({ ...row, label: `${row.hour}:00` }))}
              lines={[
                { key: 'received', label: 'Received', color: '#0891b2' },
                { key: 'abandoned', label: 'Abandoned', color: '#dc2626' },
                { key: 'avgTalkSeconds', label: 'Avg talk sec', color: '#0f766e' }
              ]}
              emptyMessage="No telephony hourly feed is available right now."
            />
          </OpsSection>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
            <OpsSection title="Queue Waiting Snapshot" subtitle="Live waiting callers by queue from the Illation feed." tone="#0891b2" minHeight={0}>
              <HorizontalBarChart rows={telephonyQueueWaitingSummary} dataKey="count" emptyMessage="No queue waiting summary is available right now." />
            </OpsSection>

            <OpsSection title="Missed Calls By Agent" subtitle="Highest missed-call counts by agent in the current voice snapshot." tone="#dc2626" minHeight={0}>
              <HorizontalBarChart rows={telephonyMissedAgentSummary} dataKey="count" emptyMessage="No missed-call agent summary is available right now." />
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
            <OpsSection title="Telephony Queues" subtitle="Queue pressure from the Illation stats feed." tone="#0891b2" minHeight={0}>
              <MonitoringTable rows={collections.telephonyQueues || []} columns={queueColumns} emptyMessage="No telephony queue rows are available right now." />
            </OpsSection>

            <OpsSection title="Telephony Agents" subtitle="Agent state, login, and missed-call context from the same live voice feed." tone="#0f172a" minHeight={0}>
              <MonitoringTable rows={collections.telephonyAgents || []} columns={agentColumns} emptyMessage="No telephony agent rows are available right now." />
            </OpsSection>
          </Box>
        </Box>
      ) : null}

      {tab === 'skipped' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <OpsSection title="Source Warnings" subtitle="Per-source fetch issues are surfaced here instead of collapsing the entire monitoring page." tone="#d97706" minHeight={0}>
            <Stack spacing={0.8}>
              {warnings.length ? warnings.map((warning, index) => (
                <OpsAlert key={`${warning.source}-${index}`} severity="warning">
                  <strong>{warning.source}</strong>: {warning.message}
                </OpsAlert>
              )) : (
                <OpsAlert severity="success">No source warnings were raised in the latest snapshot.</OpsAlert>
              )}
              <OpsAlert severity={collections.telephonyMeta?.available ? 'info' : 'warning'}>
                {collections.telephonyMeta?.available
                  ? 'Telephony data was included in the current snapshot.'
                  : collections.telephonyMeta?.reason || 'Telephony data is not configured yet.'}
              </OpsAlert>
            </Stack>
          </OpsSection>

          <OpsSection title="Skipped Ticket Hygiene" subtitle="The visible Zendesk skip list is kept on its own tab for now so it does not compete with the live action lanes." tone="#475569" minHeight={0}>
            <MonitoringTable rows={collections.skippedTickets || []} columns={skippedColumns} emptyMessage="No skipped ticket rows are visible right now." />
          </OpsSection>
        </Box>
      ) : null}
      </Box>
    </PageShell>
  )
}

