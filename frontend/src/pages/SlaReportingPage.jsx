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
import api from '../api'

const DEFAULT_ISP_PAGE_SIZE = 50

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
  const from = dayjs().subtract(5, 'month').format('YYYY-MM')
  return { from, to }
}

export default function SlaReportingPage() {
  const [range, setRange] = useState(defaultRange)
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
          pageSize
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

  const monthColumns = useMemo(() => {
    return (data.months || []).map((m) => ({
      field: `m_${m.replace('-', '_')}`,
      headerName: m,
      width: 120,
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
      minWidth: 220,
      flex: 1,
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
          {(data.isps || []).map((isp) => (
            <Accordion
              key={isp.isp}
              expanded={expandedIsp === isp.isp}
              onChange={(_, expanded) => {
                setExpandedIsp(expanded ? isp.isp : '')
                if (expanded) {
                  const meta = getIspMeta(isp.isp)
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

          {!data.isps?.length && (
            <Paper elevation={0} sx={{ p: 2, border: '1px solid #eee' }}>
              <Typography variant="body2">No SLA records found for selected range.</Typography>
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
              {(detail.details || []).map((m) => (
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
              ))}
            </Stack>
          ) : (
            <Typography variant="body2">No details available.</Typography>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  )
}
