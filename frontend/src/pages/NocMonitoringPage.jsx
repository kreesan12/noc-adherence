import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
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
import { fetchNocMonitoringSnapshot, fetchNocMonitoringTelephonyPulse, refreshNocMonitoringSnapshot } from '../api/nocMonitoring'
import { PageShell } from '../components/ui/PageScaffold'
import { downloadWorkbook } from '../utils/slaExport'
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
const SNAPSHOT_POLL_MS = 5 * 60 * 1000
const TELEPHONY_POLL_MS = 5000
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
const DASHBOARD_SECTION_HEADER_SX = {
  px: 1,
  py: 0.78,
  borderBottomColor: 'rgba(148, 163, 184, 0.12)',
  background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.92) 0%, rgba(9, 18, 34, 0.9) 100%)'
}
const DASHBOARD_SECTION_BODY_SX = {
  px: 1.05,
  py: 0.95
}
const DASHBOARD_SECTION_TITLE_SX = {
  color: '#f8fafc',
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

function DrillCounterButton({ label, count, helper, tone = ACCENT, onClick }) {
  return (
    <Button
      size="small"
      variant="outlined"
      onClick={onClick}
      sx={{
        minWidth: 0,
        justifyContent: 'flex-start',
        px: 1,
        py: 0.55,
        borderRadius: 2.2,
        color: '#f8fafc',
        borderColor: alpha(tone, 0.4),
        bgcolor: 'rgba(8, 15, 29, 0.8)',
        background: `linear-gradient(180deg, rgba(10, 18, 33, 0.94) 0%, ${alpha(tone, 0.12)} 100%)`,
        textTransform: 'none'
      }}
    >
      <Stack spacing={0.1} alignItems="flex-start">
        <Typography variant="caption" sx={{ color: OPS_MUTED, lineHeight: 1.15 }}>
          {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
          {formatCount(count)}
        </Typography>
        {helper ? (
          <Typography variant="caption" sx={{ color: alpha('#e5eef8', 0.78), lineHeight: 1.1 }}>
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
              color: selected ? '#f8fafc' : OPS_MUTED,
              bgcolor: selected ? 'rgba(15, 118, 110, 0.26)' : 'rgba(15, 23, 42, 0.64)',
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
            color: value === 'all' ? '#f8fafc' : OPS_MUTED,
            bgcolor: value === 'all' ? alpha(tone, 0.24) : 'rgba(15, 23, 42, 0.64)',
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
                color: selected ? '#f8fafc' : OPS_MUTED,
                bgcolor: selected ? alpha(tone, 0.24) : 'rgba(15, 23, 42, 0.64)',
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
            p: 0.85,
            borderRadius: 2.2,
            border: `1px solid ${alpha(item.tone || ACCENT, 0.22)}`,
            bgcolor: 'rgba(8, 15, 29, 0.82)',
            background: `linear-gradient(180deg, rgba(10, 18, 33, 0.96) 0%, ${alpha(item.tone || ACCENT, 0.12)} 100%)`,
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
              <Typography variant="caption" sx={{ color: OPS_MUTED, textTransform: 'uppercase', letterSpacing: 0.55 }}>
                {item.label}
              </Typography>
              {item.badge ? <SignalChip label={item.badge} tone={item.tone || ACCENT} /> : null}
            </Stack>
            <Typography variant="h6" sx={{ fontWeight: 900, lineHeight: 1, color: '#f8fafc' }}>
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

function OpsStatusPill({ label, value, tone = ACCENT }) {
  return (
    <Box
      sx={{
        minWidth: 0,
        px: 0.9,
        py: 0.65,
        borderRadius: 2.3,
        border: `1px solid ${alpha(tone, 0.34)}`,
        bgcolor: 'rgba(8, 15, 29, 0.84)',
        background: `linear-gradient(180deg, rgba(10, 18, 33, 0.96) 0%, ${alpha(tone, 0.14)} 100%)`,
        boxShadow: `inset 0 0 0 1px ${alpha('#ffffff', 0.03)}`
      }}
    >
      <Stack spacing={0.1} sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: '#a5b4fc', textTransform: 'uppercase', letterSpacing: 0.6, lineHeight: 1 }}>
          {label}
        </Typography>
        <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 900, lineHeight: 1.08, letterSpacing: 0.1 }}>
          {value}
        </Typography>
      </Stack>
    </Box>
  )
}

function OpsPriorityCard({ label, value, detail, meta, tone = ACCENT, onClick, active = false }) {
  return (
    <Box
      component={onClick ? 'button' : 'div'}
      onClick={onClick}
      sx={{
        position: 'relative',
        overflow: 'hidden',
        width: '100%',
        p: 0.95,
        textAlign: 'left',
        borderRadius: 2.8,
        color: OPS_TEXT,
        border: `1px solid ${alpha(tone, active ? 0.5 : 0.24)}`,
        bgcolor: 'rgba(8, 15, 29, 0.84)',
        background: `linear-gradient(180deg, rgba(10, 18, 33, 0.96) 0%, ${alpha(tone, active ? 0.18 : 0.1)} 100%)`,
        boxShadow: active
          ? `0 0 0 1px ${alpha(tone, 0.18)}, 0 20px 34px ${alpha(tone, 0.22)}`
          : 'inset 0 0 0 1px rgba(148, 163, 184, 0.06)',
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
          boxShadow: `0 0 0 1px ${alpha(tone, 0.18)}, 0 22px 38px ${alpha(tone, 0.2)}`
        } : undefined
      }}
    >
      <Stack spacing={0.42}>
        <Stack direction="row" spacing={0.7} justifyContent="space-between" alignItems="flex-start">
          <Typography variant="caption" sx={{ color: OPS_MUTED, textTransform: 'uppercase', letterSpacing: 0.58 }}>
            {label}
          </Typography>
          <Box sx={{ width: 10, height: 10, borderRadius: 999, bgcolor: tone, boxShadow: `0 0 16px ${alpha(tone, 0.55)}` }} />
        </Stack>
        <Typography variant="h4" sx={{ color: '#ffffff', fontWeight: 900, lineHeight: 0.95 }}>
          {value}
        </Typography>
        <Typography variant="body2" sx={{ color: '#f8fafc', fontWeight: 700, lineHeight: 1.18 }}>
          {detail}
        </Typography>
        {meta ? (
          <Typography variant="caption" sx={{ color: OPS_MUTED, lineHeight: 1.18 }}>
            {meta}
          </Typography>
        ) : null}
      </Stack>
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

function MonitoringTable({ rows, columns, emptyMessage = 'No rows available.', getRowSx }) {
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

function MultiLineChartPanel({ rows, lines, emptyMessage, height = 260, showLegend = true }) {
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
        bgcolor: 'rgba(10, 18, 33, 0.82)',
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
      headerSx={DASHBOARD_SECTION_HEADER_SX}
      bodySx={DASHBOARD_SECTION_BODY_SX}
      titleSx={DASHBOARD_SECTION_TITLE_SX}
      subtitleSx={DASHBOARD_SECTION_SUBTITLE_SX}
      {...props}
    />
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
  const [tab, setTab] = useState('overview')
  const [t1DueNowLimit, setT1DueNowLimit] = useState(15)
  const [t1ActionViewLimit, setT1ActionViewLimit] = useState(20)
  const [t1DeskLimit, setT1DeskLimit] = useState(10)
  const [t1MaintenanceLimit, setT1MaintenanceLimit] = useState(10)
  const [t1ClientPendingLimit, setT1ClientPendingLimit] = useState(10)
  const [t1ParkedLimit, setT1ParkedLimit] = useState(10)
  const [t1QuickPreset, setT1QuickPreset] = useState('all')
  const [t1ActionFilters, setT1ActionFilters] = useState(DEFAULT_T1_ACTION_FILTERS)
  const [t1OwnershipLens, setT1OwnershipLens] = useState('workflowOwner')
  const [t1WorkbenchDrawer, setT1WorkbenchDrawer] = useState('none')
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

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    setError('')
    try {
      const next = await refreshNocMonitoringSnapshot({ historyHours: DEFAULT_HISTORY_HOURS })
      setPayload(next)
      void loadTelephonyPulse()
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Unable to refresh the monitoring snapshot.')
    } finally {
      setRefreshing(false)
    }
  }, [loadTelephonyPulse])

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
      label: freshness?.hasSnapshot ? (freshness?.stale ? 'Snapshot aging' : 'Snapshot fresh') : 'Snapshot',
      value: freshness?.hasSnapshot ? formatSnapshotAge(freshness.ageMs) : 'bootstrapping',
      tone: freshness?.hardStale ? '#dc2626' : freshness?.stale ? '#f97316' : '#16a34a'
    },
    {
      label: 'Updated',
      value: snapshot?.generatedAt ? formatStamp(snapshot.generatedAt) : 'Waiting',
      tone: '#64748b'
    },
    {
      label: 'Ops day',
      value: summary.dayKey || '--',
      tone: '#0f766e'
    },
    {
      label: 'Open work',
      value: formatCount((summary.majorOutageOpen || 0) + (summary.nldOutageOpen || 0) + (summary.backhaulOpen || 0) + (summary.vipOpen || 0) + (summary.tier1Open || 0) + (summary.tier2Open || 0)),
      tone: '#1d4ed8'
    },
    {
      label: 'Impact',
      value: formatCount((summary.majorOutageSubscribers || 0) + (summary.nldOutageSubscribers || 0)),
      tone: '#dc2626'
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
          ? `${row.playPolicyTitle || row.label} | ${formatCount(row.breached || 0)} breached | ${formatCount(row.dueSoon || 0)} due <=30m`
          : `${formatCount(row.count || 0)} open | ${formatCount(row.noActiveTimer || 0)} no active play clock`
      })),
    [t1ActionSummary]
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
      label: 'Due <=30m',
      count: Number(summary.tier1PlayClockDueSoon || 0),
      tone: '#ea580c',
      detail: 'Tracked P2/P3/P4 timers needing attention in the next 30 minutes'
    },
    {
      key: 'change',
      label: 'Change control',
      count: Number(summary.tier1ChangeControlOpen || 0),
      tone: '#8b5cf6',
      detail: 'Rows carrying the noc_change_checks tag'
    },
    {
      key: 'inbound-anomaly',
      label: 'Inbound spike',
      count: Number(summary.t1InboundAnomalyCount || 0),
      tone: Number(summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : '#d97706',
      detail: summary.t1InboundFocusLabel
        ? `${summary.t1InboundFocusLabel} | ${summary.t1InboundFocusStatusLabel || 'Flagged'} | ${summary.t1InboundFocusStatusDetail || `${summary.t1InboundFocusDayLabel || summary.t1InboundFocusDayKey} hit ${formatCount(summary.t1InboundFocusCount || 0)}`}`
        : 'No abnormal recent completed-day product spike detected'
    },
    {
      key: 'maintenance',
      label: 'With maintenance',
      count: Number(summary.tier1WithMaintenance || 0),
      tone: '#2563eb',
      detail: 'Largest external holding lane in the live Tier 1 queue'
    },
    {
      key: 'client',
      label: 'Waiting on client',
      count: Number(summary.tier1WaitingClient || 0),
      tone: '#ea580c',
      detail: 'Rows pending ISP or client feedback'
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
  ]), [summary])

  const t1AutomationOpenRows = useMemo(
    () => (t1AutomationOpenSummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1AutomationOpenSummary]
  )

  const t1AutomationTodayRows = useMemo(
    () => (t1AutomationCreatedTodaySummary || []).filter((row) => Number(row.count || 0) > 0),
    [t1AutomationCreatedTodaySummary]
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

  const t1OwnershipLensConfig = useMemo(() => ({
    workflowOwner: {
      key: 'workflowOwner',
      label: 'Workflow owner',
      tone: '#0f766e',
      rows: t1WorkflowOwnerRows,
      secondaryText: (row) => `${formatCount(row.count || 0)} live rows`
    },
    operationalState: {
      key: 'operationalState',
      label: 'Operational state',
      tone: '#2563eb',
      rows: t1OperationalShapeRows,
      secondaryText: (row) => `${formatCount(row.count || 0)} live rows`
    },
    escalationPath: {
      key: 'escalationPath',
      label: 'Escalation path',
      tone: '#8b5cf6',
      rows: t1EscalationRows,
      secondaryText: (row) => `${formatCount(row.count || 0)} routed rows`
    }
  }), [t1EscalationRows, t1OperationalShapeRows, t1WorkflowOwnerRows])

  const t1ActiveOwnershipLens = useMemo(
    () => t1OwnershipLensConfig[t1OwnershipLens] || t1OwnershipLensConfig.workflowOwner,
    [t1OwnershipLens, t1OwnershipLensConfig]
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
      }, 90)
    }
  }, [])

  const openT1WorkbenchDrawer = useCallback((drawerKey, preset = 'all', nextFilters = {}) => {
    setT1WorkbenchDrawer((current) => current === drawerKey ? 'none' : drawerKey)
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
        { label: 'Urgent', value: formatCount(t1DeskUrgentCount), tone: '#ea580c', helper: 'breached or due <=30m' },
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
        { label: 'Urgent', value: formatCount(t1ClientPendingUrgentCount), tone: '#d97706', helper: 'breached or due <=30m' }
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
    t1ActionColumnParts.automation,
    t1ActionColumnParts.updated,
    t1ActionColumnParts.age,
    t1ActionColumnParts.subject
  ], [t1ActionColumnParts])

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
          borderRadius: 3.4,
          color: OPS_TEXT,
          border: `1px solid ${OPS_BORDER}`,
          background: [
            `radial-gradient(circle at 12% 18%, ${alpha('#14b8a6', 0.2)} 0%, transparent 22%)`,
            `radial-gradient(circle at 88% 16%, ${alpha('#2563eb', 0.18)} 0%, transparent 24%)`,
            `linear-gradient(135deg, rgba(8, 15, 29, 0.98) 0%, rgba(10, 23, 43, 0.98) 52%, rgba(5, 12, 24, 0.98) 100%)`
          ].join(','),
          boxShadow: '0 26px 54px rgba(2, 6, 23, 0.34)'
        }}
        eyebrowSx={{ color: '#2dd4bf', mb: 0.22, fontWeight: 800, letterSpacing: 0.9 }}
        titleSx={{ color: '#f8fafc', fontSize: { xs: '1.7rem', md: '1.95rem' }, fontWeight: 900, lineHeight: 1.02 }}
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
        borderRadius: 3.4,
        color: OPS_TEXT,
        border: `1px solid ${OPS_BORDER}`,
        background: [
          `radial-gradient(circle at 12% 18%, ${alpha('#14b8a6', 0.22)} 0%, transparent 22%)`,
          `radial-gradient(circle at 88% 16%, ${alpha('#2563eb', 0.2)} 0%, transparent 24%)`,
          `linear-gradient(135deg, rgba(8, 15, 29, 0.98) 0%, rgba(10, 23, 43, 0.98) 52%, rgba(5, 12, 24, 0.98) 100%)`
        ].join(','),
        boxShadow: '0 26px 54px rgba(2, 6, 23, 0.34)'
      }}
      eyebrowSx={{ color: '#2dd4bf', mb: 0.22, fontWeight: 800, letterSpacing: 0.9 }}
      titleSx={{ color: '#f8fafc', fontSize: { xs: '1.7rem', md: '1.95rem' }, fontWeight: 900, lineHeight: 1.02 }}
      actionsSx={{ width: { xs: '100%', xl: 'auto' } }}
      actions={(
        <Stack direction={{ xs: 'column', xl: 'row' }} spacing={0.72} alignItems={{ xs: 'stretch', xl: 'center' }} justifyContent="flex-end">
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                sm: 'repeat(3, minmax(0, 1fr))',
                xl: 'repeat(5, minmax(104px, 1fr))'
              },
              gap: 0.55,
              width: { xs: '100%', xl: 'auto' }
            }}
          >
            {heroStatusItems.map((item) => (
              <OpsStatusPill key={item.label} label={item.label} value={item.value} tone={item.tone} />
            ))}
          </Box>
          <Button
            size="small"
            variant="contained"
            startIcon={<RefreshRoundedIcon />}
            onClick={handleRefresh}
            disabled={refreshing}
            sx={{
              flexShrink: 0,
              alignSelf: { xs: 'stretch', xl: 'center' },
              minHeight: 42,
              px: 1.4,
              borderRadius: 2.4,
              fontWeight: 800,
              textTransform: 'none',
              boxShadow: '0 14px 30px rgba(15, 118, 110, 0.24)'
            }}
          >
            {refreshing ? 'Refreshing...' : 'Refresh Snapshot'}
          </Button>
        </Stack>
      )}
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

        <Box
          sx={{
            px: { xs: 0.05, md: 0.12 },
            py: 0.18,
            borderRadius: 2.8,
            border: `1px solid ${alpha('#93c5fd', 0.12)}`,
            bgcolor: 'rgba(8, 15, 29, 0.58)'
          }}
        >
          <Tabs
            value={tab}
            onChange={(_event, value) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 34,
              '& .MuiTab-root': {
                minHeight: 34,
                color: OPS_MUTED,
                fontWeight: 700,
                fontSize: 13,
                textTransform: 'none',
                borderRadius: 2.3,
                px: 1.1,
                py: 0.35
              },
              '& .Mui-selected': {
                color: '#ffffff !important',
                background: 'linear-gradient(180deg, rgba(20, 184, 166, 0.22) 0%, rgba(37, 99, 235, 0.18) 100%)'
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
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' }, gap: 0.85 }}>
            <OpsPriorityCard
              label="P1 unattended"
              value={formatCount(summary.tier1P1Unattended || 0)}
              detail={`${formatCount(summary.tier1P1Breached || 0)} breached first-touch SLA`}
              meta="30m first-touch queue"
              tone="#dc2626"
              active={(summary.tier1P1Breached || 0) > 0 || (summary.tier1P1Unattended || 0) > 0}
              onClick={() => openT1WorkbenchDrawer('p1', 'p1Only', { systemState: 'new' })}
            />
            <OpsPriorityCard
              label="Clocks breached"
              value={formatCount(summary.tier1PlayClockBreached || 0)}
              detail={`${formatCount(summary.tier1PlayClockDueSoon || 0)} more due within 30m`}
              meta="Live P2 / P3 / P4 tracked lanes"
              tone="#ea580c"
              active={(summary.tier1PlayClockBreached || 0) > 0}
              onClick={() => openT1WorkbenchDrawer('urgent', 'dueNow', { dueBucket: 'BREACHED' })}
            />
            <OpsPriorityCard
              label="Due <=30m"
              value={formatCount(summary.tier1PlayClockDueSoon || 0)}
              detail={`${formatCount((collections.tier1UrgentTickets || []).length)} urgent rows in view`}
              meta="Next action timers closing soon"
              tone="#d97706"
              active={(summary.tier1PlayClockDueSoon || 0) > 0}
              onClick={() => openT1WorkbenchDrawer('urgent', 'dueNow')}
            />
            <OpsPriorityCard
              label="Voice queue"
              value={tier1VoiceQueue ? formatCount(summary.telephonyTier1Waiting || 0) : '--'}
              detail={tier1VoiceQueue ? `${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)} max queue` : 'Tier 1 voice queue unavailable'}
              meta={summary.telephonyTier1SlaBreached ? '20s SLA breached' : 'Within 20s response target'}
              tone={summary.telephonyTier1SlaBreached ? '#dc2626' : '#0891b2'}
              active={!!summary.telephonyTier1SlaBreached}
            />
            <OpsPriorityCard
              label="Inbound anomaly"
              value={formatCount(summary.t1InboundAnomalyCount || 0)}
              detail={summary.t1InboundFocusLabel ? `${summary.t1InboundFocusLabel} | ${summary.t1InboundFocusStatusLabel || 'Flagged'}` : 'No abnormal inbound product spike'}
              meta={summary.t1InboundFocusStatusDetail || 'Recent completed-day spike watch'}
              tone={(summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : '#8b5cf6'}
              active={(summary.t1InboundAnomalyCount || 0) > 0}
              onClick={() => t1InboundAnomalyRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            />
          </Box>

          {((summary.t1InboundAnomalyCount || 0) > 0 || summary.telephonyTier1SlaBreached) ? (
            <Box
              sx={{
                px: 1.05,
                py: 0.9,
                borderRadius: 2.8,
                border: `1px solid ${alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#dc2626' : '#0891b2', 0.28)}`,
                bgcolor: alpha((summary.t1InboundAnomalyCount || 0) > 0 ? '#dc2626' : '#0891b2', 0.08)
              }}
            >
              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'flex-start', lg: 'center' }}>
                <Stack spacing={0.2}>
                  <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 800 }}>
                    Supervisor watch
                  </Typography>
                  <Typography variant="body2" sx={{ color: OPS_MUTED }}>
                    {(summary.t1InboundAnomalyCount || 0) > 0
                      ? `${summary.t1InboundFocusLabel || 'Inbound product'} is ${summary.t1InboundFocusStatusLabel || 'flagged'}. ${summary.t1InboundFocusStatusDetail || ''}`
                      : 'No inbound product anomaly is currently flagged.'}
                  {summary.telephonyTier1SlaBreached
                      ? ` Tier 1 voice is outside the 20-second target with a ${formatSeconds(summary.telephonyTier1MaxQueueSeconds || 0)} max queue.`
                      : ''}
                  </Typography>
                </Stack>
                <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap">
                  {(summary.t1InboundAnomalyCount || 0) > 0 ? <SignalChip label={`${formatCount(summary.t1InboundAnomalyCount || 0)} anomaly days`} tone={(summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : '#8b5cf6'} /> : null}
                  {(summary.t1InboundAnomalyCount || 0) > 0 ? <SignalChip label={summary.t1InboundFocusStatusLabel || 'Flagged'} tone={summary.t1InboundFocusStatusTone || '#dc2626'} /> : null}
                  {summary.telephonyTier1SlaBreached ? <SignalChip label="Voice SLA risk" tone="#dc2626" /> : null}
                </Stack>
              </Stack>
            </Box>
          ) : null}

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.02fr 0.98fr' }, gap: 1.05 }}>
            <OpsSection
              title="Critical Now"
              subtitle="Live lanes, timers, and the fastest drill targets."
              tone="#dc2626"
              minHeight={0}
              action={(
                <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                  <SignalChip label="P1 30m" tone="#dc2626" />
                  <SignalChip label="P2 60m" tone="#ea580c" />
                  <SignalChip label="P3 / P4 90m" tone="#2563eb" />
                </Stack>
              )}
            >
              <Stack spacing={0.85}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' }, gap: 0.7 }}>
                  <DrillCounterButton label="P1 first touch" count={summary.tier1P1Unattended || 0} helper="open unattended P1 queue" tone="#dc2626" onClick={() => openT1WorkbenchDrawer('p1', 'p1Only', { systemState: 'new' })} />
                  <DrillCounterButton label="Breached clocks" count={summary.tier1PlayClockBreached || 0} helper="work overdue actions now" tone="#ea580c" onClick={() => openT1WorkbenchDrawer('urgent', 'dueNow', { dueBucket: 'BREACHED' })} />
                  <DrillCounterButton label="Due <=30m" count={summary.tier1PlayClockDueSoon || 0} helper="timers closing soon" tone="#d97706" onClick={() => openT1WorkbenchDrawer('urgent', 'dueNow')} />
                  <DrillCounterButton label="Parked timers" count={summary.tier1ParkedTimers || 0} helper="pre-play waiting buckets" tone="#475569" onClick={() => openT1WorkbenchDrawer('parked', 'parkedTimers')} />
                  <DrillCounterButton label="Change control" count={summary.tier1ChangeControlOpen || 0} helper="separate workflow lane" tone="#8b5cf6" onClick={() => applyT1ActionLens('changeControl')} />
                </Box>
                <CompactBreakdownList rows={t1ActionMixRows} total={summary.tier1Open || 0} maxRows={7} emptyMessage="No Tier 1 action-lane mix is available right now." />
                <OpsValueTiles
                  columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' }}
                  items={[
                    {
                      label: 'Clocks breached',
                      value: formatCount(summary.tier1PlayClockBreached || 0),
                      tone: '#dc2626',
                      helper: 'already over timer'
                    },
                    {
                      label: 'Due <=15m',
                      value: formatCount(t1DueNowFifteenMinuteCount),
                      tone: '#ea580c',
                      helper: 'next danger bucket'
                    },
                    {
                      label: 'Due <=30m',
                      value: formatCount(t1DueNowThirtyMinuteCount),
                      tone: '#d97706',
                      helper: 'close watch window'
                    },
                    {
                      label: 'Parked timers',
                      value: formatCount(summary.tier1ParkedTimers || 0),
                      tone: '#475569',
                      helper: `${formatCount(t1ParkedP3Count)} P3 | ${formatCount(t1ParkedP4Count)} P4`
                    },
                    {
                      label: 'Change control',
                      value: formatCount(summary.tier1ChangeControlOpen || 0),
                      tone: '#8b5cf6',
                      helper: 'separate operational flow'
                    }
                  ]}
                />
              </Stack>
            </OpsSection>

            <OpsSection title="Queue Ownership" subtitle="Who owns the next move in the live queue." tone="#0f766e" minHeight={0}>
              <Stack spacing={0.85}>
                <OpsValueTiles
                  columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }}
                  items={[
                    {
                      label: 'With Tier 1',
                      value: formatCount(summary.tier1WithDesk || 0),
                      tone: '#0f766e',
                      helper: `${formatCount(t1DeskUrgentCount)} urgent | ${formatCount(t1DeskP1Count)} P1`
                    },
                    {
                      label: 'With maintenance',
                      value: formatCount(summary.tier1WithMaintenance || 0),
                      tone: '#2563eb',
                      helper: `${formatCount(t1MaintenanceBreachedCount)} breached | ${formatCount(t1MaintenanceTrackedCount)} tracked`
                    },
                    {
                      label: 'Waiting client',
                      value: formatCount(summary.tier1WaitingClient || 0),
                      tone: '#ea580c',
                      helper: `${formatCount(t1ClientPendingOnHoldCount)} on hold | ${formatCount(t1ClientPendingUrgentCount)} urgent`
                    },
                    {
                      label: 'Parked timers',
                      value: formatCount(summary.tier1ParkedTimers || 0),
                      tone: '#475569',
                      helper: `${formatCount(t1ParkedP3Count)} P3 | ${formatCount(t1ParkedP4Count)} P4`
                    }
                  ]}
                />
                <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                  {Object.values(t1OwnershipLensConfig).map((lens) => {
                    const selected = t1OwnershipLens === lens.key
                    return (
                      <Chip
                        key={lens.key}
                        size="small"
                        label={lens.label}
                        clickable
                        onClick={() => setT1OwnershipLens(lens.key)}
                        sx={{
                          height: 24,
                          fontWeight: 700,
                          color: selected ? '#f8fafc' : OPS_MUTED,
                          bgcolor: selected ? alpha(lens.tone, 0.28) : 'rgba(15, 23, 42, 0.64)',
                          border: `1px solid ${selected ? alpha(lens.tone, 0.44) : 'rgba(148, 163, 184, 0.18)'}`,
                          '& .MuiChip-label': { px: 1 }
                        }}
                      />
                    )
                  })}
                </Stack>
                <CompactBreakdownList
                  rows={t1ActiveOwnershipLens.rows.slice(0, 8)}
                  maxRows={8}
                  total={summary.tier1Open || 0}
                  secondaryText={t1ActiveOwnershipLens.secondaryText}
                  emptyMessage={`No ${t1ActiveOwnershipLens.label.toLowerCase()} shape is available right now.`}
                />
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }, gap: 0.7 }}>
                  <DrillCounterButton label="Desk-owned" count={t1DeskRows.length} helper="open desk workbench" tone="#0f766e" onClick={() => openT1WorkbenchDrawer('desk', 'deskOwned')} />
                  <DrillCounterButton label="Maintenance" count={t1MaintenanceRows.length} helper="external hold lane" tone="#2563eb" onClick={() => openT1WorkbenchDrawer('maintenance', 'maintenanceOwned')} />
                  <DrillCounterButton label="Waiting client" count={t1ClientPendingRows.length} helper="client / ISP pending" tone="#ea580c" onClick={() => openT1WorkbenchDrawer('client', 'all', { workflowOwner: 'Waiting on client / ISP' })} />
                  <DrillCounterButton label="Parked timers" count={t1ParkedRows.length} helper="pre-play queues" tone="#475569" onClick={() => openT1WorkbenchDrawer('parked', 'parkedTimers')} />
                </Box>
              </Stack>
            </OpsSection>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.18fr 0.82fr' }, gap: 1.05 }}>
            <OpsSection title="Desk Health" subtitle="Today against baseline, plus live queue drift." tone="#0f766e" minHeight={0}>
              <Stack spacing={0.85}>
                <OpsValueTiles
                  columns={{ xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }}
                  items={[
                    {
                      label: 'Received',
                      value: formatCount(summary.t1ReceivedToday || 0),
                      tone: '#0f766e',
                      helper: `7d ${formatCount(summary.t1ReceivedLastWeek || 0)} | 14d ${formatCount(summary.t1ReceivedPreviousWeek || 0)}`
                    },
                    {
                      label: 'Solved',
                      value: formatCount(summary.t1SolvedToday || 0),
                      tone: '#16a34a',
                      helper: `7d ${formatCount(summary.t1SolvedLastWeek || 0)} | 14d ${formatCount(summary.t1SolvedPreviousWeek || 0)}`
                    },
                    {
                      label: 'Voice answered',
                      value: tier1VoiceQueue ? formatCount(summary.telephonyTier1Answered || 0) : '--',
                      tone: '#0891b2',
                      helper: tier1VoiceWeekCompare.lastWeek ? `7d ${formatCount(tier1VoiceWeekCompare.lastWeek.answered || 0)} | 14d ${formatCount(tier1VoiceWeekCompare.previousWeek?.answered || 0)}` : 'voice history building'
                    },
                    {
                      label: 'Automation touched',
                      value: formatCount((t1AutomationCreatedTodaySummary || []).reduce((total, row) => total + Number(row.count || 0), 0)),
                      tone: '#8b5cf6',
                      helper: 'Outage, MNT, DFA, and other automation routes'
                    }
                  ]}
                />
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: 'repeat(2, minmax(0, 1fr))' }, gap: 0.85 }}>
                  <MultiLineChartPanel
                    rows={t1ReceivedComparisonSeries}
                    lines={[
                      { key: 'today', label: 'Today', color: '#0f766e' },
                      { key: 'lastWeek', label: '7 days ago', color: '#22c55e', strokeDasharray: '5 4', opacity: 0.92 },
                      { key: 'previousWeek', label: '14 days ago', color: '#86efac', strokeDasharray: '2 5', opacity: 0.8 }
                    ]}
                    emptyMessage="No Tier 1 received comparison data is available right now."
                    showLegend={false}
                    height={170}
                  />
                  <MultiLineChartPanel
                    rows={t1SolvedComparisonSeries}
                    lines={[
                      { key: 'today', label: 'Today', color: '#16a34a' },
                      { key: 'lastWeek', label: '7 days ago', color: '#4ade80', strokeDasharray: '5 4', opacity: 0.92 },
                      { key: 'previousWeek', label: '14 days ago', color: '#bbf7d0', strokeDasharray: '2 5', opacity: 0.82 }
                    ]}
                    emptyMessage="No Tier 1 solved comparison data is available right now."
                    showLegend={false}
                    height={170}
                  />
                  <MultiLineChartPanel
                    rows={historyTier1}
                    lines={[
                      { key: 'open', label: 'Open queue', color: '#0f766e' },
                      { key: 'urgent', label: 'Urgent / due <=30m', color: '#dc2626' }
                    ]}
                    emptyMessage="Tier 1 historical pressure will appear after a few stored monitoring buckets."
                    showLegend={false}
                    height={170}
                  />
                  <MultiLineChartPanel
                    rows={historyTier1VoiceQueue}
                    lines={[
                      { key: 'waiting', label: 'Waiting', color: '#dc2626' },
                      { key: 'answered', label: 'Answered', color: '#0891b2' },
                      { key: 'missed', label: 'Missed', color: '#7c3aed', strokeDasharray: '5 4', opacity: 0.9 }
                    ]}
                    emptyMessage="Tier 1 voice queue history will appear as more telephony snapshots are stored."
                    showLegend={false}
                    height={170}
                  />
                </Box>
              </Stack>
            </OpsSection>

            <Box ref={t1InboundAnomalyRef}>
              <OpsSection
                title="Signal Watch"
                subtitle="Inbound anomalies and the follow-through after the breakout."
                tone={(summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : '#8b5cf6'}
                minHeight={0}
                action={<SignalChip label={`${formatCount(summary.t1InboundAnomalyCount || 0)} flagged`} tone={(summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : '#8b5cf6'} />}
              >
                <Stack spacing={0.8}>
                  <OpsValueTiles
                    columns={{ xs: 'repeat(2, minmax(0, 1fr))' }}
                    items={[
                      {
                        label: 'Flagged spikes',
                        value: formatCount(summary.t1InboundAnomalyCount || 0),
                        tone: (summary.t1InboundHighAnomalyCount || 0) > 0 ? '#dc2626' : '#d97706',
                        helper: 'Across the last two completed days'
                      },
                      {
                        label: 'High severity',
                        value: formatCount(summary.t1InboundHighAnomalyCount || 0),
                        tone: '#dc2626',
                        helper: 'Large jump versus the prior baseline'
                      },
                      {
                        label: 'Affected products',
                        value: formatCount(t1InboundAffectedServiceCount),
                        tone: '#f97316',
                        helper: 'Distinct inbound product types flagged'
                      },
                      {
                        label: 'Current state',
                        value: summary.t1InboundFocusStatusLabel || 'Stable',
                        tone: summary.t1InboundFocusStatusTone || '#0f766e',
                        helper: summary.t1InboundFocusStatusDetail || 'No lead product spike right now'
                      }
                    ]}
                  />
                  <MultiLineChartPanel
                    rows={t1InboundAnomalyTrendLines.length ? t1InboundAnomalyTrendRows : []}
                    lines={t1InboundAnomalyTrendLines}
                    emptyMessage="Inbound product drift history will appear once the cached recent-day activity scan has enough data."
                    showLegend={false}
                    height={212}
                  />
                  <CompactBreakdownList
                    rows={(t1InboundAnomalyRows || []).slice(0, 4).map((row) => ({
                      key: `${row.productType}-${row.dayKey}-${row.mode}`,
                      label: `${row.productType || row.serviceType || '--'} | ${row.dayLabel || row.dayKey}`,
                      count: row.count || 0,
                      tone: row.statusTone || row.tone || '#d97706',
                      detail: `${row.statusLabel || 'Flagged'} | prev max ${formatCount(row.baselineMax || 0)} | ${formatSignedDelta(row.deltaCount || 0)}`
                    }))}
                    maxRows={4}
                    emptyMessage="No abnormal recent Tier 1 inbound product spikes are visible right now."
                  />
                </Stack>
              </OpsSection>
            </Box>
          </Box>

          <Box ref={t1ActionViewRef}>
            <OpsSection title="Tier 1 Workbench" subtitle="One dominant supervisor drill surface for the live queue." tone="#0f766e" minHeight={0}>
              <Stack spacing={0.8}>
                <Box
                  sx={{
                    p: 0.9,
                    borderRadius: 2.4,
                    border: `1px solid ${alpha('#0f766e', 0.2)}`,
                    bgcolor: 'rgba(6, 12, 24, 0.72)'
                  }}
                >
                  <Stack spacing={0.85}>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                      <Stack spacing={0.7} sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(6, minmax(0, 1fr))' }, gap: 0.7 }}>
                          <DrillCounterButton label="Desk-owned" count={t1DeskRows.length} helper="with Tier 1" tone="#0f766e" onClick={() => openT1WorkbenchDrawer('desk', 'deskOwned')} />
                          <DrillCounterButton label="Maintenance" count={t1MaintenanceRows.length} helper="external lane" tone="#2563eb" onClick={() => openT1WorkbenchDrawer('maintenance', 'maintenanceOwned')} />
                          <DrillCounterButton label="Waiting client" count={t1ClientPendingRows.length} helper="ISP / client pending" tone="#ea580c" onClick={() => openT1WorkbenchDrawer('client', 'all', { workflowOwner: 'Waiting on client / ISP' })} />
                          <DrillCounterButton label="P1 queue" count={t1P1AttentionRows.length} helper="first-touch focus" tone="#dc2626" onClick={() => openT1WorkbenchDrawer('p1', 'p1Only', { systemState: 'new' })} />
                          <DrillCounterButton label="Urgent timers" count={t1DueNowRows.length} helper="due <=30m" tone="#d97706" onClick={() => openT1WorkbenchDrawer('urgent', 'dueNow')} />
                          <DrillCounterButton label="Parked" count={t1ParkedRows.length} helper="pre-play queues" tone="#475569" onClick={() => openT1WorkbenchDrawer('parked', 'parkedTimers')} />
                        </Box>
                        <FilterChipGroup
                          label="Quick presets"
                          value={t1QuickPreset}
                          onChange={setT1QuickPreset}
                          options={T1_PRESETS.filter((preset) => preset.key !== 'all').map((preset) => preset.key)}
                          tone={T1_PRESET_TONE_MAP[t1QuickPreset] || '#0f766e'}
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
                            tone="#0f766e"
                            countMap={t1PLevelCountMap}
                            anyCount={t1FilterAnyCounts.pLevel}
                          />
                          <FilterChipGroup
                            label="Clock state"
                            value={t1ActionFilters.dueBucket}
                            onChange={(next) => setT1ActionFilters((current) => ({ ...current, dueBucket: next }))}
                            options={t1DueBucketOptions}
                            tone="#ea580c"
                            countMap={t1DueBucketCountMap}
                            anyCount={t1FilterAnyCounts.dueBucket}
                          />
                          <FilterChipGroup
                            label="Workflow owner"
                            value={t1ActionFilters.workflowOwner}
                            onChange={(next) => setT1ActionFilters((current) => ({ ...current, workflowOwner: next }))}
                            options={t1WorkflowOwnerOptions}
                            tone="#0f766e"
                            countMap={t1WorkflowOwnerCountMap}
                            anyCount={t1FilterAnyCounts.workflowOwner}
                          />
                        </Box>
                      </Stack>
                      <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignSelf={{ xs: 'stretch', md: 'flex-start' }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setT1ShowAdvancedFilters((current) => !current)}
                          sx={{
                            minWidth: 0,
                            px: 1.1,
                            py: 0.2,
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
                            py: 0.2,
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
                            py: 0.2,
                            color: '#cbd5e1',
                            borderColor: 'rgba(148, 163, 184, 0.24)'
                          }}
                        >
                          Reset filters
                        </Button>
                      </Stack>
                    </Stack>
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
                          tone="#1d4ed8"
                          countMap={t1SystemStateCountMap}
                          anyCount={t1FilterAnyCounts.systemState}
                          labelFormatter={titleCaseWords}
                        />
                        <FilterChipGroup
                          label="Operational state"
                          value={t1ActionFilters.operationalState}
                          onChange={(next) => setT1ActionFilters((current) => ({ ...current, operationalState: next }))}
                          options={t1OperationalStateOptions}
                          tone="#7c3aed"
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
                </Box>
                {t1ActiveWorkbenchDrawer ? (
                  <Box
                    sx={{
                      p: 0.9,
                      borderRadius: 2.4,
                      border: `1px solid ${alpha(t1ActiveWorkbenchDrawer.tone, 0.22)}`,
                      bgcolor: 'rgba(8, 15, 29, 0.76)',
                      background: `linear-gradient(180deg, rgba(10, 18, 33, 0.94) 0%, ${alpha(t1ActiveWorkbenchDrawer.tone, 0.08)} 100%)`
                    }}
                  >
                    <Stack spacing={0.75}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.7} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                        <Stack spacing={0.15}>
                          <Typography variant="subtitle2" sx={{ color: '#ffffff', fontWeight: 800 }}>
                            {t1ActiveWorkbenchDrawer.label}
                          </Typography>
                          <Typography variant="caption" sx={{ color: OPS_MUTED }}>
                            Focused queue drawer opened from the command surface. Click the same summary tile again to collapse it.
                          </Typography>
                        </Stack>
                        {t1ActiveWorkbenchDrawer.setLimit ? (
                          <RowWindowSelector
                            value={t1ActiveWorkbenchDrawer.limit}
                            onChange={t1ActiveWorkbenchDrawer.setLimit}
                            options={t1ActiveWorkbenchDrawer.key === 'urgent' ? [10, 20, 50, 'all'] : [5, 10, 20, 'all']}
                          />
                        ) : null}
                      </Stack>
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
                  </Box>
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
              rows={telephonyHourly.map((row) => ({ ...row, label: `${row.hour}:00` }))}
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
              <MonitoringTable rows={telephonyQueues} columns={queueColumns} emptyMessage="No telephony queue rows are available right now." />
            </OpsSection>

            <OpsSection title="Telephony Agents" subtitle="Agent state, login, and missed-call context from the same live voice feed." tone="#0f172a" minHeight={0}>
              <MonitoringTable rows={telephonyAgents} columns={agentColumns} emptyMessage="No telephony agent rows are available right now." />
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

