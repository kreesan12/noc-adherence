import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from 'recharts'
import api from '../api'

const DEFAULT_ISP_PAGE_SIZE = 50
const DOWNTIME_CATEGORY = 'service impacting'
const MS_PER_DAY = 24 * 60 * 60 * 1000

function fmtPct(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return `${Number(v).toFixed(2)}%`
}

function fmtHours(v) {
  if (v == null || Number.isNaN(Number(v))) return '0.00h'
  return `${Number(v).toFixed(2)}h`
}

function pctChipColor(v) {
  if (v == null || Number.isNaN(Number(v))) return 'default'
  if (v >= 99.5) return 'success'
  if (v >= 98.5) return 'warning'
  return 'error'
}

function fmtTs(v) {
  if (!v) return '—'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(v)
}

function defaultRange() {
  const to = dayjs().format('YYYY-MM')
  const from = dayjs().subtract(2, 'month').format('YYYY-MM')
  return { from, to }
}

function toDateSafe(v) {
  if (!v) return null
  const d = dayjs(v)
  return d.isValid() ? d.toDate() : null
}

function normalizeInterval(startV, stopV) {
  const start = toDateSafe(startV)
  if (!start) return null
  const stop = toDateSafe(stopV) || start
  if (stop <= start) {
    return { start, end: new Date(start.getTime() + 1000) }
  }
  return { start, end: stop }
}

function mergeIntervals(intervals) {
  if (!intervals.length) return []
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  const merged = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i]
    const last = merged[merged.length - 1]
    if (cur.start <= last.end) {
      last.end = new Date(Math.max(last.end.getTime(), cur.end.getTime()))
    } else {
      merged.push(cur)
    }
  }
  return merged
}

function overlapMs(startA, endA, startB, endB) {
  const s = Math.max(startA.getTime(), startB.getTime())
  const e = Math.min(endA.getTime(), endB.getTime())
  return Math.max(0, e - s)
}

function dayIndexInMonth(ts, monthStart, monthDays) {
  const d = toDateSafe(ts)
  if (!d) return -1
  const idx = dayjs(d).diff(monthStart, 'day')
  if (!Number.isInteger(idx) || idx < 0 || idx >= monthDays) return -1
  return idx
}

function buildMonthlyTimelineData(monthDetail) {
  const ym = String(monthDetail?.yearMonth || '').trim()
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null

  const monthStart = dayjs(`${ym}-01`).startOf('day')
  const monthEnd = monthStart.add(1, 'month')
  const monthDays = monthStart.daysInMonth()

  const dayRows = []
  for (let i = 0; i < monthDays; i += 1) {
    const day = monthStart.add(i, 'day')
    dayRows.push({
      day: i + 1,
      label: day.format('DD MMM'),
      availability: 100,
      downtimeHours: 0,
      outageCount: 0,
      downtimeTicketCount: 0,
      otherTicketCount: 0
    })
  }

  const downtimeIntervalsRaw = []

  for (const o of (monthDetail?.outages || [])) {
    const idx = dayIndexInMonth(o.impact_start || o.impact_stop, monthStart, monthDays)
    if (idx >= 0) dayRows[idx].outageCount += 1
    const interval = normalizeInterval(o.impact_start, o.impact_stop || o.impact_start)
    if (interval) downtimeIntervalsRaw.push(interval)
  }

  for (const t of (monthDetail?.tickets || [])) {
    const cat = String(t.category || '').trim().toLowerCase()
    const isDowntimeTicket = cat === DOWNTIME_CATEGORY
    const idx = dayIndexInMonth(t.created_date || t.impact_stop_time, monthStart, monthDays)
    if (idx >= 0) {
      if (isDowntimeTicket) dayRows[idx].downtimeTicketCount += 1
      else dayRows[idx].otherTicketCount += 1
    }
    if (isDowntimeTicket) {
      const interval = normalizeInterval(t.created_date, t.impact_stop_time || t.created_date)
      if (interval) downtimeIntervalsRaw.push(interval)
    }
  }

  const monthStartDt = monthStart.toDate()
  const monthEndDt = monthEnd.toDate()
  const clippedIntervals = downtimeIntervalsRaw
    .map((it) => ({
      start: new Date(Math.max(it.start.getTime(), monthStartDt.getTime())),
      end: new Date(Math.min(it.end.getTime(), monthEndDt.getTime()))
    }))
    .filter((it) => it.end > it.start)

  const mergedIntervals = mergeIntervals(clippedIntervals)
  for (let i = 0; i < monthDays; i += 1) {
    const dayStart = monthStart.add(i, 'day').toDate()
    const dayEnd = monthStart.add(i + 1, 'day').toDate()
    let downtimeMs = 0
    for (const iv of mergedIntervals) {
      downtimeMs += overlapMs(dayStart, dayEnd, iv.start, iv.end)
    }
    const downtimeHours = Number((downtimeMs / (1000 * 60 * 60)).toFixed(2))
    const availability = Math.max(0, Math.min(100, Number((100 - ((downtimeMs / MS_PER_DAY) * 100)).toFixed(2))))
    dayRows[i].downtimeHours = downtimeHours
    dayRows[i].availability = availability
  }

  const outageMarkers = dayRows
    .filter((d) => d.outageCount > 0)
    .map((d) => ({ day: d.day, y: 5, count: d.outageCount }))
  const downtimeTicketMarkers = dayRows
    .filter((d) => d.downtimeTicketCount > 0)
    .map((d) => ({ day: d.day, y: 12, count: d.downtimeTicketCount }))
  const otherTicketMarkers = dayRows
    .filter((d) => d.otherTicketCount > 0)
    .map((d) => ({ day: d.day, y: 20, count: d.otherTicketCount }))

  return {
    series: dayRows,
    outageMarkers,
    downtimeTicketMarkers,
    otherTicketMarkers
  }
}

export default function SlaReportingPage() {
  const [range, setRange] = useState(defaultRange)
  const [ispSearch, setIspSearch] = useState('')
  const [frgSearch, setFrgSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({ months: [], isps: [], from: null, to: null })
  const [linksByIsp, setLinksByIsp] = useState({})
  const [linksMetaByIsp, setLinksMetaByIsp] = useState({})
  const [expandedIsp, setExpandedIsp] = useState('')

  const [openLink, setOpenLink] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState('')

  async function loadSummary() {
    setLoading(true)
    try {
      const res = await api.get('/sla-reporting/summary', {
        params: {
          from: range.from,
          to: range.to
        }
      })
      setData(res.data || { months: [], isps: [] })
      setLinksByIsp({})
      setLinksMetaByIsp({})
      setExpandedIsp('')
    } finally {
      setLoading(false)
    }
  }

  function getIspMeta(ispName) {
    return linksMetaByIsp[ispName] || {
      loading: false,
      loaded: false,
      error: '',
      page: 0,
      pageSize: DEFAULT_ISP_PAGE_SIZE,
      totalCount: 0
    }
  }

  async function loadIspLinks(ispName, page = 0, pageSize = DEFAULT_ISP_PAGE_SIZE) {
    if (!ispName) return
    setLinksMetaByIsp((s) => ({
      ...s,
      [ispName]: {
        ...(s[ispName] || {
          loading: false,
          loaded: false,
          error: '',
          page: 0,
          pageSize: DEFAULT_ISP_PAGE_SIZE,
          totalCount: 0
        }),
        loading: true,
        error: '',
        page,
        pageSize
      }
    }))
    try {
      const res = await api.get(`/sla-reporting/isp/${encodeURIComponent(ispName)}/links`, {
        params: {
          from: range.from,
          to: range.to,
          page,
          pageSize,
          frgSearch
        }
      })
      const payload = res.data || {}
      const links = payload.links || []
      setLinksByIsp((s) => ({ ...s, [ispName]: links }))
      setLinksMetaByIsp((s) => ({
        ...s,
        [ispName]: {
          loading: false,
          loaded: true,
          error: '',
          page: Number(payload.page ?? page),
          pageSize: Number(payload.pageSize ?? pageSize),
          totalCount: Number(payload.totalCount ?? links.length)
        }
      }))
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load links'
      setLinksMetaByIsp((s) => ({
        ...s,
        [ispName]: {
          ...(s[ispName] || {
            loading: false,
            loaded: false,
            error: '',
            page: 0,
            pageSize: DEFAULT_ISP_PAGE_SIZE,
            totalCount: 0
          }),
          loading: false,
          loaded: false,
          error: String(msg),
          page,
          pageSize
        }
      }))
    }
  }

  async function openLinkDetails(link) {
    setOpenLink(link)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const res = await api.get(`/sla-reporting/link/${encodeURIComponent(link)}/details`, {
        params: {
          from: range.from,
          to: range.to
        }
      })
      setDetail(res.data)
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load FRG details'
      setDetailError(String(msg))
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    loadSummary().catch(console.error)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    // FRG search changes the server query for each ISP detail table.
    setLinksByIsp({})
    setLinksMetaByIsp({})
    setExpandedIsp('')
  }, [frgSearch])

  const visibleIsps = useMemo(() => {
    const q = ispSearch.trim().toLowerCase()
    if (!q) return data.isps || []
    return (data.isps || []).filter((isp) => String(isp.isp || '').toLowerCase().includes(q))
  }, [data.isps, ispSearch])

  const monthColumns = useMemo(() => {
    return (data.months || []).map((m) => ({
      field: `m_${m.replace('-', '_')}`,
      headerName: m,
      width: 96,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      valueGetter: (_, row) => row?.monthValues?.[m] ?? null,
      renderCell: (p) => {
        const v = p.value ?? p.row?.monthValues?.[m] ?? null
        return (
          <Chip
            size="small"
            color={pctChipColor(v)}
            label={fmtPct(v)}
            sx={{ fontWeight: 600 }}
          />
        )
      }
    }))
  }, [data.months])

  const baseColumns = useMemo(() => ([
    {
      field: 'frogfootlinklabel',
      headerName: 'FRG Link',
      width: 180,
      renderCell: (p) => (
        <Button
          size="small"
          variant="text"
          startIcon={<VisibilityOutlinedIcon />}
          onClick={() => openLinkDetails(p.row.frogfootlinklabel)}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          {p.row.frogfootlinklabel}
        </Button>
      )
    },
    {
      field: 'avgUptimePct',
      headerName: 'Avg SLA',
      width: 110,
      align: 'center',
      headerAlign: 'center',
      renderCell: (p) => (
        <Chip
          size="small"
          color={pctChipColor(p.row.avgUptimePct)}
          label={fmtPct(p.row.avgUptimePct)}
          sx={{ fontWeight: 600 }}
        />
      )
    },
    {
      field: 'worstUptimePct',
      headerName: 'Worst SLA',
      width: 110,
      align: 'center',
      headerAlign: 'center',
      renderCell: (p) => (
        <Chip
          size="small"
          color={pctChipColor(p.row.worstUptimePct)}
          label={fmtPct(p.row.worstUptimePct)}
          sx={{ fontWeight: 600 }}
        />
      )
    },
    {
      field: 'impactedMonths',
      headerName: 'Impacted Months',
      width: 130,
      align: 'center',
      headerAlign: 'center',
    },
    {
      field: 'totalDowntimeHours',
      headerName: 'Downtime',
      width: 120,
      align: 'center',
      headerAlign: 'center',
      renderCell: (p) => fmtHours(p.row.totalDowntimeHours)
    }
  ]), []) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => [...baseColumns, ...monthColumns], [baseColumns, monthColumns])

  return (
    <Box px={2} py={1}>
      <Typography variant="h5" fontWeight={700} mb={1}>
        ISP SLA Reporting
      </Typography>
      <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
        View SLA by ISP and FRG link per month. Click a link for full ticket/outage drill-down and overlap checks.
      </Typography>

      <Paper elevation={0} sx={{ p: 1.5, mb: 1.5, border: '1px solid #eee' }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField
            size="small"
            label="From"
            type="month"
            value={range.from}
            onChange={(e) => setRange(s => ({ ...s, from: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            label="To"
            type="month"
            value={range.to}
            onChange={(e) => setRange(s => ({ ...s, to: e.target.value }))}
            InputLabelProps={{ shrink: true }}
          />
          <TextField
            size="small"
            label="ISP Search"
            placeholder="e.g. Vox"
            value={ispSearch}
            onChange={(e) => setIspSearch(e.target.value)}
          />
          <TextField
            size="small"
            label="FRG Search"
            placeholder="e.g. FRG1109853"
            value={frgSearch}
            onChange={(e) => setFrgSearch(e.target.value)}
          />
          <Button variant="contained" onClick={() => loadSummary().catch(console.error)} disabled={loading}>
            Refresh
          </Button>
          <Chip
            size="small"
            label={`Range: ${data.from || range.from || '—'} to ${data.to || range.to || '—'}`}
            sx={{ fontWeight: 600 }}
          />
        </Stack>
      </Paper>

      {loading ? (
        <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid #eee' }}>
          <CircularProgress size={28} />
          <Typography variant="body2" sx={{ mt: 1.2 }}>Loading SLA data...</Typography>
        </Paper>
      ) : (
        <>
          {(visibleIsps || []).map((isp) => (
            <Accordion
              key={isp.isp}
              expanded={expandedIsp === isp.isp}
              onChange={(_, expanded) => {
                const meta = getIspMeta(isp.isp)
                if (meta.loading) return
                setExpandedIsp(expanded ? isp.isp : '')
                if (expanded) {
                  if (!meta.loaded) {
                    loadIspLinks(isp.isp, 0, DEFAULT_ISP_PAGE_SIZE).catch(console.error)
                  }
                }
              }}
              sx={{ mb: 1 }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  sx={{ width: '100%' }}
                >
                  <Typography variant="subtitle1" fontWeight={700}>{isp.isp}</Typography>
                  {getIspMeta(isp.isp).loading ? <CircularProgress size={16} /> : null}
                  <Chip size="small" label={`Links ${isp.linkCount}`} />
                  <Chip size="small" label={`Impacted ${isp.impactedLinks}`} color={isp.impactedLinks > 0 ? 'warning' : 'success'} />
                  <Chip size="small" label={`Avg ${fmtPct(isp.avgUptimePct)}`} color={pctChipColor(isp.avgUptimePct)} />
                  <Chip size="small" label={`Worst ${fmtPct(isp.worstUptimePct)}`} color={pctChipColor(isp.worstUptimePct)} />
                  <Chip size="small" label={`Downtime ${fmtHours(isp.totalDowntimeHours)}`} />
                </Stack>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                {(() => {
                  const meta = getIspMeta(isp.isp)
                  const rows = (linksByIsp[isp.isp] || []).map((l) => ({ id: l.frogfootlinklabel, ...l }))
                  const hasNoRows = !meta.loading && meta.loaded && rows.length === 0

                  return (
                    <Box>
                      {meta.error ? (
                        <Alert severity="warning" sx={{ m: 1 }}>
                          {meta.error}
                        </Alert>
                      ) : null}

                      {meta.loading && !rows.length ? (
                        <Box py={2} textAlign="center">
                          <CircularProgress size={22} />
                          <Typography variant="body2" sx={{ mt: 1 }}>Loading links...</Typography>
                        </Box>
                      ) : hasNoRows ? (
                        <Paper elevation={0} sx={{ p: 1.5, borderTop: '1px solid #eee' }}>
                          <Typography variant="body2">No FRG link records returned for this ISP in the selected range.</Typography>
                        </Paper>
                      ) : (
                        <DataGrid
                          rows={rows}
                          columns={columns}
                          autoHeight
                          density="compact"
                          rowCount={meta.totalCount || rows.length}
                          pageSizeOptions={[25, 50, 100, 200]}
                          paginationMode="server"
                          paginationModel={{ page: meta.page || 0, pageSize: meta.pageSize || DEFAULT_ISP_PAGE_SIZE }}
                          onPaginationModelChange={(model) => {
                            loadIspLinks(isp.isp, model.page, model.pageSize).catch(console.error)
                          }}
                          loading={Boolean(meta.loading)}
                          slots={{ toolbar: GridToolbar }}
                          slotProps={{
                            toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 250 } }
                          }}
                          sx={{ border: 0 }}
                        />
                      )}
                    </Box>
                  )
                })()}
              </AccordionDetails>
            </Accordion>
          ))}

          {!visibleIsps?.length && (
            <Paper elevation={0} sx={{ p: 2, border: '1px solid #eee' }}>
              <Typography variant="body2">
                {data.isps?.length
                  ? 'No ISPs match your current search.'
                  : 'No SLA records found for selected range.'}
              </Typography>
            </Paper>
          )}
        </>
      )}

      <Dialog
        open={Boolean(openLink)}
        onClose={() => {
          setOpenLink('')
          setDetailError('')
        }}
        fullWidth
        maxWidth="xl"
      >
        <DialogTitle>
          FRG Details: {openLink}
        </DialogTitle>
        <DialogContent dividers>
          {detailLoading ? (
            <Box py={3} textAlign="center">
              <CircularProgress size={24} />
              <Typography variant="body2" sx={{ mt: 1 }}>Loading link details...</Typography>
            </Box>
          ) : detailError ? (
            <Alert severity="error">{detailError}</Alert>
          ) : detail ? (
            <Stack spacing={1.2}>
              {(detail.details || []).map((m) => {
                const timeline = buildMonthlyTimelineData(m)
                return (
                  <Accordion key={m.yearMonth} defaultExpanded={m.yearMonth === detail.to}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                        <Typography variant="subtitle2" fontWeight={700}>{m.yearMonth}</Typography>
                        <Chip size="small" label={`SLA ${fmtPct(m.sla?.uptimePct)}`} color={pctChipColor(m.sla?.uptimePct)} />
                        <Chip size="small" label={`Downtime ${fmtHours(m.sla?.downtimeHours)}`} />
                        <Chip size="small" label={`Active ${fmtHours(m.sla?.activeHours)}`} />
                        <Chip size="small" label={`Tickets ${m.tickets?.length || 0}`} />
                        <Chip size="small" label={`Outages ${m.outages?.length || 0}`} />
                        <Chip size="small" label={`Linked tickets ${m.overlap?.linkedTickets || 0}`} />
                        <Chip size="small" label={`Overlap tickets ${m.overlap?.overlapTickets || 0}`} />
                        <Chip size="small" label={`Overlap pairs ${m.overlap?.overlapPairs || 0}`} />
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {timeline ? (
                        <Paper elevation={0} sx={{ mb: 1.2, p: 1, border: '1px solid #eee' }}>
                          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                            Daily Availability Timeline
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', mb: 0.75, opacity: 0.8 }}>
                            Blue line = daily availability. Markers = outages, service-impacting tickets, and non-downtime tickets.
                          </Typography>
                          <Box sx={{ width: '100%', height: 260 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <ComposedChart data={timeline.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis
                                  dataKey="day"
                                  interval={Math.max(0, Math.floor((timeline.series.length || 1) / 12) - 1)}
                                  tickFormatter={(v) => String(v).padStart(2, '0')}
                                />
                                <YAxis
                                  domain={[0, 100]}
                                  ticks={[0, 25, 50, 75, 100]}
                                  tickFormatter={(v) => `${v}%`}
                                  width={44}
                                />
                                <RechartsTooltip
                                  labelFormatter={(label) => `Day ${String(label).padStart(2, '0')}`}
                                  formatter={(value, name, item) => {
                                    if (name === 'Availability') return [`${Number(value).toFixed(2)}%`, name]
                                    if (name === 'Outages') return [`${item?.payload?.count || 0} event(s)`, name]
                                    if (name === 'Service-impacting Tickets') return [`${item?.payload?.count || 0} ticket(s)`, name]
                                    if (name === 'Other Tickets') return [`${item?.payload?.count || 0} ticket(s)`, name]
                                    return [value, name]
                                  }}
                                />
                                <Legend />
                                <Line
                                  type="monotone"
                                  dataKey="availability"
                                  name="Availability"
                                  stroke="#1976d2"
                                  strokeWidth={2}
                                  dot={false}
                                  activeDot={{ r: 4 }}
                                />
                                <Scatter name="Outages" data={timeline.outageMarkers} dataKey="y" fill="#ef6c00" />
                                <Scatter name="Service-impacting Tickets" data={timeline.downtimeTicketMarkers} dataKey="y" fill="#c62828" />
                                <Scatter name="Other Tickets" data={timeline.otherTicketMarkers} dataKey="y" fill="#6d4c41" />
                              </ComposedChart>
                            </ResponsiveContainer>
                          </Box>
                        </Paper>
                      ) : null}

                      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Tickets</Typography>
                      <Table size="small">
                        <TableHead>
                        <TableRow>
                          <TableCell>Ticket ID</TableCell>
                          <TableCell>Created</TableCell>
                          <TableCell>Stop</TableCell>
                          <TableCell>Category</TableCell>
                          <TableCell>Linked Outage</TableCell>
                          <TableCell>Overlaps</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(m.tickets || []).map((t) => (
                          <TableRow key={`${m.yearMonth}-${t.ticket_id}-${t.created_date || ''}`}>
                            <TableCell>{t.ticket_id || '—'}</TableCell>
                            <TableCell>{fmtTs(t.created_date)}</TableCell>
                            <TableCell>{fmtTs(t.impact_stop_time)}</TableCell>
                            <TableCell>{t.category || '—'}</TableCell>
                            <TableCell>{t.linkedOutageRef || '—'}</TableCell>
                            <TableCell>{(t.overlapOutageRefs || []).join(', ') || '—'}</TableCell>
                          </TableRow>
                        ))}
                        {!m.tickets?.length && (
                          <TableRow>
                            <TableCell colSpan={6}>No tickets in this month.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>

                    <Divider sx={{ my: 1.2 }} />

                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Outages</Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>Outage Ref</TableCell>
                          <TableCell>Start</TableCell>
                          <TableCell>Stop</TableCell>
                          <TableCell>Impact</TableCell>
                          <TableCell>Force Majeure</TableCell>
                          <TableCell>Title</TableCell>
                          <TableCell>Summary</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(m.outages || []).map((o) => (
                          <TableRow key={`${m.yearMonth}-${o.outage_ref}`}>
                            <TableCell>{o.outage_ref || '—'}</TableCell>
                            <TableCell>{fmtTs(o.impact_start)}</TableCell>
                            <TableCell>{fmtTs(o.impact_stop)}</TableCell>
                            <TableCell>{o.impact_type || '—'}</TableCell>
                            <TableCell>{o.force_majeure || '—'}</TableCell>
                            <TableCell>{o.outagetitle || '—'}</TableCell>
                            <TableCell>{o.summary || '—'}</TableCell>
                          </TableRow>
                        ))}
                        {!m.outages?.length && (
                          <TableRow>
                            <TableCell colSpan={7}>No outages in this month.</TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                    </AccordionDetails>
                  </Accordion>
                )
              })}
            </Stack>
          ) : (
            <Typography variant="body2">No details available.</Typography>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  )
}
