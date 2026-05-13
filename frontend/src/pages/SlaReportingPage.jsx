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
  Tooltip,
  MenuItem,
  Typography
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import api from '../api'

const DEFAULT_ISP_PAGE_SIZE = 50
const DOWNTIME_CATEGORY = 'service impacting'

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
  const toMonth = dayjs().subtract(1, 'month')
  const to = toMonth.format('YYYY-MM')
  const from = toMonth.subtract(2, 'month').format('YYYY-MM')
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

  const days = Array.from({ length: monthDays }, (_, i) => {
    const d = monthStart.add(i, 'day')
    return {
      day: i + 1,
      label: d.format('DD MMM'),
      isDown: false,
      downEvents: [],
      otherTickets: []
    }
  })

  const monthStartDt = monthStart.toDate()
  const monthEndDt = monthEnd.toDate()

  function clipInterval(startV, stopV) {
    const interval = normalizeInterval(startV, stopV)
    if (!interval) return null
    const start = new Date(Math.max(interval.start.getTime(), monthStartDt.getTime()))
    const end = new Date(Math.min(interval.end.getTime(), monthEndDt.getTime()))
    if (end <= start) return null
    return { start, end }
  }

  function addDownEventToDays(interval, event) {
    if (!interval) return
    let cursor = dayjs(interval.start).startOf('day')
    while (cursor.isBefore(interval.end)) {
      const idx = cursor.diff(monthStart, 'day')
      if (idx >= 0 && idx < monthDays) {
        days[idx].isDown = true
        if (!days[idx].downEvents.some((e) => e.key === event.key)) {
          days[idx].downEvents.push(event)
        }
      }
      cursor = cursor.add(1, 'day')
    }
  }

  for (const o of (monthDetail?.outages || [])) {
    const interval = clipInterval(o.impact_start, o.impact_stop || o.impact_start)
    const event = {
      key: `outage:${o.outage_ref || ''}`,
      type: 'Outage',
      id: o.outage_ref || 'Unknown',
      start: fmtTs(o.impact_start),
      stop: fmtTs(o.impact_stop),
      detail: o.impact_type || o.outagetitle || ''
    }
    addDownEventToDays(interval, event)
  }

  for (const t of (monthDetail?.tickets || [])) {
    const category = String(t.category || '').trim()
    const isDowntimeTicket = category.toLowerCase() === DOWNTIME_CATEGORY
    const event = {
      key: `ticket:${t.ticket_id || ''}`,
      type: 'Ticket',
      id: t.ticket_id || 'Unknown',
      start: fmtTs(t.created_date),
      stop: fmtTs(t.impact_stop_time),
      detail: category || 'Uncategorized'
    }

    if (isDowntimeTicket) {
      const interval = clipInterval(t.created_date, t.impact_stop_time || t.created_date)
      addDownEventToDays(interval, event)
    } else {
      const idx = dayIndexInMonth(t.created_date || t.impact_stop_time, monthStart, monthDays)
      if (idx >= 0 && !days[idx].otherTickets.some((x) => x.key === event.key)) {
        days[idx].otherTickets.push(event)
      }
    }
  }

  return { days }
}

export default function SlaReportingPage() {
  const [range, setRange] = useState(defaultRange)
  const [ispSearch, setIspSearch] = useState('')
  const [frgSearch, setFrgSearch] = useState('')
  const [productTypeFilter, setProductTypeFilter] = useState('')
  const [serviceTypeFilter, setServiceTypeFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({ months: [], isps: [], productTypes: [], serviceTypes: [], from: null, to: null })
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
          to: range.to,
          productType: productTypeFilter,
          serviceType: serviceTypeFilter
        }
      })
      setData(res.data || { months: [], isps: [], productTypes: [], serviceTypes: [] })
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
          frgSearch,
          productType: productTypeFilter,
          serviceType: serviceTypeFilter
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
    // These filters change the server query for each ISP detail table.
    setLinksByIsp({})
    setLinksMetaByIsp({})
    setExpandedIsp('')
  }, [frgSearch, productTypeFilter, serviceTypeFilter])

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
      width: 210,
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
            select
            label="Product Type"
            value={productTypeFilter}
            onChange={(e) => setProductTypeFilter(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All Products</MenuItem>
            {(data.productTypes || []).map((pt) => (
              <MenuItem key={`pt-${pt}`} value={pt}>{pt}</MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            select
            label="Service Type"
            value={serviceTypeFilter}
            onChange={(e) => setServiceTypeFilter(e.target.value)}
            sx={{ minWidth: 180 }}
          >
            <MenuItem value="">All Services</MenuItem>
            {(data.serviceTypes || []).map((st) => (
              <MenuItem key={`st-${st}`} value={st}>{st}</MenuItem>
            ))}
          </TextField>
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
                            Monthly Uptime Timeline
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', mb: 0.75, opacity: 0.8 }}>
                            Green = up, red = down. Hover red periods for outage/ticket details. Orange dots are non-downtime tickets.
                          </Typography>
                          <Box sx={{ width: '100%' }}>
                            <Box sx={{ display: 'flex', width: '100%', height: 20, borderRadius: 1, overflow: 'hidden', border: '1px solid #ddd' }}>
                              {timeline.days.map((d) => {
                                const downEvents = d.downEvents || []
                                const otherTickets = d.otherTickets || []
                                const title = (
                                  <Box>
                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                                      {d.label}
                                    </Typography>
                                    {d.isDown ? (
                                      <>
                                        <Typography variant="caption" sx={{ display: 'block', mb: 0.25 }}>
                                          Downtime events: {downEvents.length}
                                        </Typography>
                                        {downEvents.slice(0, 6).map((ev) => (
                                          <Typography key={`${d.day}-${ev.key}`} variant="caption" sx={{ display: 'block' }}>
                                            {ev.type} {ev.id}: {ev.start} - {ev.stop}
                                          </Typography>
                                        ))}
                                        {downEvents.length > 6 ? (
                                          <Typography variant="caption" sx={{ display: 'block' }}>
                                            +{downEvents.length - 6} more
                                          </Typography>
                                        ) : null}
                                      </>
                                    ) : (
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        No downtime
                                      </Typography>
                                    )}
                                    {otherTickets.length ? (
                                      <Typography variant="caption" sx={{ display: 'block', mt: 0.25 }}>
                                        Other tickets: {otherTickets.map((t) => t.id).join(', ')}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                )

                                return (
                                  <Tooltip key={`day-bar-${d.day}`} title={title} arrow placement="top">
                                    <Box
                                      sx={{
                                        flex: 1,
                                        bgcolor: d.isDown ? '#d32f2f' : '#2e7d32',
                                        borderRight: d.day < timeline.days.length ? '1px solid rgba(255,255,255,0.35)' : 'none',
                                        cursor: 'pointer'
                                      }}
                                    />
                                  </Tooltip>
                                )
                              })}
                            </Box>

                            <Box sx={{ display: 'flex', width: '100%', mt: 0.35 }}>
                              {timeline.days.map((d) => (
                                <Box key={`day-dot-${d.day}`} sx={{ flex: 1, display: 'flex', justifyContent: 'center', minHeight: 8 }}>
                                  {d.otherTickets?.length ? (
                                    <Tooltip
                                      title={`${d.label} non-downtime tickets: ${d.otherTickets.map((t) => t.id).join(', ')}`}
                                      arrow
                                      placement="top"
                                    >
                                      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#f57c00', mt: 0.15, cursor: 'pointer' }} />
                                    </Tooltip>
                                  ) : null}
                                </Box>
                              ))}
                            </Box>

                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.3 }}>
                              <Typography variant="caption" sx={{ opacity: 0.75 }}>Day 01</Typography>
                              <Typography variant="caption" sx={{ opacity: 0.75 }}>Day {String(timeline.days.length).padStart(2, '0')}</Typography>
                            </Box>
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
