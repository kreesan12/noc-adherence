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
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

const SLA_TARGET = 99.5
const PRODUCT_ORDER = ['FTTB', 'FTTH', 'FTTC']
const PRODUCT_COLORS = {
  FTTB: '#0f766e',
  FTTH: '#2563eb',
  FTTC: '#7c3aed'
}

function alphaHex(color, alpha) {
  return `${color}${alpha}`
}

function cardSurface(tone) {
  return `radial-gradient(circle at top right, ${alphaHex(tone, '18')} 0%, transparent 36%), linear-gradient(180deg, ${alphaHex(tone, '10')} 0%, #ffffff 40%, #ffffff 100%)`
}

function sectionSurface(tone) {
  return `linear-gradient(135deg, ${alphaHex(tone, '12')} 0%, ${alphaHex(tone, '04')} 52%, rgba(255,255,255,0) 100%)`
}

function hasNumericValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
}

function compactLabel(value, limit = 24) {
  const text = String(value || '').trim()
  if (!text) return 'Unknown'
  if (text.length <= limit) return text
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`
}

function buildPercentDomain(rows, keys, floor = 98) {
  const values = []
  for (const row of rows || []) {
    for (const key of keys || []) {
      if (hasNumericValue(row?.[key])) values.push(Number(row[key]))
    }
  }
  if (!values.length) return [floor, 100]
  const min = Math.min(SLA_TARGET, ...values)
  const max = Math.max(SLA_TARGET, ...values)
  const lower = Math.max(floor, Math.floor((min - 0.25) * 10) / 10)
  const upper = Math.min(100, Math.ceil((max + 0.15) * 10) / 10)
  return [lower, upper > lower ? upper : Math.min(100, lower + 0.5)]
}

function buildHeatTone(rate) {
  const pct = Number(rate || 0)
  if (pct >= 12) {
    return { bg: '#fee2e2', border: '#fecaca', text: '#991b1b', accent: '#dc2626' }
  }
  if (pct >= 6) {
    return { bg: '#ffedd5', border: '#fed7aa', text: '#9a3412', accent: '#f97316' }
  }
  if (pct >= 2) {
    return { bg: '#fef3c7', border: '#fde68a', text: '#92400e', accent: '#f59e0b' }
  }
  return { bg: '#dcfce7', border: '#bbf7d0', text: '#166534', accent: '#16a34a' }
}

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

function MetricCard({ label, value, subtext, rows = [], tone = '#0f172a', trend = null, spark = null }) {
  return (
    <Paper
      elevation={0}
      sx={{
        position: 'relative',
        p: 1.35,
        border: '1px solid #e5e7eb',
        borderTop: `4px solid ${tone}`,
        borderRadius: 3,
        background: cardSurface(tone),
        boxShadow: '0 14px 32px rgba(15, 23, 42, 0.06)',
        minHeight: rows.length ? 148 : 118,
        minWidth: 0,
        overflow: 'hidden',
        transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
        '&:hover': {
          transform: 'translateY(-1px)',
          boxShadow: '0 18px 34px rgba(15, 23, 42, 0.09)',
          borderColor: alphaHex(tone, '55')
        }
      }}
    >
      <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start" sx={{ minWidth: 0 }}>
        <Stack spacing={0.8} sx={{ minWidth: 0, flex: 1 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              sx={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                bgcolor: tone,
                boxShadow: `0 0 0 5px ${alphaHex(tone, '14')}`
              }}
            />
            <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.7, opacity: 0.72 }}>
              {label}
            </Typography>
          </Stack>
          <Typography
            variant="h5"
            fontWeight={900}
            sx={{ lineHeight: 1, letterSpacing: '-0.02em', color: '#0f172a' }}
          >
            {value}
          </Typography>
        </Stack>
        {trend ? (
          <Chip
            size="small"
            label={trend.label}
            sx={{
              bgcolor: trend.tone,
              color: trend.textColor,
              border: `1px solid ${trend.textColor}22`,
              fontWeight: 700,
              maxWidth: '100%',
              '& .MuiChip-label': {
                px: 1
              }
            }}
          />
        ) : null}
      </Stack>

      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.8, opacity: 0.72, fontSize: 12.5, maxWidth: 280 }}>
          {subtext}
        </Typography>
      ) : null}

      {rows.length ? (
        <Stack spacing={0.65} sx={{ mt: 1.1 }}>
          {rows.map((row) => (
            <Stack
              key={row.label}
              direction="row"
              spacing={1}
              justifyContent="space-between"
              alignItems="center"
              sx={{
                minWidth: 0,
                px: 0.9,
                py: 0.5,
                borderRadius: 1.5,
                bgcolor: alphaHex(tone, '0a'),
                border: `1px solid ${alphaHex(tone, '12')}`
              }}
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

      {spark?.data?.length > 1 ? (
        <Box sx={{ mt: rows.length ? 0.95 : 1.15, pt: 0.55, borderTop: `1px solid ${alphaHex(tone, '12')}` }}>
          <ResponsiveContainer width="100%" height={42}>
            <AreaChart data={spark.data} margin={{ top: 4, right: 2, left: 2, bottom: 0 }}>
              <Area
                type="monotone"
                dataKey={spark.dataKey}
                stroke={spark.color || tone}
                fill={alphaHex(spark.color || tone, '18')}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>
      ) : null}
    </Paper>
  )
}

function InsightCard({ title, badge, message, tone = '#0f172a', actionLabel, onAction }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.3,
        border: '1px solid #e5e7eb',
        borderLeft: `4px solid ${tone}`,
        borderRadius: 3,
        minHeight: 126,
        minWidth: 0,
        background: `linear-gradient(135deg, ${alphaHex(tone, '10')} 0%, #ffffff 30%, #ffffff 100%)`,
        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)'
      }}
    >
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.05 }}>
        <Typography variant="subtitle2" fontWeight={800}>
          {title}
        </Typography>
        {badge ? (
          <Chip
            size="small"
            label={badge}
            sx={{
              bgcolor: alphaHex(tone, '12'),
              color: tone,
              border: `1px solid ${alphaHex(tone, '24')}`,
              fontWeight: 700
            }}
          />
        ) : null}
      </Stack>

      <Typography variant="body2" sx={{ opacity: 0.82, minHeight: 48, fontSize: 13, lineHeight: 1.45 }}>
        {message}
      </Typography>

      {actionLabel && onAction ? (
        <Button
          size="small"
          variant="outlined"
          onClick={onAction}
          sx={{
            mt: 1.3,
            textTransform: 'none',
            fontWeight: 700,
            borderColor: alphaHex(tone, '48'),
            color: tone,
            '&:hover': {
              borderColor: tone,
              bgcolor: alphaHex(tone, '0f')
            }
          }}
        >
          {actionLabel}
        </Button>
      ) : null}
    </Paper>
  )
}

function SectionCard({ title, subtitle, children, minHeight = 280, action = null, bodySx = {}, tone = '#0f172a' }) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid #e5e7eb',
        borderRadius: 3,
        minWidth: 0,
        overflow: 'hidden',
        background: '#ffffff',
        boxShadow: '0 14px 32px rgba(15, 23, 42, 0.05)'
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{
          minWidth: 0,
          px: 1.35,
          py: 1.15,
          borderBottom: '1px solid #eef2f7',
          background: sectionSurface(tone)
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={800} sx={{ color: '#0f172a' }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" sx={{ opacity: 0.72, fontSize: 12.5 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
      </Stack>
      <Box sx={{ px: 1.25, py: 1.15, minHeight, ...bodySx }}>{children}</Box>
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
  const productMonthTrend = (overview?.productMonthTrend || []).slice(-6)
  const latestMonth = monthTrend[monthTrend.length - 1] || null
  const previousMonth = monthTrend[monthTrend.length - 2] || null
  const monthsInView = allMonths.length
  const rangeLabel = overview?.from && overview?.to
    ? `${overview.from} to ${overview.to}`
    : 'No range loaded'
  const monthlySlaDomain = buildPercentDomain(monthTrend, ['avgUptimePct'], 98)
  const productSlaDomain = buildPercentDomain(productMonthTrend, PRODUCT_ORDER, 98)
  const productRows = PRODUCT_ORDER.map((label) => {
    const row = (overview?.productPerformance || []).find((entry) => entry.label === label)
    return {
      label,
      value: row ? fmtPct(row.avgUptimePct) : 'N/A'
    }
  })
  const activeProductGroups = PRODUCT_ORDER.filter((label) =>
    productMonthTrend.some((row) => hasNumericValue(row?.[label]))
  )
  const monthlyRiskStrip = monthTrend.map((row) => {
    const totalLinks = Number(row.totalLinks || 0)
    const breachRate = totalLinks ? (Number(row.breachLinks || 0) / totalLinks) * 100 : 0
    const impactedRate = totalLinks ? (Number(row.impactedLinks || 0) / totalLinks) * 100 : 0
    return {
      ...row,
      breachRate,
      impactedRate,
      tone: buildHeatTone(breachRate)
    }
  })
  const sparkByKey = {
    avgUptimePct: monthTrend.map((row) => ({ yearMonth: row.yearMonth, value: Number(row.avgUptimePct || 0) })),
    breachLinks: monthTrend.map((row) => ({ yearMonth: row.yearMonth, value: Number(row.breachLinks || 0) })),
    impactedLinks: monthTrend.map((row) => ({ yearMonth: row.yearMonth, value: Number(row.impactedLinks || 0) })),
    ticketCount: monthTrend.map((row) => ({ yearMonth: row.yearMonth, value: Number(row.ticketCount || 0) })),
    outageCount: monthTrend.map((row) => ({ yearMonth: row.yearMonth, value: Number(row.outageCount || 0) }))
  }
  const worstIspRows = (overview?.worstIsps || []).slice(0, 6).map((row, index) => ({
    ...row,
    rank: index + 1,
    shortIsp: compactLabel(row.isp, 24)
  }))
  const serviceRows = [...(overview?.servicePerformance || [])]
    .slice(0, 6)
    .map((row) => ({
      ...row,
      shortLabel: compactLabel(row.label, 22)
    }))
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
          spark={{ data: sparkByKey.avgUptimePct, dataKey: 'value', color: '#0f766e' }}
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
          spark={{ data: sparkByKey.breachLinks, dataKey: 'value', color: '#dc2626' }}
        />
        <MetricCard
          label="Impacted Links"
          value={fmtCount(cards.impactedLinks)}
          subtext="Any month below 100% availability"
          trend={buildTrendChip(latestMonth, previousMonth, 'impactedLinks', { digits: 0, invert: true })}
          tone="#f59e0b"
          spark={{ data: sparkByKey.impactedLinks, dataKey: 'value', color: '#f59e0b' }}
        />
        <MetricCard
          label="Tickets"
          value={fmtCount(cards.ticketCount)}
          subtext="Ticket contacts in selected range"
          trend={buildTrendChip(latestMonth, previousMonth, 'ticketCount', { digits: 0, invert: true })}
          tone="#1d4ed8"
          spark={{ data: sparkByKey.ticketCount, dataKey: 'value', color: '#1d4ed8' }}
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
          spark={{ data: sparkByKey.outageCount, dataKey: 'value', color: '#0f172a' }}
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

      <SectionCard
        title="Monthly Risk Strip"
        subtitle="Compact month-by-month view of breach intensity and impact density across the selected range."
        minHeight={108}
        tone="#f59e0b"
        action={<Chip size="small" label={`${monthTrend.length || 0} months`} sx={{ fontWeight: 700 }} />}
        bodySx={{ py: 1, px: 1.1 }}
      >
        {monthlyRiskStrip.length ? (
          <Box
            sx={{
              display: 'grid',
              gap: 0.9,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: `repeat(${Math.min(Math.max(monthlyRiskStrip.length, 1), 6)}, minmax(0, 1fr))`
              }
            }}
          >
            {monthlyRiskStrip.map((row) => (
              <Paper
                key={row.yearMonth}
                elevation={0}
                sx={{
                  p: 1,
                  borderRadius: 2.5,
                  border: `1px solid ${row.tone.border}`,
                  bgcolor: row.tone.bg,
                  minWidth: 0
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, color: row.tone.text }}>
                      {row.yearMonth}
                    </Typography>
                    <Typography variant="caption" sx={{ color: row.tone.text, opacity: 0.9 }}>
                      Breach rate {row.breachRate.toFixed(2)}%
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={fmtPct(row.avgUptimePct)}
                    sx={{
                      bgcolor: '#fff',
                      color: row.tone.text,
                      border: `1px solid ${row.tone.border}`,
                      fontWeight: 700
                    }}
                  />
                </Stack>
                <Box sx={{ mt: 1 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.35 }}>
                    <Typography variant="caption" sx={{ color: row.tone.text }}>Breaches</Typography>
                    <Typography variant="caption" sx={{ color: row.tone.text, fontWeight: 700 }}>{fmtCount(row.breachLinks)}</Typography>
                  </Box>
                  <Box sx={{ height: 6, borderRadius: 3, bgcolor: '#fff', overflow: 'hidden' }}>
                    <Box sx={{ width: `${Math.min(100, Math.max(6, row.breachRate * 6))}%`, height: '100%', bgcolor: row.tone.accent }} />
                  </Box>
                </Box>
                <Stack direction="row" spacing={1.2} sx={{ mt: 0.9, flexWrap: 'wrap' }}>
                  <Typography variant="caption" sx={{ color: row.tone.text }}>Impacted {fmtCount(row.impactedLinks)}</Typography>
                  <Typography variant="caption" sx={{ color: row.tone.text }}>Impact rate {row.impactedRate.toFixed(2)}%</Typography>
                </Stack>
              </Paper>
            ))}
          </Box>
        ) : (
          <ChartFallback message="No month-level risk pattern available." />
        )}
      </SectionCard>

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
          alignItems: 'start',
          minWidth: 0
        }}
      >
        <SectionCard
          title="Monthly Performance Story"
          subtitle="Average SLA with impacted and breaching link counts for the latest six months in range."
          minHeight={248}
          action={<Chip size="small" label={`Target ${SLA_TARGET}%`} sx={{ fontWeight: 700 }} />}
          tone="#0f766e"
        >
          {trendLoading && !monthTrend.length ? (
            <ChartFallback message="Loading monthly trend..." />
          ) : monthTrend.length ? (
            <ResponsiveContainer width="100%" height={248}>
              <ComposedChart data={monthTrend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis yAxisId="left" domain={monthlySlaDomain} tickFormatter={(value) => `${value}%`} width={52} />
                <YAxis yAxisId="right" orientation="right" width={56} />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === 'Average SLA') return [fmtPct(value), name]
                    return [fmtCount(value), name]
                  }}
                />
                <Legend />
                <ReferenceLine yAxisId="left" y={SLA_TARGET} stroke="#0f766e" strokeDasharray="5 4" name="SLA Target" />
                <Bar yAxisId="right" dataKey="impactedLinks" fill="#f59e0b" name="Impacted Links" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="breachLinks" fill="#dc2626" name="Breaching Links" radius={[4, 4, 0, 0]} />
                <Line yAxisId="left" type="monotone" dataKey="avgUptimePct" stroke="#0f766e" strokeWidth={3} dot={{ r: 3 }} name="Average SLA" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <Box sx={{ display: 'grid', gap: 1.25, minWidth: 0 }}>
          <SectionCard
            title="Worst Performing ISPs"
            subtitle="Top six weakest performers in range. Click a bar to open that ISP in the explorer."
            minHeight={210}
            action={<Chip size="small" label={`Top ${worstIspRows.length || 0}`} sx={{ fontWeight: 700 }} />}
            tone="#dc2626"
          >
            {focusLoading && !worstIspRows.length ? (
              <ChartFallback message="Loading ISP watchlist..." />
            ) : worstIspRows.length ? (
              <ResponsiveContainer width="100%" height={210}>
                <BarChart
                  data={worstIspRows}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                  onClick={(state) => {
                    const isp = state?.activePayload?.[0]?.payload?.isp
                    if (isp) onSelectIsp?.(isp)
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" domain={[95, 100]} tickFormatter={(value) => `${value}%`} />
                  <YAxis type="category" dataKey="shortIsp" width={120} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Average SLA') return [fmtPct(value), name]
                      return [fmtCount(value), name]
                    }}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.isp || label}
                  />
                  <ReferenceLine x={SLA_TARGET} stroke="#0f766e" strokeDasharray="5 4" />
                  <Bar dataKey="avgUptimePct" fill="#dc2626" name="Average SLA" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartFallback />
            )}
          </SectionCard>

          <SectionCard
            title="Service Type Pressure"
            subtitle="Highest impacted service types in range. Click a bar to filter the dashboard."
            minHeight={180}
            action={<Chip size="small" label={`${serviceRows.length || 0} visible`} sx={{ fontWeight: 700 }} />}
            tone="#1d4ed8"
          >
            {focusLoading && !serviceRows.length ? (
              <ChartFallback message="Loading service pressure..." />
            ) : serviceRows.length ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={serviceRows}
                  layout="vertical"
                  margin={{ top: 0, right: 8, left: 0, bottom: 0 }}
                  onClick={(state) => {
                    const service = state?.activePayload?.[0]?.payload?.label
                    if (service) onSelectServiceType?.(service)
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="shortLabel" width={116} tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value, name) => {
                      if (name === 'Impacted Links') return [fmtCount(value), name]
                      return [fmtPct(value), name]
                    }}
                    labelFormatter={(label, payload) => payload?.[0]?.payload?.label || label}
                  />
                  <Bar dataKey="impactedLinks" fill="#1d4ed8" name="Impacted Links" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartFallback />
            )}
          </SectionCard>
        </Box>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gap: 1.25,
          gridTemplateColumns: {
            xs: '1fr',
            xl: '1fr 1fr'
          },
          alignItems: 'start',
          minWidth: 0
        }}
      >
        <SectionCard
          title="Product Group SLA By Month"
          subtitle="Monthly average SLA by grouped product family across the selected range."
          minHeight={248}
          action={<Chip size="small" label={activeProductGroups.join(' / ') || 'No groups'} sx={{ fontWeight: 700 }} />}
          tone="#7c3aed"
        >
          {focusLoading && !productMonthTrend.length ? (
            <ChartFallback message="Loading grouped product SLA..." />
          ) : productMonthTrend.length && activeProductGroups.length ? (
            <ResponsiveContainer width="100%" height={248}>
              <ComposedChart data={productMonthTrend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis domain={productSlaDomain} tickFormatter={(value) => `${value}%`} width={52} />
                <Tooltip
                  formatter={(value, name) => [hasNumericValue(value) ? fmtPct(value) : 'N/A', `${name} SLA`]}
                />
                <Legend />
                <ReferenceLine y={SLA_TARGET} stroke="#dc2626" strokeDasharray="5 4" name="SLA Target" />
                {activeProductGroups.map((label) => (
                  <Line
                    key={label}
                    type="monotone"
                    dataKey={label}
                    stroke={PRODUCT_COLORS[label] || '#334155'}
                    strokeWidth={3}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                    connectNulls
                    name={label}
                  />
                ))}
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Monthly Contact Ratios"
          subtitle="Ticket and outage ratios relative to the active link base for the latest six months in range."
          minHeight={248}
          action={<Chip size="small" label={latestMonth?.yearMonth || 'No data'} sx={{ fontWeight: 700 }} />}
          tone="#0f172a"
        >
          {trendLoading && !monthTrend.length ? (
            <ChartFallback message="Loading monthly ratios..." />
          ) : monthTrend.length ? (
            <ResponsiveContainer width="100%" height={248}>
              <ComposedChart data={monthTrend} margin={{ left: 0, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis tickFormatter={(value) => `${Number(value).toFixed(1)}%`} width={58} />
                <Tooltip formatter={(value) => [`${Number(value || 0).toFixed(2)}%`, 'Ratio']} />
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
