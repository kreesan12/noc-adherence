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
        borderRadius: 2.5,
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
    <Paper elevation={0} sx={{ border: '1px solid #e5e7eb', borderRadius: 3, height: '100%', minWidth: 0, overflow: 'hidden', boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)' }}>
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
    <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 3 }}>
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
      <Paper elevation={0} sx={{ p: 1.25, border: '1px solid #e5e7eb', borderRadius: 3, boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)', background: 'linear-gradient(180deg, #f7faff 0%, #ffffff 100%)' }}>
        <Stack spacing={1.1}>
          <Box>
            <Typography variant="overline" sx={{ letterSpacing: 0.9, color: '#1d4ed8' }}>
              Ticket Analytics
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.74 }}>
              Operational view of ticket volume, category mix, responsibility, and the downtime effect after access-time adjustments.
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
            <SummaryCard label="Tickets" value={fmtCount(total)} tone="#1d4ed8" subtext="All ticket contacts returned for the selected range." />
            <SummaryCard label="Service Impacting" value={fmtCount(serviceImpacting)} tone="#dc2626" subtext="Tickets still classified as service impacting after cleanup." />
            <SummaryCard label="Access Adjusted" value={fmtCount(adjusted)} tone="#0f766e" subtext="Tickets where site-access rules adjusted the final downtime." />
          </Box>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap">
            <Chip size="small" label={`Months ${fmtCount((ticketData.byMonth || []).length)}`} sx={{ fontWeight: 700 }} />
            <Chip size="small" label={`Top ticket rows ${fmtCount((ticketData.topTickets || []).length)}`} sx={{ fontWeight: 700 }} />
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
          title="Tickets By Month"
          subtitle="Shows total, service impacting, and site-access-adjusted ticket counts."
          tone="#1d4ed8"
          action={<Chip size="small" label={`${fmtCount((ticketData.byMonth || []).length)} months`} sx={{ fontWeight: 700 }} />}
        >
          {ticketData.byMonth?.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <ComposedChart data={ticketData.byMonth}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="yearMonth" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="ticketCount" fill="#cbd5e1" name="All Tickets" radius={[4, 4, 0, 0]} />
                <Bar dataKey="serviceImpactingTickets" fill="#dc2626" name="Service Impacting" radius={[4, 4, 0, 0]} />
                <Bar dataKey="accessAdjustedTickets" fill="#2563eb" name="Access Adjusted" radius={[4, 4, 0, 0]} />
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
          tone="#0f766e"
        >
          {ticketData.byCategory?.length ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={[...ticketData.byCategory].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={180} />
                <Tooltip />
                <Bar dataKey="ticketCount" fill="#0f766e" radius={[0, 4, 4, 0]} />
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
          tone="#f59e0b"
        >
          {ticketData.bySeverity?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...ticketData.bySeverity].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Bar dataKey="ticketCount" fill="#f59e0b" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback />
          )}
        </SectionCard>

        <SectionCard
          title="Party At Fault"
          subtitle="High-level responsibility view from the source tickets."
          tone="#2563eb"
        >
          {ticketData.byPartyAtFault?.length ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={[...ticketData.byPartyAtFault].reverse()} layout="vertical" margin={{ left: 10, right: 12 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="label" width={170} />
                <Tooltip />
                <Bar dataKey="ticketCount" fill="#2563eb" radius={[0, 4, 4, 0]} />
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
        tone="#0f172a"
        action={<Chip size="small" label={`${fmtCount((ticketData.topTickets || []).length)} rows`} sx={{ fontWeight: 700 }} />}
      >
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 980, '& th': { fontWeight: 800, bgcolor: '#f8fafc' } }}>
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
