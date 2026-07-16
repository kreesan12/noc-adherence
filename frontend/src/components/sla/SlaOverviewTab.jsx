import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography
} from '@mui/material'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

const SLA_TARGET = 99.5
const PRODUCT_ORDER = ['FTTB', 'FTTH', 'FTTC']

function formatChange(value, digits = 2) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || n === 0) return 'Flat'
  return `${n > 0 ? '+' : '-'}${Math.abs(n).toFixed(digits)}`
}

function buildTrendChip(current, previous, key, { digits = 2, invert = false, suffix = '' } = {}) {
  if (!current) return null
  if (!previous) {
    return {
      label: `${current.yearMonth} baseline`,
      tone: '#64748b',
      textColor: '#0f172a'
    }
  }

  const delta = Number(current[key] || 0) - Number(previous[key] || 0)
  const good = invert ? delta <= 0 : delta >= 0
  return {
    label: `${formatChange(delta, digits)}${suffix} vs ${previous.yearMonth}`,
    tone: good ? '#dcfce7' : '#fee2e2',
    textColor: good ? '#166534' : '#991b1b'
  }
}

function MetricCard({ label, value, subtext, rows = [], tone = '#0f172a', trend = null }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.25,
        border: '1px solid #e5e7eb',
        borderTop: `4px solid ${tone}`,
        minHeight: rows.length ? 140 : 108,
        minWidth: 0
      }}
    >
      <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start" sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7 }}>
          {label}
        </Typography>
        {trend ? (
          <Chip
            size="small"
            label={trend.label}
            sx={{
              bgcolor: trend.tone,
              color: trend.textColor,
              fontWeight: 700,
              maxWidth: '100%'
            }}
          />
        ) : null}
      </Stack>

      <Typography variant="h6" fontWeight={800} sx={{ mt: 0.4 }}>
        {value}
      </Typography>

      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.55, opacity: 0.75, fontSize: 12.5 }}>
          {subtext}
        </Typography>
      ) : null}

      {rows.length ? (
        <Stack spacing={0.5} sx={{ mt: 1 }}>
          {rows.map((row) => (
            <Stack
              key={row.label}
              direction="row"
              spacing={1}
              justifyContent="space-between"
              alignItems="center"
              sx={{ minWidth: 0 }}
            >
              <Typography variant="body2" sx={{ opacity: 0.72, fontSize: 12.5 }}>
                {row.label}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 12.5, textAlign: 'right' }}>
                {row.value}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Paper>
  )
}

function InsightCard({ title, badge, message, tone = '#0f172a', actionLabel, onAction }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.25,
        border: '1px solid #e5e7eb',
        borderLeft: `4px solid ${tone}`,
        minHeight: 118,
        minWidth: 0
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {title}
        </Typography>
        {badge ? <Chip size="small" label={badge} /> : null}
      </Stack>

      <Typography variant="body2" sx={{ opacity: 0.82, minHeight: 44, fontSize: 13 }}>
        {message}
      </Typography>

      {actionLabel && onAction ? (
        <Button
          size="small"
          variant="outlined"
          onClick={onAction}
          sx={{ mt: 1.25, textTransform: 'none', fontWeight: 600 }}
        >
          {actionLabel}
        </Button>
      ) : null}
    </Paper>
  )
}

function SectionCard({ title, subtitle, children, minHeight = 280 }) {
  return (
    <Paper elevation={0} sx={{ p: 1.25, border: '1px solid #e5e7eb', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      <Typography variant="subtitle2" fontWeight={800}>
        {title}
      </Typography>
      {subtitle ? (
        <Typography variant="body2" sx={{ opacity: 0.7, mb: 1, fontSize: 12.5 }}>
          {subtitle}
        </Typography>
      ) : null}
      <Box sx={{ minHeight }}>{children}</Box>
    </Paper>
  )
}

function ChartFallback({ message = 'No data available for this view.' }) {
  return (
    <Box
      sx={{
        minHeight: 220,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        color: 'text.secondary'
      }}
    >
      <Typography variant="body2">{message}</Typography>
    </Box>
  )
}

function LoadingBlock({ message }) {
  return (
    <Paper elevation={0} sx={{ p: 3, textAlign: 'center', border: '1px solid #e5e7eb' }}>
      <Typography variant="body2">{message}</Typography>
    </Paper>
  )
}

export default function SlaOverviewTab({
  loading,
  error,
  overview,
  insights,
  trendLoading,
  trendError,
  focusLoading,
  focusError,
  fmtPct,
  fmtHours,
  fmtCount,
  onViewBreaches,
  onSelectIsp,
  onSelectProductType,
  onSelectServiceType
}) {
  const cards = overview?.cards || {}
  const allMonths = overview?.months || []
  const monthTrend = (overview?.monthTrend || []).slice(-6)
  const latestMonth = monthTrend[monthTrend.length - 1] || null
  const previousMonth = monthTrend[monthTrend.length - 2] || null
  const monthsInView = allMonths.length
  const rangeLabel = overview?.from && overview?.to
    ? `${overview.from} to ${overview.to}`
    : 'No range loaded'
  const productRows = PRODUCT_ORDER.map((label) => {
    const row = (overview?.productPerformance || []).find((entry) => entry.label === label)
    return {
      label,
      value: row ? fmtPct(row.avgUptimePct) : 'N/A'
    }
  })
  const ratioAverages = {
    ticket: monthTrend.length
      ? monthTrend.reduce((sum, row) => sum + Number(row.ticketContactRatioPct || 0), 0) / monthTrend.length
      : 0,
    outage: monthTrend.length
      ? monthTrend.reduce((sum, row) => sum + Number(row.outageImpactRatioPct || 0), 0) / monthTrend.length
      : 0,
    uniqueOutage: monthTrend.length
      ? monthTrend.reduce((sum, row) => sum + Number(row.uniqueOutageImpactRatioPct || 0), 0) / monthTrend.length
      : 0
  }

  if (loading) {
    return <LoadingBlock message="Loading SLA overview..." />
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>
  }

  return (
    <Stack spacing={1.5}>
      {trendError || focusError ? (
        <Alert severity="warning">
          {[trendError, focusError].filter(Boolean).join(' ')}
        </Alert>
      ) : null}

      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(4, minmax(0, 1fr))'
          },
          minWidth: 0
        }}
      >
        <MetricCard
          label="Average SLA"
          value={fmtPct(cards.avgUptimePct)}
          subtext={`${fmtCount(cards.totalLinks)} links in selected range`}
          trend={buildTrendChip(latestMonth, previousMonth, 'avgUptimePct', { digits: 2, suffix: ' pts' })}
          tone="#0f766e"
        />
        <MetricCard
          label="SLA by Product Group"
          value={fmtPct(cards.avgUptimePct)}
          subtext="Range average with grouped product views"
          rows={productRows}
          tone="#2563eb"
        />
        <MetricCard
          label="Breaching Links"
          value={fmtCount(cards.breachLinks)}
          subtext={`Below ${SLA_TARGET}% across the selected range`}
          trend={buildTrendChip(latestMonth, previousMonth, 'breachLinks', { digits: 0, invert: true })}
          tone="#dc2626"
        />
        <MetricCard
          label="Impacted Links"
          value={fmtCount(cards.impactedLinks)}
          subtext="Any month below 100% availability"
          trend={buildTrendChip(latestMonth, previousMonth, 'impactedLinks', { digits: 0, invert: true })}
          tone="#f59e0b"
        />
        <MetricCard
          label="Tickets"
          value={fmtCount(cards.ticketCount)}
          subtext="Ticket contacts in selected range"
          trend={buildTrendChip(latestMonth, previousMonth, 'ticketCount', { digits: 0, invert: true })}
          tone="#1d4ed8"
        />
        <MetricCard
          label="Outages"
          value={fmtCount(cards.outageCount)}
          subtext="Unique outage refs in selected range"
          rows={[
            { label: 'Minor incidents (<20 clients)', value: fmtCount(cards.minorOutageCount) },
            { label: 'Major outages (20+ clients)', value: fmtCount(cards.majorOutageCount) }
          ]}
          trend={buildTrendChip(latestMonth, previousMonth, 'outageCount', { digits: 0, invert: true })}
          tone="#0f172a"
        />
        <MetricCard
          label="Monthly Ratios"
          value={latestMonth ? latestMonth.yearMonth : 'No data'}
          subtext="Latest month with range averages beneath"
          rows={[
            {
              label: 'Ticket contact ratio',
              value: `${Number(latestMonth?.ticketContactRatioPct || 0).toFixed(2)}% | Avg ${ratioAverages.ticket.toFixed(2)}%`
            },
            {
              label: 'Outage impact ratio',
              value: `${Number(latestMonth?.outageImpactRatioPct || 0).toFixed(2)}% | Avg ${ratioAverages.outage.toFixed(2)}%`
            },
            {
              label: 'Unique outage impact ratio',
              value: `${Number(latestMonth?.uniqueOutageImpactRatioPct || 0).toFixed(2)}% | Avg ${ratioAverages.uniqueOutage.toFixed(2)}%`
            }
          ]}
          tone="#7c3aed"
        />
        <MetricCard
          label="Months In View"
          value={fmtCount(monthsInView)}
          subtext={`${rangeLabel} (${fmtCount(monthsInView)} months)`}
          tone="#334155"
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(4, minmax(0, 1fr))'
          },
          minWidth: 0
        }}
      >
        <InsightCard
          title="Watchlist"
          badge={insights?.watchlist?.badge}
          message={insights?.watchlist?.message}
          tone="#dc2626"
          actionLabel="Open In Explorer"
          onAction={insights?.watchlist?.actionLabel ? insights?.watchlist?.onAction : undefined}
        />
        <InsightCard
          title="Product Focus"
          badge={insights?.product?.badge}
          message={insights?.product?.message}
          tone="#f59e0b"
          actionLabel={insights?.product?.actionLabel}
          onAction={insights?.product?.actionLabel ? insights?.product?.onAction : undefined}
        />
        <InsightCard
          title="Incident Mix"
          badge={insights?.incident?.badge}
          message={insights?.incident?.message}
          tone="#0f172a"
        />
        <InsightCard
          title="Trend"
          badge={insights?.trend?.badge}
          message={insights?.trend?.message}
          tone={insights?.trend?.tone || '#0f766e'}
          actionLabel="View Breaches"
          onAction={onViewBreaches}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: {
            xs: '1fr',
            xl: '1.45fr 1fr'
          },
          minWidth: 0
        }}
      >
        <SectionCard
          title="Monthly Performance Story"
          subtitle="Average SLA with impacted and breaching link counts for the latest six months in range."
        >
          {trendLoading && !monthTrend.length ? (
            <ChartFallback message="Loading monthly trend..." />
          ) : monthTrend.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={monthTrend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis yAxisId="left" domain={[98, 100]} tickFormatter={(value) => `${value}%`} width={52} />
                <YAxis yAxisId="right" orientation="right" width={56} />
                <Tooltip />
                <Legend />
                <Bar yAxisId="right" dataKey="impactedLinks" fill="#f59e0b" name="Impacted Links" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="right" dataKey="breachLinks" fill="#dc2626" name="Breaching Links" radius={[6, 6, 0, 0]} />
                <Line yAxisId="left" type="monotone" dataKey="avgUptimePct" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} name="Average SLA" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Worst Performing ISPs"
          subtitle="Average SLA order for the weakest performers in the selected range. Click a bar to open that ISP in the explorer."
        >
          {focusLoading && !overview.worstIsps?.length ? (
            <ChartFallback message="Loading ISP watchlist..." />
          ) : overview.worstIsps?.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={[...overview.worstIsps].reverse()} layout="vertical" margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" domain={[95, 100]} tickFormatter={(value) => `${value}%`} />
                <YAxis type="category" dataKey="isp" width={112} />
                <Tooltip />
                <Bar
                  dataKey="avgUptimePct"
                  fill="#dc2626"
                  radius={[0, 6, 6, 0]}
                  name="Average SLA"
                  cursor="pointer"
                  onClick={(row) => onSelectIsp?.(row?.isp)}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: {
            xs: '1fr',
            xl: '1fr 1fr'
          },
          minWidth: 0
        }}
      >
        <SectionCard
          title="Product Group SLA"
          subtitle="Average SLA by grouped product type."
        >
          {focusLoading && !overview.productPerformance?.length ? (
            <ChartFallback message="Loading grouped product SLA..." />
          ) : overview.productPerformance?.length ? (
            <ResponsiveContainer width="100%" height={255}>
              <BarChart data={[...overview.productPerformance]} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" />
                <YAxis domain={[95, 100]} tickFormatter={(value) => `${value}%`} width={50} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="avgUptimePct"
                  fill="#2563eb"
                  name="Average SLA"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Monthly Contact Ratios"
          subtitle="Ticket and outage ratios relative to the active link base for the latest six months in range."
        >
          {trendLoading && !monthTrend.length ? (
            <ChartFallback message="Loading monthly ratios..." />
          ) : monthTrend.length ? (
            <ResponsiveContainer width="100%" height={255}>
              <ComposedChart data={monthTrend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis tickFormatter={(value) => `${Number(value).toFixed(1)}%`} width={58} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="ticketContactRatioPct" stroke="#1d4ed8" strokeWidth={3} dot={{ r: 3 }} name="Ticket Contact Ratio" />
                <Line type="monotone" dataKey="outageImpactRatioPct" stroke="#0f172a" strokeWidth={3} dot={{ r: 3 }} name="Outage Impact Ratio" />
                <Line type="monotone" dataKey="uniqueOutageImpactRatioPct" stroke="#7c3aed" strokeWidth={3} dot={{ r: 3 }} name="Unique Outage Impact Ratio" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>
      </Box>
    </Stack>
  )
}
