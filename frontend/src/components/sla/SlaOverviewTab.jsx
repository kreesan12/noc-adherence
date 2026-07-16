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

function MetricCard({ label, value, subtext, tone = '#0f172a' }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.25,
        border: '1px solid #e5e7eb',
        borderTop: `4px solid ${tone}`,
        minHeight: 92,
        minWidth: 0
      }}
    >
      <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, opacity: 0.7 }}>
        {label}
      </Typography>
      <Typography variant="h6" fontWeight={800} sx={{ mt: 0.4 }}>
        {value}
      </Typography>
      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.55, opacity: 0.75, fontSize: 12.5 }}>
          {subtext}
        </Typography>
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
  const totalLinks = Number(cards.totalLinks || 0)
  const breachRate = totalLinks ? (Number(cards.breachLinks || 0) / totalLinks) * 100 : 0
  const ticketDensity = totalLinks ? (Number(cards.ticketCount || 0) / totalLinks) * 100 : 0
  const outageDensity = totalLinks ? (Number(cards.outageCount || 0) / totalLinks) * 100 : 0
  const monthsInView = (overview?.months || []).length

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
            sm: 'repeat(2, 1fr)',
            lg: 'repeat(4, 1fr)'
          },
          minWidth: 0
        }}
      >
        <MetricCard
          label="Average SLA"
          value={fmtPct(cards.avgUptimePct)}
          subtext={`${fmtCount(cards.totalLinks)} links in range`}
          tone="#0f766e"
        />
        <MetricCard
          label="Breaching Links"
          value={fmtCount(cards.breachLinks)}
          subtext={`Below ${SLA_TARGET}% over selected range`}
          tone="#dc2626"
        />
        <MetricCard
          label="Impacted Links"
          value={fmtCount(cards.impactedLinks)}
          subtext="Any month below 100% availability"
          tone="#f59e0b"
        />
        <MetricCard
          label="Total Downtime"
          value={fmtHours(cards.totalDowntimeHours)}
          subtext={`Worst observed SLA ${fmtPct(cards.worstUptimePct)}`}
          tone="#2563eb"
        />
        <MetricCard
          label="Tickets"
          value={fmtCount(cards.ticketCount)}
          subtext={`${fmtCount(cards.serviceImpactingTickets)} service impacting`}
          tone="#1d4ed8"
        />
        <MetricCard
          label="Outages"
          value={fmtCount(cards.outageCount)}
          subtext="Distinct outages in selected range"
          tone="#0f172a"
        />
        <MetricCard
          label="Breach Rate"
          value={fmtPct(breachRate)}
          subtext="Breaching links as a share of the loaded base"
          tone="#7c3aed"
        />
        <MetricCard
          label="Tickets / 100 Links"
          value={ticketDensity.toFixed(1)}
          subtext="Operational load indicator for the selected range"
          tone="#0891b2"
        />
        <MetricCard
          label="Outages / 100 Links"
          value={outageDensity.toFixed(1)}
          subtext="Outage concentration relative to the link base"
          tone="#b45309"
        />
        <MetricCard
          label="Months In View"
          value={fmtCount(monthsInView)}
          subtext={(overview?.months || []).join(' to ') || 'No range loaded'}
          tone="#334155"
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: {
            xs: '1fr',
            md: 'repeat(2, 1fr)',
            xl: 'repeat(4, 1fr)'
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
          actionLabel="Filter Product"
          onAction={insights?.product?.actionLabel ? insights?.product?.onAction : undefined}
        />
        <InsightCard
          title="Service Focus"
          badge={insights?.service?.badge}
          message={insights?.service?.message}
          tone="#2563eb"
          actionLabel="Filter Service"
          onAction={insights?.service?.actionLabel ? insights?.service?.onAction : undefined}
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
            xl: '1.5fr 1fr'
          },
          minWidth: 0
        }}
      >
        <SectionCard
          title="Monthly Performance Story"
          subtitle="Average SLA line with impacted and breaching link counts by month."
        >
          {trendLoading && !overview.monthTrend?.length ? (
            <ChartFallback message="Loading monthly trend..." />
          ) : overview.monthTrend?.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={overview.monthTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis yAxisId="left" domain={[98, 100]} tickFormatter={(value) => `${value}%`} />
                <YAxis yAxisId="right" orientation="right" />
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
              <BarChart data={[...overview.worstIsps].reverse()} layout="vertical" margin={{ left: 20, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" domain={[95, 100]} tickFormatter={(value) => `${value}%`} />
                <YAxis type="category" dataKey="isp" width={140} />
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
          title="Product Performance"
          subtitle="Where the impacted links are concentrating by product type. Click a bar to filter the full dashboard."
        >
          {focusLoading && !overview.productPerformance?.length ? (
            <ChartFallback message="Loading product concentration..." />
          ) : overview.productPerformance?.length ? (
            <ResponsiveContainer width="100%" height={255}>
              <BarChart data={[...overview.productPerformance].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="impactedLinks"
                  fill="#f59e0b"
                  name="Impacted Links"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(row) => onSelectProductType?.(row?.label)}
                />
                <Bar
                  dataKey="linkCount"
                  fill="#cbd5e1"
                  name="Total Links"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(row) => onSelectProductType?.(row?.label)}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Service Performance"
          subtitle="Impact pattern by service type for the selected range. Click a bar to filter the full dashboard."
        >
          {focusLoading && !overview.servicePerformance?.length ? (
            <ChartFallback message="Loading service concentration..." />
          ) : overview.servicePerformance?.length ? (
            <ResponsiveContainer width="100%" height={255}>
              <BarChart data={[...overview.servicePerformance].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="impactedLinks"
                  fill="#2563eb"
                  name="Impacted Links"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(row) => onSelectServiceType?.(row?.label)}
                />
                <Bar
                  dataKey="linkCount"
                  fill="#cbd5e1"
                  name="Total Links"
                  radius={[0, 6, 6, 0]}
                  cursor="pointer"
                  onClick={(row) => onSelectServiceType?.(row?.label)}
                />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>
      </Box>
    </Stack>
  )
}
