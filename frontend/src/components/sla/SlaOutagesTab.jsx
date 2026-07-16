import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
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

function alphaHex(color, alpha) {
  return `${color}${alpha}`
}

function sectionSurface(tone) {
  return `linear-gradient(135deg, ${alphaHex(tone, '12')} 0%, ${alphaHex(tone, '04')} 52%, rgba(255,255,255,0) 100%)`
}

function SummaryCard({ label, value, tone, subtext }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.2,
        borderRadius: 2.8,
        border: '1px solid #e5e7eb',
        borderTop: `4px solid ${tone}`,
        background: `linear-gradient(180deg, ${alphaHex(tone, '10')} 0%, #ffffff 46%, #ffffff 100%)`,
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)'
      }}
    >
      <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.72 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.35, fontWeight: 900, lineHeight: 1 }}>
        {value}
      </Typography>
      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.6, fontSize: 12.5, opacity: 0.72 }}>
          {subtext}
        </Typography>
      ) : null}
    </Paper>
  )
}

function SectionCard({ title, subtitle, children, minHeight = 300, tone = '#0f172a', action = null }) {
  return (
    <Paper elevation={0} sx={{ border: '1px solid #e5e7eb', borderRadius: 3.25, height: '100%', minWidth: 0, overflow: 'hidden', boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)' }}>
      <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start" sx={{ px: 1.35, py: 1.15, borderBottom: '1px solid #eef2f7', background: sectionSurface(tone) }}>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={800}>
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
      <Box sx={{ minHeight, px: 1.2, py: 1.1 }}>{children}</Box>
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

function EmptyTableRow({ colSpan, message }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <Typography variant="body2" sx={{ py: 1 }}>
          {message}
        </Typography>
      </TableCell>
    </TableRow>
  )
}

function LoadingBlock({ message }) {
  return (
    <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 3.25 }}>
      <Typography variant="body2">{message}</Typography>
    </Paper>
  )
}

export default function SlaOutagesTab({ loading, error, outageData, fmtCount, fmtHours, fmtTs, onOpenOutage }) {
  const totalOutages = (outageData.byMonth || []).reduce((sum, row) => sum + Number(row.outageCount || 0), 0)
  const totalAffectedLinks = (outageData.byMonth || []).reduce((sum, row) => sum + Number(row.affectedLinks || 0), 0)
  const totalDowntimeHours = (outageData.byMonth || []).reduce((sum, row) => sum + Number(row.downtimeHours || 0), 0)

  if (loading) return <LoadingBlock message="Loading outage analytics..." />
  if (error) return <Alert severity="error">{error}</Alert>

  return (
    <Stack spacing={1.5}>
      <Paper elevation={0} sx={{ p: 1.25, border: '1px solid #e5e7eb', borderRadius: 3.25, boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)', background: 'linear-gradient(180deg, #fff7f7 0%, #ffffff 100%)' }}>
        <Stack spacing={1.1}>
          <Box>
            <Typography variant="overline" sx={{ letterSpacing: 0.9, color: '#dc2626' }}>
              Outage Analytics
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.74 }}>
              Evidence view of outage volume, impact, geography, and the biggest operational events in range.
            </Typography>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(3, minmax(0, 1fr))'
              }
            }}
          >
            <SummaryCard label="Outages" value={fmtCount(totalOutages)} tone="#dc2626" subtext="Unique outage refs across the selected range." />
            <SummaryCard label="Affected Links" value={fmtCount(totalAffectedLinks)} tone="#f59e0b" subtext="Client-link impact summed from the outage view." />
            <SummaryCard label="Downtime Hours" value={fmtHours(totalDowntimeHours)} tone="#0f172a" subtext="Accumulated outage duration attributed in range." />
          </Box>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap">
            <Chip size="small" label={`Months ${fmtCount((outageData.byMonth || []).length)}`} sx={{ fontWeight: 700 }} />
            <Chip size="small" label={`Largest table ${fmtCount((outageData.topOutages || []).length)} rows`} sx={{ fontWeight: 700 }} />
          </Stack>
        </Stack>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gap: 1.5,
          gridTemplateColumns: {
            xs: '1fr',
            xl: '1.3fr 1fr'
          },
          minWidth: 0
        }}
      >
        <SectionCard
          title="Outages By Month"
          subtitle="Count, affected links, and accumulated outage hours."
          tone="#dc2626"
          action={<Chip size="small" label={`${fmtCount((outageData.byMonth || []).length)} months`} sx={{ fontWeight: 700 }} />}
        >
          {outageData.byMonth?.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={outageData.byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip />
                <Legend />
                <Bar yAxisId="left" dataKey="outageCount" fill="#dc2626" name="Outages" radius={[4, 4, 0, 0]} />
                <Bar yAxisId="left" dataKey="affectedLinks" fill="#f59e0b" name="Affected Links" radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" dataKey="downtimeHours" stroke="#0f172a" strokeWidth={3} name="Downtime Hours" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Impact Type"
          subtitle="Top outage groups by impact type."
          tone="#f59e0b"
        >
          {outageData.byImpactType?.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={[...outageData.byImpactType].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={160} />
                <Tooltip />
                <Bar dataKey="outageCount" fill="#dc2626" radius={[0, 4, 4, 0]} name="Outages" />
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
          gap: 1.5,
          gridTemplateColumns: {
            xs: '1fr',
            xl: '1fr 1fr'
          },
          minWidth: 0
        }}
      >
        <SectionCard
          title="Cause Class"
          subtitle="Most frequent outage cause classes."
          tone="#2563eb"
        >
          {outageData.byCauseClass?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...outageData.byCauseClass].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Bar dataKey="outageCount" fill="#2563eb" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Region Hotspots"
          subtitle="Regions with the highest outage count in the selected range."
          tone="#0f766e"
        >
          {outageData.byRegion?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...outageData.byRegion].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={130} />
                <Tooltip />
                <Bar dataKey="outageCount" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>
      </Box>

      <SectionCard
        title="Largest Outages"
        subtitle="Operational view of the biggest outages by affected links and duration."
        minHeight={100}
        tone="#0f172a"
        action={<Chip size="small" label={`${fmtCount((outageData.topOutages || []).length)} rows`} sx={{ fontWeight: 700 }} />}
      >
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 980, '& th': { fontWeight: 800, bgcolor: '#f8fafc' } }}>
            <TableHead>
              <TableRow>
                <TableCell>Outage Ref</TableCell>
                <TableCell>Month</TableCell>
                <TableCell>Impact Type</TableCell>
                <TableCell>Cause Class</TableCell>
                <TableCell>Region</TableCell>
                <TableCell>Party at Fault</TableCell>
                <TableCell align="right">Affected Links</TableCell>
                <TableCell align="right">Duration</TableCell>
                <TableCell>Impact Start</TableCell>
                <TableCell>Impact Stop</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(outageData.topOutages || []).length ? (
                outageData.topOutages.map((row) => (
                  <TableRow
                    key={row.outageRef}
                    hover
                    sx={{ '& td': { whiteSpace: 'nowrap' } }}
                  >
                    <TableCell>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => onOpenOutage?.(row)}
                        sx={{ px: 0, textTransform: 'none', fontWeight: 700 }}
                      >
                        {row.outageRef}
                      </Button>
                    </TableCell>
                    <TableCell>{row.yearMonth}</TableCell>
                    <TableCell>{row.impactType}</TableCell>
                    <TableCell>{row.causeClass}</TableCell>
                    <TableCell>{row.region}</TableCell>
                    <TableCell>{row.partyAtFault}</TableCell>
                    <TableCell align="right">{fmtCount(row.affectedLinks)}</TableCell>
                    <TableCell align="right">{fmtHours(row.durationHours)}</TableCell>
                    <TableCell>{fmtTs(row.impactStart)}</TableCell>
                    <TableCell>{fmtTs(row.impactStop)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyTableRow colSpan={10} message="No outage data returned for the selected range." />
              )}
            </TableBody>
          </Table>
        </Box>
      </SectionCard>
    </Stack>
  )
}
