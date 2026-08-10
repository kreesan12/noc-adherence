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
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded'
import NotificationsActiveRoundedIcon from '@mui/icons-material/NotificationsActiveRounded'
import LanRoundedIcon from '@mui/icons-material/LanRounded'
import SupportAgentRoundedIcon from '@mui/icons-material/SupportAgentRounded'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded'
import dayjs from 'dayjs'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
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
  if (!href) return <Typography variant="caption" sx={{ color: 'text.secondary' }}>No link</Typography>
  return (
    <Link href={href} target="_blank" rel="noreferrer" underline="hover" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35 }}>
      {label}
      <OpenInNewRoundedIcon sx={{ fontSize: 14 }} />
    </Link>
  )
}

function SpotlightCard({ item }) {
  return (
    <Box
      sx={{
        p: 1.05,
        borderRadius: 2.6,
        border: '1px solid #e5e7eb',
        background: `linear-gradient(180deg, ${item.tone}12 0%, rgba(255,255,255,0.98) 100%)`,
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)'
      }}
    >
      <Stack spacing={0.7}>
        <Stack direction="row" spacing={0.65} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {item.title}
          </Typography>
          {item.badge ? <Chip size="small" label={item.badge} sx={{ bgcolor: `${item.tone}14`, color: item.tone, fontWeight: 700 }} /> : null}
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {item.message}
        </Typography>
        {item.url ? (
          <ExternalTicketLink href={item.url} label="Open ticket" />
        ) : (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Snapshot insight
          </Typography>
        )}
      </Stack>
    </Box>
  )
}

function LaneBars({ rows, dataKey, title, emptyMessage, colorMap = {} }) {
  if (!rows.length) {
    return <AnalyticsChartFallback minHeight={220} message={emptyMessage} />
  }

  return (
    <Box sx={{ height: 240 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" height={44} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey={dataKey} radius={[8, 8, 0, 0]}>
            {rows.map((row) => (
              <Cell key={row.key} fill={colorMap[row.key] || row.tone || ACCENT} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Box>
  )
}

function MonitoringTable({ rows, columns, emptyMessage = 'No rows available.' }) {
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ minWidth: 720 }}>
        <TableHead>
          <TableRow>
            {columns.map((column) => (
              <TableCell key={column.key} sx={{ fontWeight: 800, whiteSpace: 'nowrap' }}>
                {column.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length ? rows.map((row) => (
            <TableRow key={row.id || row.ticketId} hover>
              {columns.map((column) => (
                <TableCell key={column.key} sx={{ verticalAlign: 'top' }}>
                  {column.render ? column.render(row) : row[column.key]}
                </TableCell>
              ))}
            </TableRow>
          )) : (
            <TableRow>
              <TableCell colSpan={columns.length}>
                <Typography variant="body2" sx={{ py: 1, color: 'text.secondary' }}>
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
      const next = await fetchNocMonitoringSnapshot()
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
      const next = await refreshNocMonitoringSnapshot()
      setPayload(next)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Unable to refresh the monitoring snapshot.')
    } finally {
      setRefreshing(false)
    }
  }, [])

  const snapshot = payload?.snapshot
  const freshness = payload?.freshness
  const meta = payload?.meta
  const summary = snapshot?.summary || {}
  const lanes = snapshot?.lanes || []
  const spotlights = snapshot?.spotlights || []
  const warnings = snapshot?.warnings || []
  const collections = snapshot?.collections || {}

  const stats = useMemo(() => [
    {
      label: 'Snapshot',
      value: freshness?.hasSnapshot ? formatSnapshotAge(freshness.ageMs) : 'bootstrapping',
      helper: snapshot?.generatedAt ? formatStamp(snapshot.generatedAt) : 'first live snapshot will be generated on load'
    },
    {
      label: 'Live Tickets',
      value: formatCount((summary.majorOutageOpen || 0) + (summary.nldOutageOpen || 0) + (summary.backhaulOpen || 0) + (summary.vipOpen || 0) + (summary.tier1Open || 0) + (summary.tier2Open || 0)),
      helper: 'major outage, NLD, backhaul, VIP, Tier 1, and Tier 2 combined'
    },
    {
      label: 'Subscriber Impact',
      value: formatCount((summary.majorOutageSubscribers || 0) + (summary.nldOutageSubscribers || 0)),
      helper: 'open outage subscribers across major + NLD lanes'
    },
    {
      label: 'Queue Hygiene',
      value: formatCount(summary.skippedCount || 0),
      helper: 'visible skipped-ticket items in the latest snapshot'
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

  const queueColumns = useMemo(() => [
    { key: 'name', label: 'Queue' },
    { key: 'waiting', label: 'Waiting', render: (row) => formatCount(row.waiting) },
    { key: 'active', label: 'Active', render: (row) => formatCount(row.active) },
    { key: 'answered', label: 'Answered', render: (row) => formatCount(row.answered) },
    { key: 'missed', label: 'Missed', render: (row) => formatCount(row.missed) },
    { key: 'avgAnswerSeconds', label: 'Avg Answer (s)', render: (row) => formatCount(row.avgAnswerSeconds) }
  ], [])

  const agentColumns = useMemo(() => [
    { key: 'name', label: 'Agent' },
    { key: 'queue', label: 'Queue', render: (row) => row.queue || '--' },
    { key: 'state', label: 'State', render: (row) => <Chip size="small" label={row.state || 'unknown'} color={severityColor(row.state)} /> },
    { key: 'activeCalls', label: 'Active Calls', render: (row) => formatCount(row.activeCalls) }
  ], [])

  const ticketColumns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'status', label: 'Status', render: (row) => <Chip size="small" label={row.status} color={severityColor(row.status)} /> },
    { key: 'priority', label: 'Priority', render: (row) => <Chip size="small" label={row.priority} color={priorityColor(row.priority)} /> },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'updatedAt', label: 'Updated', render: (row) => formatStamp(row.updatedAt) },
    { key: 'subject', label: 'Subject' }
  ], [])

  const vipColumns = useMemo(() => [
    { key: 'id', label: 'Ticket', render: (row) => <ExternalTicketLink href={row.url} label={`#${row.id}`} /> },
    { key: 'sourceLabels', label: 'Trigger', render: (row) => row.sourceLabels?.join(', ') || 'VIP' },
    { key: 'status', label: 'Status', render: (row) => <Chip size="small" label={row.status} color={severityColor(row.status)} /> },
    { key: 'priority', label: 'Priority', render: (row) => <Chip size="small" label={row.priority} color={priorityColor(row.priority)} /> },
    { key: 'ageHours', label: 'Age', render: (row) => formatAgeHours(row.ageHours) },
    { key: 'subject', label: 'Subject' }
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
      description="A native Ops Hub replacement for the old Grafana view, built around cached backend snapshots instead of dozens of browser-side live calls."
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
      {refreshing ? <LinearProgress sx={{ borderRadius: 999, overflow: 'hidden' }} /> : null}

      {error ? (
        <Alert severity="error">{error}</Alert>
      ) : null}

      {warnings.length ? (
        <Alert severity="warning">
          {warnings.length} monitoring source{warnings.length === 1 ? '' : 's'} returned partial data. The page still loaded the rest of the snapshot so the team can keep working.
        </Alert>
      ) : null}

      {meta?.dashboardNote ? (
        <Alert severity="info">{meta.dashboardNote}</Alert>
      ) : null}

      <SectionCard
        title="Workspace Views"
        subtitle="Move between executive overview, outage operations, ticket operations, and queue hygiene without leaving the same cached snapshot."
        tone={ACCENT}
        minHeight={0}
      >
        <Tabs value={tab} onChange={(_event, value) => setTab(value)} variant="scrollable" scrollButtons="auto">
          <Tab value="overview" label="Overview" />
          <Tab value="outages" label="Outage Desk" />
          <Tab value="tickets" label="Ticket Desk" />
          <Tab value="queues" label="Queues and Hygiene" />
        </Tabs>
      </SectionCard>

      {tab === 'overview' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
              gap: 1
            }}
          >
            <MetricCard label="Major outages" value={formatCount(summary.majorOutageOpen)} subtext={`${formatCount(summary.majorOutageSubscribers)} subscribers currently impacted`} tone="#dc2626" icon={<NotificationsActiveRoundedIcon fontSize="small" />} />
            <MetricCard label="NLD outages" value={formatCount(summary.nldOutageOpen)} subtext={`${formatCount(summary.nldOutageSubscribers)} subscribers currently impacted`} tone="#f97316" icon={<LanRoundedIcon fontSize="small" />} />
            <MetricCard label="Backhauls + VIP" value={formatCount((summary.backhaulOpen || 0) + (summary.vipOpen || 0))} subtext={`${formatCount(summary.backhaulOpen || 0)} backhaul | ${formatCount(summary.vipOpen || 0)} VIP`} tone="#7c3aed" icon={<MonitorHeartRoundedIcon fontSize="small" />} />
            <MetricCard label="Tier 1 + Tier 2" value={formatCount((summary.tier1Open || 0) + (summary.tier2Open || 0))} subtext={`${formatCount(summary.tier2NewUnassigned || 0)} Tier 2 new + unassigned`} tone="#2563eb" icon={<SupportAgentRoundedIcon fontSize="small" />} />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', xl: '1.2fr 0.8fr' },
              gap: 1.05
            }}
          >
            <SectionCard title="Open Work By Lane" subtitle="Live open counts versus aged counts per lane from the current snapshot." tone="#0f766e" minHeight={0}>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: 1 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Open items
                  </Typography>
                  <LaneBars rows={laneChartData} dataKey="openCount" emptyMessage="No lane counts were returned for this snapshot." colorMap={Object.fromEntries(laneChartData.map((lane) => [lane.key, lane.tone]))} />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Aged items beyond lane threshold
                  </Typography>
                  <LaneBars rows={laneChartData} dataKey="agedCount" emptyMessage="No aged items are available in this snapshot." colorMap={Object.fromEntries(laneChartData.map((lane) => [lane.key, lane.tone]))} />
                </Box>
              </Box>
            </SectionCard>

            <SectionCard title="Impact Pressure" subtitle="Subscriber impact focus and operational hygiene counts from the current snapshot." tone="#1d4ed8" minHeight={0}>
              <Box sx={{ display: 'grid', gap: 1 }}>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                    Subscriber impact by outage lane
                  </Typography>
                  <LaneBars rows={impactChartData} dataKey="impactCount" emptyMessage="No subscriber impact is available right now." colorMap={Object.fromEntries(impactChartData.map((lane) => [lane.key, lane.tone]))} />
                </Box>
                <Stack direction="row" spacing={0.8} flexWrap="wrap" useFlexGap>
                  <Chip size="small" label={`Skipped ${formatCount(summary.skippedCount || 0)}`} color="warning" />
                  <Chip size="small" label={`Tier 2 new + unassigned ${formatCount(summary.tier2NewUnassigned || 0)}`} color="error" />
                  <Chip size="small" label={summary.telephonyWaiting !== null ? `Waiting calls ${formatCount(summary.telephonyWaiting)}` : 'Telephony not configured'} color={summary.telephonyWaiting ? 'success' : 'default'} />
                </Stack>
              </Box>
            </SectionCard>
          </Box>

          <SectionCard title="Operational Spotlights" subtitle="The strongest live watch items pulled from the latest snapshot." tone="#0f172a" minHeight={0}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
                gap: 0.95
              }}
            >
              {spotlights.length ? spotlights.map((item) => <SpotlightCard key={item.key} item={item} />) : (
                <AnalyticsChartFallback minHeight={180} message="No spotlight items are available for this snapshot." />
              )}
            </Box>
          </SectionCard>
        </Box>
      ) : null}

      {tab === 'outages' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <SectionCard title="Major Outage Desk" subtitle="Open non-NLD outage capturing tickets, ranked by age." tone="#dc2626" minHeight={0}>
            <MonitoringTable rows={collections.majorOutages || []} columns={majorColumns} emptyMessage="No major outage rows are open right now." />
          </SectionCard>

          <SectionCard title="NLD Outage Desk" subtitle="Open NLD outage capturing tickets with subscriber impact and last update context." tone="#f97316" minHeight={0}>
            <MonitoringTable rows={collections.nldOutages || []} columns={nldColumns} emptyMessage="No open NLD outage rows are visible right now." />
          </SectionCard>

          <SectionCard title="Backhaul Desk" subtitle="Open backhaul tickets driven off the configured backhaul tag." tone="#7c3aed" minHeight={0}>
            <MonitoringTable rows={collections.backhauls || []} columns={backhaulColumns} emptyMessage="No backhaul tickets are open right now." />
          </SectionCard>
        </Box>
      ) : null}

      {tab === 'tickets' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <SectionCard title="VIP Ticket Desk" subtitle="VIP organization and VIP-tag linked tickets in one deduped queue view." tone="#2563eb" minHeight={0}>
            <MonitoringTable rows={collections.vipTickets || []} columns={vipColumns} emptyMessage="No VIP-linked tickets are open right now." />
          </SectionCard>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' },
              gap: 1.05
            }}
          >
            <SectionCard title="Tier 1 Open Queue" subtitle="Open Tier 1 tickets from the Frogfoot Initial Form lane." tone="#0f766e" minHeight={0}>
              <MonitoringTable rows={collections.tier1Tickets || []} columns={ticketColumns} emptyMessage="No Tier 1 tickets are open right now." />
            </SectionCard>

            <SectionCard title="Tier 2 Open Queue" subtitle="Open Tier 2 tickets plus the new-and-unassigned pressure number in the page header." tone="#1d4ed8" minHeight={0}>
              <MonitoringTable rows={collections.tier2Tickets || []} columns={ticketColumns} emptyMessage="No Tier 2 tickets are open right now." />
            </SectionCard>
          </Box>
        </Box>
      ) : null}

      {tab === 'queues' ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' },
              gap: 1.05
            }}
          >
            <SectionCard title="Skipped Ticket Hygiene" subtitle="The visible Zendesk skip list from the current cached snapshot." tone="#475569" minHeight={0}>
              <MonitoringTable rows={collections.skippedTickets || []} columns={skippedColumns} emptyMessage="No skipped ticket rows are visible right now." />
            </SectionCard>

            <SectionCard title="Snapshot Warnings" subtitle="Per-source fetch issues are surfaced here instead of collapsing the entire monitoring page." tone="#d97706" minHeight={0}>
              <Stack spacing={0.8}>
                {warnings.length ? warnings.map((warning, index) => (
                  <Alert key={`${warning.source}-${index}`} severity="warning" icon={<WarningAmberRoundedIcon fontSize="inherit" />}>
                    <strong>{warning.source}</strong>: {warning.message}
                  </Alert>
                )) : (
                  <Alert severity="success">No source warnings were raised in the latest snapshot.</Alert>
                )}
                <Alert severity={collections.telephonyMeta?.available ? 'info' : 'warning'}>
                  {collections.telephonyMeta?.available
                    ? 'Telephony data was included in the current snapshot.'
                    : collections.telephonyMeta?.reason || 'Telephony data is not configured yet.'}
                </Alert>
              </Stack>
            </SectionCard>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', xl: '1fr 1fr' },
              gap: 1.05
            }}
          >
            <SectionCard title="Telephony Queues" subtitle="Queue pressure from the Illation dashboard stats feed when configured." tone="#059669" minHeight={0}>
              <MonitoringTable rows={collections.telephonyQueues || []} columns={queueColumns} emptyMessage="No telephony queue rows are available. Configure the Illation stats endpoint to light this up." />
            </SectionCard>

            <SectionCard title="Telephony Agents" subtitle="Agent-level queue states from the same telephony snapshot feed." tone="#0891b2" minHeight={0}>
              <MonitoringTable rows={collections.telephonyAgents || []} columns={agentColumns} emptyMessage="No telephony agent rows are available in this snapshot." />
            </SectionCard>
          </Box>
        </Box>
      ) : null}
    </PageShell>
  )
}
