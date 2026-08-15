import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Collapse,
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
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import dayjs from 'dayjs'
import {
  CircleMarker,
  MapContainer,
  Popup as LeafletPopup,
  TileLayer,
  Tooltip as LeafletTooltip,
  useMap
} from 'react-leaflet'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  fetchNocMonitoringSnapshot,
  fetchNocMonitoringTelephonyPulse,
  fetchNocMonitoringTier1PremisesMap
} from '../api/nocMonitoring'
import { PageShell } from '../components/ui/PageScaffold'
import { downloadWorkbook } from '../utils/slaExport'
import {
  AnalyticsChartFallback,
  AnalyticsLoadingBlock,
  AnalyticsMetricCard as MetricCard,
  AnalyticsSectionCard as SectionCard
} from '../components/ui/AnalyticsPrimitives'

const ACCENT = '#0f766e'
const OPS_BG = '#eef4fb'
const OPS_PANEL = 'rgba(255, 255, 255, 0.98)'
const OPS_PANEL_SOFT = 'rgba(255, 255, 255, 0.95)'
const OPS_BORDER = 'rgba(148, 163, 184, 0.28)'
const OPS_TEXT = '#0f172a'
const OPS_MUTED = 'rgba(51, 65, 85, 0.72)'
const OPS_GRID = 'rgba(148, 163, 184, 0.24)'
const OPS_RADIUS_SM = 1.2
const OPS_RADIUS_MD = 1.5
const OPS_RADIUS_LG = 1.75
const DEFAULT_HISTORY_HOURS = 72
const SNAPSHOT_POLL_MS = 5 * 60 * 1000
const TELEPHONY_POLL_MS = 5000
const OUTAGE_PROCESS_MARKERS = [
  { key: 'validate', label: 'Validate impact', target: '0-10m', detail: 'Confirm affected routes, subs, and service footprint.', tone: '#0f766e' },
  { key: 'vendorLog', label: 'Log to vendor', target: 'By 20m for NLD', detail: 'Vendor ticket raised and tracking started.', tone: '#ea580c' },
  { key: 'solid', label: 'Solid outage created', target: 'Early incident', detail: 'Formal outage record opened for tracking.', tone: '#2563eb' },
  { key: 'comms', label: 'Comms sent', target: 'Early incident', detail: 'Customer / stakeholder communication issued.', tone: '#7c3aed' },
  { key: 'ack', label: 'Vendor ack / dispatch / ETA / side', target: 'Inside 1h', detail: 'Need acknowledgement, ETA, and side of link.', tone: '#d97706' },
  { key: 'onsite', label: 'On site', target: 'By 2h', detail: 'Vendor should be on site for outage / NLD / backhaul.', tone: '#dc2626' },
  { key: 'test', label: 'Test', target: 'Mid incident', detail: 'Field and desk testing underway.', tone: '#0891b2' },
  { key: 'localise', label: 'Localise fault', target: 'Before 4h', detail: 'Fault side / cause understood and narrowed down.', tone: '#14b8a6' },
  { key: 'pictures', label: 'Pictures received', target: 'Repair evidence', detail: 'Visual proof / site evidence back from field.', tone: '#8b5cf6' },
  { key: 'resolve', label: 'Repaired / confirm / resolve', target: 'By 4h', detail: 'Repair complete, levels confirmed, closure ready.', tone: '#16a34a' }
]
const DASHBOARD_METRIC_ROOT_SX = {
  p: 1.05,
  borderRadius: OPS_RADIUS_MD,
  backdropFilter: 'blur(14px)',
  color: OPS_TEXT,
  border: `1px solid ${OPS_BORDER}`,
  bgcolor: 'rgba(255, 255, 255, 0.98)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, rgba(244, 247, 251, 0.96) 100%)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.7)'
}
const DASHBOARD_METRIC_VALUE_SX = {
  fontSize: '1.12rem',
  color: OPS_TEXT
}
const DASHBOARD_SECTION_ROOT_SX = {
  borderRadius: OPS_RADIUS_LG,
  color: OPS_TEXT,
  border: '1px solid rgba(148, 163, 184, 0.18)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, rgba(245, 248, 252, 0.98) 100%)',
  boxShadow: '0 16px 34px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.85)',
  '& > .MuiStack-root': {
    borderBottomColor: 'rgba(148, 163, 184, 0.18)',
    background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.98) 0%, rgba(239, 246, 255, 0.9) 100%)'
  },
  '& > .MuiStack-root .MuiTypography-subtitle2': {
    color: OPS_TEXT
  },
  '& > .MuiStack-root .MuiTypography-body2': {
    color: `${OPS_MUTED} !important`
  },
  '& .MuiTableCell-root': {
    color: OPS_TEXT,
    borderColor: 'rgba(148, 163, 184, 0.18)'
  },
  '& .MuiTableRow-root:hover': {
    backgroundColor: 'rgba(226, 232, 240, 0.4)'
  },
  '& .MuiChip-root': {
    borderColor: 'rgba(148, 163, 184, 0.24)'
  }
}
const DASHBOARD_SECTION_HEADER_SX = {
  px: 1,
  py: 0.72,
  borderBottomColor: 'rgba(148, 163, 184, 0.18)',
  background: 'linear-gradient(180deg, rgba(248, 250, 252, 0.98) 0%, rgba(239, 246, 255, 0.92) 100%)'
}
const DASHBOARD_SECTION_BODY_SX = {
  px: 1.05,
  py: 0.92
}
const DASHBOARD_SECTION_TITLE_SX = {
  color: OPS_TEXT,
  fontSize: '0.94rem',
  fontWeight: 800,
  letterSpacing: 0.15
}
const DASHBOARD_SECTION_SUBTITLE_SX = {
  fontSize: '0.76rem',
  lineHeight: 1.25,
  color: `${OPS_MUTED} !important`
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
  'P3 Parked': '#92400e',
  'P4 Parked': '#1d4ed8',
  Change: '#8b5cf6',
  Other: '#64748b'
}
const T1_DUE_BUCKET_TONE_MAP = {
  BREACHED: '#dc2626',
  'Due <=15m': '#ea580c',
  'Due <=30m': '#d97706',
  'Safe >30m': '#0f766e',
  'Parked timer': '#475569',
  'Change control': '#8b5cf6',
  'No active timer': '#64748b'
}
const T1_OPERATIONAL_STATE_TONE_MAP = {
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
}
const T1_ESCALATION_PATH_TONE_MAP = {
  'Tier 1 desk': '#0f766e',
  Maintenance: '#2563eb',
  'DFA / vendor': '#d97706',
  'Linked outage': '#7c3aed',
  'ISP / customer': '#ea580c',
  'Vendor / carrier': '#d97706',
  'Change control': '#8b5cf6',
  'Tier 1 review': '#475569'
}
const T1_WORKFLOW_OWNER_TONE_MAP = {
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
const T1_PRESET_TONE_MAP = {
  all: '#0f766e',
  p1Only: '#dc2626',
  dueNow: '#ea580c',
  changeControl: '#8b5cf6',
  automationRouted: '#2563eb',
  deskOwned: '#0f766e',
  maintenanceOwned: '#2563eb',
  parkedTimers: '#475569'
}
const T1_SYSTEM_STATE_ORDER = ['new', 'open', 'hold', 'pending', 'solved', 'closed', 'unknown']
const T1_OPERATIONAL_STATE_ORDER = [
  'Active support',
  'Active support blitz',
  'Pending maintenance',
  'Pending vendor',
  'Pending client info',
  'Pending outage closure',
  'Deferred',
  'Change control',
  'Pending Tier 2',
  'Pending Tier 3',
  'Pending PMT',
  'Pending 365',
  'Pending management',
  'Pending RCA',
  'Pending COC',
  'Pending change control',
  'Pending provisioning',
  'Pending facilities',
  'Pending review',
  'On hold',
  'New / unattended',
  'Solved / cleanup',
  'Closed / cleanup',
  'Needs review'
]
const T1_ACTION_ORDER = ['P1', 'P2', 'P3', 'P4', 'P3 Parked', 'P4 Parked', 'Change', 'Other']
const T1_ESCALATION_PATH_ORDER = ['Tier 1 desk', 'Maintenance', 'DFA / vendor', 'Linked outage', 'ISP / customer', 'Vendor / carrier', 'Change control', 'Tier 1 review']
const T1_WORKFLOW_OWNER_ORDER = ['With Tier 1', 'With maintenance', 'Waiting on client / ISP', 'With vendor / carrier', 'Linked outage / closure', 'Deferred / parked', 'Change control', 'Internal / other', 'Needs review']
const T1_DUE_BUCKET_ORDER_UI = ['BREACHED', 'Due <=15m', 'Due <=30m', 'Safe >30m', 'Parked timer', 'Change control', 'No active timer']
const T1_PLAY_POLICY_TONE_MAP = {
  'Play Priority 1': '#dc2626',
  'Play Priority 2': '#ea580c',
  'Play Priority 3': '#d97706',
  'Play Priority 4': '#2563eb'
}

const T1_PRESETS = [
  { key: 'all', label: 'All queue' },
  { key: 'p1Only', label: 'P1 only' },
  { key: 'dueNow', label: 'Due now' },
  { key: 'changeControl', label: 'Change Control' },
  { key: 'automationRouted', label: 'Automation-routed' },
  { key: 'deskOwned', label: 'With Tier 1' },
  { key: 'maintenanceOwned', label: 'With Maintenance' },
  { key: 'parkedTimers', label: 'Parked timers' }
]
const DEFAULT_T1_ACTION_FILTERS = {
  systemState: 'all',
  operationalState: 'all',
  workflowOwner: 'all',
  escalationPath: 'all',
  pLevel: 'all',
  dueBucket: 'all',
  automationRoute: 'all'
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

function formatMinutesRemaining(value) {
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return '--'

  const sign = minutes < 0 ? '-' : ''
  const absolute = Math.abs(Math.round(minutes))
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60

  if (!hours) return `${sign}${mins}m`
  if (!mins) return `${sign}${hours}h`
  return `${sign}${hours}h ${mins}m`
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

function safeFilePart(value) {
  return String(value || 'export')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'export'
}

function formatExportValue(value) {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined || value === '') return '--'
  return value
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function sortByPresetOrder(values, order = []) {
  const rank = new Map(order.map((item, index) => [item, index]))
  return [...values].sort((left, right) => {
    const leftRank = rank.has(left) ? rank.get(left) : Number.MAX_SAFE_INTEGER
    const rightRank = rank.has(right) ? rank.get(right) : Number.MAX_SAFE_INTEGER
    if (leftRank !== rightRank) return leftRank - rightRank
    return String(left).localeCompare(String(right))
  })
}

function normalizePremisesAliasKey(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function buildTier1PremisesClusters(rows = []) {
  const grouped = new Map()

  rows.forEach((row) => {
    const aliasLabel = String(row?.customerPremisesAlias || '').replace(/\s+/g, ' ').trim()
    if (!aliasLabel || aliasLabel.length < 6) return

    const key = normalizePremisesAliasKey(aliasLabel)
    if (!key || ['--', 'n/a', 'na', 'none', 'null', 'unknown', 'unknown address'].includes(key)) return

    const existing = grouped.get(key) || {
      key,
      label: aliasLabel,
      count: 0,
      regionCounts: new Map(),
      nodeCounts: new Map(),
      oltCounts: new Map(),
      orgCounts: new Map(),
      productCounts: new Map(),
      tickets: []
    }

    const bump = (map, value) => {
      const text = String(value || '').replace(/\s+/g, ' ').trim()
      if (!text) return
      map.set(text, (map.get(text) || 0) + 1)
    }

    existing.count += 1
    bump(existing.regionCounts, row?.province || row?.region)
    bump(existing.nodeCounts, row?.nodeName)
    bump(existing.oltCounts, row?.olt)
    bump(existing.orgCounts, row?.organizationLabel)
    bump(existing.productCounts, row?.product)

    if (existing.tickets.length < 8) {
      existing.tickets.push({
        id: row?.id,
        url: row?.url || '',
        subject: row?.subject || '',
        pLevel: row?.pLevel || '',
        dueBucket: row?.dueBucket || '',
        workflowOwner: row?.workflowOwner || ''
      })
    }

    grouped.set(key, existing)
  })

  const pickTopLabel = (map, fallback = '--') => [...map.entries()]
    .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))[0]?.[0] || fallback

  return [...grouped.values()]
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      count: entry.count,
      province: pickTopLabel(entry.regionCounts, 'Unknown province'),
      nodeName: pickTopLabel(entry.nodeCounts, 'Unknown node'),
      olt: pickTopLabel(entry.oltCounts, 'Unknown OLT'),
      organizationLabel: pickTopLabel(entry.orgCounts, 'Unknown organisation'),
      product: pickTopLabel(entry.productCounts, '--'),
      tickets: entry.tickets
    }))
    .sort((left, right) => right.count - left.count || String(left.label).localeCompare(String(right.label)))
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
    <Link href={href} target="_blank" rel="noreferrer" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35, color: '#0f766e' }}>
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
        color: OPS_TEXT,
        bgcolor: alpha(tone, 0.12),
        border: `1px solid ${alpha(tone, 0.36)}`,
        '& .MuiChip-label': {
          px: 0.95
        }
      }}
    />
  )
}

function SectionCollapseButton({ expanded, onClick }) {
  return (
    <Button
      size="small"
      variant="outlined"
      onClick={onClick}
      sx={{
        minWidth: 0,
        px: 0.95,
        py: 0.42,
        borderRadius: OPS_RADIUS_SM,
        textTransform: 'none',
        color: OPS_TEXT,
        borderColor: 'rgba(148, 163, 184, 0.24)',
        bgcolor: 'rgba(255, 255, 255, 0.96)',
        fontWeight: 800,
        fontSize: '0.74rem',
        '&:hover': {
          borderColor: 'rgba(100, 116, 139, 0.34)',
          bgcolor: 'rgba(248, 250, 252, 0.98)'
        }
      }}
    >
      {expanded ? 'Collapse' : 'Expand'}
    </Button>
  )
}

function DrillCounterButton({ label, count, helper, tone = ACCENT, onClick }) {
  return (
    <Button
      size="small"
      variant="outlined"
      onClick={onClick}
      sx={{
        minWidth: 0,
        justifyContent: 'flex-start',
        px: 0.95,
        py: 0.65,
        borderRadius: OPS_RADIUS_SM,
        color: OPS_TEXT,
        borderColor: alpha(tone, 0.36),
        bgcolor: 'rgba(255, 255, 255, 0.98)',
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, ${alpha(tone, 0.12)} 100%)`,
        textTransform: 'none',
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.8), 0 10px 18px ${alpha('#020617', 0.06)}`,
        '&:hover': {
          borderColor: alpha(tone, 0.52),
          bgcolor: 'rgba(248, 250, 252, 0.98)'
        }
      }}
    >
      <Stack spacing={0.1} alignItems="flex-start">
        <Typography variant="caption" sx={{ color: alpha(tone, 0.9), lineHeight: 1.1, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {label}
        </Typography>
        <Typography variant="subtitle1" sx={{ fontWeight: 900, color: OPS_TEXT, lineHeight: 1 }}>
          {formatCount(count)}
        </Typography>
        {helper ? (
          <Typography variant="caption" sx={{ color: OPS_MUTED, lineHeight: 1.15 }}>
            {helper}
          </Typography>
        ) : null}
      </Stack>
    </Button>
  )
}

function RowWindowSelector({ value, onChange, options = [10, 20, 50, 'all'] }) {
  return (
    <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap" justifyContent="flex-end">
      {options.map((option) => {
        const selected = value === option
        const label = option === 'all' ? 'All' : String(option)
        return (
          <Chip
            key={label}
            size="small"
            label={label}
            clickable
            onClick={() => onChange(option)}
            sx={{
              height: 22,
              fontWeight: 700,
              color: OPS_TEXT,
              bgcolor: selected ? 'rgba(15, 118, 110, 0.14)' : 'rgba(255, 255, 255, 0.95)',
              border: `1px solid ${selected ? alpha('#34d399', 0.42) : 'rgba(148, 163, 184, 0.18)'}`,
              '& .MuiChip-label': {
                px: 0.95
              }
            }}
          />
        )
      })}
    </Stack>
  )
}

function FilterChipGroup({ label, value, onChange, options = [], tone = ACCENT, countMap = {}, anyCount = null, labelFormatter, anyLabel = 'Any' }) {
  return (
    <Stack spacing={0.45}>
      <Typography variant="caption" sx={{ color: OPS_MUTED, textTransform: 'uppercase', letterSpacing: 0.55 }}>
        {label}
      </Typography>
      <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
        <Chip
          size="small"
          label={`${anyLabel} ${formatCount(anyCount ?? 0)}`}
          clickable
          onClick={() => onChange('all')}
          sx={{
            height: 22,
            fontWeight: 700,
            color: OPS_TEXT,
            bgcolor: value === 'all' ? alpha(tone, 0.14) : 'rgba(255, 255, 255, 0.95)',
            border: `1px solid ${value === 'all' ? alpha(tone, 0.44) : 'rgba(148, 163, 184, 0.18)'}`,
            '& .MuiChip-label': {
              px: 0.95
            }
          }}
        />
        {options.map((option) => {
          const selected = value === option
          const label = labelFormatter ? labelFormatter(option) : option
          return (
            <Chip
              key={option}
              size="small"
              label={`${label} ${formatCount(countMap[option] ?? 0)}`}
              clickable
              onClick={() => onChange(option)}
              sx={{
                height: 22,
                fontWeight: 700,
                color: OPS_TEXT,
                bgcolor: selected ? alpha(tone, 0.14) : 'rgba(255, 255, 255, 0.95)',
                border: `1px solid ${selected ? alpha(tone, 0.44) : 'rgba(148, 163, 184, 0.18)'}`,
                '& .MuiChip-label': {
                  px: 0.95
                }
              }}
            />
          )
        })}
      </Stack>
    </Stack>
  )
}

function OpsValueTiles({ items, columns = { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' } }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: columns, gap: 0.75 }}>
      {items.map((item) => (
        <Box
          key={item.label}
          sx={{
            position: 'relative',
            overflow: 'hidden',
            p: 0.9,
            borderRadius: OPS_RADIUS_MD,
            border: `1px solid ${alpha(item.tone || ACCENT, 0.22)}`,
            bgcolor: 'rgba(255, 255, 255, 0.98)',
            background: `linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, ${alpha(item.tone || ACCENT, 0.12)} 100%)`,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.8)',
            '&::before': {
              content: '""',
              position: 'absolute',
              inset: '0 auto 0 0',
              width: 3,
              background: `linear-gradient(180deg, ${alpha(item.tone || ACCENT, 0.9)} 0%, ${alpha(item.tone || ACCENT, 0)} 100%)`
            }
          }}
        >
          <Stack spacing={0.35}>
            <Stack direction="row" spacing={0.55} alignItems="center" justifyContent="space-between">
              <Typography variant="caption" sx={{ color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 0.55, fontWeight: 700 }}>
                {item.label}
              </Typography>
              {item.badge ? <SignalChip label={item.badge} tone={item.tone || ACCENT} /> : null}
            </Stack>
            <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1.04, color: OPS_TEXT, letterSpacing: -0.2, ...(item.valueSx || {}) }}>
              {item.value}
            </Typography>
            {item.helper ? (
              <Typography variant="caption" sx={{ color: OPS_MUTED }}>
                {item.helper}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      ))}
    </Box>
  )
}

function OpsStatusPill({ label, value, tone = ACCENT, centered = false, quiet = false }) {
  return (
    <Box
      sx={{
        minWidth: 0,
        px: 1.15,
        py: 0.78,
        borderRadius: OPS_RADIUS_MD,
        border: `1px solid ${alpha(tone, 0.34)}`,
        bgcolor: 'rgba(255, 255, 255, 0.98)',
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, ${alpha(tone, 0.12)} 100%)`,
        boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.7)}, 0 10px 24px ${alpha('#020617', 0.06)}`,
        minHeight: 52
      }}
    >
      <Stack spacing={0.3} sx={{ minWidth: 0, alignItems: centered ? 'center' : 'stretch', textAlign: centered ? 'center' : 'left' }}>
        <Typography variant="caption" sx={{ color: alpha(tone, 0.9), textTransform: 'uppercase', letterSpacing: 0.74, lineHeight: 1, fontWeight: 800, fontSize: '0.58rem' }}>
          {label}
        </Typography>
        <Stack direction="row" spacing={0.65} alignItems="center" justifyContent={centered ? 'center' : 'space-between'} sx={{ minWidth: 0 }}>
          <Typography
            variant="body2"
            sx={{
              color: OPS_TEXT,
              fontWeight: 900,
              lineHeight: 1,
              fontSize: '1.04rem',
              letterSpacing: -0.12
            }}
            noWrap
          >
            {value}
          </Typography>
          {quiet ? null : <Box sx={{ width: 8, height: 8, borderRadius: 999, bgcolor: tone, boxShadow: `0 0 14px ${alpha(tone, 0.55)}`, flexShrink: 0 }} />}
        </Stack>
      </Stack>
    </Box>
  )
}

function OpsPriorityCard({ label, value, detail, meta, tone = ACCENT, onClick, active = false, icon = null, progress = null, rootSx = null }) {
  return (
    <Box
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        p: 0.92,
        textAlign: 'left',
        borderRadius: OPS_RADIUS_LG,
        color: OPS_TEXT,
        border: `1px solid ${alpha(tone, active ? 0.5 : 0.24)}`,
        bgcolor: 'rgba(255, 255, 255, 0.98)',
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, rgba(248, 250, 252, 0.96) 58%, ${alpha(tone, active ? 0.14 : 0.08)} 100%)`,
        boxShadow: active
          ? `0 0 0 1px ${alpha(tone, 0.12)}, 0 16px 28px ${alpha(tone, 0.12)}`
          : 'inset 0 0 0 1px rgba(148, 163, 184, 0.05), 0 10px 22px rgba(2, 6, 23, 0.06)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
        appearance: 'none',
        outline: 'none',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '0 auto 0 0',
          width: 3,
          background: tone,
          boxShadow: `0 0 24px ${alpha(tone, 0.5)}`
        },
        '&:hover': onClick ? {
          transform: 'translateY(-1px)',
          borderColor: alpha(tone, 0.52),
          boxShadow: `0 0 0 1px ${alpha(tone, 0.14)}, 0 18px 30px ${alpha(tone, 0.12)}`
        } : undefined,
        ...rootSx
      }}
    >
        <Stack spacing={0.42}>
          <Stack direction="row" spacing={0.7} justifyContent="space-between" alignItems="flex-start">
            <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0 }}>
              {icon ? (
                <Box
                  sx={{
                    width: 26,
                    height: 26,
                    borderRadius: OPS_RADIUS_SM,
                    display: 'grid',
                    placeItems: 'center',
                    color: tone,
                    bgcolor: alpha(tone, active ? 0.12 : 0.08),
                    border: `1px solid ${alpha(tone, active ? 0.34 : 0.18)}`
                  }}
                >
                  {icon}
                </Box>
              ) : null}
              <Typography variant="caption" sx={{ color: alpha(tone, 0.9), textTransform: 'uppercase', letterSpacing: 0.54, fontWeight: 800 }}>
                {label}
              </Typography>
            </Stack>
            <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: tone, boxShadow: `0 0 16px ${alpha(tone, 0.55)}` }} />
          </Stack>
          <Stack direction="row" spacing={0.9} alignItems="flex-end" justifyContent="space-between">
            <Typography variant="h4" sx={{ color: OPS_TEXT, fontWeight: 900, lineHeight: 0.92, letterSpacing: -0.32, fontSize: '2rem' }}>
              {value}
            </Typography>
            {meta ? (
              <Typography variant="caption" sx={{ color: OPS_MUTED, lineHeight: 1.12, textAlign: 'right', maxWidth: 132 }}>
                {meta}
              </Typography>
            ) : null}
          </Stack>
          <Typography variant="body2" sx={{ color: OPS_TEXT, fontWeight: 800, lineHeight: 1.16 }}>
            {detail}
          </Typography>
          <Box sx={{ height: 4, borderRadius: 999, bgcolor: alpha(tone, 0.14), overflow: 'hidden' }}>
            <Box sx={{ width: `${Math.min(100, Math.max(0, progress ?? (active ? 100 : 58)))}%`, height: '100%', borderRadius: 999, background: `linear-gradient(90deg, ${tone} 0%, ${alpha(tone, 0.38)} 100%)` }} />
          </Box>
        </Stack>
      </Box>
  )
}

function ConsoleToggleStrip({ value, onChange, options, tone = ACCENT }) {
  return (
    <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
      {options.map((option) => {
        const selected = value === option.value
        return (
          <Chip
            key={option.value}
            size="small"
            label={option.label}
            clickable
            onClick={() => onChange(option.value)}
            sx={{
              height: 24,
              fontWeight: 800,
              color: OPS_TEXT,
              bgcolor: selected ? alpha(option.tone || tone, 0.14) : 'rgba(255, 255, 255, 0.95)',
              border: `1px solid ${selected ? alpha(option.tone || tone, 0.46) : 'rgba(148, 163, 184, 0.18)'}`,
              '& .MuiChip-label': {
                px: 1
              }
            }}
          />
        )
      })}
    </Stack>
  )
}

function ConsoleLaneRail({ label, count, tone = ACCENT, percent = 0, detail, helper, onClick, active = false }) {
  return (
    <Box
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      sx={{
        width: '100%',
        p: 0.9,
        textAlign: 'left',
        borderRadius: OPS_RADIUS_MD,
        color: OPS_TEXT,
        border: `1px solid ${alpha(tone, active ? 0.48 : 0.22)}`,
        bgcolor: 'rgba(255, 255, 255, 0.98)',
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, ${alpha(tone, active ? 0.12 : 0.08)} 100%)`,
        boxShadow: active
          ? `0 0 0 1px ${alpha(tone, 0.08)}, 0 12px 22px ${alpha(tone, 0.08)}`
          : 'inset 0 1px 0 rgba(255,255,255,0.8)',
        cursor: onClick ? 'pointer' : 'default',
        appearance: 'none',
        outline: 'none',
        transition: 'transform 120ms ease, border-color 120ms ease',
        '&:hover': onClick ? {
          transform: 'translateY(-1px)',
          borderColor: alpha(tone, 0.44)
        } : undefined
      }}
    >
      <Stack spacing={0.52}>
        <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={0.62} alignItems="center" sx={{ minWidth: 0 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: tone, boxShadow: `0 0 16px ${alpha(tone, 0.55)}` }} />
            <Typography variant="body2" sx={{ color: OPS_TEXT, fontWeight: 800 }} noWrap>
              {label}
            </Typography>
          </Stack>
          <SignalChip label={formatCount(count)} tone={tone} />
        </Stack>
        <Box sx={{ height: 8, borderRadius: 999, bgcolor: 'rgba(148, 163, 184, 0.12)', overflow: 'hidden' }}>
          <Box
            sx={{
              width: `${percent <= 0 ? 0 : Math.max(4, Math.min(100, percent))}%`,
              height: '100%',
              borderRadius: 999,
              background: `linear-gradient(90deg, ${tone} 0%, ${alpha(tone, 0.58)} 100%)`
            }}
          />
        </Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.55} justifyContent="space-between">
          <Typography variant="caption" sx={{ color: OPS_TEXT, fontWeight: 700 }}>
            {detail}
          </Typography>
          {helper ? (
            <Typography variant="caption" sx={{ color: OPS_MUTED }}>
              {helper}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </Box>
  )
}

function ConsoleLaneTile({ label, count, tone = ACCENT, detail, helper, percent = 0, onClick, active = false, badge = null }) {
  return (
    <Box
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      sx={{
        width: '100%',
        p: 0.95,
        textAlign: 'left',
        borderRadius: OPS_RADIUS_MD,
        color: OPS_TEXT,
        border: `1px solid ${alpha(tone, active ? 0.5 : 0.24)}`,
        bgcolor: 'rgba(255, 255, 255, 0.98)',
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, rgba(248, 250, 252, 0.96) 55%, ${alpha(tone, active ? 0.14 : 0.08)} 100%)`,
        boxShadow: active
          ? `0 12px 24px ${alpha(tone, 0.12)}`
          : '0 8px 18px rgba(2, 6, 23, 0.06)',
        cursor: onClick ? 'pointer' : 'default',
        appearance: 'none',
        outline: 'none',
        transition: 'transform 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
        '&:hover': onClick ? {
          transform: 'translateY(-1px)',
          borderColor: alpha(tone, 0.48),
          boxShadow: `0 20px 36px ${alpha(tone, 0.18)}`
        } : undefined
      }}
    >
      <Stack spacing={0.55}>
        <Stack direction="row" spacing={0.6} alignItems="flex-start" justifyContent="space-between">
          <Stack spacing={0.12} sx={{ minWidth: 0 }}>
            <Typography variant="caption" sx={{ color: alpha(tone, 0.9), textTransform: 'uppercase', letterSpacing: 0.54, fontWeight: 800 }}>
              {label}
            </Typography>
            <Typography variant="h5" sx={{ color: OPS_TEXT, fontWeight: 900, lineHeight: 0.95, letterSpacing: -0.28 }}>
              {formatCount(count)}
            </Typography>
          </Stack>
          {badge ? <SignalChip label={badge} tone={tone} /> : <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: tone, boxShadow: `0 0 16px ${alpha(tone, 0.55)}` }} />}
        </Stack>
        <Typography variant="body2" sx={{ color: OPS_TEXT, fontWeight: 700, lineHeight: 1.15 }}>
          {detail}
        </Typography>
        {helper ? (
          <Typography variant="caption" sx={{ color: OPS_MUTED, lineHeight: 1.16 }}>
            {helper}
          </Typography>
        ) : null}
        <Box sx={{ height: 6, borderRadius: 999, bgcolor: 'rgba(148, 163, 184, 0.12)', overflow: 'hidden' }}>
          <Box
            sx={{
              width: `${percent <= 0 ? 0 : Math.max(6, Math.min(100, percent))}%`,
              height: '100%',
              borderRadius: 999,
              background: `linear-gradient(90deg, ${tone} 0%, ${alpha(tone, 0.36)} 100%)`
            }}
          />
        </Box>
      </Stack>
    </Box>
  )
}

function ConsoleSparklinePanel({ rows, lines, emptyMessage, height = 180 }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={height} message={emptyMessage} />
  }

  return (
    <Box sx={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 6, left: 6, bottom: 0 }}>
          <Tooltip />
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color}
              strokeWidth={2.6}
              strokeDasharray={line.strokeDasharray}
              opacity={line.opacity ?? 1}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
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
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.99) 0%, ${alpha(item.tone, 0.12)} 100%)`,
        boxShadow: `0 12px 26px ${alpha(item.tone, 0.08)}`
      }}
    >
      <Stack spacing={0.7}>
        <Stack direction="row" spacing={0.65} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {item.title}
          </Typography>
          {item.badge ? <Chip size="small" label={item.badge} sx={{ bgcolor: alpha(item.tone, 0.12), color: OPS_TEXT, fontWeight: 700, border: `1px solid ${alpha(item.tone, 0.35)}` }} /> : null}
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

function MonitoringTable({ rows, columns, emptyMessage = 'No rows available.', getRowSx }) {
  return (
    <Box sx={{ overflowX: 'auto', borderRadius: OPS_RADIUS_MD, border: `1px solid ${OPS_BORDER}`, background: OPS_PANEL_SOFT }}>
      <Table size="small" sx={{ minWidth: 760 }}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.key} sx={{ fontWeight: 800, whiteSpace: 'nowrap', color: OPS_TEXT, bgcolor: 'rgba(241, 245, 249, 0.98)' }}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length ? rows.map((row, index) => (
            <TableRow key={row.id || row.ticketId || row.routeLabel || `${index}-${row.label || 'row'}`} hover sx={getRowSx ? getRowSx(row) : undefined}>
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

function PremisesHotspotMapFit({ markers }) {
  const map = useMap()

  useEffect(() => {
    if (!markers?.length) return
    const points = markers
      .map((marker) => [Number(marker.lat), Number(marker.lng)])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng))

    if (!points.length) return
    if (points.length === 1) {
      map.setView(points[0], 13, { animate: false })
      return
    }

    map.fitBounds(points, { padding: [26, 26] })
  }, [map, markers])

  return null
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

function MultiLineChartPanel({ rows, lines, emptyMessage, height = 260, showLegend = true, xAxisLabel = null, yAxisLabel = null }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={height} message={emptyMessage} />
  }

  const xInterval = rows.length > 40
    ? Math.ceil(rows.length / 8)
    : rows.length > 18
      ? Math.ceil(rows.length / 10)
      : 0

  return (
    <Box sx={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 8, left: yAxisLabel ? 6 : -18, bottom: xAxisLabel ? 10 : 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={OPS_GRID} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: OPS_MUTED }}
            stroke={OPS_GRID}
            interval={xInterval}
            minTickGap={18}
            label={xAxisLabel ? { value: xAxisLabel, position: 'insideBottomRight', offset: -2, fill: OPS_MUTED, fontSize: 11 } : undefined}
          />
          <YAxis
            tick={{ fontSize: 11, fill: OPS_MUTED }}
            stroke={OPS_GRID}
            label={yAxisLabel ? { value: yAxisLabel, angle: -90, position: 'insideLeft', fill: OPS_MUTED, fontSize: 11 } : undefined}
          />
          <Tooltip />
          {showLegend ? <Legend wrapperStyle={{ color: OPS_MUTED }} /> : null}
          {lines.map((line) => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color}
              strokeWidth={2}
              strokeDasharray={line.strokeDasharray}
              opacity={line.opacity ?? 1}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Box>
  )
}

function DonutBreakdownChart({ rows, dataKey = 'count', emptyMessage, colorMap = {}, height = 220 }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={height} message={emptyMessage} />
  }

  const total = rows.reduce((sum, row) => sum + Number(row[dataKey] || 0), 0)

  return (
    <Box sx={{ position: 'relative', height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip />
          <Pie
            data={rows}
            dataKey={dataKey}
            nameKey="label"
            innerRadius="58%"
            outerRadius="84%"
            paddingAngle={2}
            stroke="rgba(15, 23, 42, 0.92)"
            strokeWidth={2}
          >
            {rows.map((row) => (
              <Cell key={row.key || row.label} fill={colorMap[row.key] || row.tone || ACCENT} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none'
        }}
      >
        <Stack spacing={0.12} alignItems="center">
          <Typography variant="caption" sx={{ color: OPS_MUTED, textTransform: 'uppercase', letterSpacing: 0.55 }}>
            live mix
          </Typography>
          <Typography variant="h5" sx={{ color: OPS_TEXT, fontWeight: 900, lineHeight: 1 }}>
            {formatCount(total)}
          </Typography>
          <Typography variant="caption" sx={{ color: OPS_MUTED }}>
            tracked rows
          </Typography>
        </Stack>
      </Box>
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
          <Typography variant="body2" sx={{ fontWeight: 800, color: OPS_TEXT }}>
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
              borderRadius: OPS_RADIUS_SM,
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
        borderRadius: OPS_RADIUS_MD,
        border: `1px solid ${OPS_BORDER}`,
        bgcolor: 'rgba(255, 255, 255, 0.98)',
        color: OPS_TEXT,
        '& .MuiAlert-icon': {
          color: OPS_TEXT
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

function OpsSection({ tone = ACCENT, rootSx, headerSx, bodySx, ...props }) {
  return (
    <SectionCard
      rootSx={{
        ...DASHBOARD_SECTION_ROOT_SX,
        position: 'relative',
        overflow: 'hidden',
        border: `1px solid ${alpha(tone, 0.18)}`,
        boxShadow: `0 14px 28px rgba(15, 23, 42, 0.07), 0 0 0 1px ${alpha(tone, 0.05)}, inset 0 1px 0 rgba(255,255,255,0.8)`,
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: '0 0 auto 0',
          height: 2,
          background: `linear-gradient(90deg, ${alpha(tone, 0.92)} 0%, ${alpha(tone, 0.18)} 45%, transparent 100%)`
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: '0 auto auto 0',
          width: '42%',
          height: 140,
          background: `radial-gradient(circle at top left, ${alpha(tone, 0.08)} 0%, transparent 68%)`,
          pointerEvents: 'none'
        },
        ...rootSx
      }}
      headerSx={{
        ...DASHBOARD_SECTION_HEADER_SX,
        background: `linear-gradient(180deg, ${alpha(tone, 0.08)} 0%, rgba(255, 255, 255, 0.94) 72%)`,
        ...headerSx
      }}
      bodySx={{
        ...DASHBOARD_SECTION_BODY_SX,
        position: 'relative',
        ...bodySx
      }}
      titleSx={DASHBOARD_SECTION_TITLE_SX}
      subtitleSx={DASHBOARD_SECTION_SUBTITLE_SX}
      tone={tone}
      {...props}
    />
  )
}

function OpsSubPanel({ title, subtitle, tone = ACCENT, action = null, children, rootSx = null }) {
  return (
    <Box
      sx={{
        p: 0.9,
        borderRadius: OPS_RADIUS_MD,
        border: `1px solid ${alpha(tone, 0.18)}`,
        bgcolor: 'rgba(255, 255, 255, 0.94)',
        background: `linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, ${alpha(tone, 0.05)} 100%)`,
        boxShadow: `inset 0 1px 0 rgba(255,255,255,0.85), 0 10px 22px ${alpha(tone, 0.04)}`,
        ...rootSx
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.7} alignItems="flex-start" justifyContent="space-between">
          <Stack spacing={0.18} sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ color: OPS_TEXT, fontWeight: 800 }}>
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="caption" sx={{ color: OPS_MUTED, lineHeight: 1.25 }}>
                {subtitle}
              </Typography>
            ) : null}
          </Stack>
          {action}
        </Stack>
        {children}
      </Stack>
    </Box>
  )
}

function ProcessMilestoneStrip({ items, liveTone = '#0f766e' }) {
  if (!items?.length) {
    return <AnalyticsChartFallback minHeight={140} message="No process milestones are configured." />
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridAutoFlow: 'column',
        gridAutoColumns: { xs: 'minmax(188px, 1fr)', xl: 'minmax(204px, 1fr)' },
        gap: 0.78,
        overflowX: 'auto',
        pb: 0.35
      }}
    >
      {items.map((item, index) => (
        <Box
          key={item.key || item.label}
          sx={{
            minWidth: 0,
            p: 0.82,
            borderRadius: OPS_RADIUS_MD,
            border: `1px solid ${alpha(item.tone || liveTone, 0.2)}`,
            bgcolor: 'rgba(255,255,255,0.98)',
            background: `linear-gradient(180deg, rgba(255,255,255,0.99) 0%, ${alpha(item.tone || liveTone, 0.08)} 100%)`,
            boxShadow: `0 8px 18px ${alpha(item.tone || liveTone, 0.05)}`
          }}
        >
          <Stack spacing={0.55}>
            <Stack direction="row" spacing={0.65} alignItems="flex-start" justifyContent="space-between">
              <Stack spacing={0.12} sx={{ minWidth: 0 }}>
                <Typography variant="caption" sx={{ color: alpha(item.tone || liveTone, 0.92), textTransform: 'uppercase', letterSpacing: 0.58, fontWeight: 800 }}>
                  Step {index + 1}
                </Typography>
                <Typography variant="body2" sx={{ color: OPS_TEXT, fontWeight: 800, lineHeight: 1.18 }}>
                  {item.label}
                </Typography>
              </Stack>
              <SignalChip label={item.target} tone={item.tone || liveTone} />
            </Stack>
            <Typography variant="caption" sx={{ color: OPS_MUTED, lineHeight: 1.3 }}>
              {item.detail}
            </Typography>
            {item.liveNote ? (
              <Typography variant="caption" sx={{ color: alpha(item.tone || liveTone, 0.96), fontWeight: 700, lineHeight: 1.25 }}>
                {item.liveNote}
              </Typography>
            ) : null}
          </Stack>
        </Box>
      ))}
    </Box>
  )
}

export default function NocMonitoringPage() {
  const t1ActionViewRef = useRef(null)
  const t1InboundAnomalyRef = useRef(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exportingT1Action, setExportingT1Action] = useState(false)
  const [error, setError] = useState('')
  const [payload, setPayload] = useState(null)
  const [telephonyPulse, setTelephonyPulse] = useState(null)
  const [t1PremisesMapPayload, setT1PremisesMapPayload] = useState(null)
  const [t1PremisesMapLoading, setT1PremisesMapLoading] = useState(false)
  const [t1PremisesMapError, setT1PremisesMapError] = useState('')
  const [t1PremisesHotspotLimit, setT1PremisesHotspotLimit] = useState(10)
  const [tab, setTab] = useState('overview')
  const [t1WatchExpanded, setT1WatchExpanded] = useState(true)
  const [t1CommandExpanded, setT1CommandExpanded] = useState(true)
  const [t1TempoExpanded, setT1TempoExpanded] = useState(true)
  const [overviewPulseExpanded, setOverviewPulseExpanded] = useState(true)
  const [overviewWorkbenchExpanded, setOverviewWorkbenchExpanded] = useState(true)
  const [outagesRadarExpanded, setOutagesRadarExpanded] = useState(true)
  const [outagesDeskExpanded, setOutagesDeskExpanded] = useState(true)
  const [tier2RadarExpanded, setTier2RadarExpanded] = useState(true)
  const [tier2WorkbenchExpanded, setTier2WorkbenchExpanded] = useState(true)
  const [nldRadarExpanded, setNldRadarExpanded] = useState(true)
  const [nldWorkbenchExpanded, setNldWorkbenchExpanded] = useState(true)
  const [voiceRadarExpanded, setVoiceRadarExpanded] = useState(true)
  const [voiceWorkbenchExpanded, setVoiceWorkbenchExpanded] = useState(true)
  const [t1DueNowLimit, setT1DueNowLimit] = useState(15)
  const [t1ActionViewLimit, setT1ActionViewLimit] = useState(20)
  const [t1DeskLimit, setT1DeskLimit] = useState(10)
  const [t1MaintenanceLimit, setT1MaintenanceLimit] = useState(10)
  const [t1ClientPendingLimit, setT1ClientPendingLimit] = useState(10)
  const [t1ParkedLimit, setT1ParkedLimit] = useState(10)
  const [t1QuickPreset, setT1QuickPreset] = useState('all')
  const [t1ActionFilters, setT1ActionFilters] = useState(DEFAULT_T1_ACTION_FILTERS)
  const [t1WorkbenchDrawer, setT1WorkbenchDrawer] = useState('none')
  const [t1WorkbenchExpanded, setT1WorkbenchExpanded] = useState(false)
  const [t1PostureLens, setT1PostureLens] = useState('workflowOwner')
  const [t1TrendLens, setT1TrendLens] = useState('queue')
  const [t1ShowAdvancedFilters, setT1ShowAdvancedFilters] = useState(false)
  const meta = payload?.meta

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

  const loadSnapshotSilently = useCallback(async () => {
    try {
      const next = await fetchNocMonitoringSnapshot({ historyHours: DEFAULT_HISTORY_HOURS })
      setPayload(next)
    } catch {
      // Keep the last good snapshot on screen during silent poll failures.
    }
  }, [])

  const loadTelephonyPulse = useCallback(async () => {
    try {
      const next = await fetchNocMonitoringTelephonyPulse()
      setTelephonyPulse(next?.pulse || null)
    } catch {
      // Keep the last good telephony pulse on screen during fast poll failures.
    }
  }, [])

  const loadT1PremisesMap = useCallback(async () => {
    setT1PremisesMapError('')
    setT1PremisesMapLoading(true)
    try {
      const next = await fetchNocMonitoringTier1PremisesMap({ clusterLimit: 150 })
      setT1PremisesMapPayload(next)
      return next
    } catch (err) {
      setT1PremisesMapError(err?.response?.data?.error || err?.message || 'Unable to load Tier 1 premises hotspot map.')
      return null
    } finally {
      setT1PremisesMapLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  useEffect(() => {
    let cancelled = false
    let timerId = null

    const run = async () => {
      if (cancelled || typeof document !== 'undefined' && document.hidden) return
      await loadSnapshotSilently()
    }

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void run()
      }
    }

    timerId = window.setInterval(() => {
      void run()
    }, SNAPSHOT_POLL_MS)

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      cancelled = true
      if (timerId) window.clearInterval(timerId)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [loadSnapshotSilently])

  useEffect(() => {
    if (meta?.telephonyConfigured === false) return undefined

    let cancelled = false
    let inFlight = false
    let timerId = null

    const run = async () => {
      if (cancelled || inFlight || typeof document !== 'undefined' && document.hidden) return
      inFlight = true
      try {
        await loadTelephonyPulse()
      } finally {
        inFlight = false
      }
    }

    const onVisibilityChange = () => {
      if (!document.hidden) {
        void run()
      }
    }

    void run()
    timerId = window.setInterval(() => {
      void run()
    }, TELEPHONY_POLL_MS)

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }

    return () => {
      cancelled = true
      if (timerId) window.clearInterval(timerId)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [loadTelephonyPulse, meta?.telephonyConfigured])

  useEffect(() => {
    if (tab !== 'tier1' || !payload?.snapshot?.generatedAt) return undefined

    let cancelled = false

    ;(async () => {
      try {
        const next = await loadT1PremisesMap()
        if (!cancelled) {
          setT1PremisesMapPayload(next || null)
        }
      } catch {
        // handled inside loadT1PremisesMap
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadT1PremisesMap, payload?.snapshot?.generatedAt, tab])

  const snapshot = payload?.snapshot
  const freshness = payload?.freshness
  const history = payload?.history || { series: {} }
  const snapshotSummary = snapshot?.summary || {}
  const lanes = snapshot?.lanes || []
  const spotlights = snapshot?.spotlights || []
  const warnings = snapshot?.warnings || []
  const trends = snapshot?.trends || {}
  const collections = snapshot?.collections || {}
  const telephonySummary = telephonyPulse?.summary || collections?.telephonyMeta?.summary || null
  const telephonyQueues = telephonyPulse?.queues || collections?.telephonyQueues || []
  const telephonyAgents = telephonyPulse?.agents || collections?.telephonyAgents || []
  const telephonyHourly = telephonyPulse?.hourly || collections?.telephonyHourly || []
  const telephonyMeta = telephonyPulse
    ? {
        available: telephonyPulse.available,
        reason: telephonyPulse.reason || '',
        summary: telephonySummary
      }
    : (collections?.telephonyMeta || null)
  const telephonyQueueWaitingSummary = telephonyPulse?.queueWaitingSummary || trends.telephonyQueueWaitingSummary || []
  const telephonyMissedAgentSummary = telephonyPulse?.missedAgentSummary || trends.telephonyMissedAgentSummary || []
  const tier1VoiceQueue = telephonyPulse?.tier1
    ? {
        name: telephonyPulse.tier1.queueName,
        waiting: telephonyPulse.tier1.waiting,
        answered: telephonyPulse.tier1.answered,
        missed: telephonyPulse.tier1.missed,
        avgAnswerSeconds: telephonyPulse.tier1.avgAnswerSeconds,
        maxQueueSeconds: telephonyPulse.tier1.maxQueueSeconds
      }
    : (collections?.tier1VoiceQueue || null)
  const summary = useMemo(() => ({
    ...snapshotSummary,
    telephonyQueues: telephonyPulse ? telephonyQueues.length : snapshotSummary.telephonyQueues,
    telephonyWaiting: telephonySummary?.callsWaiting ?? snapshotSummary.telephonyWaiting,
    telephonyAnswered: telephonySummary?.callsAnswered ?? snapshotSummary.telephonyAnswered,
    telephonyMissed: telephonySummary?.callsMissed ?? snapshotSummary.telephonyMissed,
    telephonyAbandonRate: telephonySummary?.abandonRate ?? snapshotSummary.telephonyAbandonRate,
    telephonyAvgAnswerSeconds: telephonySummary?.avgAnswerSeconds ?? snapshotSummary.telephonyAvgAnswerSeconds,
    telephonyTier1QueueName: telephonyPulse?.tier1?.queueName || snapshotSummary.telephonyTier1QueueName,
    telephonyTier1Waiting: telephonyPulse?.tier1?.waiting ?? snapshotSummary.telephonyTier1Waiting,
    telephonyTier1Answered: telephonyPulse?.tier1?.answered ?? snapshotSummary.telephonyTier1Answered,
    telephonyTier1Missed: telephonyPulse?.tier1?.missed ?? snapshotSummary.telephonyTier1Missed,
    telephonyTier1AvgAnswerSeconds: telephonyPulse?.tier1?.avgAnswerSeconds ?? snapshotSummary.telephonyTier1AvgAnswerSeconds,
    telephonyTier1MaxQueueSeconds: telephonyPulse?.tier1?.maxQueueSeconds ?? snapshotSummary.telephonyTier1MaxQueueSeconds,
    telephonyTier1SlaBreached: telephonyPulse?.tier1?.slaBreached ?? snapshotSummary.telephonyTier1SlaBreached
  }), [snapshotSummary, telephonyPulse, telephonyQueues.length, telephonySummary])

  const heroStatusItems = useMemo(() => [
    {
      label: 'Snapshot freshness',
      value: freshness?.hasSnapshot ? formatSnapshotAge(freshness.ageMs) : 'bootstrapping',
      tone: '#94a3b8'
    },
    {
      label: 'Updated',
      value: snapshot?.generatedAt ? formatStamp(snapshot.generatedAt) : 'Waiting',
      tone: '#94a3b8'
    },
    {
      label: 'Ops day',
      value: summary.dayKey || '--',
      tone: '#94a3b8'
    },
    {
      label: 'Open work',
      value: formatCount((summary.majorOutageOpen || 0) + (summary.nldOutageOpen || 0) + (summary.backhaulOpen || 0) + (summary.vipOpen || 0) + (summary.tier1Open || 0) + (summary.tier2Open || 0)),
      tone: '#94a3b8'
    },
    {
      label: 'Impact',
      value: formatCount((summary.majorOutageSubscribers || 0) + (summary.nldOutageSubscribers || 0)),
      tone: '#94a3b8'
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
  const t1WorkflowOwnerSummary = trends.t1WorkflowOwnerSummary || []
  const t1EscalationPathSummary = trends.t1EscalationPathSummary || []
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
  const partialRouteSummary = trends.partialRouteSummary || []
  const t1InboundAnomalyTrendRows = trends.t1InboundAnomalyTrendRows || []
  const t1InboundAnomalyTrendServices = trends.t1InboundAnomalyTrendServices || []
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
  const tier1DeskTickets = collections?.tier1DeskTickets || []
  const tier1MaintenanceTickets = collections?.tier1MaintenanceTickets || []
  const tier1ClientPendingTickets = collections?.tier1ClientPendingTickets || []
  const tier1ParkedTickets = collections?.tier1ParkedTickets || []
  const t1InboundAnomalyRows = collections?.t1InboundAnomalies || []

  const classifyTier1SlaProduct = useCallback((row) => {
    const explicit = String(row?.slaProduct || '').trim()
    if (explicit) return explicit
    const serviceType = String(row?.serviceType || '').toLowerCase()
    const product = String(row?.product || '').toUpperCase()
    if (serviceType.includes('air')) return 'FF Air'
    if (product === 'FTTB') return 'FTTB'
    if (product === 'FTTH' || serviceType.includes('ftth') || serviceType.includes('home') || serviceType.includes('rise')) return 'FTTH'
    return 'Other'
  }, [])

  const t1QueueTrend = useMemo(() => {
    const latest = historyTier1?.[historyTier1.length - 1] || null
    const compare = latest?.bucketStart
      ? findHistoryPointNear(historyTier1, dayjs(latest.bucketStart).subtract(24, 'hour').toISOString(), 180) || historyTier1?.[0] || null
      : null
    const delta = latest && compare ? Number(latest.open || 0) - Number(compare.open || 0) : null
    const tone = delta == null ? '#94a3b8' : delta > 0 ? '#dc2626' : delta < 0 ? '#16a34a' : '#64748b'
    const statusLabel = delta == null ? 'History building' : delta > 0 ? 'Trending up' : delta < 0 ? 'Trending down' : 'Flat'
    return {
      delta,
      tone,
      statusLabel,
      helper: compare?.bucketStart ? `${formatSignedDelta(delta || 0)} vs ${dayjs(compare.bucketStart).format('DD MMM HH:mm')}` : 'stored snapshot trend still building'
    }
  }, [historyTier1])

  const t1VoiceQueueState = useMemo(() => {
    if (!tier1VoiceQueue) {
      return {
        tone: '#94a3b8',
        active: false,
        waiting: 0,
        detail: 'Tier 1 voice queue unavailable',
        meta: 'No live queue feed'
      }
    }
    const waiting = Number(summary.telephonyTier1Waiting || 0)
    const maxQueueSeconds = Number(summary.telephonyTier1MaxQueueSeconds || 0)
    const avgAnswerSeconds = Number(summary.telephonyTier1AvgAnswerSeconds || 0)
    const tone = waiting <= 0 ? '#16a34a' : maxQueueSeconds > 20 ? '#dc2626' : '#f59e0b'
    const meta = `Avg ${formatSeconds(avgAnswerSeconds)} | Max ${formatSeconds(maxQueueSeconds)}`
    return {
      tone,
      active: waiting > 0,
      waiting,
      detail: waiting <= 0 ? 'No callers waiting right now' : `${formatCount(waiting)} callers waiting in the NOC Tier 1 queue`,
      meta
    }
  }, [summary, tier1VoiceQueue])

  const t1VoiceAgentState = useMemo(() => {
    const fallbackQueue = String(summary.telephonyTier1QueueName || '').toLowerCase()
    const agents = (telephonyAgents || []).filter((row) => {
      const queue = String(row?.queue || '').toLowerCase()
      return fallbackQueue ? queue.includes(fallbackQueue) : false
    })
    const total = Number(summary.telephonyTier1AgentTotal || agents.length || 0)
    const loggedIn = Number(summary.telephonyTier1AgentLoggedIn || agents.filter((row) => row.loggedIn).length || 0)
    const busy = Number(summary.telephonyTier1AgentBusy || agents.filter((row) => Number(row?.activeCalls || 0) > 0).length || 0)
    const ratio = total > 0 ? loggedIn / total : 0
    const tone = total <= 0 ? '#94a3b8' : ratio >= 0.8 ? '#16a34a' : ratio >= 0.5 ? '#f59e0b' : '#dc2626'
    return {
      total,
      loggedIn,
      busy,
      tone,
      detail: total > 0 ? `${formatCount(loggedIn)}/${formatCount(total)} logged in on Tier 1 voice` : 'Tier 1 voice agents unavailable',
      meta: total > 0 ? `${formatCount(busy)} on live calls` : 'No queue roster returned'
    }
  }, [summary, telephonyAgents])

  const voiceCommandCards = useMemo(() => {
    const waiting = Number(telephonySummary?.callsWaiting || 0)
    const waitingTone = waiting <= 0 ? '#16a34a' : waiting > 0 && Number(telephonySummary?.maxQueueSeconds || 0) > 20 ? '#dc2626' : '#f59e0b'

    return [
      {
        label: 'Calls waiting',
        value: telephonySummary ? formatCount(waiting) : '--',
        detail: telephonySummary ? `${formatSeconds(telephonySummary.maxQueueSeconds || 0)} max queue` : 'telephony not configured',
        meta: telephonySummary ? `${formatSeconds(telephonySummary.avgAnswerSeconds || 0)} avg answer` : 'no live feed',
        tone: waitingTone,
        icon: <CallRoundedIcon sx={{ fontSize: 16 }} />,
        progress: telephonySummary ? Math.min(100, waiting > 0 ? 60 + waiting * 6 : 8) : 0
      },
      {
        label: 'Answered',
        value: telephonySummary ? formatCount(telephonySummary.callsAnswered || 0) : '--',
        detail: 'current dashboard-day call throughput',
        meta: telephonySummary ? `${formatCount(telephonySummary.customerCallCount || 0)} customer calls` : 'no live feed',
        tone: '#0891b2',
        icon: <InsightsRoundedIcon sx={{ fontSize: 16 }} />,
        progress: telephonySummary ? Math.min(100, Number(telephonySummary.callsAnswered || 0) / 2) : 0
      },
      {
        label: 'Missed',
        value: telephonySummary ? formatCount(telephonySummary.callsMissed || 0) : '--',
        detail: telephonySummary ? `${formatPercent(telephonySummary.abandonRate || 0)} abandon rate` : 'telephony not configured',
        meta: 'calls lost from the current feed window',
        tone: '#dc2626',
        icon: <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />,
        progress: telephonySummary ? Math.min(100, Number(telephonySummary.callsMissed || 0) * 10) : 0
      },
      {
        label: 'Tier 1 voice agents',
        value: t1VoiceAgentState.total > 0 ? `${formatCount(t1VoiceAgentState.loggedIn)}/${formatCount(t1VoiceAgentState.total)}` : '--',
        detail: t1VoiceAgentState.detail,
        meta: t1VoiceAgentState.meta,
        tone: t1VoiceAgentState.tone,
        icon: <SupportAgentRoundedIcon sx={{ fontSize: 16 }} />,
        progress: t1VoiceAgentState.total > 0 ? (t1VoiceAgentState.loggedIn / t1VoiceAgentState.total) * 100 : 0
      },
      {
        label: 'Queues live',
        value: telephonySummary ? formatCount(summary.telephonyQueues || 0) : '--',
        detail: telephonySummary ? `${formatCount(telephonyQueueWaitingSummary.length || 0)} queues with visibility` : 'telephony not configured',
        meta: telephonySummary ? `${formatCount(telephonyMissedAgentSummary.length || 0)} agents with missed calls` : 'no live feed',
        tone: '#7c3aed',
        icon: <MonitorHeartRoundedIcon sx={{ fontSize: 16 }} />,
        progress: telephonySummary ? Math.min(100, Number(summary.telephonyQueues || 0) * 8) : 0
      }
    ]
  }, [summary, t1VoiceAgentState, telephonyMissedAgentSummary.length, telephonyQueueWaitingSummary.length, telephonySummary])

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
      label: 'T1 anomaly watch',
      value: formatCount(summary.t1InboundAnomalyCount || 0),
      subtext: (summary.t1InboundAnomalyCount || 0) > 0
        ? `${summary.t1InboundFocusLabel || 'Inbound product'} | ${summary.t1InboundFocusStatusLabel || 'Flagged'}`
        : 'No abnormal inbound product spike detected',
      tone: (summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : ((summary.t1InboundAnomalyCount || 0) > 0 ? '#d97706' : '#475569'),
      icon: <WarningAmberRoundedIcon fontSize="small" />
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

  const overviewCommandCards = useMemo(() => {
    const liveVoiceWaiting = Number(summary.telephonyTier1Waiting || 0)
    const liveVoiceTone = liveVoiceWaiting <= 0
      ? '#16a34a'
      : summary.telephonyTier1SlaBreached ? '#dc2626' : '#f59e0b'

    return [
      {
        label: 'Major outages',
        value: formatCount(summary.majorOutageOpen || 0),
        detail: `${formatCount(summary.majorOutageSubscribers || 0)} subscribers impacted`,
        meta: `${formatCount(summary.outageP1 || 0)} P1 | ${formatCount(summary.outageP2 || 0)} P2`,
        tone: '#dc2626',
        icon: <NotificationsActiveRoundedIcon sx={{ fontSize: 16 }} />,
        progress: Math.min(100, Number(summary.majorOutageSubscribers || 0) > 0 ? 100 : 18)
      },
      {
        label: 'Tier 1 load',
        value: formatCount(summary.tier1Open || 0),
        detail: `${formatCount(summary.t1ReceivedToday || 0)} received | ${formatCount(summary.t1SolvedToday || 0)} solved`,
        meta: `${formatCount(summary.tier1P1Breached || 0)} first-touch breaches`,
        tone: '#0f766e',
        icon: <SupportAgentRoundedIcon sx={{ fontSize: 16 }} />,
        progress: Math.min(100, Number(summary.tier1Open || 0))
      },
      {
        label: 'Tier 2 load',
        value: formatCount(summary.tier2Open || 0),
        detail: `${formatCount(summary.t2ReceivedToday || 0)} received | ${formatCount(summary.t2SolvedToday || 0)} solved`,
        meta: `${formatCount(summary.tier2NewUnassigned || 0)} unattended`,
        tone: '#1d4ed8',
        icon: <SupportAgentRoundedIcon sx={{ fontSize: 16 }} />,
        progress: Math.min(100, Number(summary.tier2Open || 0))
      },
      {
        label: 'NLD pressure',
        value: formatCount((summary.nldOutageOpen || 0) + (summary.nldPartialEventCount || 0)),
        detail: `${formatCount(summary.nldOutageOpen || 0)} open NLD outages`,
        meta: `${formatCount(summary.nldPartialNotLoggedCount || 0)} not logged`,
        tone: '#f97316',
        icon: <LanRoundedIcon sx={{ fontSize: 16 }} />,
        progress: Math.min(100, Number(summary.nldPartialEventCount || 0) + Number(summary.nldOutageOpen || 0))
      },
      {
        label: 'Voice queue',
        value: telephonySummary ? formatCount(liveVoiceWaiting) : '--',
        detail: telephonySummary ? `${formatSeconds(summary.telephonyTier1AvgAnswerSeconds || 0)} avg answer` : 'telephony not configured',
        meta: telephonySummary ? `${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)} max queue` : 'no live feed',
        tone: liveVoiceTone,
        icon: <CallRoundedIcon sx={{ fontSize: 16 }} />,
        progress: telephonySummary ? Math.min(100, liveVoiceWaiting > 0 ? 60 + (liveVoiceWaiting * 4) : 10) : 0
      },
      {
        label: 'Inbound anomaly',
        value: formatCount(summary.t1InboundAnomalyCount || 0),
        detail: (summary.t1InboundAnomalyCount || 0) > 0
          ? `${summary.t1InboundFocusLabel || 'Inbound product'} | ${summary.t1InboundFocusStatusLabel || 'Flagged'}`
          : 'No current inbound spike',
        meta: (summary.t1InboundAnomalyCount || 0) > 0
          ? `${formatCount(summary.t1InboundSustainedCount || 0)} sustained`
          : 'watch clear',
        tone: (summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : ((summary.t1InboundAnomalyCount || 0) > 0 ? '#f59e0b' : '#475569'),
        icon: <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />,
        progress: Math.min(100, Number(summary.t1InboundAnomalyCount || 0) * 26)
      }
    ]
  }, [summary, telephonySummary])

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
      rootSx: {
        ...CONTROL_METRIC_ROOT_SX,
        borderColor: alpha((summary.tier1P1Breached || 0) > 0 ? '#dc2626' : '#0f766e', 0.34),
        boxShadow: (summary.tier1P1Breached || 0) > 0
          ? '0 0 0 1px rgba(220, 38, 38, 0.18), 0 18px 36px rgba(127, 29, 29, 0.28)'
          : CONTROL_METRIC_ROOT_SX.boxShadow
      },
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
        detail: row.playTargetMinutes
          ? `${row.playPolicyTitle || row.label} | ${formatCount(row.breached || 0)} breached | ${formatCount(row.dueSoon || 0)} closing soon`
          : `${formatCount(row.count || 0)} open | ${formatCount(row.noActiveTimer || 0)} no active play clock`
      })),
    [t1ActionSummary]
  )

  const t1ActionMixMap = useMemo(
    () => Object.fromEntries(t1ActionMixRows.map((row) => [row.key || row.label, row])),
    [t1ActionMixRows]
  )

  const t1PrimaryActionRows = useMemo(
    () => ['P1', 'P2', 'P3', 'P4'].map((key) => t1ActionMixMap[key]).filter(Boolean),
    [t1ActionMixMap]
  )

  const t1SupportActionRows = useMemo(
    () => ['P3 Parked', 'P4 Parked', 'Change', 'Other'].map((key) => t1ActionMixMap[key]).filter(Boolean),
    [t1ActionMixMap]
  )

  const t1PrimaryLaneTileRows = useMemo(
    () => t1PrimaryActionRows.map((row) => ({
      ...row,
      percent: summary.tier1Open ? (Number(row.count || 0) / Number(summary.tier1Open || 1)) * 100 : 0,
      detail: `${formatCount(row.breached || 0)} breached | ${formatCount(row.dueSoon || 0)} soon | ${formatCount(row.safe || 0)} safe`,
      helper: row.playTargetMinutes
        ? `${row.playPolicyTitle || row.label} | ${row.playTargetMinutes}m target`
        : `${formatCount(row.count || 0)} open`
    })),
    [summary.tier1Open, t1PrimaryActionRows]
  )

  const t1WorkflowOwnerRows = useMemo(
    () => (t1WorkflowOwnerSummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1WorkflowOwnerSummary]
  )

  const t1InboundAnomalyTrendLines = useMemo(
    () => (t1InboundAnomalyTrendServices || []).map((row) => ({
      key: row.key,
      label: row.label,
      color: row.tone || '#dc2626'
    })),
    [t1InboundAnomalyTrendServices]
  )

  const t1InboundAffectedServiceCount = useMemo(
    () => new Set((t1InboundAnomalyRows || []).map((row) => row.productType || row.serviceType).filter(Boolean)).size,
    [t1InboundAnomalyRows]
  )

  const t1EscalationRows = useMemo(
    () => (t1EscalationPathSummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1EscalationPathSummary]
  )

  const t1OperationalShapeRows = useMemo(
    () => (t1OperationalStateSummary || [])
      .filter((row) => Number(row.count || 0) > 0)
      .slice(0, 8),
    [t1OperationalStateSummary]
  )

  const t1AutomationOpenRows = useMemo(
    () => (t1AutomationOpenSummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1AutomationOpenSummary]
  )

  const t1AutomationTodayRows = useMemo(
    () => (t1AutomationCreatedTodaySummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1AutomationCreatedTodaySummary]
  )

  const t1AnomalyListRows = useMemo(
    () => (t1InboundAnomalyRows || []).slice(0, 4).map((row) => ({
      key: `${row.productType || row.serviceType}-${row.dayKey}-${row.mode}`,
      label: `${row.productType || row.serviceType || '--'} | ${row.dayLabel || row.dayKey}`,
      count: row.count || 0,
      tone: row.statusTone || row.tone || '#f59e0b',
      detail: `${row.statusLabel || 'Flagged'} | prev max ${formatCount(row.baselineMax || 0)} | ${formatSignedDelta(row.deltaCount || 0)}`
    })),
    [t1InboundAnomalyRows]
  )

  const sortTier1Rows = useCallback((rows) => [...(rows || [])].sort((a, b) => {
    const aRemaining = a?.playClockActive && Number.isFinite(Number(a?.remainingMinutes))
      ? Number(a.remainingMinutes)
      : Number.POSITIVE_INFINITY
    const bRemaining = b?.playClockActive && Number.isFinite(Number(b?.remainingMinutes))
      ? Number(b.remainingMinutes)
      : Number.POSITIVE_INFINITY
    if (aRemaining !== bRemaining) return aRemaining - bRemaining

    const actionRank = { P1: 0, P2: 1, P3: 2, P4: 3, 'P3 Parked': 4, 'P4 Parked': 5, Change: 6, Other: 7 }
    const aAction = actionRank[a?.pLevel] ?? 99
    const bAction = actionRank[b?.pLevel] ?? 99
    if (aAction !== bAction) return aAction - bAction

    return Number(b?.ageHours || 0) - Number(a?.ageHours || 0)
  }), [])

  const t1P1AttentionRows = useMemo(
    () => sortTier1Rows(collections.tier1P1UnattendedTickets || []),
    [collections, sortTier1Rows]
  )

  const t1DueNowRows = useMemo(
    () => sortTier1Rows(collections.tier1UrgentTickets || []),
    [collections, sortTier1Rows]
  )

  const t1ActionViewRows = useMemo(
    () => sortTier1Rows(collections.tier1Tickets || []),
    [collections, sortTier1Rows]
  )

  const t1CreatedSlaBreachSummary = useMemo(() => {
    const buckets = { FTTB: 0, FTTH: 0, 'FF Air': 0 }
    ;(t1ActionViewRows || []).forEach((row) => {
      const slaProduct = classifyTier1SlaProduct(row)
      if (!Object.prototype.hasOwnProperty.call(buckets, slaProduct)) return
      const targetHours = slaProduct === 'FTTB' ? 8 : 12
      if (Number(row?.ageHours || 0) >= targetHours) {
        buckets[slaProduct] += 1
      }
    })
    return {
      ...buckets,
      total: buckets.FTTB + buckets.FTTH + buckets['FF Air']
    }
  }, [classifyTier1SlaProduct, t1ActionViewRows])

  const t1CreatedSlaPopulation = useMemo(() => {
    const buckets = { FTTB: 0, FTTH: 0, 'FF Air': 0 }
    ;(t1ActionViewRows || []).forEach((row) => {
      const slaProduct = classifyTier1SlaProduct(row)
      if (Object.prototype.hasOwnProperty.call(buckets, slaProduct)) {
        buckets[slaProduct] += 1
      }
    })
    return buckets
  }, [classifyTier1SlaProduct, t1ActionViewRows])

  const t1RegionHotspot = useMemo(() => {
    const grouped = new Map()
    ;(t1ActionViewRows || []).forEach((row) => {
      const key = String(row?.province || row?.region || '').trim() || 'Unknown province'
      grouped.set(key, (grouped.get(key) || 0) + 1)
    })
    return [...grouped.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)[0] || null
  }, [t1ActionViewRows])

  const t1OrganisationHotspot = useMemo(() => {
    const grouped = new Map()
    ;(t1ActionViewRows || []).forEach((row) => {
      const key = String(row?.organizationLabel || '').trim() || 'Unknown organisation'
      grouped.set(key, (grouped.get(key) || 0) + 1)
    })
    return [...grouped.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)[0] || null
  }, [t1ActionViewRows])

  const t1NodeHotspot = useMemo(() => {
    const grouped = new Map()
    ;(t1ActionViewRows || []).forEach((row) => {
      const key = String(row?.nodeName || '').trim() || 'Unknown node'
      grouped.set(key, (grouped.get(key) || 0) + 1)
    })
    return [...grouped.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)[0] || null
  }, [t1ActionViewRows])

  const t1OltHotspot = useMemo(() => {
    const grouped = new Map()
    ;(t1ActionViewRows || []).forEach((row) => {
      const key = String(row?.olt || '').trim() || 'Unknown OLT'
      grouped.set(key, (grouped.get(key) || 0) + 1)
    })
    return [...grouped.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((left, right) => right.count - left.count)[0] || null
  }, [t1ActionViewRows])

  const t1DeskRows = useMemo(
    () => sortTier1Rows(tier1DeskTickets),
    [sortTier1Rows, tier1DeskTickets]
  )

  const t1MaintenanceRows = useMemo(
    () => sortTier1Rows(tier1MaintenanceTickets),
    [sortTier1Rows, tier1MaintenanceTickets]
  )

  const t1ClientPendingRows = useMemo(
    () => sortTier1Rows(tier1ClientPendingTickets),
    [sortTier1Rows, tier1ClientPendingTickets]
  )

  const t1ParkedRows = useMemo(
    () => sortTier1Rows(tier1ParkedTickets),
    [sortTier1Rows, tier1ParkedTickets]
  )

  const t1SystemStateOptions = useMemo(
    () => sortByPresetOrder([...new Set(t1ActionViewRows.map((row) => row.status).filter(Boolean))], T1_SYSTEM_STATE_ORDER),
    [t1ActionViewRows]
  )

  const t1OperationalStateOptions = useMemo(
    () => sortByPresetOrder([...new Set(t1ActionViewRows.map((row) => row.operationalState).filter(Boolean))], T1_OPERATIONAL_STATE_ORDER),
    [t1ActionViewRows]
  )

  const t1WorkflowOwnerOptions = useMemo(
    () => sortByPresetOrder([...new Set(t1ActionViewRows.map((row) => row.workflowOwner).filter(Boolean))], T1_WORKFLOW_OWNER_ORDER),
    [t1ActionViewRows]
  )

  const t1EscalationPathOptions = useMemo(
    () => sortByPresetOrder([...new Set(t1ActionViewRows.map((row) => row.escalationPath).filter(Boolean))], T1_ESCALATION_PATH_ORDER),
    [t1ActionViewRows]
  )

  const t1PLevelOptions = useMemo(
    () => sortByPresetOrder([...new Set(t1ActionViewRows.map((row) => row.pLevel).filter(Boolean))], T1_ACTION_ORDER),
    [t1ActionViewRows]
  )

  const t1DueBucketOptions = useMemo(
    () => sortByPresetOrder([...new Set(t1ActionViewRows.map((row) => row.dueBucket).filter(Boolean))], T1_DUE_BUCKET_ORDER_UI),
    [t1ActionViewRows]
  )

  const t1AutomationRouteOptions = useMemo(
    () => [...new Set(t1ActionViewRows.flatMap((row) => row.automationRoutes || []).filter(Boolean))].sort((left, right) => String(left).localeCompare(String(right))),
    [t1ActionViewRows]
  )

  const matchesT1QuickPreset = useCallback((row, preset = t1QuickPreset) => {
    switch (preset) {
      case 'p1Only':
        return row.pLevel === 'P1'
      case 'dueNow':
        return ['BREACHED', 'Due <=15m', 'Due <=30m'].includes(row.dueBucket)
      case 'changeControl':
        return row.pLevel === 'Change' || row.operationalState === 'Change control'
      case 'automationRouted':
        return Array.isArray(row.automationRoutes) && row.automationRoutes.length > 0
      case 'deskOwned':
        return row.workflowOwner === 'With Tier 1'
      case 'maintenanceOwned':
        return row.workflowOwner === 'With maintenance'
      case 'parkedTimers':
        return row.parkedTimerActive || row.dueBucket === 'Parked timer'
      case 'all':
      default:
        return true
    }
  }, [t1QuickPreset])

  const matchesT1ActionFilters = useCallback((row, filters, ignoreField = null) => {
    if (ignoreField !== 'systemState' && filters.systemState !== 'all' && row.status !== filters.systemState) return false
    if (ignoreField !== 'operationalState' && filters.operationalState !== 'all' && row.operationalState !== filters.operationalState) return false
    if (ignoreField !== 'workflowOwner' && filters.workflowOwner !== 'all' && row.workflowOwner !== filters.workflowOwner) return false
    if (ignoreField !== 'escalationPath' && filters.escalationPath !== 'all' && row.escalationPath !== filters.escalationPath) return false
    if (ignoreField !== 'pLevel' && filters.pLevel !== 'all' && row.pLevel !== filters.pLevel) return false
    if (ignoreField !== 'dueBucket' && filters.dueBucket !== 'all' && row.dueBucket !== filters.dueBucket) return false
    if (ignoreField !== 'automationRoute' && filters.automationRoute !== 'all' && !(row.automationRoutes || []).includes(filters.automationRoute)) return false
    return true
  }, [])

  const t1QuickPresetCounts = useMemo(
    () => Object.fromEntries(T1_PRESETS.map((preset) => [preset.key, t1ActionViewRows.filter((row) => matchesT1QuickPreset(row, preset.key)).length])),
    [matchesT1QuickPreset, t1ActionViewRows]
  )

  const buildT1FieldCountMap = useCallback((fieldName, options) => (
    Object.fromEntries(
      options.map((option) => [
        option,
        t1ActionViewRows.filter((row) => (
          matchesT1QuickPreset(row) &&
          matchesT1ActionFilters(
            row,
            {
              ...t1ActionFilters,
              [fieldName]: option
            },
            fieldName
          )
        )).length
      ])
    )
  ), [matchesT1ActionFilters, matchesT1QuickPreset, t1ActionFilters, t1ActionViewRows])

  const t1FilterAnyCounts = useMemo(() => ({
    systemState: t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters, 'systemState')).length,
    operationalState: t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters, 'operationalState')).length,
    workflowOwner: t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters, 'workflowOwner')).length,
    escalationPath: t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters, 'escalationPath')).length,
    pLevel: t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters, 'pLevel')).length,
    dueBucket: t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters, 'dueBucket')).length,
    automationRoute: t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters, 'automationRoute')).length
  }), [matchesT1ActionFilters, matchesT1QuickPreset, t1ActionFilters, t1ActionViewRows])

  const t1SystemStateCountMap = useMemo(() => buildT1FieldCountMap('systemState', t1SystemStateOptions), [buildT1FieldCountMap, t1SystemStateOptions])
  const t1OperationalStateCountMap = useMemo(() => buildT1FieldCountMap('operationalState', t1OperationalStateOptions), [buildT1FieldCountMap, t1OperationalStateOptions])
  const t1WorkflowOwnerCountMap = useMemo(() => buildT1FieldCountMap('workflowOwner', t1WorkflowOwnerOptions), [buildT1FieldCountMap, t1WorkflowOwnerOptions])
  const t1EscalationPathCountMap = useMemo(() => buildT1FieldCountMap('escalationPath', t1EscalationPathOptions), [buildT1FieldCountMap, t1EscalationPathOptions])
  const t1PLevelCountMap = useMemo(() => buildT1FieldCountMap('pLevel', t1PLevelOptions), [buildT1FieldCountMap, t1PLevelOptions])
  const t1DueBucketCountMap = useMemo(() => buildT1FieldCountMap('dueBucket', t1DueBucketOptions), [buildT1FieldCountMap, t1DueBucketOptions])
  const t1AutomationRouteCountMap = useMemo(() => buildT1FieldCountMap('automationRoute', t1AutomationRouteOptions), [buildT1FieldCountMap, t1AutomationRouteOptions])

  const t1FilteredActionViewRows = useMemo(
    () => t1ActionViewRows.filter((row) => matchesT1QuickPreset(row) && matchesT1ActionFilters(row, t1ActionFilters)),
    [matchesT1ActionFilters, matchesT1QuickPreset, t1ActionFilters, t1ActionViewRows]
  )

  const t1PremisesClusters = useMemo(
    () => buildTier1PremisesClusters(t1FilteredActionViewRows),
    [t1FilteredActionViewRows]
  )

  const t1PremisesMarkerMap = useMemo(
    () => new Map((t1PremisesMapPayload?.markers || []).map((marker) => [marker.key, marker])),
    [t1PremisesMapPayload]
  )

  const t1PremisesMapMarkers = useMemo(
    () => t1PremisesClusters
      .map((cluster) => {
        const marker = t1PremisesMarkerMap.get(cluster.key)
        if (!marker) return null
        return {
          ...cluster,
          ...marker
        }
      })
      .filter(Boolean),
    [t1PremisesClusters, t1PremisesMarkerMap]
  )

  const t1PremisesVisibleClusters = useMemo(
    () => t1PremisesHotspotLimit === 'all'
      ? t1PremisesClusters
      : t1PremisesClusters.slice(0, Number(t1PremisesHotspotLimit || 10)),
    [t1PremisesClusters, t1PremisesHotspotLimit]
  )

  const t1PremisesHotspot = t1PremisesClusters[0] || null
  const t1PremisesMappedCount = t1PremisesMapMarkers.length
  const t1PremisesUnmappedCount = Math.max(0, t1PremisesClusters.length - t1PremisesMappedCount)

  const t1DueNowVisibleRows = useMemo(
    () => t1DueNowLimit === 'all' ? t1DueNowRows : t1DueNowRows.slice(0, Number(t1DueNowLimit || 15)),
    [t1DueNowLimit, t1DueNowRows]
  )

  const t1ActionViewVisibleRows = useMemo(
    () => t1ActionViewLimit === 'all' ? t1FilteredActionViewRows : t1FilteredActionViewRows.slice(0, Number(t1ActionViewLimit || 20)),
    [t1ActionViewLimit, t1FilteredActionViewRows]
  )

  const t1DeskVisibleRows = useMemo(
    () => t1DeskLimit === 'all' ? t1DeskRows : t1DeskRows.slice(0, Number(t1DeskLimit || 10)),
    [t1DeskLimit, t1DeskRows]
  )

  const t1MaintenanceVisibleRows = useMemo(
    () => t1MaintenanceLimit === 'all' ? t1MaintenanceRows : t1MaintenanceRows.slice(0, Number(t1MaintenanceLimit || 10)),
    [t1MaintenanceLimit, t1MaintenanceRows]
  )

  const t1ClientPendingVisibleRows = useMemo(
    () => t1ClientPendingLimit === 'all' ? t1ClientPendingRows : t1ClientPendingRows.slice(0, Number(t1ClientPendingLimit || 10)),
    [t1ClientPendingLimit, t1ClientPendingRows]
  )

  const t1ParkedVisibleRows = useMemo(
    () => t1ParkedLimit === 'all' ? t1ParkedRows : t1ParkedRows.slice(0, Number(t1ParkedLimit || 10)),
    [t1ParkedLimit, t1ParkedRows]
  )

  const resetT1ActionFilters = useCallback(() => {
    setT1QuickPreset('all')
    setT1ActionFilters(DEFAULT_T1_ACTION_FILTERS)
  }, [])

  const applyT1ActionLens = useCallback((preset = 'all', nextFilters = {}) => {
    setTab('tier1')
    setT1QuickPreset(preset)
    setT1ActionFilters({
      ...DEFAULT_T1_ACTION_FILTERS,
      ...nextFilters
    })
    setT1ActionViewLimit(20)

    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        t1ActionViewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 160)
    }
  }, [])

  const openT1WorkbenchDrawer = useCallback((drawerKey, preset = 'all', nextFilters = {}) => {
    setT1WorkbenchExpanded(true)
    setT1WorkbenchDrawer(drawerKey)
    applyT1ActionLens(preset, nextFilters)
  }, [applyT1ActionLens])

  const handleExportT1ActionView = useCallback(async () => {
    setExportingT1Action(true)
    try {
      const quickPresetLabel = T1_PRESETS.find((preset) => preset.key === t1QuickPreset)?.label || 'All queue'
      await downloadWorkbook(
        `tier1-action-view-${safeFilePart(quickPresetLabel)}-${dayjs().format('YYYYMMDD_HHmm')}.xlsx`,
        [
          {
            name: 'Filters',
            rows: [{
              SnapshotGeneratedAt: snapshot?.generatedAt || '--',
              QuickPreset: quickPresetLabel,
              SystemState: t1ActionFilters.systemState,
              OperationalState: t1ActionFilters.operationalState,
              WorkflowOwner: t1ActionFilters.workflowOwner,
              EscalationPath: t1ActionFilters.escalationPath,
              ActionLane: t1ActionFilters.pLevel,
              DueBucket: t1ActionFilters.dueBucket,
              AutomationRoute: t1ActionFilters.automationRoute,
              FilteredRows: t1FilteredActionViewRows.length,
              VisibleRows: t1ActionViewVisibleRows.length,
              LiveQueueRows: t1ActionViewRows.length
            }]
          },
          {
            name: 'Tier1 Action View',
            rows: t1FilteredActionViewRows.map((row) => ({
              Ticket: row.id ? `#${row.id}` : '--',
              Subject: formatExportValue(row.subject),
              ActionLane: formatExportValue(row.pLevel),
              DueBucket: formatExportValue(row.dueBucket),
              PlayPolicy: formatExportValue(row.playPolicyTitle),
              PlayMetric: formatExportValue(row.playMetricKey),
              PlayTargetMinutes: row.playTargetMinutes ?? '--',
              TimerRemaining: formatMinutesRemaining(row.remainingMinutes),
              ClockActive: row.playClockActive ? 'Yes' : 'No',
              ClockExact: row.playClockExact ? 'Yes' : 'Approximate',
              TimerAnchorAt: formatExportValue(row.timerAnchorAt),
              TimerAnchorMode: formatExportValue(row.timerAnchorMode),
              SystemState: formatExportValue(row.status),
              Priority: formatExportValue(row.priority),
              Product: formatExportValue(row.product),
              ServiceType: formatExportValue(row.serviceType),
              Node: formatExportValue(row.nodeName),
              OLT: formatExportValue(row.olt),
              CustomerPremisesAlias: formatExportValue(row.customerPremisesAlias),
              WorkflowOwner: formatExportValue(row.workflowOwner),
              OperationalState: formatExportValue(row.operationalState),
              EscalationPath: formatExportValue(row.escalationPath),
              AutomationRoutes: formatExportValue(row.automationRoutes),
              AgeHours: Number.isFinite(Number(row.ageHours)) ? Number(row.ageHours).toFixed(1) : '--',
              CreatedAt: formatExportValue(row.createdAt),
              UpdatedAt: formatExportValue(row.updatedAt),
              Url: formatExportValue(row.url)
            }))
          }
        ]
      )
    } finally {
      setExportingT1Action(false)
    }
  }, [exportingT1Action, snapshot?.generatedAt, t1ActionFilters, t1ActionViewRows.length, t1ActionViewVisibleRows.length, t1FilteredActionViewRows, t1QuickPreset])

  const t1DueNowBreachedCount = useMemo(
    () => t1DueNowRows.filter((row) => row.dueBucket === 'BREACHED' || Number(row.remainingMinutes) <= 0).length,
    [t1DueNowRows]
  )

  const t1DueNowFifteenMinuteCount = useMemo(
    () => t1DueNowRows.filter((row) => Number(row.remainingMinutes) > 0 && Number(row.remainingMinutes) <= 15).length,
    [t1DueNowRows]
  )

  const t1DueNowThirtyMinuteCount = useMemo(
    () => t1DueNowRows.filter((row) => Number(row.remainingMinutes) > 15 && Number(row.remainingMinutes) <= 30).length,
    [t1DueNowRows]
  )

  const t1P1BreachedRowCount = useMemo(
    () => t1P1AttentionRows.filter((row) => row.dueBucket === 'BREACHED' || Number(row.remainingMinutes) <= 0).length,
    [t1P1AttentionRows]
  )

  const t1DeskUrgentCount = useMemo(
    () => t1DeskRows.filter((row) => ['BREACHED', 'Due <=15m', 'Due <=30m'].includes(row.dueBucket)).length,
    [t1DeskRows]
  )

  const t1DeskP1Count = useMemo(
    () => t1DeskRows.filter((row) => row.pLevel === 'P1').length,
    [t1DeskRows]
  )

  const t1MaintenanceBreachedCount = useMemo(
    () => t1MaintenanceRows.filter((row) => row.dueBucket === 'BREACHED' || Number(row.remainingMinutes) <= 0).length,
    [t1MaintenanceRows]
  )

  const t1MaintenanceTrackedCount = useMemo(
    () => t1MaintenanceRows.filter((row) => row.playClockActive).length,
    [t1MaintenanceRows]
  )

  const t1ClientPendingUrgentCount = useMemo(
    () => t1ClientPendingRows.filter((row) => ['BREACHED', 'Due <=15m', 'Due <=30m'].includes(row.dueBucket)).length,
    [t1ClientPendingRows]
  )

  const t1ClientPendingOnHoldCount = useMemo(
    () => t1ClientPendingRows.filter((row) => row.status === 'hold').length,
    [t1ClientPendingRows]
  )

  const t1ParkedP3Count = useMemo(
    () => t1ParkedRows.filter((row) => row.pLevel === 'P3 Parked').length,
    [t1ParkedRows]
  )

  const t1ParkedP4Count = useMemo(
    () => t1ParkedRows.filter((row) => row.pLevel === 'P4 Parked').length,
    [t1ParkedRows]
  )

  const t1WorkbenchShortcutRows = useMemo(() => ([
    { key: 'desk', label: 'Desk-owned', count: t1DeskRows.length, tone: '#14b8a6', detail: 'with Tier 1' },
    { key: 'maintenance', label: 'Maintenance', count: t1MaintenanceRows.length, tone: '#3b82f6', detail: 'external lane' },
    { key: 'client', label: 'Waiting client', count: t1ClientPendingRows.length, tone: '#f97316', detail: 'ISP / client pending' },
    { key: 'p1', label: 'P1 queue', count: t1P1AttentionRows.length, tone: '#ef4444', detail: 'first-touch focus' },
    { key: 'urgent', label: 'Urgent timers', count: t1DueNowRows.length, tone: '#f59e0b', detail: 'closing soon' },
    { key: 'parked', label: 'Parked', count: t1ParkedRows.length, tone: '#64748b', detail: 'pre-play queues' }
  ]), [
    t1ClientPendingRows.length,
    t1DeskRows.length,
    t1DueNowRows.length,
    t1MaintenanceRows.length,
    t1P1AttentionRows.length,
    t1ParkedRows.length
  ])

  const t1PostureLensConfig = useMemo(() => ({
    workflowOwner: {
      label: 'Workflow owner',
      tone: '#14b8a6',
      rows: t1WorkflowOwnerRows,
      total: summary.tier1Open || 0,
      secondaryText: (row) => `${formatCount(row.count || 0)} live rows`
    },
    operationalState: {
      label: 'Operational state',
      tone: '#3b82f6',
      rows: t1OperationalShapeRows,
      total: summary.tier1Open || 0,
      secondaryText: (row) => `${formatCount(row.count || 0)} live rows`
    },
    escalationPath: {
      label: 'Escalation path',
      tone: '#8b5cf6',
      rows: t1EscalationRows,
      total: summary.tier1Open || 0,
      secondaryText: (row) => `${formatCount(row.count || 0)} routed rows`
    },
    automation: {
      label: 'Automation routes',
      tone: '#7c3aed',
      rows: t1AutomationOpenRows,
      total: (t1AutomationOpenRows || []).reduce((total, row) => total + Number(row.count || 0), 0),
      secondaryText: (row) => `${formatCount(row.count || 0)} open automation-touched rows`
    }
  }), [summary.tier1Open, t1AutomationOpenRows, t1EscalationRows, t1OperationalShapeRows, t1WorkflowOwnerRows])

  const t1ActivePostureLens = t1PostureLensConfig[t1PostureLens] || t1PostureLensConfig.workflowOwner

  const t1TrendLensConfig = useMemo(() => ({
    queue: {
      label: 'Queue pressure',
      tone: '#14b8a6',
      summaryItems: [
        { label: 'Open now', value: formatCount(summary.tier1Open || 0), tone: '#14b8a6', helper: 'live Tier 1 queue' },
        { label: 'Urgent', value: formatCount((collections.tier1UrgentTickets || []).length), tone: '#ef4444', helper: 'breached or closing soon' },
        { label: 'P1 unattended', value: formatCount(summary.tier1P1Unattended || 0), tone: '#dc2626', helper: 'first-touch queue' },
        { label: 'Change', value: formatCount(summary.tier1ChangeControlOpen || 0), tone: '#8b5cf6', helper: 'separate workflow' }
      ],
      rows: historyTier1,
      lines: [
        { key: 'open', label: 'Open queue', color: '#14b8a6' },
        { key: 'urgent', label: 'Urgent / closing soon', color: '#ef4444' }
      ],
      emptyMessage: 'Tier 1 historical queue pressure will appear after more monitoring buckets are stored.'
    },
    received: {
      label: 'Received compare',
      tone: '#0f766e',
      summaryItems: [
        { label: 'Today', value: formatCount(summary.t1ReceivedToday || 0), tone: '#0f766e', helper: `7d ${formatCount(summary.t1ReceivedLastWeek || 0)}` },
        { label: 'Prev 14d', value: formatCount(summary.t1ReceivedPreviousWeek || 0), tone: '#0ea5e9', helper: 'same weekday prior' },
        { label: 'Automation', value: formatCount((t1AutomationTodayRows || []).reduce((total, row) => total + Number(row.count || 0), 0)), tone: '#8b5cf6', helper: 'today routed' }
      ],
      rows: t1ReceivedComparisonSeries,
      lines: [
        { key: 'today', label: 'Today', color: '#14b8a6' },
        { key: 'lastWeek', label: '7 days ago', color: '#2dd4bf', strokeDasharray: '5 4', opacity: 0.92 },
        { key: 'previousWeek', label: '14 days ago', color: '#93c5fd', strokeDasharray: '2 5', opacity: 0.82 }
      ],
      emptyMessage: 'No Tier 1 received comparison data is available right now.'
    },
    solved: {
      label: 'Solved compare',
      tone: '#22c55e',
      summaryItems: [
        { label: 'Today', value: formatCount(summary.t1SolvedToday || 0), tone: '#22c55e', helper: `7d ${formatCount(summary.t1SolvedLastWeek || 0)}` },
        { label: 'Prev 14d', value: formatCount(summary.t1SolvedPreviousWeek || 0), tone: '#4ade80', helper: 'same weekday prior' },
        { label: 'Voice answered', value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Answered || 0) : '--', tone: '#06b6d4', helper: tier1VoiceWeekCompare.lastWeek ? `7d ${formatCount(tier1VoiceWeekCompare.lastWeek.answered || 0)}` : 'history building' }
      ],
      rows: t1SolvedComparisonSeries,
      lines: [
        { key: 'today', label: 'Today', color: '#22c55e' },
        { key: 'lastWeek', label: '7 days ago', color: '#4ade80', strokeDasharray: '5 4', opacity: 0.92 },
        { key: 'previousWeek', label: '14 days ago', color: '#bbf7d0', strokeDasharray: '2 5', opacity: 0.82 }
      ],
      emptyMessage: 'No Tier 1 solved comparison data is available right now.'
    },
    voice: {
      label: 'Voice pulse',
      tone: '#06b6d4',
      summaryItems: [
        { label: 'Waiting', value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Waiting || 0) : '--', tone: summary.telephonyTier1SlaBreached ? '#ef4444' : '#06b6d4', helper: tier1VoiceQueue ? `${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)} max queue` : 'queue unavailable' },
        { label: 'Answered', value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Answered || 0) : '--', tone: '#06b6d4', helper: summary.telephonyTier1QueueName || 'Tier 1 queue' },
        { label: 'Missed', value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Missed || 0) : '--', tone: '#8b5cf6', helper: summary.telephonyTier1SlaBreached ? 'outside 20s target' : 'within target' }
      ],
      rows: historyTier1VoiceQueue,
      lines: [
        { key: 'waiting', label: 'Waiting', color: '#ef4444' },
        { key: 'answered', label: 'Answered', color: '#06b6d4' },
        { key: 'missed', label: 'Missed', color: '#8b5cf6', strokeDasharray: '5 4', opacity: 0.9 }
      ],
      emptyMessage: 'Tier 1 voice queue history will appear as more telephony snapshots are stored.'
    }
  }), [
    collections.tier1UrgentTickets,
    historyTier1,
    historyTier1VoiceQueue,
    summary,
    t1AutomationTodayRows,
    t1ReceivedComparisonSeries,
    t1SolvedComparisonSeries,
    tier1VoiceQueue,
    tier1VoiceWeekCompare
  ])

  const t1ActiveTrendLens = t1TrendLensConfig[t1TrendLens] || t1TrendLensConfig.queue

  const getTier1UrgencyRowSx = useCallback((row) => {
    const remaining = Number(row?.remainingMinutes)
    if (row?.dueBucket === 'BREACHED' || (Number.isFinite(remaining) && remaining <= 0)) {
      return {
        backgroundColor: 'rgba(127, 29, 29, 0.22)',
        boxShadow: 'inset 3px 0 0 rgba(248, 113, 113, 0.95)'
      }
    }
    if (Number.isFinite(remaining) && remaining <= 15) {
      return {
        backgroundColor: 'rgba(124, 45, 18, 0.18)',
        boxShadow: 'inset 3px 0 0 rgba(251, 146, 60, 0.9)'
      }
    }
    if (Number.isFinite(remaining) && remaining <= 30) {
      return {
        backgroundColor: 'rgba(120, 53, 15, 0.14)',
        boxShadow: 'inset 3px 0 0 rgba(245, 158, 11, 0.82)'
      }
    }
    return undefined
  }, [])

  const t1WorkbenchDrawerConfig = useMemo(() => ({
    desk: {
      key: 'desk',
      label: 'Desk-owned focus',
      tone: '#0f766e',
      rows: t1DeskRows,
      visibleRows: t1DeskVisibleRows,
      limit: t1DeskLimit,
      setLimit: setT1DeskLimit,
      emptyMessage: 'No Tier 1 desk-owned rows are open right now.',
      summaryItems: [
        { label: 'Desk-owned', value: formatCount(t1DeskRows.length), tone: '#0f766e', helper: 'active Tier 1 workbench' },
        { label: 'Urgent', value: formatCount(t1DeskUrgentCount), tone: '#ea580c', helper: 'breached or closing soon' },
        { label: 'P1 rows', value: formatCount(t1DeskP1Count), tone: '#dc2626', helper: 'live desk P1 pressure' }
      ]
    },
    maintenance: {
      key: 'maintenance',
      label: 'Maintenance-held focus',
      tone: '#2563eb',
      rows: t1MaintenanceRows,
      visibleRows: t1MaintenanceVisibleRows,
      limit: t1MaintenanceLimit,
      setLimit: setT1MaintenanceLimit,
      emptyMessage: 'No Tier 1 rows are currently sitting with maintenance.',
      summaryItems: [
        { label: 'With maintenance', value: formatCount(t1MaintenanceRows.length), tone: '#2563eb', helper: 'largest external holding lane' },
        { label: 'Tracked clocks', value: formatCount(t1MaintenanceTrackedCount), tone: '#1d4ed8', helper: `${formatCount(t1MaintenanceBreachedCount)} already breached` }
      ]
    },
    client: {
      key: 'client',
      label: 'Client-waiting focus',
      tone: '#ea580c',
      rows: t1ClientPendingRows,
      visibleRows: t1ClientPendingVisibleRows,
      limit: t1ClientPendingLimit,
      setLimit: setT1ClientPendingLimit,
      emptyMessage: 'No Tier 1 rows are currently waiting on the client or ISP.',
      summaryItems: [
        { label: 'Waiting client', value: formatCount(t1ClientPendingRows.length), tone: '#ea580c', helper: `${formatCount(t1ClientPendingOnHoldCount)} on hold right now` },
        { label: 'Urgent', value: formatCount(t1ClientPendingUrgentCount), tone: '#d97706', helper: 'breached or closing soon' }
      ]
    },
    p1: {
      key: 'p1',
      label: 'P1 first-touch focus',
      tone: '#dc2626',
      rows: t1P1AttentionRows,
      visibleRows: t1P1AttentionRows,
      limit: 'all',
      setLimit: null,
      emptyMessage: 'No unattended Tier 1 P1 tickets are open right now.',
      summaryItems: [
        { label: 'P1 unattended', value: formatCount(t1P1AttentionRows.length), tone: '#dc2626', helper: 'awaiting first touch' },
        { label: 'Breached', value: formatCount(t1P1BreachedRowCount), tone: '#f97316', helper: 'already over first-touch SLA' }
      ]
    },
    urgent: {
      key: 'urgent',
      label: 'Urgent timer focus',
      tone: '#ea580c',
      rows: t1DueNowRows,
      visibleRows: t1DueNowVisibleRows,
      limit: t1DueNowLimit,
      setLimit: setT1DueNowLimit,
      emptyMessage: 'No breached or due-soon Tier 1 rows are open right now.',
      summaryItems: [
        { label: 'Breached', value: formatCount(t1DueNowBreachedCount), tone: '#dc2626', helper: 'already over timer' },
        { label: '<= 15m', value: formatCount(t1DueNowFifteenMinuteCount), tone: '#ea580c', helper: 'next danger bucket' },
        { label: '<= 30m', value: formatCount(t1DueNowThirtyMinuteCount), tone: '#d97706', helper: 'close watch window' }
      ]
    },
    parked: {
      key: 'parked',
      label: 'Parked timer focus',
      tone: '#475569',
      rows: t1ParkedRows,
      visibleRows: t1ParkedVisibleRows,
      limit: t1ParkedLimit,
      setLimit: setT1ParkedLimit,
      emptyMessage: 'No parked pre-play Tier 1 timers are open right now.',
      summaryItems: [
        { label: 'Total parked', value: formatCount(t1ParkedRows.length), tone: '#475569', helper: 'outside the live play lane' },
        { label: 'P3 parked', value: formatCount(t1ParkedP3Count), tone: '#92400e', helper: 'pre-play start timer' },
        { label: 'P4 parked', value: formatCount(t1ParkedP4Count), tone: '#1d4ed8', helper: 'pre-play start timer' }
      ]
    }
  }), [
    t1ClientPendingLimit,
    t1ClientPendingOnHoldCount,
    t1ClientPendingRows,
    t1ClientPendingUrgentCount,
    t1ClientPendingVisibleRows,
    t1DeskLimit,
    t1DeskP1Count,
    t1DeskRows,
    t1DeskUrgentCount,
    t1DeskVisibleRows,
    t1DueNowBreachedCount,
    t1DueNowFifteenMinuteCount,
    t1DueNowLimit,
    t1DueNowRows,
    t1DueNowThirtyMinuteCount,
    t1DueNowVisibleRows,
    t1MaintenanceBreachedCount,
    t1MaintenanceLimit,
    t1MaintenanceRows,
    t1MaintenanceTrackedCount,
    t1MaintenanceVisibleRows,
    t1P1AttentionRows,
    t1P1BreachedRowCount,
    t1ParkedLimit,
    t1ParkedP3Count,
    t1ParkedP4Count,
    t1ParkedRows,
    t1ParkedVisibleRows
  ])

  const t1ActiveWorkbenchDrawer = useMemo(
    () => t1WorkbenchDrawer !== 'none' ? t1WorkbenchDrawerConfig[t1WorkbenchDrawer] : null,
    [t1WorkbenchDrawer, t1WorkbenchDrawerConfig]
  )

  const t1CommandCardItems = useMemo(() => {
    const p1Breached = Number(summary.tier1P1Breached || 0)
    const p1Unattended = Number(summary.tier1P1Unattended || 0)
    const timerBreached = Number(summary.tier1PlayClockBreached || 0)
    const timerDueSoon = Number(summary.tier1PlayClockDueSoon || 0)
    const timerTracked = Number(summary.tier1PlayClockTracked || 0)
    const timerSafe = Math.max(0, timerTracked - timerBreached - timerDueSoon)
    const queueTrendRising = Number(t1QueueTrend.delta || 0) > 0
    const voiceAgentValue = t1VoiceAgentState.total > 0
      ? `${formatCount(t1VoiceAgentState.loggedIn)}/${formatCount(t1VoiceAgentState.total)}`
      : '--'

    const productCard = (label, key, targetHours) => {
      const breachCount = Number(t1CreatedSlaBreachSummary[key] || 0)
      const population = Number(t1CreatedSlaPopulation[key] || 0)
      const tone = breachCount > 0 ? '#dc2626' : '#16a34a'
      return {
        label,
        value: formatCount(breachCount),
        detail: `${formatCount(population)} open | ${targetHours}h create-to-now SLA`,
        meta: breachCount > 0 ? 'breached rows' : 'within target',
        icon: <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />,
        tone,
        active: breachCount > 0,
        progress: population > 0 ? (breachCount / population) * 100 : 0
      }
    }

    return [
      {
        label: 'First-touch risk',
        value: formatCount(p1Breached),
        detail: `${formatCount(p1Unattended)} unattended | ${formatCount(p1Breached)} breached`,
        meta: '30m first-touch target',
        icon: p1Breached > 0 ? (
          <NotificationsActiveRoundedIcon
            sx={{
              fontSize: 16,
              animation: 'opsSiren 1.05s linear infinite',
              '@keyframes opsSiren': {
                '0%': { transform: 'rotate(-10deg) scale(1)', opacity: 0.8 },
                '50%': { transform: 'rotate(10deg) scale(1.1)', opacity: 1 },
                '100%': { transform: 'rotate(-10deg) scale(1)', opacity: 0.8 }
              }
            }}
          />
        ) : <SupportAgentRoundedIcon sx={{ fontSize: 16 }} />,
        tone: p1Breached > 0 ? '#dc2626' : p1Unattended > 0 ? '#f59e0b' : '#16a34a',
        active: p1Breached > 0 || p1Unattended > 0,
        progress: summary.tier1Open ? (p1Unattended / summary.tier1Open) * 100 : 0,
        onClick: () => openT1WorkbenchDrawer('p1', 'p1Only', { systemState: 'new' })
      },
      {
        label: 'Timer pressure',
        value: formatCount(timerBreached),
        detail: `${formatCount(timerBreached)} breached | ${formatCount(timerDueSoon)} soon | ${formatCount(timerSafe)} safe`,
        meta: 'P2 60m | P3/P4 90m',
        icon: <MonitorHeartRoundedIcon sx={{ fontSize: 16 }} />,
        tone: timerBreached > 0 ? '#dc2626' : timerDueSoon > 0 ? '#f59e0b' : '#16a34a',
        active: timerBreached > 0 || timerDueSoon > 0,
        progress: timerTracked > 0 ? (timerBreached / timerTracked) * 100 : 0,
        onClick: () => openT1WorkbenchDrawer('urgent', 'dueNow', { dueBucket: 'BREACHED' })
      },
      productCard('FTTB SLA', 'FTTB', 8),
      productCard('FTTH SLA', 'FTTH', 12),
      productCard('FF Air SLA', 'FF Air', 12),
      {
        label: 'Voice queue',
        value: tier1VoiceQueue ? formatCount(t1VoiceQueueState.waiting || 0) : '--',
        detail: t1VoiceQueueState.detail,
        meta: t1VoiceQueueState.meta,
        icon: <CallRoundedIcon sx={{ fontSize: 16 }} />,
        tone: t1VoiceQueueState.tone,
        active: t1VoiceQueueState.active,
        progress: tier1VoiceQueue
          ? (Number(summary.telephonyTier1MaxQueueSeconds || 0) > 20
              ? 100
              : (Number(summary.telephonyTier1Waiting || 0) > 0 ? 55 : 0))
          : 0
      },
      {
        label: 'Voice agents',
        value: voiceAgentValue,
        detail: t1VoiceAgentState.detail,
        meta: t1VoiceAgentState.meta,
        icon: <SupportAgentRoundedIcon sx={{ fontSize: 16 }} />,
        tone: t1VoiceAgentState.tone,
        active: t1VoiceAgentState.total > 0,
        progress: t1VoiceAgentState.total > 0 ? (t1VoiceAgentState.loggedIn / t1VoiceAgentState.total) * 100 : 0
      },
      {
        label: 'Open Tier 1',
        value: formatCount(summary.tier1Open || 0),
        detail: t1QueueTrend.statusLabel,
        meta: t1QueueTrend.helper,
        icon: <InsightsRoundedIcon sx={{ fontSize: 16 }} />,
        tone: t1QueueTrend.tone,
        active: queueTrendRising,
        progress: summary.tier1Open ? Math.min(100, ((summary.tier1Open || 0) / Math.max(1, (summary.tier1Open || 0) + Math.abs(Number(t1QueueTrend.delta || 0)))) * 100) : 0
      },
      {
        label: 'Inbound anomaly',
        value: formatCount(summary.t1InboundAnomalyCount || 0),
        detail: summary.t1InboundFocusLabel
          ? `${summary.t1InboundFocusLabel} | ${summary.t1InboundFocusStatusLabel || 'Flagged'}`
          : 'No abnormal inbound surge right now',
        meta: summary.t1InboundFocusStatusDetail || 'completed-day watch',
        icon: <CrisisAlertRoundedIcon sx={{ fontSize: 16 }} />,
        tone: summary.t1InboundFocusStatusTone || '#8b5cf6',
        active: (summary.t1InboundAnomalyCount || 0) > 0,
        progress: (summary.t1InboundAnomalyCount || 0) > 0 ? 100 : 0,
        onClick: () => t1InboundAnomalyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    ]
  }, [
    openT1WorkbenchDrawer,
    summary,
    t1CreatedSlaBreachSummary,
    t1CreatedSlaPopulation,
    t1InboundAnomalyRef,
    t1QueueTrend,
    t1VoiceAgentState,
    t1VoiceQueueState,
    tier1VoiceQueue
  ])

  const t1DeskCompareTiles = useMemo(() => ([
    {
      label: 'Received',
      value: formatCount(summary.t1ReceivedToday || 0),
      tone: '#0f766e',
      helper: `7d ${formatCount(summary.t1ReceivedLastWeek || 0)} | 14d ${formatCount(summary.t1ReceivedPreviousWeek || 0)}`
    },
    {
      label: 'Solved',
      value: formatCount(summary.t1SolvedToday || 0),
      tone: '#22c55e',
      helper: `7d ${formatCount(summary.t1SolvedLastWeek || 0)} | 14d ${formatCount(summary.t1SolvedPreviousWeek || 0)}`
    },
    {
      label: 'Voice answered',
      value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Answered || 0) : '--',
      tone: '#06b6d4',
      helper: tier1VoiceQueue
        ? `7d ${tier1VoiceWeekCompare.lastWeek ? formatCount(tier1VoiceWeekCompare.lastWeek.answered || 0) : '--'} | 14d ${tier1VoiceWeekCompare.previousWeek ? formatCount(tier1VoiceWeekCompare.previousWeek.answered || 0) : '--'}`
        : 'queue history building'
    },
    {
      label: 'Automation touched',
      value: formatCount((t1AutomationTodayRows || []).reduce((total, row) => total + Number(row.count || 0), 0)),
      tone: '#8b5cf6',
      helper: 'today routed into automation lanes'
    }
  ]), [summary, t1AutomationTodayRows, tier1VoiceQueue, tier1VoiceWeekCompare])

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

  const majorOutageOverSlaCount = useMemo(
    () => (collections.majorOutages || []).filter((row) => Number(row?.ageHours || 0) > 4).length,
    [collections]
  )

  const nldOutageOverSlaCount = useMemo(
    () => (collections.nldOutages || []).filter((row) => Number(row?.ageHours || 0) > 4).length,
    [collections]
  )

  const backhaulOverSlaCount = useMemo(
    () => (collections.backhauls || []).filter((row) => Number(row?.ageHours || 0) > 4).length,
    [collections]
  )

  const nldPartialLogLateCount = useMemo(
    () => (collections.nldPartialNotLogged || []).filter((row) => Number(row?.ageHours || 0) > (20 / 60)).length,
    [collections]
  )

  const outageCommandCards = useMemo(() => [
    {
      label: 'Major outages',
      value: formatCount(summary.majorOutageOpen || 0),
      detail: `${formatCount(summary.majorOutageSubscribers || 0)} subscribers impacted`,
      meta: `${formatCount(majorOutageOverSlaCount)} over 4h SLA`,
      tone: '#dc2626',
      icon: <NotificationsActiveRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.majorOutageSubscribers || 0) > 0 ? 100 : 18)
    },
    {
      label: 'NLD outages',
      value: formatCount(summary.nldOutageOpen || 0),
      detail: `${formatCount(summary.nldOutageSubscribers || 0)} subscribers impacted`,
      meta: `${formatCount(nldOutageOverSlaCount)} over 4h SLA`,
      tone: '#f97316',
      icon: <LanRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.nldOutageOpen || 0) * 8)
    },
    {
      label: 'Backhauls',
      value: formatCount(summary.backhaulOpen || 0),
      detail: `${formatCount(summary.vipOpen || 0)} VIP-linked rows alongside backhaul pressure`,
      meta: `${formatCount(backhaulOverSlaCount)} over 4h SLA`,
      tone: '#7c3aed',
      icon: <MonitorHeartRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.backhaulOpen || 0) * 10)
    },
    {
      label: 'P1 + P2',
      value: formatCount((summary.outageP1 || 0) + (summary.outageP2 || 0)),
      detail: `${formatCount(summary.outageP1 || 0)} P1 | ${formatCount(summary.outageP2 || 0)} P2`,
      meta: 'highest live alert pressure',
      tone: ((summary.outageP1 || 0) + (summary.outageP2 || 0)) > 0 ? '#dc2626' : '#16a34a',
      icon: <CrisisAlertRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, ((Number(summary.outageP1 || 0) + Number(summary.outageP2 || 0)) * 10))
    },
    {
      label: 'Priority stack',
      value: formatCount((summary.outageP1 || 0) + (summary.outageP2 || 0) + (summary.outageP3 || 0) + (summary.outageP4 || 0) + (summary.outagePower || 0)),
      detail: `${formatCount(summary.outageP3 || 0)} P3 | ${formatCount(summary.outageP4 || 0)} P4 | ${formatCount(summary.outagePower || 0)} power`,
      meta: `${formatCount(nldPartialLogLateCount)} NLD partials over 20m`,
      tone: '#ea580c',
      icon: <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, (Number(summary.outageP1 || 0) + Number(summary.outageP2 || 0) + Number(summary.outageP3 || 0) + Number(summary.outageP4 || 0) + Number(summary.outagePower || 0)) * 6)
    }
  ], [backhaulOverSlaCount, majorOutageOverSlaCount, nldOutageOverSlaCount, nldPartialLogLateCount, summary])

  const tier2CommandCards = useMemo(() => [
    {
      label: 'Tickets received',
      value: formatCount(summary.t2ReceivedToday || 0),
      detail: `7d ${formatCount(summary.t2ReceivedLastWeek || 0)} | 14d ${formatCount(summary.t2ReceivedPreviousWeek || 0)}`,
      meta: 'today intake pace',
      tone: '#1d4ed8',
      icon: <InsightsRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.t2ReceivedToday || 0))
    },
    {
      label: 'Tickets solved',
      value: formatCount(summary.t2SolvedToday || 0),
      detail: `7d ${formatCount(summary.t2SolvedLastWeek || 0)} | 14d ${formatCount(summary.t2SolvedPreviousWeek || 0)}`,
      meta: 'today closure pace',
      tone: '#60a5fa',
      icon: <SupportAgentRoundedIcon fontSize="small" />,
      progress: Math.min(100, Number(summary.t2SolvedToday || 0))
    },
    {
      label: 'Open queue',
      value: formatCount(summary.tier2Open || 0),
      detail: `${formatCount(summary.tier2NewUnassigned || 0)} new / unattended`,
      meta: `${formatCount(summary.t2HandoverOpen || 0)} handover`,
      tone: '#0f172a',
      icon: <MonitorHeartRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.tier2Open || 0))
    },
    {
      label: 'New unattended',
      value: formatCount(summary.tier2NewUnassigned || 0),
      detail: 'Immediate Tier 2 attention lane',
      meta: 'unassigned or untouched',
      tone: (summary.tier2NewUnassigned || 0) > 0 ? '#dc2626' : '#16a34a',
      icon: <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.tier2NewUnassigned || 0) * 10)
    },
    {
      label: 'Handover open',
      value: formatCount(summary.t2HandoverOpen || 0),
      detail: 'Live macro handover workflow',
      meta: 'needs movement across parties',
      tone: '#ea580c',
      icon: <RouteRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.t2HandoverOpen || 0) * 10)
    }
  ], [summary])

  const nldCommandCards = useMemo(() => [
    {
      label: 'Partial events',
      value: formatCount(summary.nldPartialEventCount || 0),
      detail: 'recent partial-NLD event rows in lookback',
      meta: `${formatCount(summary.nldPartialClusterCount || 0)} clusters`,
      tone: '#f97316',
      icon: <LanRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.nldPartialEventCount || 0))
    },
    {
      label: 'Route clusters',
      value: formatCount(summary.nldPartialClusterCount || 0),
      detail: 'repeat event clusters on the same route',
      meta: `${formatCount(summary.nldPartialNotLoggedCount || 0)} not logged`,
      tone: '#dc2626',
      icon: <RouteRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.nldPartialClusterCount || 0) * 14)
    },
    {
      label: 'Open NLD outages',
      value: formatCount(summary.nldOutageOpen || 0),
      detail: `${formatCount(summary.nldOutageSubscribers || 0)} subscribers impacted`,
      meta: 'current NLD outage desk',
      tone: '#0f766e',
      icon: <NotificationsActiveRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.nldOutageOpen || 0) * 10)
    },
    {
      label: 'Not logged',
      value: formatCount(summary.nldPartialNotLoggedCount || 0),
      detail: 'partial events without outage ticket match',
      meta: 'direct logging watchlist',
      tone: (summary.nldPartialNotLoggedCount || 0) > 0 ? '#ea580c' : '#16a34a',
      icon: <WarningAmberRoundedIcon sx={{ fontSize: 16 }} />,
      progress: Math.min(100, Number(summary.nldPartialNotLoggedCount || 0) * 14)
    }
  ], [summary])

  const outageProcessMarkerItems = useMemo(() => (OUTAGE_PROCESS_MARKERS.map((marker) => {
    switch (marker.key) {
      case 'vendorLog':
        return { ...marker, liveNote: `${formatCount(nldPartialLogLateCount)} NLD partial events are already beyond the 20-minute log marker.` }
      case 'onsite':
        return { ...marker, liveNote: `${formatCount(nldOutageOverSlaCount + backhaulOverSlaCount)} NLD / backhaul rows are already beyond the 2-hour site-arrival guide.` }
      case 'resolve':
        return { ...marker, liveNote: `${formatCount(majorOutageOverSlaCount + nldOutageOverSlaCount + backhaulOverSlaCount)} live rows are already beyond the 4-hour restore target.` }
      default:
        return marker
    }
  })), [backhaulOverSlaCount, majorOutageOverSlaCount, nldOutageOverSlaCount, nldPartialLogLateCount])

  const nldProcessMarkerItems = useMemo(() => (OUTAGE_PROCESS_MARKERS.map((marker) => {
    switch (marker.key) {
      case 'vendorLog':
        return { ...marker, liveNote: `${formatCount(nldPartialLogLateCount)} partial events still need outage logging before the 20-minute target slips further.` }
      case 'onsite':
        return { ...marker, liveNote: `${formatCount(nldOutageOverSlaCount)} open NLD outages are already beyond the 2-hour site-arrival guide.` }
      case 'resolve':
        return { ...marker, liveNote: `${formatCount(nldOutageOverSlaCount)} open NLD outages are already beyond the 4-hour outage SLA.` }
      default:
        return marker
    }
  })), [nldOutageOverSlaCount, nldPartialLogLateCount])

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

  const t1ActionColumnParts = useMemo(() => ({
    ticket: { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    action: { key: 'pLevel', label: 'Action Lane', render: (row) => <SignalChip label={row.pLevel} tone={T1_ACTION_TONE_MAP[row.pLevel] || '#64748b'} /> },
    playPolicy: {
      key: 'playPolicyTitle',
      label: 'Play Policy',
      render: (row) => row.playPolicyTitle
        ? <SignalChip label={`${row.playPolicyTitle} - ${row.playTargetMinutes}m`} tone={T1_PLAY_POLICY_TONE_MAP[row.playPolicyTitle] || '#64748b'} />
        : '--'
    },
    dueBucket: { key: 'dueBucket', label: 'Clock State', render: (row) => <SignalChip label={row.dueBucket} tone={T1_DUE_BUCKET_TONE_MAP[row.dueBucket] || '#64748b'} /> },
    remaining: {
      key: 'remainingMinutes',
      label: 'Timer Left',
      render: (row) => row.remainingMinutes === null
        ? '--'
        : <Typography variant="body2" sx={{ fontWeight: 800, color: row.remainingMinutes <= 0 ? '#fca5a5' : row.remainingMinutes <= 30 ? '#fdba74' : OPS_TEXT }}>{formatMinutesRemaining(row.remainingMinutes)}</Typography>
    },
    status: { key: 'status', label: 'System State', render: (row) => <Chip size="small" label={row.status} color={severityColor(row.status)} /> },
    product: { key: 'product', label: 'Product' },
    service: { key: 'serviceType', label: 'Service', render: (row) => row.serviceType || '--' },
    node: {
      key: 'nodeName',
      label: 'Node',
      render: (row) => (
        <Typography variant="body2" sx={{ maxWidth: 180, fontWeight: 700, whiteSpace: 'normal', lineHeight: 1.25 }}>
          {row.nodeName || '--'}
        </Typography>
      )
    },
    olt: {
      key: 'olt',
      label: 'OLT',
      render: (row) => (
        <Typography variant="body2" sx={{ maxWidth: 140, fontWeight: 700, whiteSpace: 'normal', lineHeight: 1.25 }}>
          {row.olt || '--'}
        </Typography>
      )
    },
    premisesAlias: {
      key: 'customerPremisesAlias',
      label: 'Premises Alias',
      render: (row) => (
        <Typography variant="body2" sx={{ maxWidth: 240, whiteSpace: 'normal', lineHeight: 1.25 }}>
          {row.customerPremisesAlias || '--'}
        </Typography>
      )
    },
    workflowOwner: { key: 'workflowOwner', label: 'Workflow Owner', render: (row) => <SignalChip label={row.workflowOwner || 'Needs review'} tone={T1_WORKFLOW_OWNER_TONE_MAP[row.workflowOwner] || '#64748b'} /> },
    operationalState: { key: 'operationalState', label: 'Operational State', render: (row) => <SignalChip label={row.operationalState} tone={T1_OPERATIONAL_STATE_TONE_MAP[row.operationalState] || '#64748b'} /> },
    escalationPath: { key: 'escalationPath', label: 'Escalation Path', render: (row) => <SignalChip label={row.escalationPath || 'Tier 1 review'} tone={T1_ESCALATION_PATH_TONE_MAP[row.escalationPath] || '#475569'} /> },
    automation: {
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
    updated: { key: 'updatedAt', label: 'Updated', render: (row) => formatStamp(row.updatedAt) },
    age: { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    subject: { key: 'subject', label: 'Subject' }
  }), [])

  const t1FocusColumns = useMemo(() => [
    t1ActionColumnParts.ticket,
    t1ActionColumnParts.action,
    t1ActionColumnParts.playPolicy,
    t1ActionColumnParts.dueBucket,
    t1ActionColumnParts.remaining,
    t1ActionColumnParts.node,
    t1ActionColumnParts.olt,
    t1ActionColumnParts.premisesAlias,
    t1ActionColumnParts.operationalState,
    t1ActionColumnParts.workflowOwner,
    t1ActionColumnParts.escalationPath,
    t1ActionColumnParts.status,
    t1ActionColumnParts.updated,
    t1ActionColumnParts.subject
  ], [t1ActionColumnParts])

  const t1ActionColumns = useMemo(() => [
    t1ActionColumnParts.ticket,
    t1ActionColumnParts.action,
    t1ActionColumnParts.playPolicy,
    t1ActionColumnParts.dueBucket,
    t1ActionColumnParts.remaining,
    t1ActionColumnParts.operationalState,
    t1ActionColumnParts.workflowOwner,
    t1ActionColumnParts.escalationPath,
    t1ActionColumnParts.status,
    t1ActionColumnParts.product,
    t1ActionColumnParts.service,
    t1ActionColumnParts.node,
    t1ActionColumnParts.olt,
    t1ActionColumnParts.premisesAlias,
    t1ActionColumnParts.automation,
    t1ActionColumnParts.updated,
    t1ActionColumnParts.age,
    t1ActionColumnParts.subject
  ], [t1ActionColumnParts])

  const t1PremisesHotspotColumns = useMemo(() => [
    {
      key: 'label',
      label: 'Premises Alias',
      render: (row) => (
        <Stack spacing={0.25}>
          <Typography variant="body2" sx={{ fontWeight: 800, maxWidth: 260, whiteSpace: 'normal', lineHeight: 1.25 }}>
            {row.label}
          </Typography>
          <Typography variant="caption" sx={{ color: OPS_MUTED }}>
            {row.organizationLabel || 'Unknown organisation'}
          </Typography>
        </Stack>
      )
    },
    { key: 'count', label: 'Tickets', render: (row) => formatCount(row.count || 0) },
    { key: 'province', label: 'Province', render: (row) => row.province || '--' },
    { key: 'nodeName', label: 'Node', render: (row) => row.nodeName || '--' },
    { key: 'olt', label: 'OLT', render: (row) => row.olt || '--' },
    {
      key: 'topTicket',
      label: 'Lead Ticket',
      render: (row) => {
        const ticket = row.tickets?.[0]
        return ticket?.id
          ? <ExternalTicketLink href={ticket.url} label={`#${ticket.id}`} />
          : '--'
      }
    }
  ], [])

  const t1InboundAnomalyColumns = useMemo(() => [
    {
      key: 'productType',
      label: 'Product Type',
      render: (row) => (
        <Stack spacing={0.2}>
          <Typography variant="body2" sx={{ fontWeight: 700, color: OPS_TEXT }}>
            {row.productType || row.serviceType || '--'}
          </Typography>
          <Typography variant="caption" sx={{ color: OPS_MUTED }}>
            {row.productGroup || '--'}
          </Typography>
        </Stack>
      )
    },
    { key: 'dayLabel', label: 'Day' },
    { key: 'mode', label: 'Mode', render: (row) => <SignalChip label={row.mode === 'sustained' ? 'Sustained' : 'Breakout'} tone={row.mode === 'sustained' ? '#8b5cf6' : '#dc2626'} /> },
    { key: 'statusLabel', label: 'State', render: (row) => <SignalChip label={row.statusLabel || 'Flagged'} tone={row.statusTone || row.tone || '#d97706'} /> },
    { key: 'count', label: 'Count', render: (row) => formatCount(row.count || 0) },
    { key: 'baselineAvg', label: 'Baseline Avg', render: (row) => Number(row.baselineAvg || 0).toFixed(1) },
    { key: 'baselineMax', label: 'Prev Max', render: (row) => formatCount(row.baselineMax || 0) },
    { key: 'deltaCount', label: 'Delta', render: (row) => formatSignedDelta(row.deltaCount || 0) },
    { key: 'ratio', label: 'Lift', render: (row) => row.ratio ? `${Number(row.ratio).toFixed(1)}x` : 'new' },
    { key: 'severity', label: 'Severity', render: (row) => <SignalChip label={titleCaseWords(row.severity || 'warning')} tone={row.tone || '#d97706'} /> }
  ], [])
  const t2Columns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'status', label: 'Status', render: (row) => <Chip size="small" label={row.status} color={severityColor(row.status)} /> },
    { key: 'priority', label: 'Priority', render: (row) => <Chip size="small" label={row.priority} color={priorityColor(row.priority)} /> },
    { key: 'product', label: 'Product' },
    { key: 'organizationLabel', label: 'ISP', render: (row) => row.organizationLabel || '--' },
    { key: 'province', label: 'Province', render: (row) => row.province || '--' },
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
        shellSx={{ p: { xs: 0.95, md: 1.1 }, gap: 0.85 }}
        heroSx={{
          p: { xs: 1.05, md: 1.15 },
          borderRadius: OPS_RADIUS_LG,
          color: OPS_TEXT,
          border: `1px solid ${OPS_BORDER}`,
          background: [
            `radial-gradient(circle at 12% 18%, ${alpha('#14b8a6', 0.16)} 0%, transparent 22%)`,
            `radial-gradient(circle at 88% 16%, ${alpha('#2563eb', 0.14)} 0%, transparent 24%)`,
            `linear-gradient(135deg, rgba(255, 255, 255, 0.99) 0%, rgba(243, 248, 255, 0.98) 52%, rgba(238, 244, 251, 0.98) 100%)`
          ].join(','),
          boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)'
        }}
        eyebrowSx={{ color: '#0f766e', mb: 0.22, fontWeight: 800, letterSpacing: 0.9 }}
        titleSx={{ color: OPS_TEXT, fontSize: { xs: '1.7rem', md: '1.95rem' }, fontWeight: 900, lineHeight: 1.02 }}
        descriptionSx={{ color: OPS_MUTED, fontSize: '0.92rem', maxWidth: 920 }}
      >
        <AnalyticsLoadingBlock message="Loading the current monitoring snapshot..." />
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="NOC Monitoring"
      title="NOC Monitoring Hub"
      accent={ACCENT}
      shellSx={{ p: { xs: 0.95, md: 1.1 }, gap: 0.85 }}
      heroSx={{
        p: { xs: 1.05, md: 1.15 },
        borderRadius: OPS_RADIUS_LG,
        color: OPS_TEXT,
        border: `1px solid ${OPS_BORDER}`,
        background: [
          `radial-gradient(circle at 12% 18%, ${alpha('#14b8a6', 0.16)} 0%, transparent 22%)`,
          `radial-gradient(circle at 88% 16%, ${alpha('#2563eb', 0.14)} 0%, transparent 24%)`,
          `linear-gradient(135deg, rgba(255, 255, 255, 0.99) 0%, rgba(243, 248, 255, 0.98) 52%, rgba(238, 244, 251, 0.98) 100%)`
        ].join(','),
        boxShadow: '0 18px 36px rgba(15, 23, 42, 0.08)'
      }}
      eyebrowSx={{ color: '#0f766e', mb: 0.22, fontWeight: 800, letterSpacing: 0.9 }}
      titleSx={{ color: OPS_TEXT, fontSize: { xs: '1.7rem', md: '1.95rem' }, fontWeight: 900, lineHeight: 1.02 }}
      actionsSx={{ width: { xs: '100%', xl: 'auto' } }}
      actions={(
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(3, minmax(0, 1fr))',
              xl: 'repeat(5, minmax(108px, 1fr))'
            },
            gap: 0.55,
            width: { xs: '100%', xl: 'auto' }
          }}
        >
          {heroStatusItems.map((item) => (
            <OpsStatusPill
              key={item.label}
              label={item.label}
              value={item.value}
              tone={item.tone}
              centered
              quiet
            />
          ))}
        </Box>
      )}
    >
      <Box
        sx={{
          display: 'grid',
          gap: 1.05,
          p: { xs: 0.8, md: 1 },
          borderRadius: OPS_RADIUS_LG,
          border: `1px solid ${OPS_BORDER}`,
          background: [
            `radial-gradient(circle at top left, ${alpha('#0f766e', 0.1)} 0%, transparent 24%)`,
            `radial-gradient(circle at 82% 18%, ${alpha('#1d4ed8', 0.08)} 0%, transparent 22%)`,
            `linear-gradient(180deg, ${OPS_BG} 0%, #f8fbff 100%)`
          ].join(','),
          boxShadow: '0 20px 42px rgba(15, 23, 42, 0.08)'
        }}
      >
        {refreshing ? <LinearProgress sx={{ borderRadius: 999, overflow: 'hidden', bgcolor: 'rgba(226,232,240,0.72)' }} /> : null}

        {error ? (
          <OpsAlert severity="error">{error}</OpsAlert>
        ) : null}

        {warnings.length ? (
          <OpsAlert severity="warning">
            {warnings.length} monitoring source{warnings.length === 1 ? '' : 's'} returned partial data. The page still loaded the rest of the snapshot so the team can keep working.
          </OpsAlert>
        ) : null}

        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: { xs: 0.55, md: 0.7 },
            py: 0.32,
            borderRadius: OPS_RADIUS_MD,
            border: `1px solid ${alpha('#93c5fd', 0.08)}`,
            bgcolor: 'rgba(255, 255, 255, 0.9)'
          }}
        >
          <Tabs
            value={tab}
            onChange={(_event, value) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              flex: 1,
              minHeight: 34,
              '& .MuiTab-root': {
                minHeight: 34,
                color: OPS_MUTED,
                fontWeight: 700,
                fontSize: 13,
                textTransform: 'none',
                borderRadius: OPS_RADIUS_SM,
                px: 1.1,
                py: 0.35
              },
              '& .Mui-selected': {
                color: `${OPS_TEXT} !important`,
                background: 'linear-gradient(180deg, rgba(20, 184, 166, 0.14) 0%, rgba(37, 99, 235, 0.1) 100%)'
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
        </Box>

      {tab === 'overview' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          {(summary.t1InboundAnomalyCount || 0) > 0 ? (
            <OpsAlert severity="warning">
              Tier 1 inbound anomaly watch is active: {summary.t1InboundFocusLabel || 'lead product'} is flagged with {formatCount(summary.t1InboundAnomalyCount || 0)} recent anomaly day{Number(summary.t1InboundAnomalyCount || 0) === 1 ? '' : 's'}. {summary.t1InboundFocusStatusDetail || 'The spike is still under watch.'}
            </OpsAlert>
          ) : null}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(6, minmax(0, 1fr))' }, gap: 0.82 }}>
            {overviewCommandCards.map((item) => (
              <OpsPriorityCard key={item.label} {...item} />
            ))}
          </Box>

          <OpsSection
            title="Monitoring Pulse"
            subtitle="Shared pressure view across outages, Tier 1, Tier 2, and subscriber impact."
            tone="#1d4ed8"
            minHeight={0}
            bodySx={overviewPulseExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={overviewPulseExpanded} onClick={() => setOverviewPulseExpanded((current) => !current)} />}
          >
            {overviewPulseExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.2fr 0.8fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Open work by lane" subtitle="Live open counts and aged counts across the core lanes." tone="#0f766e">
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 0.95 }}>
                      <Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                          Open items
                        </Typography>
                        <VerticalBarChart rows={laneChartData} dataKey="openCount" emptyMessage="No lane counts were returned for this snapshot." colorMap={Object.fromEntries(laneChartData.map((lane) => [lane.key, lane.tone]))} height={220} />
                      </Box>
                      <Box>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                          Aged items beyond lane threshold
                        </Typography>
                        <VerticalBarChart rows={laneChartData} dataKey="agedCount" emptyMessage="No aged items are available in this snapshot." colorMap={Object.fromEntries(laneChartData.map((lane) => [lane.key, lane.tone]))} height={220} />
                      </Box>
                    </Box>
                  </OpsSubPanel>

                  <OpsSubPanel title="Pressure mix" subtitle="Impact, outage priority, and partial-NLD pressure areas." tone="#dc2626">
                    <Box sx={{ display: 'grid', gap: 0.9 }}>
                      <VerticalBarChart rows={impactChartData} dataKey="impactCount" emptyMessage="No subscriber impact is available right now." colorMap={Object.fromEntries(impactChartData.map((lane) => [lane.key, lane.tone]))} height={220} />
                      <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
                        <SignalChip label={`P1 ${formatCount(summary.outageP1 || 0)}`} tone="#dc2626" />
                        <SignalChip label={`P2 ${formatCount(summary.outageP2 || 0)}`} tone="#ea580c" />
                        <SignalChip label={`P3 ${formatCount(summary.outageP3 || 0)}`} tone="#d97706" />
                        <SignalChip label={`P4 ${formatCount(summary.outageP4 || 0)}`} tone="#2563eb" />
                        <SignalChip label={`Power ${formatCount(summary.outagePower || 0)}`} tone="#7c3aed" />
                        <SignalChip label={`Partial not logged ${formatCount(summary.nldPartialNotLoggedCount || 0)}`} tone="#475569" />
                      </Stack>
                    </Box>
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.08fr 0.92fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Historical queue pressure" subtitle={`Backlog direction across the last ${historyWindowLabel}.`} tone="#1d4ed8">
                    <MultiLineChartPanel
                      rows={historyLanePressure}
                      lines={[
                        { key: 'tier1Open', label: 'Tier 1', color: '#0f766e' },
                        { key: 'tier2Open', label: 'Tier 2', color: '#1d4ed8' },
                        { key: 'majorOutageOpen', label: 'Major outages', color: '#dc2626' },
                        { key: 'backhaulOpen', label: 'Backhaul', color: '#7c3aed' }
                      ]}
                      emptyMessage="Historical queue pressure is still building and will appear after a few refresh buckets land."
                      height={220}
                    />
                  </OpsSubPanel>

                  <OpsSubPanel title="Historical subscriber impact" subtitle={`Open impact over the last ${historyWindowLabel}.`} tone="#dc2626">
                    <MultiLineChartPanel
                      rows={historySubscriberImpact}
                      lines={[
                        { key: 'majorOutageSubscribers', label: 'Major outage subs', color: '#dc2626' },
                        { key: 'nldOutageSubscribers', label: 'NLD subs', color: '#f97316' },
                        { key: 'totalSubscribers', label: 'Total impacted', color: '#facc15' }
                      ]}
                      emptyMessage="Historical subscriber impact will light up once more monitoring buckets have been stored."
                      height={220}
                    />
                  </OpsSubPanel>
                </Box>
              </Box>
            ) : null}
          </OpsSection>

          <OpsSection
            title="Shared Workbench"
            subtitle="Operational detail blocks used to branch into the desk-specific tabs."
            tone="#0f172a"
            minHeight={0}
            bodySx={overviewWorkbenchExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={overviewWorkbenchExpanded} onClick={() => setOverviewWorkbenchExpanded((current) => !current)} />}
          >
            {overviewWorkbenchExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.95fr 1.05fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Outage priority lanes" subtitle="Native alert bucket view from the latest snapshot." tone="#dc2626">
                    <VerticalBarChart rows={outagePrioritySummary} dataKey="count" emptyMessage="No outage priority lanes are active in this snapshot." colorMap={Object.fromEntries(outagePrioritySummary.map((row) => [row.key, row.tone]))} height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Daily ops flow" subtitle={`Tier 1 and Tier 2 received versus solved for ${summary.dayKey || 'today'}.`} tone="#0f172a">
                    <MultiLineChartPanel
                      rows={hourlySeries}
                      lines={[
                        { key: 't1Received', label: 'T1 received', color: '#0f766e' },
                        { key: 't1Solved', label: 'T1 solved', color: '#22c55e' },
                        { key: 't2Received', label: 'T2 received', color: '#1d4ed8' },
                        { key: 't2Solved', label: 'T2 solved', color: '#60a5fa' }
                      ]}
                      emptyMessage="No Tier 1 or Tier 2 intake data is available for the current ops day."
                      height={220}
                    />
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Partial NLD routes" subtitle="Top partial-route pressure in the current lookback window." tone="#f97316">
                    <VerticalBarChart rows={partialRouteSummary.slice(0, 10)} dataKey="count" emptyMessage="No partial NLD routes were returned for the current lookback window." height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Operational spotlights" subtitle="Strongest live watch items pulled from the latest snapshot." tone="#0f172a">
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 0.85 }}>
                      {spotlights.length ? spotlights.map((item) => <SpotlightCard key={item.key} item={item} />) : (
                        <AnalyticsChartFallback minHeight={220} message="No spotlight items are available for this snapshot." />
                      )}
                    </Box>
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.05 }}>
                  <OpsSubPanel title="Outage impact by region" subtitle="Subscriber-impact concentration by outage region." tone="#dc2626">
                    <HorizontalBarChart rows={outageRegionImpactSummary} dataKey="count" emptyMessage="No outage region impact is available right now." height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Tier 2 service mix" subtitle="Current Tier 2 open work grouped by service type." tone="#1d4ed8">
                    <HorizontalBarChart rows={t2ServiceTypeSummary} dataKey="count" emptyMessage="No Tier 2 service-type split is available right now." height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Voice queue pressure" subtitle="Waiting callers by queue from the telephony snapshot." tone="#0891b2">
                    <HorizontalBarChart rows={telephonyQueueWaitingSummary} dataKey="count" emptyMessage="No queue waiting data is available right now." height={220} />
                  </OpsSubPanel>
                </Box>
              </Box>
            ) : null}
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'outages' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' }, gap: 0.82 }}>
            {outageCommandCards.map((item) => (
              <OpsPriorityCard key={item.label} {...item} />
            ))}
          </Box>

          <OpsSection
            title="Outage Radar"
            subtitle="SLA pressure, priority flow, and where outage load is concentrating."
            tone="#dc2626"
            minHeight={0}
            bodySx={outagesRadarExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={outagesRadarExpanded} onClick={() => setOutagesRadarExpanded((current) => !current)} />}
          >
            {outagesRadarExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <OpsValueTiles
                  columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }}
                  items={[
                    { label: 'Major >4h', value: formatCount(majorOutageOverSlaCount), tone: majorOutageOverSlaCount > 0 ? '#dc2626' : '#16a34a', helper: 'major outage SLA breaches' },
                    { label: 'NLD >4h', value: formatCount(nldOutageOverSlaCount), tone: nldOutageOverSlaCount > 0 ? '#f97316' : '#16a34a', helper: 'NLD outage SLA breaches' },
                    { label: 'Backhaul >4h', value: formatCount(backhaulOverSlaCount), tone: backhaulOverSlaCount > 0 ? '#7c3aed' : '#16a34a', helper: 'backhaul SLA breaches' },
                    { label: 'NLD log >20m', value: formatCount(nldPartialLogLateCount), tone: nldPartialLogLateCount > 0 ? '#ea580c' : '#16a34a', helper: 'partial events still not logged' }
                  ]}
                />

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
                  <OpsSubPanel title="Desk pressure trend" subtitle={`Major outage, NLD, and backhaul movement across the last ${historyWindowLabel}.`} tone="#dc2626">
                    <MultiLineChartPanel
                      rows={historyLanePressure}
                      lines={[
                        { key: 'majorOutageOpen', label: 'Major outages', color: '#dc2626' },
                        { key: 'nldOutageOpen', label: 'NLD outages', color: '#f97316' },
                        { key: 'backhaulOpen', label: 'Backhaul', color: '#7c3aed' }
                      ]}
                      emptyMessage="Historical outage desk pressure will appear as more backend buckets are stored."
                      height={220}
                    />
                  </OpsSubPanel>

                  <OpsSubPanel title="Priority trend" subtitle={`P1 to P4 movement across the last ${historyWindowLabel}.`} tone="#ea580c">
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
                      height={220}
                    />
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' }, gap: 1.05 }}>
                  <OpsSubPanel title="Impact by region" subtitle="Subscriber impact rolled up by outage region." tone="#dc2626">
                    <HorizontalBarChart rows={outageRegionImpactSummary} dataKey="count" emptyMessage="No outage-region impact data is available right now." height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Outage service split" subtitle="Open outage rows grouped by service type." tone="#f97316">
                    <HorizontalBarChart rows={outageServiceTypeSummary} dataKey="count" emptyMessage="No outage service-type summary is available right now." height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Backhaul owner load" subtitle="Current open backhaul tickets by working owner." tone="#7c3aed">
                    <HorizontalBarChart rows={backhaulOwnerSummary} dataKey="count" emptyMessage="No backhaul owner summary is available right now." height={220} />
                  </OpsSubPanel>
                </Box>

                <OpsSubPanel title="Outage process markers" subtitle="Static visual guide for where live outage, NLD, and backhaul work should roughly sit against age." tone="#0f766e">
                  <ProcessMilestoneStrip items={outageProcessMarkerItems} liveTone="#0f766e" />
                </OpsSubPanel>
              </Box>
            ) : null}
          </OpsSection>

          <OpsSection
            title="Open Desks"
            subtitle="Priority queue first, then the three live outage desks."
            tone="#0f172a"
            minHeight={0}
            bodySx={outagesDeskExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={outagesDeskExpanded} onClick={() => setOutagesDeskExpanded((current) => !current)} />}
          >
            {outagesDeskExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.08fr 0.92fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Priority queue detail" subtitle="Native replacement for the Grafana P1 / P2 / P3 / P4 and power alert table." tone="#dc2626">
                    <MonitoringTable rows={priorityRows} columns={priorityColumns} emptyMessage="No outage priority rows are active right now." />
                  </OpsSubPanel>

                  <OpsSubPanel title="Outage SLA cues" subtitle="Fast supervision tiles for the live outage estate." tone="#ea580c">
                    <OpsValueTiles
                      columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(2, minmax(0, 1fr))' }}
                      items={[
                        { label: 'Major >4h', value: formatCount(majorOutageOverSlaCount), tone: majorOutageOverSlaCount > 0 ? '#dc2626' : '#16a34a', helper: `${formatCount(summary.majorOutageOpen || 0)} total open` },
                        { label: 'NLD >4h', value: formatCount(nldOutageOverSlaCount), tone: nldOutageOverSlaCount > 0 ? '#f97316' : '#16a34a', helper: `${formatCount(summary.nldOutageOpen || 0)} total open` },
                        { label: 'Backhaul >4h', value: formatCount(backhaulOverSlaCount), tone: backhaulOverSlaCount > 0 ? '#7c3aed' : '#16a34a', helper: `${formatCount(summary.backhaulOpen || 0)} total open` },
                        { label: 'NLD log >20m', value: formatCount(nldPartialLogLateCount), tone: nldPartialLogLateCount > 0 ? '#ea580c' : '#16a34a', helper: `${formatCount(summary.nldPartialNotLoggedCount || 0)} not logged rows` }
                      ]}
                    />
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Major outage desk" subtitle="Open non-NLD outage capturing tickets ranked by age." tone="#dc2626">
                    <MonitoringTable rows={collections.majorOutages || []} columns={majorColumns} emptyMessage="No major outage rows are open right now." />
                  </OpsSubPanel>

                  <OpsSubPanel title="NLD outage desk" subtitle="Open NLD outage capturing tickets with subscriber impact and last update context." tone="#f97316">
                    <MonitoringTable rows={collections.nldOutages || []} columns={nldColumns} emptyMessage="No open NLD outage rows are visible right now." />
                  </OpsSubPanel>
                </Box>

                <OpsSubPanel title="Backhaul desk" subtitle="Open backhaul tickets driven off the configured backhaul tag." tone="#7c3aed">
                  <MonitoringTable rows={collections.backhauls || []} columns={backhaulColumns} emptyMessage="No backhaul tickets are open right now." />
                </OpsSubPanel>
              </Box>
            ) : null}
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'tier1' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(9, minmax(0, 1fr))' },
              gap: 0.78
            }}
          >
            {t1CommandCardItems.map((item) => (
              <OpsPriorityCard key={item.label} {...item} />
            ))}
          </Box>

          <Box ref={t1InboundAnomalyRef}>
            <OpsSection
              title={(
                <Stack direction="row" spacing={0.7} alignItems="center">
                  <CrisisAlertRoundedIcon sx={{ fontSize: 18, color: '#f97316' }} />
                  <Box component="span">Watch Radar</Box>
                </Stack>
              )}
              subtitle="Supervisor watch in one live strip."
              tone="#ef4444"
              minHeight={0}
              bodySx={t1WatchExpanded ? undefined : { display: 'none' }}
              action={(
                <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                  {(summary.t1InboundAnomalyCount || 0) > 0 ? <SignalChip label={`${formatCount(summary.t1InboundAnomalyCount || 0)} anomaly days`} tone={(summary.t1InboundHighAnomalyCount || 0) > 0 ? '#ef4444' : '#8b5cf6'} /> : null}
                  {(summary.t1InboundAnomalyCount || 0) > 0 ? <SignalChip label={summary.t1InboundFocusStatusLabel || 'Flagged'} tone={summary.t1InboundFocusStatusTone || '#ef4444'} /> : null}
                  {summary.telephonyTier1SlaBreached ? <SignalChip label="Voice SLA risk" tone="#ef4444" /> : null}
                  <SectionCollapseButton expanded={t1WatchExpanded} onClick={() => setT1WatchExpanded((current) => !current)} />
                </Stack>
              )}
            >
              {t1WatchExpanded ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.94fr 1.06fr' }, gap: 0.85, alignItems: 'stretch' }}>
                  <Box
                    sx={{
                      p: 1,
                      borderRadius: OPS_RADIUS_MD,
                      border: `1px solid ${alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#ef4444' : '#14b8a6', 0.28)}`,
                      bgcolor: 'rgba(255, 255, 255, 0.96)',
                      background: `linear-gradient(135deg, ${alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#ef4444' : '#14b8a6', 0.12)} 0%, rgba(255, 255, 255, 0.98) 58%)`,
                      boxShadow: `0 14px 24px ${alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#ef4444' : '#14b8a6', 0.08)}`
                    }}
                  >
                    <Stack spacing={0.62} sx={{ height: '100%' }}>
                      <Typography variant="caption" sx={{ color: alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#ef4444' : '#14b8a6', 0.92), textTransform: 'uppercase', letterSpacing: 0.62, fontWeight: 800 }}>
                        Current watch
                      </Typography>
                      <Typography variant="h5" sx={{ color: OPS_TEXT, fontWeight: 900, lineHeight: 1.02, letterSpacing: -0.28 }}>
                        {summary.t1InboundFocusLabel
                          ? `${summary.t1InboundFocusLabel} | ${summary.t1InboundFocusStatusLabel || 'Flagged'}`
                          : 'No major inbound anomaly right now'}
                      </Typography>
                      <Typography variant="body2" sx={{ color: OPS_MUTED, lineHeight: 1.3 }}>
                        {summary.t1InboundFocusStatusDetail || 'Completed-day inbound spikes are clear right now.'}
                        {summary.telephonyTier1SlaBreached
                          ? ` Voice queue remains outside the 20-second target at ${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)}.`
                          : ''}
                      </Typography>
                      <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap" sx={{ pt: 0.15 }}>
                        <SignalChip label={summary.t1InboundFocusStatusLabel || 'Clear'} tone={summary.t1InboundFocusStatusTone || '#14b8a6'} />
                        <SignalChip label={summary.telephonyTier1SlaBreached ? 'Voice outside SLA' : 'Voice within SLA'} tone={summary.telephonyTier1SlaBreached ? '#ef4444' : '#06b6d4'} />
                        {t1RegionHotspot ? <SignalChip label={`Province ${t1RegionHotspot.label}`} tone="#f59e0b" /> : null}
                        {t1OrganisationHotspot ? <SignalChip label={`ISP ${t1OrganisationHotspot.label}`} tone="#2563eb" /> : null}
                        {t1NodeHotspot ? <SignalChip label={`Node ${t1NodeHotspot.label}`} tone="#0f766e" /> : null}
                        {t1OltHotspot ? <SignalChip label={`OLT ${t1OltHotspot.label}`} tone="#7c3aed" /> : null}
                      </Stack>
                      <Box sx={{ pt: 0.2 }}>
                        <CompactBreakdownList
                          rows={t1AnomalyListRows}
                          maxRows={3}
                          emptyMessage="No abnormal recent Tier 1 inbound product spikes are visible right now."
                        />
                      </Box>
                    </Stack>
                  </Box>

                  <Stack spacing={0.85}>
                    <OpsValueTiles
                      columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }}
                      items={[
                        {
                          label: 'Flagged days',
                          value: formatCount(summary.t1InboundAnomalyCount || 0),
                          tone: (summary.t1InboundHighAnomalyCount || 0) > 0 ? '#ef4444' : '#8b5cf6',
                          helper: summary.t1InboundFocusStatusLabel || 'completed-day watch'
                        },
                        {
                          label: 'Ongoing spike',
                          value: summary.t1InboundFocusStatusLabel || 'Clear',
                          tone: summary.t1InboundFocusStatusTone || '#64748b',
                          helper: summary.t1InboundFocusLabel || 'no active focus'
                        },
                        {
                          label: 'Products hit',
                          value: formatCount(t1InboundAffectedServiceCount),
                          tone: '#f59e0b',
                          helper: 'distinct product groups'
                        },
                        {
                          label: 'Province hotspot',
                          value: t1RegionHotspot?.label || 'None',
                          tone: '#ea580c',
                          helper: t1RegionHotspot ? `${formatCount(t1RegionHotspot.count)} live rows` : 'no regional hotspot',
                          valueSx: { fontSize: '0.92rem', lineHeight: 1.08, wordBreak: 'break-word' }
                        },
                        {
                          label: 'ISP hotspot',
                          value: t1OrganisationHotspot?.label || 'None',
                          tone: '#2563eb',
                          helper: t1OrganisationHotspot ? `${formatCount(t1OrganisationHotspot.count)} live rows` : 'no ISP hotspot',
                          valueSx: { fontSize: '0.92rem', lineHeight: 1.08, wordBreak: 'break-word' }
                        },
                        {
                          label: 'Node hotspot',
                          value: t1NodeHotspot?.label || 'None',
                          tone: '#0f766e',
                          helper: t1NodeHotspot ? `${formatCount(t1NodeHotspot.count)} live rows` : 'no node hotspot',
                          valueSx: { fontSize: '0.92rem', lineHeight: 1.08, wordBreak: 'break-word' }
                        },
                        {
                          label: 'OLT hotspot',
                          value: t1OltHotspot?.label || 'None',
                          tone: '#7c3aed',
                          helper: t1OltHotspot ? `${formatCount(t1OltHotspot.count)} live rows` : 'no OLT hotspot',
                          valueSx: { fontSize: '0.92rem', lineHeight: 1.08, wordBreak: 'break-word' }
                        },
                        {
                          label: 'Voice queue',
                          value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Waiting || 0) : '--',
                          tone: summary.telephonyTier1SlaBreached ? '#ef4444' : '#06b6d4',
                          helper: summary.telephonyTier1SlaBreached ? 'outside 20s target' : 'within target'
                        }
                      ]}
                    />

                    <OpsSubPanel title="Inbound pattern" subtitle="Recent completed-day spike profile." tone="#8b5cf6">
                      <MultiLineChartPanel
                        rows={t1InboundAnomalyTrendRows}
                        lines={t1InboundAnomalyTrendLines.slice(0, 3)}
                        emptyMessage="No Tier 1 inbound anomaly trend is available right now."
                        height={184}
                        showLegend
                        xAxisLabel="Completed day"
                        yAxisLabel="Tickets"
                      />
                    </OpsSubPanel>
                  </Stack>
                </Box>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.05fr 0.95fr' }, gap: 0.85, alignItems: 'stretch' }}>
                  <Box
                    sx={{
                      p: 0.95,
                      borderRadius: OPS_RADIUS_MD,
                      border: `1px solid ${alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#ef4444' : '#14b8a6', 0.24)}`,
                      bgcolor: 'rgba(255, 255, 255, 0.96)',
                      background: `linear-gradient(135deg, ${alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#ef4444' : '#14b8a6', 0.1)} 0%, rgba(255, 255, 255, 0.98) 62%)`
                    }}
                  >
                    <Stack spacing={0.72}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} justifyContent="space-between">
                        <Stack spacing={0.18}>
                          <Typography variant="caption" sx={{ color: alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#ef4444' : '#14b8a6', 0.92), textTransform: 'uppercase', letterSpacing: 0.62, fontWeight: 800 }}>
                            Current watch
                          </Typography>
                          <Typography variant="h5" sx={{ color: OPS_TEXT, fontWeight: 900, lineHeight: 1.02, letterSpacing: -0.28 }}>
                            {summary.t1InboundFocusLabel
                              ? `${summary.t1InboundFocusLabel} | ${summary.t1InboundFocusStatusLabel || 'Flagged'}`
                              : 'No major inbound anomaly right now'}
                          </Typography>
                          <Typography variant="body2" sx={{ color: OPS_MUTED, lineHeight: 1.28, maxWidth: 620 }}>
                            {summary.t1InboundFocusStatusDetail || 'Completed-day inbound spikes are clear right now.'}
                          </Typography>
                        </Stack>
                  <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap" alignItems="flex-start">
                          <SignalChip label={summary.t1InboundFocusStatusLabel || 'Clear'} tone={summary.t1InboundFocusStatusTone || '#14b8a6'} />
                          <SignalChip label={summary.telephonyTier1SlaBreached ? 'Voice outside SLA' : 'Voice within SLA'} tone={summary.telephonyTier1SlaBreached ? '#ef4444' : '#06b6d4'} />
                          {t1RegionHotspot ? <SignalChip label={t1RegionHotspot.label} tone="#f59e0b" /> : null}
                          {t1OrganisationHotspot ? <SignalChip label={t1OrganisationHotspot.label} tone="#2563eb" /> : null}
                          {t1NodeHotspot ? <SignalChip label={t1NodeHotspot.label} tone="#0f766e" /> : null}
                          {t1OltHotspot ? <SignalChip label={t1OltHotspot.label} tone="#7c3aed" /> : null}
                        </Stack>
                      </Stack>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 0.68 }}>
                        <ConsoleLaneTile
                          label="Flagged days"
                          count={summary.t1InboundAnomalyCount || 0}
                          tone={(summary.t1InboundHighAnomalyCount || 0) > 0 ? '#ef4444' : '#8b5cf6'}
                          detail={summary.t1InboundFocusStatusLabel || 'completed-day watch'}
                          helper="recent anomaly days"
                          percent={Math.min(100, Number(summary.t1InboundAnomalyCount || 0) * 25)}
                          active={(summary.t1InboundAnomalyCount || 0) > 0}
                        />
                        <ConsoleLaneTile
                          label="Still high"
                          count={summary.t1InboundHighAnomalyCount || 0}
                          tone={summary.t1InboundFocusStatusTone || '#64748b'}
                          detail={summary.t1InboundFocusLabel || 'no active focus'}
                          helper="lingering elevated days"
                          percent={Math.min(100, Number(summary.t1InboundHighAnomalyCount || 0) * 50)}
                          active={(summary.t1InboundHighAnomalyCount || 0) > 0}
                        />
                        <ConsoleLaneTile
                          label="Products hit"
                          count={t1InboundAffectedServiceCount}
                          tone="#f59e0b"
                          detail="distinct product groups"
                          helper="spread of anomaly pattern"
                          percent={Math.min(100, Number(t1InboundAffectedServiceCount || 0) * 25)}
                          active={t1InboundAffectedServiceCount > 1}
                        />
                        <ConsoleLaneTile
                          label="Node hotspot"
                          count={t1NodeHotspot?.count || 0}
                          tone="#0f766e"
                          detail={t1NodeHotspot?.label || 'No node hotspot'}
                          helper={t1NodeHotspot ? 'live Tier 1 node cluster' : 'no repeated node pattern'}
                          percent={summary.tier1Open ? ((t1NodeHotspot?.count || 0) / summary.tier1Open) * 100 : 0}
                          active={(t1NodeHotspot?.count || 0) > 1}
                        />
                        <ConsoleLaneTile
                          label="OLT hotspot"
                          count={t1OltHotspot?.count || 0}
                          tone="#7c3aed"
                          detail={t1OltHotspot?.label || 'No OLT hotspot'}
                          helper={t1OltHotspot ? 'live Tier 1 OLT cluster' : 'no repeated OLT pattern'}
                          percent={summary.tier1Open ? ((t1OltHotspot?.count || 0) / summary.tier1Open) * 100 : 0}
                          active={(t1OltHotspot?.count || 0) > 1}
                        />
                        <ConsoleLaneTile
                          label="Voice queue"
                          count={tier1VoiceQueue ? (summary.telephonyTier1Waiting || 0) : 0}
                          tone={summary.telephonyTier1SlaBreached ? '#ef4444' : '#06b6d4'}
                          detail={tier1VoiceQueue ? `${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)} max queue` : 'queue unavailable'}
                          helper={summary.telephonyTier1SlaBreached ? 'outside 20s target' : 'within target'}
                          percent={summary.telephonyTier1SlaBreached ? 100 : Math.min(100, Number(summary.telephonyTier1MaxQueueSeconds || 0) / 20 * 100)}
                          active={!!summary.telephonyTier1SlaBreached}
                        />
                      </Box>
                    </Stack>
                  </Box>

                  <OpsSubPanel title="Inbound pattern" subtitle="Recent completed-day spike profile." tone="#8b5cf6">
                    <ConsoleSparklinePanel
                      rows={t1InboundAnomalyTrendRows}
                      lines={t1InboundAnomalyTrendLines.slice(0, 3)}
                      emptyMessage="No Tier 1 inbound anomaly trend is available right now."
                      height={148}
                    />
                  </OpsSubPanel>
                </Box>
              )}
            </OpsSection>
          </Box>

          <OpsSection
            title={(
              <Stack direction="row" spacing={0.7} alignItems="center">
                <RouteRoundedIcon sx={{ fontSize: 18, color: '#f97316' }} />
                <Box component="span">Live Command Board</Box>
              </Stack>
            )}
            subtitle="Primary lanes, side pressure, and queue ownership in one live Tier 1 command surface."
            tone="#334155"
            minHeight={0}
            bodySx={t1CommandExpanded ? undefined : { display: 'none' }}
            action={(
              <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                <SignalChip label={`${formatCount(summary.tier1P1Unattended || 0)} P1`} tone="#ef4444" />
                <SignalChip label={`${formatCount(summary.tier1PlayClockBreached || 0)} breached`} tone="#f97316" />
                <SignalChip label={`${formatCount(summary.tier1ParkedTimers || 0)} parked`} tone="#475569" />
                <SectionCollapseButton expanded={t1CommandExpanded} onClick={() => setT1CommandExpanded((current) => !current)} />
              </Stack>
            )}
          >
            {t1CommandExpanded ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.06fr 0.94fr' }, gap: 0.92, alignItems: 'start' }}>
              <OpsSubPanel
                title="Action Floor"
                subtitle="Primary lanes first. Side pressure is folded underneath."
                tone="#f97316"
                rootSx={{ p: 0, border: 'none', bgcolor: 'transparent', background: 'transparent', boxShadow: 'none' }}
              >
                <Stack spacing={0.85}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 0.78 }}>
                    {t1PrimaryLaneTileRows.map((row) => {
                      const drawerKey = row.key === 'P1' ? 'p1' : 'urgent'
                      const preset = row.key === 'P1' ? 'p1Only' : 'dueNow'
                      const nextFilters = row.key === 'P1' ? { pLevel: 'P1' } : { pLevel: row.key }
                      return (
                        <ConsoleLaneTile
                          key={row.key || row.label}
                          label={row.label}
                          count={row.count}
                          tone={row.tone || ACCENT}
                          detail={`${formatCount(row.breached || 0)} breached | ${formatCount(row.dueSoon || 0)} soon | ${formatCount(row.safe || 0)} safe`}
                          helper={`${row.playPolicyTitle || row.label} | ${row.playTargetMinutes || '--'}m target`}
                          percent={row.percent}
                          active={row.key === 'P1' ? (summary.tier1P1Breached || 0) > 0 : Number(row.breached || 0) > 0}
                          badge={row.playTargetMinutes ? `${row.playTargetMinutes}m` : 'live'}
                          onClick={() => openT1WorkbenchDrawer(drawerKey, preset, nextFilters)}
                        />
                      )
                    })}
                  </Box>

                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.92fr 1.08fr' }, gap: 0.82, alignItems: 'start' }}>
                    <OpsSubPanel title="Side pressure" subtitle="Parked, change, and non-play work kept visible but quieter." tone="#475569">
                      {t1SupportActionRows.length ? (
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 0.68 }}>
                          {t1SupportActionRows.map((row) => (
                            <ConsoleLaneRail
                              key={row.key || row.label}
                              label={row.label}
                              count={row.count}
                              tone={row.tone || '#64748b'}
                              percent={summary.tier1Open ? (Number(row.count || 0) / Number(summary.tier1Open || 1)) * 100 : 0}
                              detail={row.playTargetMinutes
                                ? `${formatCount(row.breached || 0)} breached | ${formatCount(row.dueSoon || 0)} closing soon`
                                : `${formatCount(row.noActiveTimer || 0)} no active play clock`}
                              helper={row.playTargetMinutes ? `${row.playPolicyTitle || row.label}` : `${formatCount(row.count || 0)} open rows`}
                              active={row.key === 'Change' ? Number(row.count || 0) > 0 : false}
                            />
                          ))}
                        </Box>
                      ) : (
                        <AnalyticsChartFallback minHeight={180} message="No side-lane pressure is visible right now." />
                      )}
                    </OpsSubPanel>

                    <OpsSubPanel title="Lane pressure mix" subtitle="Primary versus side-lane concentration right now." tone="#475569">
                      <Stack spacing={0.8}>
                        <DonutBreakdownChart
                          rows={t1ActionMixRows}
                          dataKey="count"
                          emptyMessage="No queue mix is available right now."
                          colorMap={Object.fromEntries(t1ActionMixRows.map((row) => [row.key, row.tone || ACCENT]))}
                          height={232}
                        />
                        <OpsValueTiles
                          columns={{ xs: 'repeat(2, minmax(0, 1fr))' }}
                          items={[
                            {
                              label: 'Clocks breached',
                              value: formatCount(summary.tier1PlayClockBreached || 0),
                              tone: '#f97316',
                              helper: 'active work already late'
                            },
                            {
                              label: 'Closing soon',
                              value: formatCount(summary.tier1PlayClockDueSoon || 0),
                              tone: '#f59e0b',
                              helper: 'next timer window'
                            },
                            {
                              label: 'Parked timers',
                              value: formatCount(summary.tier1ParkedTimers || 0),
                              tone: '#64748b',
                              helper: `${formatCount(t1ParkedP3Count)} P3 | ${formatCount(t1ParkedP4Count)} P4`
                            },
                            {
                              label: 'Change control',
                              value: formatCount(summary.tier1ChangeControlOpen || 0),
                              tone: '#8b5cf6',
                              helper: 'separate operating lane'
                            }
                          ]}
                        />
                      </Stack>
                    </OpsSubPanel>
                  </Box>
                </Stack>
              </OpsSubPanel>

              <OpsSubPanel
                title="Queue Posture"
                subtitle="Read the queue by ownership first, then switch the lens."
                tone="#3b82f6"
                rootSx={{ p: 0, border: 'none', bgcolor: 'transparent', background: 'transparent', boxShadow: 'none' }}
                action={(
                  <ConsoleToggleStrip
                    value={t1PostureLens}
                    onChange={setT1PostureLens}
                    options={[
                      { value: 'workflowOwner', label: 'Owner', tone: '#14b8a6' },
                      { value: 'operationalState', label: 'State', tone: '#3b82f6' },
                      { value: 'escalationPath', label: 'Path', tone: '#8b5cf6' },
                      { value: 'automation', label: 'Automation', tone: '#7c3aed' }
                    ]}
                  />
                )}
              >
                <Stack spacing={0.82}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 0.78 }}>
                    <ConsoleLaneTile
                      label="Desk-owned"
                      count={summary.tier1WithDesk || 0}
                      tone="#14b8a6"
                      detail={`${formatCount(t1DeskUrgentCount)} urgent | ${formatCount(t1DeskP1Count)} P1`}
                      helper="with Tier 1 right now"
                      percent={summary.tier1Open ? ((summary.tier1WithDesk || 0) / summary.tier1Open) * 100 : 0}
                      active={t1DeskUrgentCount > 0}
                      onClick={() => setT1PostureLens('workflowOwner')}
                    />
                    <ConsoleLaneTile
                      label="Maintenance"
                      count={summary.tier1WithMaintenance || 0}
                      tone="#3b82f6"
                      detail={`${formatCount(t1MaintenanceBreachedCount)} breached | ${formatCount(t1MaintenanceTrackedCount)} tracked`}
                      helper="largest external holder"
                      percent={summary.tier1Open ? ((summary.tier1WithMaintenance || 0) / summary.tier1Open) * 100 : 0}
                      active={t1MaintenanceBreachedCount > 0}
                      onClick={() => setT1PostureLens('escalationPath')}
                    />
                    <ConsoleLaneTile
                      label="Waiting client"
                      count={summary.tier1WaitingClient || 0}
                      tone="#f97316"
                      detail={`${formatCount(t1ClientPendingOnHoldCount)} on hold | ${formatCount(t1ClientPendingUrgentCount)} urgent`}
                      helper="ISP / client pending"
                      percent={summary.tier1Open ? ((summary.tier1WaitingClient || 0) / summary.tier1Open) * 100 : 0}
                      active={t1ClientPendingUrgentCount > 0}
                      onClick={() => setT1PostureLens('workflowOwner')}
                    />
                    <ConsoleLaneTile
                      label="Parked timers"
                      count={summary.tier1ParkedTimers || 0}
                      tone="#64748b"
                      detail={`${formatCount(t1ParkedP3Count)} P3 | ${formatCount(t1ParkedP4Count)} P4`}
                      helper="pre-play timer buckets"
                      percent={summary.tier1Open ? ((summary.tier1ParkedTimers || 0) / summary.tier1Open) * 100 : 0}
                      active={Number(summary.tier1ParkedTimers || 0) > 0}
                      onClick={() => setT1PostureLens('workflowOwner')}
                    />
                  </Box>

                  <OpsSubPanel title={`${t1ActivePostureLens.label} leaderboard`} subtitle="Top live lanes under the selected ownership lens." tone={t1ActivePostureLens.tone}>
                    <Stack spacing={0.82}>
                      <HorizontalBarChart
                        rows={t1ActivePostureLens.rows.slice(0, 6)}
                        dataKey="count"
                        emptyMessage={`No ${t1ActivePostureLens.label.toLowerCase()} shape is available right now.`}
                        colorMap={Object.fromEntries((t1ActivePostureLens.rows || []).map((row) => [row.key, row.tone || t1ActivePostureLens.tone]))}
                        height={246}
                      />
                      <OpsValueTiles
                        columns={{ xs: 'repeat(2, minmax(0, 1fr))' }}
                        items={(t1ActivePostureLens.rows || []).slice(0, 4).map((row) => ({
                          label: row.label,
                          value: formatCount(row.count || 0),
                          tone: row.tone || t1ActivePostureLens.tone,
                          helper: t1ActivePostureLens.secondaryText(row)
                        }))}
                      />
                    </Stack>
                  </OpsSubPanel>
                </Stack>
              </OpsSubPanel>
            </Box>
            ) : null}
          </OpsSection>

          <OpsSection
            title={(
              <Stack direction="row" spacing={0.7} alignItems="center">
                <LanRoundedIcon sx={{ fontSize: 18, color: '#0891b2' }} />
                <Box component="span">Premises Hotspots</Box>
              </Stack>
            )}
            subtitle="Customer Premises Alias clustering from the current filtered Tier 1 queue, with cached map placement when aliases resolve."
            tone="#0891b2"
            minHeight={0}
          >
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.12fr 0.88fr' }, gap: 0.92, alignItems: 'start' }}>
              <OpsSubPanel
                title="Bubble map"
                subtitle="Repeated premises aliases plotted from cached server-side geocodes."
                tone="#0891b2"
                action={(
                  <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                    <SignalChip label={`${formatCount(t1PremisesClusters.length)} aliases`} tone="#0891b2" />
                    <SignalChip label={`${formatCount(t1PremisesMappedCount)} mapped`} tone="#16a34a" />
                    <SignalChip label={`${formatCount(t1PremisesUnmappedCount)} pending`} tone="#64748b" />
                  </Stack>
                )}
              >
                <Stack spacing={0.82}>
                  <OpsValueTiles
                    columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }}
                    items={[
                      {
                        label: 'Filtered aliases',
                        value: formatCount(t1PremisesClusters.length),
                        tone: '#0891b2',
                        helper: 'distinct premises in current queue lens'
                      },
                      {
                        label: 'Mapped aliases',
                        value: formatCount(t1PremisesMappedCount),
                        tone: '#16a34a',
                        helper: 'ready for bubble plotting'
                      },
                      {
                        label: 'Pending matches',
                        value: formatCount(t1PremisesUnmappedCount),
                        tone: '#64748b',
                        helper: t1PremisesMapPayload?.geocodingEnabled ? 'still resolving or unmatched' : 'geocoding currently off'
                      },
                      {
                        label: 'Top hotspot',
                        value: formatCount(t1PremisesHotspot?.count || 0),
                        tone: '#f97316',
                        helper: t1PremisesHotspot?.label || 'no repeated alias in current queue'
                      }
                    ]}
                  />

                  {t1PremisesMapError ? (
                    <OpsAlert severity="warning">
                      {t1PremisesMapError}
                    </OpsAlert>
                  ) : null}

                  {t1PremisesMapLoading ? (
                    <AnalyticsLoadingBlock minHeight={360} message="Loading Tier 1 premises hotspot map..." />
                  ) : t1PremisesMapMarkers.length ? (
                    <Box sx={{ height: 360, borderRadius: OPS_RADIUS_MD, overflow: 'hidden', border: `1px solid ${OPS_BORDER}` }}>
                      <MapContainer center={[-29, 24]} zoom={5} minZoom={4} style={{ height: '100%', width: '100%' }} zoomControl>
                        <TileLayer
                          attribution='&copy; OpenStreetMap contributors'
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        <PremisesHotspotMapFit markers={t1PremisesMapMarkers} />
                        {t1PremisesMapMarkers.map((marker) => {
                          const tone = marker.count >= 4 ? '#dc2626' : marker.count >= 2 ? '#f59e0b' : '#0891b2'
                          const radius = Math.max(8, Math.min(24, 8 + Math.sqrt(Number(marker.count || 0)) * 3))
                          return (
                            <CircleMarker
                              key={marker.key}
                              center={[Number(marker.lat), Number(marker.lng)]}
                              radius={radius}
                              pathOptions={{
                                color: tone,
                                fillColor: tone,
                                fillOpacity: 0.42,
                                weight: 2
                              }}
                            >
                              <LeafletTooltip direction="top" offset={[0, -6]} opacity={0.95}>
                                {marker.label} | {formatCount(marker.count)} tickets
                              </LeafletTooltip>
                              <LeafletPopup>
                                <Stack spacing={0.7} sx={{ minWidth: 220 }}>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                                    {marker.label}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {marker.formattedAddress || marker.label}
                                  </Typography>
                                  <Typography variant="body2">
                                    {formatCount(marker.count)} tickets | {marker.organizationLabel || 'Unknown organisation'}
                                  </Typography>
                                  <Typography variant="body2">
                                    {marker.province || marker.region || 'Unknown province'} | {marker.nodeName || 'Unknown node'} | {marker.olt || 'Unknown OLT'}
                                  </Typography>
                                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {marker.tickets?.[0]?.id ? `Lead ticket #${marker.tickets[0].id}` : 'No lead ticket preview'}
                                  </Typography>
                                </Stack>
                              </LeafletPopup>
                            </CircleMarker>
                          )
                        })}
                      </MapContainer>
                    </Box>
                  ) : (
                    <AnalyticsChartFallback
                      minHeight={360}
                      message={
                        t1PremisesClusters.length
                          ? (t1PremisesMapPayload?.geocodingEnabled
                            ? 'Premises aliases exist in the queue, but no map matches have resolved yet.'
                            : 'Premises aliases are present, but geocoding is not configured on the API yet.')
                          : 'No customer premises aliases are present in the current filtered Tier 1 queue.'
                      }
                    />
                  )}
                </Stack>
              </OpsSubPanel>

              <Stack spacing={0.82}>
                <OpsSubPanel
                  title="Hotspot table"
                  subtitle="Top repeated premises aliases in the current filtered queue."
                  tone="#14b8a6"
                  action={(
                    <RowWindowSelector value={t1PremisesHotspotLimit} onChange={setT1PremisesHotspotLimit} options={[5, 10, 20, 'all']} />
                  )}
                >
                  <MonitoringTable
                    rows={t1PremisesVisibleClusters}
                    columns={t1PremisesHotspotColumns}
                    emptyMessage="No customer premises aliases are available in the current Tier 1 queue lens."
                  />
                </OpsSubPanel>

                <OpsSubPanel
                  title="Pending map matches"
                  subtitle="Aliases still waiting on a location match or address cleanup."
                  tone="#475569"
                  action={(
                    <SignalChip
                      label={t1PremisesMapPayload?.geocodingEnabled ? 'Geocoding live' : 'Geocoding off'}
                      tone={t1PremisesMapPayload?.geocodingEnabled ? '#16a34a' : '#64748b'}
                    />
                  )}
                >
                  {(t1PremisesMapPayload?.unresolved || []).length ? (
                    <Stack spacing={0.65}>
                      {(t1PremisesMapPayload?.unresolved || []).slice(0, 6).map((row) => (
                        <Box
                          key={row.key}
                          sx={{
                            p: 0.8,
                            borderRadius: OPS_RADIUS_SM,
                            border: `1px solid ${alpha('#64748b', 0.25)}`,
                            background: alpha('#f8fafc', 0.92)
                          }}
                        >
                          <Stack direction="row" justifyContent="space-between" spacing={0.8} alignItems="center">
                            <Typography variant="body2" sx={{ fontWeight: 800, maxWidth: 260, whiteSpace: 'normal', lineHeight: 1.25 }}>
                              {row.label}
                            </Typography>
                            <SignalChip label={formatCount(row.count || 0)} tone="#64748b" />
                          </Stack>
                          <Typography variant="caption" sx={{ display: 'block', mt: 0.35, color: OPS_MUTED }}>
                            {row.reason || 'Pending geocode resolution'}
                          </Typography>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <AnalyticsChartFallback
                      minHeight={120}
                      message={t1PremisesClusters.length ? 'All visible premises aliases that could be mapped have resolved cleanly.' : 'No premises aliases need map matching right now.'}
                    />
                  )}
                </OpsSubPanel>
              </Stack>
            </Box>
          </OpsSection>

          <OpsSection
            title={(
              <Stack direction="row" spacing={0.7} alignItems="center">
                <InsightsRoundedIcon sx={{ fontSize: 18, color: '#14b8a6' }} />
                <Box component="span">Tempo + Workbench</Box>
              </Stack>
            )}
            subtitle="Historic drift, day pace, and one-click routes into the live queue."
            tone="#334155"
            minHeight={0}
            bodySx={t1TempoExpanded ? undefined : { display: 'none' }}
            action={(
              <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                <SignalChip label={`${formatCount(summary.t1ReceivedToday || 0)} received`} tone="#0f766e" />
                <SignalChip label={`${formatCount(summary.t1SolvedToday || 0)} solved`} tone="#16a34a" />
                <SignalChip label={`${formatCount((t1AutomationCreatedTodaySummary || []).reduce((total, row) => total + Number(row.count || 0), 0))} automation`} tone="#8b5cf6" />
                <SectionCollapseButton expanded={t1TempoExpanded} onClick={() => setT1TempoExpanded((current) => !current)} />
              </Stack>
            )}
          >
            {t1TempoExpanded ? (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.08fr 0.92fr' }, gap: 0.92, alignItems: 'start' }}>
              <OpsSubPanel
                title="Ops Drift"
                subtitle="History and drift in one panel."
                tone="#14b8a6"
                rootSx={{ p: 0, border: 'none', bgcolor: 'transparent', background: 'transparent', boxShadow: 'none' }}
                action={(
                  <ConsoleToggleStrip
                    value={t1TrendLens}
                    onChange={setT1TrendLens}
                    options={[
                      { value: 'queue', label: 'Queue', tone: '#14b8a6' },
                      { value: 'received', label: 'Received', tone: '#0f766e' },
                      { value: 'solved', label: 'Solved', tone: '#22c55e' },
                      { value: 'voice', label: 'Voice', tone: '#06b6d4' }
                    ]}
                  />
                )}
              >
                <Stack spacing={0.82}>
                  <MultiLineChartPanel
                    rows={t1ActiveTrendLens.rows}
                    lines={t1ActiveTrendLens.lines}
                    emptyMessage={t1ActiveTrendLens.emptyMessage}
                    showLegend={false}
                    height={248}
                  />
                  <OpsValueTiles
                    columns={{ xs: `repeat(${Math.min(Math.max(t1ActiveTrendLens.summaryItems.length, 2), 4)}, minmax(0, 1fr))` }}
                    items={t1ActiveTrendLens.summaryItems}
                  />
                </Stack>
              </OpsSubPanel>

              <OpsSubPanel title="Desk Control" subtitle="Daily pace, queue access, and one-click drill routes." tone="#8b5cf6" rootSx={{ p: 0, border: 'none', bgcolor: 'transparent', background: 'transparent', boxShadow: 'none' }}>
                <Stack spacing={0.9}>
                  <OpsSubPanel title="Day pace" subtitle="Today versus the same weekday and automation touch." tone="#14b8a6">
                    <OpsValueTiles
                      columns={{ xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }}
                      items={t1DeskCompareTiles}
                    />
                  </OpsSubPanel>

                  <OpsSubPanel title="Workbench launch" subtitle="Fast routes into the live queue." tone="#8b5cf6">
                    <Stack spacing={0.82}>
                      <OpsValueTiles
                        columns={{ xs: 'repeat(2, minmax(0, 1fr))' }}
                        items={[
                          {
                            label: 'Live queue',
                            value: formatCount(summary.tier1Open || 0),
                            tone: '#14b8a6',
                            helper: 'all open Tier 1 rows'
                          },
                          {
                            label: 'Filtered',
                            value: formatCount(t1FilteredActionViewRows.length),
                            tone: '#3b82f6',
                            helper: 'current filter result'
                          },
                          {
                            label: 'Desk-owned',
                            value: formatCount(t1DeskRows.length),
                            tone: '#14b8a6',
                            helper: 'with Tier 1 now'
                          },
                          {
                            label: 'Urgent',
                            value: formatCount(t1DueNowRows.length),
                            tone: '#f59e0b',
                            helper: 'breached or closing soon'
                          }
                        ]}
                      />
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 0.65 }}>
                        <DrillCounterButton label="Desk-owned" count={t1DeskRows.length} helper="with Tier 1" tone="#14b8a6" onClick={() => openT1WorkbenchDrawer('desk', 'deskOwned')} />
                        <DrillCounterButton label="Maintenance" count={t1MaintenanceRows.length} helper="external lane" tone="#3b82f6" onClick={() => openT1WorkbenchDrawer('maintenance', 'maintenanceOwned')} />
                        <DrillCounterButton label="Waiting client" count={t1ClientPendingRows.length} helper="ISP / client pending" tone="#f97316" onClick={() => openT1WorkbenchDrawer('client', 'all', { workflowOwner: 'Waiting on client / ISP' })} />
                        <DrillCounterButton label="P1 queue" count={t1P1AttentionRows.length} helper="first-touch focus" tone="#ef4444" onClick={() => openT1WorkbenchDrawer('p1', 'p1Only', { systemState: 'new' })} />
                        <DrillCounterButton label="Urgent timers" count={t1DueNowRows.length} helper="closing soon" tone="#f59e0b" onClick={() => openT1WorkbenchDrawer('urgent', 'dueNow')} />
                        <DrillCounterButton label="Parked" count={t1ParkedRows.length} helper="pre-play queues" tone="#64748b" onClick={() => openT1WorkbenchDrawer('parked', 'parkedTimers')} />
                      </Box>

                      <Button
                        variant={t1WorkbenchExpanded ? 'outlined' : 'contained'}
                        onClick={() => {
                          const next = !t1WorkbenchExpanded
                          setT1WorkbenchExpanded(next)
                          if (!next) {
                            setT1WorkbenchDrawer('none')
                          }
                        }}
                        sx={{
                          borderRadius: OPS_RADIUS_SM,
                          textTransform: 'none',
                          fontWeight: 800,
                          alignSelf: 'stretch'
                        }}
                      >
                        {t1WorkbenchExpanded ? 'Hide workbench' : 'Open workbench'}
                      </Button>
                    </Stack>
                  </OpsSubPanel>
                </Stack>
              </OpsSubPanel>
            </Box>
            ) : null}
          </OpsSection>
          <Collapse in={t1WorkbenchExpanded} timeout={220} unmountOnExit={false}>
            <Box ref={t1ActionViewRef}>
              <OpsSection title="Tier 1 Workbench" subtitle="Filtered live queue once the command view points you to a lane." tone="#14b8a6" minHeight={0}>
                <Stack spacing={0.9}>
                  <OpsSubPanel
                    title="Workbench controls"
                    subtitle="Pick the lane first, then narrow the queue with filters."
                    tone="#14b8a6"
                    action={(
                      <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignSelf={{ xs: 'stretch', md: 'flex-start' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setT1ShowAdvancedFilters((current) => !current)}
                          sx={{
                            minWidth: 0,
                            px: 1.1,
                            py: 0.25,
                            color: '#cbd5e1',
                            borderColor: 'rgba(148, 163, 184, 0.24)'
                          }}
                        >
                          {t1ShowAdvancedFilters ? 'Hide advanced' : 'Advanced filters'}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<DownloadRoundedIcon />}
                          onClick={handleExportT1ActionView}
                          disabled={exportingT1Action || !t1FilteredActionViewRows.length}
                          sx={{
                            minWidth: 0,
                            px: 1.1,
                            py: 0.25,
                            color: '#cbd5e1',
                            borderColor: 'rgba(148, 163, 184, 0.24)'
                          }}
                        >
                          {exportingT1Action ? 'Exporting...' : 'Export filtered'}
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={resetT1ActionFilters}
                          sx={{
                            minWidth: 0,
                            px: 1.1,
                            py: 0.25,
                            color: '#cbd5e1',
                            borderColor: 'rgba(148, 163, 184, 0.24)'
                          }}
                        >
                          Reset filters
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => {
                            setT1WorkbenchExpanded(false)
                            setT1WorkbenchDrawer('none')
                          }}
                          sx={{
                            minWidth: 0,
                            px: 1.1,
                            py: 0.25,
                            color: '#cbd5e1',
                            borderColor: 'rgba(148, 163, 184, 0.24)'
                          }}
                        >
                          Hide workbench
                        </Button>
                      </Stack>
                    )}
                  >
                    <Stack spacing={0.85}>
                      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(6, minmax(0, 1fr))' }, gap: 0.7 }}>
                        <DrillCounterButton label="Desk-owned" count={t1DeskRows.length} helper="with Tier 1" tone="#14b8a6" onClick={() => openT1WorkbenchDrawer('desk', 'deskOwned')} />
                        <DrillCounterButton label="Maintenance" count={t1MaintenanceRows.length} helper="external lane" tone="#3b82f6" onClick={() => openT1WorkbenchDrawer('maintenance', 'maintenanceOwned')} />
                        <DrillCounterButton label="Waiting client" count={t1ClientPendingRows.length} helper="ISP / client pending" tone="#f97316" onClick={() => openT1WorkbenchDrawer('client', 'all', { workflowOwner: 'Waiting on client / ISP' })} />
                        <DrillCounterButton label="P1 queue" count={t1P1AttentionRows.length} helper="first-touch focus" tone="#ef4444" onClick={() => openT1WorkbenchDrawer('p1', 'p1Only', { systemState: 'new' })} />
                        <DrillCounterButton label="Urgent timers" count={t1DueNowRows.length} helper="closing soon" tone="#f59e0b" onClick={() => openT1WorkbenchDrawer('urgent', 'dueNow')} />
                        <DrillCounterButton label="Parked" count={t1ParkedRows.length} helper="pre-play queues" tone="#64748b" onClick={() => openT1WorkbenchDrawer('parked', 'parkedTimers')} />
                      </Box>
                      <FilterChipGroup
                        label="Quick presets"
                        value={t1QuickPreset}
                        onChange={setT1QuickPreset}
                        options={T1_PRESETS.filter((preset) => preset.key !== 'all').map((preset) => preset.key)}
                        tone={T1_PRESET_TONE_MAP[t1QuickPreset] || '#14b8a6'}
                        anyCount={t1QuickPresetCounts.all}
                        countMap={t1QuickPresetCounts}
                        labelFormatter={(presetKey) => T1_PRESETS.find((preset) => preset.key === presetKey)?.label || presetKey}
                        anyLabel="All queue"
                      />
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' },
                          gap: 0.9
                        }}
                      >
                        <FilterChipGroup
                          label="Action lane"
                          value={t1ActionFilters.pLevel}
                          onChange={(next) => setT1ActionFilters((current) => ({ ...current, pLevel: next }))}
                          options={t1PLevelOptions}
                          tone="#14b8a6"
                          countMap={t1PLevelCountMap}
                          anyCount={t1FilterAnyCounts.pLevel}
                        />
                        <FilterChipGroup
                          label="Clock state"
                          value={t1ActionFilters.dueBucket}
                          onChange={(next) => setT1ActionFilters((current) => ({ ...current, dueBucket: next }))}
                          options={t1DueBucketOptions}
                          tone="#f97316"
                          countMap={t1DueBucketCountMap}
                          anyCount={t1FilterAnyCounts.dueBucket}
                        />
                        <FilterChipGroup
                          label="Workflow owner"
                          value={t1ActionFilters.workflowOwner}
                          onChange={(next) => setT1ActionFilters((current) => ({ ...current, workflowOwner: next }))}
                          options={t1WorkflowOwnerOptions}
                          tone="#14b8a6"
                          countMap={t1WorkflowOwnerCountMap}
                          anyCount={t1FilterAnyCounts.workflowOwner}
                        />
                      </Box>
                      {t1ShowAdvancedFilters ? (
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: '1fr', xl: 'repeat(3, minmax(0, 1fr))' },
                            gap: 0.9
                          }}
                        >
                          <FilterChipGroup
                            label="Escalation path"
                            value={t1ActionFilters.escalationPath}
                            onChange={(next) => setT1ActionFilters((current) => ({ ...current, escalationPath: next }))}
                            options={t1EscalationPathOptions}
                            tone="#8b5cf6"
                            countMap={t1EscalationPathCountMap}
                            anyCount={t1FilterAnyCounts.escalationPath}
                          />
                          <FilterChipGroup
                            label="System state"
                            value={t1ActionFilters.systemState}
                            onChange={(next) => setT1ActionFilters((current) => ({ ...current, systemState: next }))}
                            options={t1SystemStateOptions}
                            tone="#3b82f6"
                            countMap={t1SystemStateCountMap}
                            anyCount={t1FilterAnyCounts.systemState}
                            labelFormatter={titleCaseWords}
                          />
                          <FilterChipGroup
                            label="Operational state"
                            value={t1ActionFilters.operationalState}
                            onChange={(next) => setT1ActionFilters((current) => ({ ...current, operationalState: next }))}
                            options={t1OperationalStateOptions}
                            tone="#8b5cf6"
                            countMap={t1OperationalStateCountMap}
                            anyCount={t1FilterAnyCounts.operationalState}
                          />
                          <Box sx={{ gridColumn: { xs: 'auto', xl: '1 / -1' } }}>
                            <FilterChipGroup
                              label="Automation route"
                              value={t1ActionFilters.automationRoute}
                              onChange={(next) => setT1ActionFilters((current) => ({ ...current, automationRoute: next }))}
                              options={t1AutomationRouteOptions}
                              tone="#8b5cf6"
                              countMap={t1AutomationRouteCountMap}
                              anyCount={t1FilterAnyCounts.automationRoute}
                            />
                          </Box>
                        </Box>
                      ) : null}
                    </Stack>
                  </OpsSubPanel>

                  {t1ActiveWorkbenchDrawer ? (
                    <OpsSubPanel
                      title={t1ActiveWorkbenchDrawer.label}
                      subtitle="Focused queue drawer opened from the command view."
                      tone={t1ActiveWorkbenchDrawer.tone}
                      action={t1ActiveWorkbenchDrawer.setLimit ? (
                        <RowWindowSelector
                          value={t1ActiveWorkbenchDrawer.limit}
                          onChange={t1ActiveWorkbenchDrawer.setLimit}
                          options={t1ActiveWorkbenchDrawer.key === 'urgent' ? [10, 20, 50, 'all'] : [5, 10, 20, 'all']}
                        />
                      ) : null}
                    >
                      <Stack spacing={0.75}>
                        <OpsValueTiles
                          columns={{ xs: `repeat(${Math.min(Math.max(t1ActiveWorkbenchDrawer.summaryItems.length, 2), 3)}, minmax(0, 1fr))`, xl: `repeat(${Math.min(Math.max(t1ActiveWorkbenchDrawer.summaryItems.length, 2), 3)}, minmax(0, 1fr))` }}
                          items={t1ActiveWorkbenchDrawer.summaryItems}
                        />
                        <MonitoringTable
                          rows={t1ActiveWorkbenchDrawer.visibleRows}
                          columns={t1FocusColumns}
                          emptyMessage={t1ActiveWorkbenchDrawer.emptyMessage}
                          getRowSx={getTier1UrgencyRowSx}
                        />
                      </Stack>
                    </OpsSubPanel>
                  ) : null}

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                    <Typography variant="caption" sx={{ color: OPS_MUTED }}>
                      Showing {formatCount(t1ActionViewVisibleRows.length)} of {formatCount(t1FilteredActionViewRows.length)} filtered rows from {formatCount(t1ActionViewRows.length)} live Tier 1 queue rows, sorted by play-clock pressure first.
                    </Typography>
                    <RowWindowSelector value={t1ActionViewLimit} onChange={setT1ActionViewLimit} options={[20, 50, 100, 'all']} />
                  </Stack>
                  <MonitoringTable rows={t1ActionViewVisibleRows} columns={t1ActionColumns} emptyMessage="No Tier 1 tickets are open right now." getRowSx={getTier1UrgencyRowSx} />
                </Stack>
              </OpsSection>
            </Box>
          </Collapse>
        </Box>
      ) : null}


      {tab === 'tier2' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' }, gap: 0.82 }}>
            {tier2CommandCards.map((item) => (
              <OpsPriorityCard key={item.label} {...item} />
            ))}
          </Box>

          <OpsSection
            title="Tier 2 Radar"
            subtitle="Intake pace, queue trend, and where Tier 2 backlog is concentrating."
            tone="#1d4ed8"
            minHeight={0}
            bodySx={tier2RadarExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={tier2RadarExpanded} onClick={() => setTier2RadarExpanded((current) => !current)} />}
          >
            {tier2RadarExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
                  <OpsSubPanel title="Tier 2 intake compare" subtitle="Today versus the same weekday on the prior two weeks." tone="#1d4ed8">
                    <MultiLineChartPanel
                      rows={t2ReceivedComparisonSeries}
                      lines={[
                        { key: 'today', label: 'Today', color: '#1d4ed8' },
                        { key: 'lastWeek', label: '7 days ago', color: '#60a5fa' },
                        { key: 'previousWeek', label: '14 days ago', color: '#bfdbfe' }
                      ]}
                      emptyMessage="No Tier 2 received comparison data is available right now."
                      height={220}
                    />
                  </OpsSubPanel>

                  <OpsSubPanel title="Tier 2 solved compare" subtitle="Today versus the same weekday on the prior two weeks." tone="#0891b2">
                    <MultiLineChartPanel
                      rows={t2SolvedComparisonSeries}
                      lines={[
                        { key: 'today', label: 'Today', color: '#0891b2' },
                        { key: 'lastWeek', label: '7 days ago', color: '#38bdf8' },
                        { key: 'previousWeek', label: '14 days ago', color: '#bae6fd' }
                      ]}
                      emptyMessage="No Tier 2 solved comparison data is available right now."
                      height={220}
                    />
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.05fr 0.95fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Tier 2 queue trend" subtitle={`Open queue, unattended rows, and handover drift over the last ${historyWindowLabel}.`} tone="#1d4ed8">
                    <MultiLineChartPanel
                      rows={historyTier2}
                      lines={[
                        { key: 'open', label: 'Open queue', color: '#1d4ed8' },
                        { key: 'unattended', label: 'New / unattended', color: '#dc2626' },
                        { key: 'handover', label: 'Handover', color: '#ea580c' }
                      ]}
                      emptyMessage="Tier 2 historical queue pressure will appear after more monitoring buckets land."
                      height={220}
                    />
                  </OpsSubPanel>

                  <OpsSubPanel title="Tier 2 daily flow" subtitle={`Hourly received versus solved flow for ${summary.dayKey || 'today'}.`} tone="#0f172a">
                    <MultiLineChartPanel
                      rows={hourlySeries}
                      lines={[
                        { key: 't2Received', label: 'T2 received', color: '#1d4ed8' },
                        { key: 't2Solved', label: 'T2 solved', color: '#60a5fa' }
                      ]}
                      emptyMessage="No Tier 2 flow data is available for the current ops day."
                      height={220}
                    />
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '0.86fr 0.86fr 1.28fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Tier 2 active by party" subtitle="Active Tier 2 work excluding pending and new." tone="#1d4ed8">
                    <VerticalBarChart rows={t2PartySummary} dataKey="count" emptyMessage="No active Tier 2 party breakdown is available right now." height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Tier 2 product split" subtitle="Open Tier 2 work grouped by product-tag logic." tone="#0f172a">
                    <SummaryStatBlock rows={t2ProductSummary} emptyMessage="No Tier 2 product split is available right now." />
                  </OpsSubPanel>

                  <OpsSubPanel title="Tier 2 age profile" subtitle="Open Tier 2 work bucketed by queue age." tone="#0f172a">
                    <VerticalBarChart rows={t2AgeBucketSummary} dataKey="count" emptyMessage="No Tier 2 age profile is available right now." colorMap={Object.fromEntries(t2AgeBucketSummary.map((row) => [row.key, row.tone]))} height={220} />
                  </OpsSubPanel>
                </Box>
              </Box>
            ) : null}
          </OpsSection>

          <OpsSection
            title="Tier 2 Workbench"
            subtitle="Service mix, immediate unattended work, handovers, and the full live queue."
            tone="#0f172a"
            minHeight={0}
            bodySx={tier2WorkbenchExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={tier2WorkbenchExpanded} onClick={() => setTier2WorkbenchExpanded((current) => !current)} />}
          >
            {tier2WorkbenchExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <OpsSubPanel title="Tier 2 service type" subtitle="Live Tier 2 queue grouped by service type from Zendesk fields." tone="#0891b2">
                  <HorizontalBarChart rows={t2ServiceTypeSummary} dataKey="count" emptyMessage="No Tier 2 service-type summary is available right now." height={220} />
                </OpsSubPanel>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Tier 2 new / unassigned" subtitle="Immediate unattended Tier 2 rows from the live snapshot." tone="#dc2626">
                    <MonitoringTable rows={collections.tier2NewUnassignedTickets || []} columns={t2Columns} emptyMessage="No new or unattended Tier 2 tickets are open right now." />
                  </OpsSubPanel>

                  <OpsSubPanel title="Tier 2 handover" subtitle="Open handover rows that used to sit in their own Grafana panel." tone="#ea580c">
                    <MonitoringTable rows={collections.tier2HandoverTickets || []} columns={t2Columns} emptyMessage="No handover Tier 2 rows are open right now." />
                  </OpsSubPanel>
                </Box>

                <OpsSubPanel title="Tier 2 open queue" subtitle="Full Tier 2 queue with ISP, province, party, and handover context." tone="#1d4ed8">
                  <MonitoringTable rows={collections.tier2Tickets || []} columns={t2Columns} emptyMessage="No Tier 2 tickets are open right now." />
                </OpsSubPanel>
              </Box>
            ) : null}
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'nld' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }, gap: 0.82 }}>
            {nldCommandCards.map((item) => (
              <OpsPriorityCard key={item.label} {...item} />
            ))}
          </Box>

          <OpsSection
            title="NLD Radar"
            subtitle="Partial-route pressure, repeat clusters, and outage logging watch."
            tone="#f97316"
            minHeight={0}
            bodySx={nldRadarExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={nldRadarExpanded} onClick={() => setNldRadarExpanded((current) => !current)} />}
          >
            {nldRadarExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <OpsValueTiles
                  columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }}
                  items={[
                    { label: 'Open NLD >4h', value: formatCount(nldOutageOverSlaCount), tone: nldOutageOverSlaCount > 0 ? '#dc2626' : '#16a34a', helper: '4h outage SLA watch' },
                    { label: 'Not logged >20m', value: formatCount(nldPartialLogLateCount), tone: nldPartialLogLateCount > 0 ? '#ea580c' : '#16a34a', helper: 'logging to vendor target' },
                    { label: 'Partial clusters', value: formatCount(summary.nldPartialClusterCount || 0), tone: '#dc2626', helper: 'repeat route pressure' },
                    { label: 'Subscribers hit', value: formatCount(summary.nldOutageSubscribers || 0), tone: '#0f766e', helper: 'open NLD outage impact' }
                  ]}
                />

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Partial NLD trend" subtitle={`Events, clusters, and not-logged pressure over the last ${historyWindowLabel}.`} tone="#f97316">
                    <MultiLineChartPanel
                      rows={historyNldPartials}
                      lines={[
                        { key: 'events', label: 'Partial events', color: '#f97316' },
                        { key: 'clusters', label: 'Route clusters', color: '#dc2626' },
                        { key: 'notLogged', label: 'Not logged', color: '#eab308' }
                      ]}
                      emptyMessage="Historical partial-NLD pressure will appear after more stored monitoring buckets are created."
                      height={220}
                    />
                  </OpsSubPanel>

                  <OpsSubPanel title="Partial route pressure" subtitle="Top route concentrations from the current event lookback." tone="#dc2626">
                    <VerticalBarChart rows={partialRouteSummary.slice(0, 12)} dataKey="count" emptyMessage="No partial route pressure is available right now." height={220} />
                  </OpsSubPanel>
                </Box>

                <OpsSubPanel title="NLD process markers" subtitle="Static visual guide for NLD logging, vendor arrival, and four-hour restoration flow." tone="#0f766e">
                  <ProcessMilestoneStrip items={nldProcessMarkerItems} liveTone="#0f766e" />
                </OpsSubPanel>
              </Box>
            ) : null}
          </OpsSection>

          <OpsSection
            title="NLD Workbench"
            subtitle="Cluster detail, not-logged events, and the live partial-event stream."
            tone="#0f172a"
            minHeight={0}
            bodySx={nldWorkbenchExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={nldWorkbenchExpanded} onClick={() => setNldWorkbenchExpanded((current) => !current)} />}
          >
            {nldWorkbenchExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
                  <OpsSubPanel title="Cluster summary" subtitle="Routes with repeated activity in the cluster window." tone="#dc2626">
                    <MonitoringTable rows={collections.nldPartialClusters || []} columns={nldClusterColumns} emptyMessage="No NLD clusters were detected in the current window." />
                  </OpsSubPanel>

                  <OpsSubPanel title="Partial not logged" subtitle="Partial events that still have not matched back to an outage ticket." tone="#ea580c">
                    <MonitoringTable rows={collections.nldPartialNotLogged || []} columns={nldEventColumns} emptyMessage="No partial events are waiting for outage logging right now." />
                  </OpsSubPanel>
                </Box>

                <OpsSubPanel title="Recent partial NLD events" subtitle="Recent partial-event rows, including route and circuit context derived from the alert subject." tone="#0f172a">
                  <MonitoringTable rows={collections.nldPartialEvents || []} columns={nldEventColumns} emptyMessage="No partial-NLD event rows are available right now." />
                </OpsSubPanel>
              </Box>
            ) : null}
          </OpsSection>
        </Box>
      ) : null}

      {tab === 'voice' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' }, gap: 0.82 }}>
            {voiceCommandCards.map((item) => (
              <OpsPriorityCard key={item.label} {...item} />
            ))}
          </Box>

          <OpsSection
            title="Voice Radar"
            subtitle="Queue movement, intake flow, and immediate missed-call pressure."
            tone="#0891b2"
            minHeight={0}
            bodySx={voiceRadarExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={voiceRadarExpanded} onClick={() => setVoiceRadarExpanded((current) => !current)} />}
          >
            {voiceRadarExpanded ? (
              <Box sx={{ display: 'grid', gap: 1.05 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
                  <OpsSubPanel title="Voice queue trend" subtitle={`Waiting, answered, and missed call movement across the last ${historyWindowLabel}.`} tone="#0891b2">
                    <MultiLineChartPanel
                      rows={historyTelephony}
                      lines={[
                        { key: 'waiting', label: 'Waiting', color: '#7c3aed' },
                        { key: 'answered', label: 'Answered', color: '#0891b2' },
                        { key: 'missed', label: 'Missed', color: '#dc2626' }
                      ]}
                      emptyMessage="Historical telephony queue movement will appear once more backend voice snapshots are stored."
                      height={220}
                    />
                  </OpsSubPanel>

                  <OpsSubPanel title="Voice hourly flow" subtitle="Hourly intake, abandon volume, and talk-time pattern from Illation." tone="#0f172a">
                    <MultiLineChartPanel
                      rows={telephonyHourly.map((row) => ({ ...row, label: `${row.hour}:00` }))}
                      lines={[
                        { key: 'received', label: 'Received', color: '#0891b2' },
                        { key: 'abandoned', label: 'Abandoned', color: '#dc2626' },
                        { key: 'avgTalkSeconds', label: 'Avg talk sec', color: '#0f766e' }
                      ]}
                      emptyMessage="No telephony hourly feed is available right now."
                      height={220}
                    />
                  </OpsSubPanel>
                </Box>

                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 1.05 }}>
                  <OpsSubPanel title="Queue waiting snapshot" subtitle="Live waiting callers by queue from the Illation feed." tone="#0891b2">
                    <HorizontalBarChart rows={telephonyQueueWaitingSummary} dataKey="count" emptyMessage="No queue waiting summary is available right now." height={220} />
                  </OpsSubPanel>

                  <OpsSubPanel title="Missed calls by agent" subtitle="Highest missed-call counts by agent in the current voice snapshot." tone="#dc2626">
                    <HorizontalBarChart rows={telephonyMissedAgentSummary} dataKey="count" emptyMessage="No missed-call agent summary is available right now." height={220} />
                  </OpsSubPanel>
                </Box>
              </Box>
            ) : null}
          </OpsSection>

          <OpsSection
            title="Voice Workbench"
            subtitle="Queue and agent detail from the live telephony feed."
            tone="#0f172a"
            minHeight={0}
            bodySx={voiceWorkbenchExpanded ? undefined : { display: 'none' }}
            action={<SectionCollapseButton expanded={voiceWorkbenchExpanded} onClick={() => setVoiceWorkbenchExpanded((current) => !current)} />}
          >
            {voiceWorkbenchExpanded ? (
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' }, gap: 1.05 }}>
                <OpsSubPanel title="Telephony queues" subtitle="Queue pressure from the Illation stats feed." tone="#0891b2">
                  <MonitoringTable rows={telephonyQueues} columns={queueColumns} emptyMessage="No telephony queue rows are available right now." />
                </OpsSubPanel>

                <OpsSubPanel title="Telephony agents" subtitle="Agent state, login, and missed-call context from the same live voice feed." tone="#0f172a">
                  <MonitoringTable rows={telephonyAgents} columns={agentColumns} emptyMessage="No telephony agent rows are available right now." />
                </OpsSubPanel>
              </Box>
            ) : null}
          </OpsSection>
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
              <OpsAlert severity={telephonyMeta?.available ? 'info' : 'warning'}>
                {telephonyMeta?.available
                  ? 'Telephony data was included in the current snapshot.'
                  : telephonyMeta?.reason || 'Telephony data is not configured yet.'}
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



