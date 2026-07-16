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

export default function SlaTicketsTab({
  loading,
  error,
  ticketData,
  fmtCount,
  fmtHours,
  onOpenTicket
}) {
  const total = (ticketData.byMonth || []).reduce((sum, row) => sum + Number(row.ticketCount || 0), 0)
  const serviceImpacting = (ticketData.byMonth || []).reduce((sum, row) => sum + Number(row.serviceImpactingTickets || 0), 0)
  const adjusted = (ticketData.byMonth || []).reduce((sum, row) => sum + Number(row.accessAdjustedTickets || 0), 0)

  if (loading) return <LoadingBlock message="Loading ticket analytics..." />
  if (error) return <Alert severity="error">{error}</Alert>

  return (
    <Stack spacing={1.5}>
      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
          <Chip size="small" label={`Tickets ${fmtCount(total)}`} />
          <Chip size="small" label={`Service Impacting ${fmtCount(serviceImpacting)}`} color={serviceImpacting ? 'warning' : 'default'} />
          <Chip size="small" label={`Access Adjusted ${fmtCount(adjusted)}`} color={adjusted ? 'info' : 'default'} />
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
          title="Tickets By Month"
          subtitle="Shows total, service impacting, and site-access-adjusted ticket counts."
        >
          {ticketData.byMonth?.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={ticketData.byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="ticketCount" fill="#cbd5e1" name="All Tickets" radius={[6, 6, 0, 0]} />
                <Bar dataKey="serviceImpactingTickets" fill="#dc2626" name="Service Impacting" radius={[6, 6, 0, 0]} />
                <Bar dataKey="accessAdjustedTickets" fill="#2563eb" name="Access Adjusted" radius={[6, 6, 0, 0]} />
                <Line dataKey="avgFinalDowntimeHours" stroke="#0f172a" strokeWidth={3} name="Avg Final Downtime (h)" />
              </ComposedChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Ticket Categories"
          subtitle="Category split after your ticket cleanup logic."
        >
          {ticketData.byCategory?.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={[...ticketData.byCategory].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={180} />
                <Tooltip />
                <Bar dataKey="ticketCount" fill="#0f766e" radius={[0, 6, 6, 0]} />
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
          title="Severity Mix"
          subtitle="Top severities from the underlying Zendesk ticket data."
        >
          {ticketData.bySeverity?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...ticketData.bySeverity].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Bar dataKey="ticketCount" fill="#f59e0b" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Party At Fault"
          subtitle="High-level responsibility view from the source tickets."
        >
          {ticketData.byPartyAtFault?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...ticketData.byPartyAtFault].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Bar dataKey="ticketCount" fill="#2563eb" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>
      </Box>

      <SectionCard
        title="Longest Ticket Downtimes"
        subtitle="Includes raw, excluded, and final downtime so site-access impact is visible."
        minHeight={100}
      >
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 980 }}>
            <TableHead>
              <TableRow>
                <TableCell>Ticket</TableCell>
                <TableCell>FRG</TableCell>
                <TableCell>Month</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Party at Fault</TableCell>
                <TableCell>Site Access</TableCell>
                <TableCell align="right">Raw</TableCell>
                <TableCell align="right">Excluded</TableCell>
                <TableCell align="right">Final</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(ticketData.topTickets || []).length ? (
                ticketData.topTickets.map((row) => (
                  <TableRow
                    key={`${row.ticketId}-${row.frg}`}
                    hover
                    sx={{ '& td': { whiteSpace: 'nowrap' } }}
                  >
                    <TableCell>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => onOpenTicket?.(row)}
                        sx={{ px: 0, textTransform: 'none', fontWeight: 700 }}
                      >
                        {row.ticketId}
                      </Button>
                    </TableCell>
                    <TableCell>{row.frg}</TableCell>
                    <TableCell>{row.yearMonth}</TableCell>
                    <TableCell>{row.category}</TableCell>
                    <TableCell>{row.severity}</TableCell>
                    <TableCell>{row.partyAtFault}</TableCell>
                    <TableCell>{row.siteAccessTimes}</TableCell>
                    <TableCell align="right">{fmtHours(row.rawHours)}</TableCell>
                    <TableCell align="right">{fmtHours(row.excludedHours)}</TableCell>
                    <TableCell align="right">{fmtHours(row.finalHours)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <EmptyTableRow colSpan={10} message="No ticket data returned for the selected range." />
              )}
            </TableBody>
          </Table>
        </Box>
      </SectionCard>
    </Stack>
  )
}
