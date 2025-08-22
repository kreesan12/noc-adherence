// frontend/src/pages/NldLightLevelsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import dayjs from 'dayjs'
import {
  Box, Paper, Typography, IconButton, Tooltip, Stack,
  TextField, Button, Drawer, Accordion, AccordionSummary,
  AccordionDetails, Chip, Divider
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import EditNoteIcon from '@mui/icons-material/EditNote'
import HistoryIcon from '@mui/icons-material/History'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded'
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded'
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded'
import { LocalizationProvider, DateTimePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import { useAuth } from '../context/AuthContext'
import api from '../api'

/* ── tiny, dependency-free sparkline ───────────────────── */
function Sparkline ({ values = [], width = 160, height = 44, stroke = '#1976d2', label }) {
  const pts = values.filter(v => typeof v === 'number' && !Number.isNaN(v))
  if (pts.length < 2) {
    return (
      <Box sx={{ width, height, display:'flex', alignItems:'center', justifyContent:'center', opacity:0.6 }}>
        <Typography variant="caption">N/A</Typography>
      </Box>
    )
  }
  const min = Math.min(...pts), max = Math.max(...pts)
  const pad = 3
  const W = width - pad * 2
  const H = height - pad * 2
  const normY = v => {
    if (max === min) return H / 2
    return H - ((v - min) / (max - min)) * H
  }
  const stepX = W / (pts.length - 1)
  const d = pts.map((v, i) => `${i === 0 ? 'M' : 'L'} ${pad + i * stepX} ${pad + normY(v)}`).join(' ')
  const lastX = pad + (pts.length - 1) * stepX
  const lastY = pad + normY(pts[pts.length - 1])

  return (
    <Box sx={{ width, height, position:'relative' }}>
      <svg width={width} height={height}>
        <path d={d} fill="none" stroke={stroke} strokeWidth="2" />
        <circle cx={lastX} cy={lastY} r="3" fill={stroke} />
      </svg>
      {label && (
        <Box sx={{ position:'absolute', top:2, left:6, bgcolor:'rgba(255,255,255,0.8)', px:0.5, borderRadius:0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 600, color: stroke }}>{label}</Typography>
        </Box>
      )}
      <Box sx={{ position:'absolute', bottom:2, right:6, opacity:0.6 }}>
        <Typography variant="caption">{`min ${min}  max ${max}`}</Typography>
      </Box>
    </Box>
  )
}

export default function NldLightLevelsPage () {
  const { user } = useAuth()

  /* ── state ─────────────────────────────────────────── */
  const [rows, setRows] = useState([])
  const [edit, setEdit] = useState(null)   // { id, rxA, rxB, reason, changedAt }
  const [hist, setHist] = useState(null)   // [{...levelHistory, event?:{ticketId,impactType,impactHours}}]

  /* ── helpers ──────────────────────────────────────── */
  const groupBy = (arr, key) =>
    arr.reduce((m, r) => ((m[r[key] ?? '—'] ??= []).push(r), m), {})

  // Per-side source chip
  const sourceChipSide = (source) => {
    if (!source) return null

    const map = {
      daily:   { label: 'Daily',          border: '#2196f3', text: '#2196f3' }, // blue
      event:   { label: 'Event',          border: '#f44336', text: '#f44336' }, // red
      initial: { label: 'Initial',        border: '#fbc02d', text: '#fbc02d' }  // yellow
    }

    const k = map[source] ?? map.initial

    return (
      <Chip
        size="small"
        variant="outlined"
        label={k.label}
        sx={{
          ml: 0.75,
          bgcolor: '#fff',
          borderColor: k.border,
          color: k.text,
          fontWeight: 500
        }}
      />
    )
  }

  // Choose display values per circuit:
  // - For each side, use Daily iff that side has a daily sample newer than lastEventAt
  // - As-of ALWAYS shows latest daily sampleTime (if any)
  function deriveRow(r) {
    const dailies = Array.isArray(r.dailyLevels) ? r.dailyLevels : []

    // latest overall daily (for the "As of" column)
    const latestDailyAt = dailies.length
      ? dailies.map(d => dayjs(d.sampleTime)).sort((a,b)=>b.valueOf()-a.valueOf())[0]
      : null

    // per-side most recent daily
    const latestA = dailies
      .filter(d => (d.side || '').toUpperCase() === 'A')
      .sort((a,b)=>dayjs(b.sampleTime).valueOf() - dayjs(a.sampleTime).valueOf())[0] || null
    const latestB = dailies
      .filter(d => (d.side || '').toUpperCase() === 'B')
      .sort((a,b)=>dayjs(b.sampleTime).valueOf() - dayjs(a.sampleTime).valueOf())[0] || null

    const lastEventAt = r.lastEventAt ? dayjs(r.lastEventAt) : null
    const sideNewerThanEvent = (sideDaily) =>
      sideDaily && (!lastEventAt || dayjs(sideDaily.sampleTime).isAfter(lastEventAt))

    const useDailyA = sideNewerThanEvent(latestA)
    const useDailyB = sideNewerThanEvent(latestB)

    const displayRxA = useDailyA ? (latestA?.rx ?? r.currentRxSiteA ?? null)
                                 : (r.currentRxSiteA ?? null)
    const displayRxB = useDailyB ? (latestB?.rx ?? r.currentRxSiteB ?? null)
                                 : (r.currentRxSiteB ?? null)

    // As-of: ALWAYS latest daily snapshot (if any)
    const displayAsOf = latestDailyAt ? latestDailyAt.toISOString() : null

    // Source per side: if not using Daily, call it Event only when an event exists; else Initial
    const displaySourceA = useDailyA ? 'daily' : (lastEventAt ? 'event' : 'initial')
    const displaySourceB = useDailyB ? 'daily' : (lastEventAt ? 'event' : 'initial')

    return {
      ...r,
      displayRxA,
      displayRxB,
      displayAsOf,
      displaySourceA,
      displaySourceB,
    }
  }

  const deriveRows = (list) => list.map(deriveRow)

  /* ── initial fetch ────────────────────────────────── */
  useEffect(() => {
    (async () => {
      const { data } = await api.get('/engineering/circuits')
      setRows(deriveRows(data))
    })()
  }, [])

  async function openHist (id) {
    const { data } = await api.get(`/engineering/circuit/${id}`)
    // Join history with lightEvents by date (YYYY-MM-DD)
    const byDate = Object.fromEntries(
      (data.lightEvents || []).map(e => [dayjs(e.eventDate).format('YYYY-MM-DD'), e])
    )
    const enriched = (data.levelHistory || []).map(h => ({
      ...h,
      event: byDate[dayjs(h.changedAt).format('YYYY-MM-DD')]
    }))
    setHist(enriched)
  }

  function startEdit (r) {
    setEdit({
      id: r.id,
      rxA: r.displayRxA ?? r.currentRxSiteA ?? '',
      rxB: r.displayRxB ?? r.currentRxSiteB ?? '',
      reason: '',
      changedAt: dayjs()
    })
  }

  const toNumOrNull = (v) => (v === '' || v == null) ? null : +v

  async function saveEdit () {
    await api.post(`/engineering/circuit/${edit.id}`, {
      currentRxSiteA: toNumOrNull(edit.rxA),
      currentRxSiteB: toNumOrNull(edit.rxB),
      reason: edit.reason || 'manual edit',
      changedAt: edit.changedAt ? dayjs(edit.changedAt).toISOString() : undefined
    })
    const { data } = await api.get('/engineering/circuits')
    setRows(deriveRows(data))
    setEdit(null)
  }

  const fmtSigned = (v) => (v === null || v === undefined || Number.isNaN(v))
    ? '—'
    : `${v > 0 ? '+' : ''}${Number(v).toFixed(1)} dBm`

  const chipForDelta = (d) => {
    if (d == null || Number.isNaN(d)) {
      return { label: '—', color: 'default', icon: <RemoveRoundedIcon fontSize="small" /> }
    }

    // Treat ~0 as "Same"
    if (Math.abs(d) < 0.05) {
      return { label: 'Same', color: 'default', icon: <RemoveRoundedIcon fontSize="small" /> }
    }

    if (d > 0) {
      // Better (less negative / more positive) -> green
      return { label: 'Better', color: 'success', icon: <ArrowUpwardRoundedIcon fontSize="small" /> }
    }

    // d < 0: worse — threshold logic
    if (d >= -2.0) {
      // within -2.0 dBm → orange
      return { label: 'Worse', color: 'warning', icon: <ArrowDownwardRoundedIcon fontSize="small" /> }
    }

    // more than -2.0 dBm drop (e.g. -2.1 and lower) → red
    return { label: 'Worse', color: 'error', icon: <ArrowDownwardRoundedIcon fontSize="small" /> }
  }

  /* ── datagrid columns (memoised) ───────────────────── */
  const columns = useMemo(() => [
    { field:'circuitId', headerName:'Circuit', flex:1, minWidth:160 },
    { field:'nodeA',     headerName:'Node A',  flex:1, minWidth:120 },
    { field:'nodeB',     headerName:'Node B',  flex:1, minWidth:120 },
    { field:'techType',  headerName:'Tech',    width:80 },

    // ── Side A group ─────────────────────────────
    {
      field:'displayRxA',
      headerName:'Current Rx A (dBm)',
      width:180,
      type:'number',
      align: 'center',
      headerAlign: 'center',
      headerClassName:'groupAStart',
      cellClassName:'groupAStart',
      valueGetter: (p) => p?.row?.displayRxA ?? p?.row?.currentRxSiteA ?? null,
      renderCell: (p) => {
        const v = p?.row?.displayRxA ?? p?.row?.currentRxSiteA
        return (
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ width:'100%' }}>
            <span>{v == null ? '—' : Number(v).toFixed(1)}</span>
            {sourceChipSide(p?.row?.displaySourceA)}
          </Stack>
        )
      }
    },
    {
      field:'initRxSiteA',
      headerName:'Initial Rx A (dBm)',
      width:140,
      type:'number',
      align: 'center',
      headerAlign: 'center',
      sortable:false,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const v = r.initRxSiteA ?? r.initial?.rxSiteA ?? null
        return <span>{v == null ? '—' : Number(v).toFixed(1)}</span>
      }
    },
    {
      field:'deltaA',
      headerName:'Δ A',
      width:130,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const init = r.initRxSiteA ?? r.initial?.rxSiteA ?? null
        const curr = r.displayRxA ?? r.currentRxSiteA
        const d = (init == null || curr == null) ? null : (Number(curr) - Number(init))
        const k = chipForDelta(d)
        return (
          <Chip
            size="small"
            color={k.color}
            icon={k.icon}
            label={d == null ? '—' : fmtSigned(d)}
            sx={{ fontWeight:600 }}
          />
        )
      }
    },
    {
      field:'trendA',
      headerName:'Trend A',
      width:110,
      headerClassName:'groupAEnd',
      cellClassName:'groupAEnd',
      sortable:false,
      renderCell:(p)=>{
        const r = p?.row ?? {}
        const init = r.initRxSiteA ?? r.initial?.rxSiteA ?? null
        const curr = r.displayRxA ?? r.currentRxSiteA
        const d = (init == null || curr == null) ? null : (Number(curr) - Number(init))
        const k = chipForDelta(d)
        return <Chip size="small" color={k.color} icon={k.icon} label={k.label} sx={{ fontWeight:600 }} />
      }
    },

    // ── Side B group ─────────────────────────────
    {
      field:'displayRxB',
      headerName:'Current Rx B (dBm)',
      width:180,
      type:'number',
      align: 'center',
      headerAlign: 'center',
      headerClassName:'groupBStart',
      cellClassName:'groupBStart',
      valueGetter: (p) => p?.row?.displayRxB ?? p?.row?.currentRxSiteB ?? null,
      renderCell: (p) => {
        const v = p?.row?.displayRxB ?? p?.row?.currentRxSiteB
        return (
          <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ width:'100%' }}>
            <span>{v == null ? '—' : Number(v).toFixed(1)}</span>
            {sourceChipSide(p?.row?.displaySourceB)}
          </Stack>
        )
      }
    },
    {
      field:'initRxSiteB',
      headerName:'Initial Rx B (dBm)',
      width:140,
      type:'number',
      align: 'center',
      headerAlign: 'center',
      sortable:false,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const v = r.initRxSiteB ?? r.initial?.rxSiteB ?? null
        return <span>{v == null ? '—' : Number(v).toFixed(1)}</span>
      }
    },
    {
      field:'deltaB',
      headerName:'Δ B',
      width:130,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const init = r.initRxSiteB ?? r.initial?.rxSiteB ?? null
        const curr = r.displayRxB ?? r.currentRxSiteB
        const d = (init == null || curr == null) ? null : (Number(curr) - Number(init))
        const k = chipForDelta(d)
        return (
          <Chip
            size="small"
            color={k.color}
            icon={k.icon}
            label={d == null ? '—' : fmtSigned(d)}
            sx={{ fontWeight:600 }}
          />
        )
      }
    },
    {
      field:'trendB',
      headerName:'Trend B',
      width:110,
      headerClassName:'groupBEnd',
      cellClassName:'groupBEnd',
      sortable:false,
      renderCell:(p)=>{
        const r = p?.row ?? {}
        const init = r.initRxSiteB ?? r.initial?.rxSiteB ?? null
        const curr = r.displayRxB ?? r.currentRxSiteB
        const d = (init == null || curr == null) ? null : (Number(curr) - Number(init))
        const k = chipForDelta(d)
        return <Chip size="small" color={k.color} icon={k.icon} label={k.label} sx={{ fontWeight:600 }} />
      }
    },

    // ── Freshness + last event + actions ───────────────
    {
      field: 'displayAsOf',
      headerName: 'As of',
      minWidth: 110,
      align: 'center',
      headerAlign: 'center',
      sortable: true,
      renderCell: (p) => {
        const v = p?.row?.displayAsOf
        return v ? dayjs(v).format('YYYY-MM-DD HH:mm') : ''
      },
      sortComparator: (_a, _b, p1, p2) => {
        const t1 = p1?.row?.displayAsOf ? dayjs(p1.row.displayAsOf).valueOf() : -Infinity
        const t2 = p2?.row?.displayAsOf ? dayjs(p2.row.displayAsOf).valueOf() : -Infinity
        return t1 - t2
      },
    },
    {
      field: 'lastEventAt',
      headerName: 'Last Event',
      minWidth: 110,
      align: 'center',
      headerAlign: 'center',
      sortable: true,
      renderCell: (p) => {
        const v = p?.row?.lastEventAt
        return v ? dayjs(v).format('YYYY-MM-DD HH:mm') : ''
      },
      sortComparator: (_a, _b, p1, p2) => {
        const t1 = p1?.row?.lastEventAt ? dayjs(p1.row.lastEventAt).valueOf() : -Infinity
        const t2 = p2?.row?.lastEventAt ? dayjs(p2.row.lastEventAt).valueOf() : -Infinity
        return t1 - t2
      },
    },
    {
      field:'actions',
      headerName:'', width:130, sortable:false, filterable:false,
      renderCell: (p) => (
        <Stack direction="row" spacing={0.5} alignItems="center">
          {user?.role === 'engineering' && (
            <Tooltip title="Edit levels">
              <IconButton size="small" onClick={() => startEdit(p.row)}>
                <EditNoteIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="View history">
            <Stack direction="row" spacing={0.6} alignItems="center">
              <IconButton size="small" onClick={() => openHist(p.row.id)}>
                <HistoryIcon fontSize="inherit" />
              </IconButton>
              <Chip
                label={p.row._count?.levelHistory ?? 0}
                size="small"
                color="secondary"
                sx={{ fontWeight:600 }}
              />
            </Stack>
          </Tooltip>
        </Stack>
      )
    }
  ], [user])

  /* ── render ────────────────────────────────────────── */
  return (
    <Box px={2} py={1}>
      <Typography variant="h5" fontWeight={700} mb={1.5}>
        NLD Light-Level Dashboard
      </Typography>
      <Typography variant="body2" sx={{ mb: 2, opacity: 0.8 }}>
        “Current” values pick the freshest of <strong>Event</strong> vs <strong>Daily</strong> snapshot <em>per side</em>.
        <br/> <strong>As of</strong> shows the timestamp of the latest <strong>Daily</strong> snapshot available.
        Deltas compare against the <strong>initial import</strong>. Higher (less negative) dBm is better.
      </Typography>

      {Object.entries(groupBy(rows, 'nldGroup')).map(([grp, list]) => (
        <Accordion key={grp} defaultExpanded sx={{ mb:1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              {grp}&nbsp;
              <Chip label={list.length} size="small" sx={{ ml:1 }} />
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p:0 }}>
            <Paper elevation={0}>
              <DataGrid
                rows={list}
                columns={columns}
                autoHeight
                density="compact"
                getRowId={(r) => r.id}
                pageSizeOptions={[25,50,100]}
                initialState={{
                  pagination:{ paginationModel:{ pageSize:25 } },
                }}
                slots={{ toolbar: GridToolbar }}
                slotProps={{
                  toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 300 } }
                }}
                sx={(theme) => ({
                  '.MuiDataGrid-cell:hover':{ bgcolor:'rgba(0,0,0,0.04)' },
                  border:0,
                  // group borders
                  '& .MuiDataGrid-columnHeader.groupAStart, & .groupAStart': {
                    borderLeft: `1px solid ${theme.palette.divider}`,
                  },
                  '& .MuiDataGrid-columnHeader.groupAEnd, & .groupAEnd': {
                    borderRight: `1px solid ${theme.palette.divider}`,
                  },
                  '& .MuiDataGrid-columnHeader.groupBStart, & .groupBStart': {
                    borderLeft: `1px solid ${theme.palette.divider}`,
                  },
                  '& .MuiDataGrid-columnHeader.groupBEnd, & .groupBEnd': {
                    borderRight: `1px solid ${theme.palette.divider}`,
                  },
                })}
              />
            </Paper>
          </AccordionDetails>
        </Accordion>
      ))}

      {/* ---------- Edit drawer ---------- */}
      <Drawer anchor="right" open={Boolean(edit)} onClose={() => setEdit(null)}>
        <Box p={3} width={320}>
          <Typography variant="h6" mb={2}>Edit Levels</Typography>
          <Stack spacing={2}>
            <TextField
              label="Rx A (dBm)"
              value={edit?.rxA ?? ''}
              onChange={e => setEdit(s => ({ ...s, rxA: e.target.value }))}
              inputProps={{ inputMode: 'decimal' }}
            />
            <TextField
              label="Rx B (dBm)"
              value={edit?.rxB ?? ''}
              onChange={e => setEdit(s => ({ ...s, rxB: e.target.value }))}
              inputProps={{ inputMode: 'decimal' }}
            />

            <TextField
              label="Reason"
              value={edit?.reason ?? ''}
              onChange={e => setEdit(s => ({ ...s, reason: e.target.value }))}
              multiline
              minRows={2}
              placeholder="e.g. value adjusted via UI"
            />

            <LocalizationProvider dateAdapter={AdapterDayjs}>
              <DateTimePicker
                label="Changed at"
                value={edit?.changedAt ?? null}
                onChange={(v) => setEdit(s => ({ ...s, changedAt: v }))}
                slotProps={{ textField: { helperText: 'Timestamp to store in history' } }}
              />
            </LocalizationProvider>

            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={saveEdit}>Save</Button>
              <Button onClick={() => setEdit(null)}>Cancel</Button>
            </Stack>
          </Stack>
        </Box>
      </Drawer>

      {/* ---------- History drawer ---------- */}
      <Drawer
        anchor="right"
        open={Boolean(hist)}
        onClose={() => setHist(null)}
        ModalProps={{ sx: { zIndex: 2400 } }}
        slotProps={{ paper: { sx: { pt: 7, width: 420 } } }}
      >
        <Box p={3} width={420}>
          <Typography variant="h6" gutterBottom>Level History</Typography>

          {/* Mini sparklines */}
          {!!hist?.length && (
            <Box sx={{ mb: 1.5 }}>
              {(() => {
                const sorted = [...hist].sort((a,b)=>dayjs(a.changedAt)-dayjs(b.changedAt))
                const valsA = sorted.map(h => h.rxSiteA).filter(v => v != null)
                const valsB = sorted.map(h => h.rxSiteB).filter(v => v != null)
                return (
                  <Box>
                    <Sparkline values={valsA} stroke="#2e7d32" label="Rx A" />
                    <Sparkline values={valsB} stroke="#1565c0" label="Rx B" />
                  </Box>
                )
              })()}
              <Divider sx={{ mt:1, mb:1 }} />
            </Box>
          )}

          {hist?.map(h => (
            <Box key={h.id} mb={1.2} p={1.5} sx={{ borderBottom:'1px solid #eee' }}>
              <Typography variant="body2" fontWeight={700}>
                {dayjs(h.changedAt).format('YYYY-MM-DD HH:mm')}
              </Typography>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                RxA:&nbsp;{h.rxSiteA ?? '—'}&nbsp;&nbsp;
                RxB:&nbsp;{h.rxSiteB ?? '—'}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ flexWrap:'wrap' }}>
                {h.event?.ticketId != null && (
                  <Chip
                    size="small"
                    variant="outlined"
                    component="a"
                    href={`https://frogfoot.zendesk.com/agent/tickets/${h.event.ticketId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    clickable
                    label={`Ticket #${h.event.ticketId}`}
                  />
                )}
                {h.event?.impactType && (
                  <Chip size="small" color="info" label={h.event.impactType} />
                )}
                {h.event?.impactHours != null && (
                  <Chip size="small" label={`${h.event.impactHours} h`} />
                )}
              </Stack>
              <Typography variant="caption" sx={{ display:'block', mt: 0.5, opacity: 0.8 }}>
                {h.reason} — {h.source}
              </Typography>
            </Box>
          ))}
        </Box>
      </Drawer>
    </Box>
  )
}
