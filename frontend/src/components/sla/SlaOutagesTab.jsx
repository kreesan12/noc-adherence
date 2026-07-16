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

function SectionCard({ title, subtitle, children, minHeight = 300 }) {
  return (
    <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb', height: '100%', minWidth: 0, overflow: 'hidden' }}>
      <Typography variant="subtitle1" fontWeight={700}>
        {title}
      </Typography>
      {subtitle ? (
        <Typography variant="body2" sx={{ opacity: 0.7, mb: 1.25 }}>
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
    <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid #e5e7eb' }}>
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
      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
          <Chip size="small" label={`Outages ${fmtCount(totalOutages)}`} />
          <Chip size="small" label={`Affected Links ${fmtCount(totalAffectedLinks)}`} color={totalAffectedLinks ? 'warning' : 'default'} />
          <Chip size="small" label={`Downtime ${fmtHours(totalDowntimeHours)}`} color={totalDowntimeHours ? 'error' : 'default'} />
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
                <Bar yAxisId="left" dataKey="outageCount" fill="#dc2626" name="Outages" radius={[6, 6, 0, 0]} />
                <Bar yAxisId="left" dataKey="affectedLinks" fill="#f59e0b" name="Affected Links" radius={[6, 6, 0, 0]} />
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
        >
          {outageData.byImpactType?.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={[...outageData.byImpactType].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={160} />
                <Tooltip />
                <Bar dataKey="outageCount" fill="#dc2626" radius={[0, 6, 6, 0]} name="Outages" />
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
        >
          {outageData.byCauseClass?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...outageData.byCauseClass].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Bar dataKey="outageCount" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Region Hotspots"
          subtitle="Regions with the highest outage count in the selected range."
        >
          {outageData.byRegion?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...outageData.byRegion].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={130} />
                <Tooltip />
                <Bar dataKey="outageCount" fill="#f59e0b" radius={[0, 6, 6, 0]} />
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
      >
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 980 }}>
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
