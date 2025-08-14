// frontend/src/pages/NldLightLevelsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import dayjs from 'dayjs'
import {
  Box, Paper, Typography, IconButton, Tooltip, Stack,
  TextField, Button, Drawer, Accordion, AccordionSummary,
  AccordionDetails, Chip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
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

export default function NldLightLevelsPage () {
  const { user } = useAuth()

  /* ── state ─────────────────────────────────────────── */
  const [rows, setRows] = useState([])
  const [edit, setEdit] = useState(null)   // { id, rxA, rxB, reason, changedAt }
  const [hist, setHist] = useState(null)   // [{...levelHistory, event?:{ticketId,impactType,impactHours}}]

  /* ── initial fetch ────────────────────────────────── */
  useEffect(() => {
    api.get('/engineering/circuits').then(r => setRows(r.data))
  }, [])

  /* ── helpers ──────────────────────────────────────── */
  const groupBy = (arr, key) =>
    arr.reduce((m, r) => ((m[r[key] ?? '—'] ??= []).push(r), m), {})

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
      rxA: r.currentRxSiteA ?? '',
      rxB: r.currentRxSiteB ?? '',
      reason: '',
      changedAt: dayjs()   // default to now; can be overridden
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
    setRows((await api.get('/engineering/circuits')).data)
    setEdit(null)
  }

  const fmtSigned = (v) => (v === null || v === undefined || Number.isNaN(v))
    ? '—'
    : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`

  const chipForDelta = (d) => {
    if (d == null || Number.isNaN(d)) {
      return { label: '—', color: 'default', icon: <RemoveRoundedIcon fontSize="small" /> }
    }
    if (Math.abs(d) < 0.05) {
      return { label: 'Same', color: 'default', icon: <RemoveRoundedIcon fontSize="small" /> }
    }
    if (d > 0) {
      return { label: 'Better', color: 'success', icon: <ArrowUpwardRoundedIcon fontSize="small" /> }
    }
    return { label: 'Worse', color: 'error', icon: <ArrowDownwardRoundedIcon fontSize="small" /> }
  }

  /* ── datagrid columns (memoised) ───────────────────── */
  const columns = useMemo(() => [
    { field:'circuitId', headerName:'Circuit', flex:1, minWidth:160 },
    { field:'nodeA',     headerName:'Node A',  flex:1, minWidth:120 },
    { field:'nodeB',     headerName:'Node B',  flex:1, minWidth:120 },
    { field:'techType',  headerName:'Tech',    width:80 },
    { field:'currentRxSiteA', headerName:'Rx A (dBm)', width:110, type:'number' },
    { field:'currentRxSiteB', headerName:'Rx B (dBm)', width:110, type:'number' },

    // Init A/B — render directly from the row (no valueGetter → null-safe)
    {
      field:'initRxSiteA',
      headerName:'Init A',
      width:95,
      sortable:false,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const v = r.initRxSiteA ?? r.initial?.rxSiteA ?? null
        return <span>{v ?? '—'}</span>
      }
    },
    {
      field:'initRxSiteB',
      headerName:'Init B',
      width:95,
      sortable:false,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const v = r.initRxSiteB ?? r.initial?.rxSiteB ?? null
        return <span>{v ?? '—'}</span>
      }
    },

    // Δ A — compute and render inside renderCell, plus a safe sortComparator
    {
      field:'deltaA',
      headerName:'Δ A',
      width:110,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const init = r.initRxSiteA ?? r.initial?.rxSiteA ?? null
        const curr = r.currentRxSiteA
        const d = (init == null || curr == null) ? null : (curr - init)
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
      },
      sortComparator: (_a, _b, p1, p2) => {
        const r1 = p1?.row ?? {}, r2 = p2?.row ?? {}
        const i1 = r1.initRxSiteA ?? r1.initial?.rxSiteA ?? null
        const c1 = r1.currentRxSiteA
        const d1 = (i1 == null || c1 == null) ? -Infinity : c1 - i1
        const i2 = r2.initRxSiteA ?? r2.initial?.rxSiteA ?? null
        const c2 = r2.currentRxSiteA
        const d2 = (i2 == null || c2 == null) ? -Infinity : c2 - i2
        return d1 - d2
      }
    },

    // Δ B — same pattern
    {
      field:'deltaB',
      headerName:'Δ B',
      width:110,
      renderCell:(p) => {
        const r = p?.row ?? {}
        const init = r.initRxSiteB ?? r.initial?.rxSiteB ?? null
        const curr = r.currentRxSiteB
        const d = (init == null || curr == null) ? null : (curr - init)
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
      },
      sortComparator: (_a, _b, p1, p2) => {
        const r1 = p1?.row ?? {}, r2 = p2?.row ?? {}
        const i1 = r1.initRxSiteB ?? r1.initial?.rxSiteB ?? null
        const c1 = r1.currentRxSiteB
        const d1 = (i1 == null || c1 == null) ? -Infinity : c1 - i1
        const i2 = r2.initRxSiteB ?? r2.initial?.rxSiteB ?? null
        const c2 = r2.currentRxSiteB
        const d2 = (i2 == null || c2 == null) ? -Infinity : c2 - i2
        return d1 - d2
      }
    },

    // Trend A/B — per-side chips using the same delta logic
    {
      field:'trendA',
      headerName:'Trend A',
      width:120,
      sortable:false,
      renderCell:(p)=>{
        const r = p?.row ?? {}
        const init = r.initRxSiteA ?? r.initial?.rxSiteA ?? null
        const curr = r.currentRxSiteA
        const d = (init == null || curr == null) ? null : (curr - init)
        const k = chipForDelta(d)
        return <Chip size="small" color={k.color} icon={k.icon} label={k.label} sx={{ fontWeight:600 }} />
      }
    },
    {
      field:'trendB',
      headerName:'Trend B',
      width:120,
      sortable:false,
      renderCell:(p)=>{
        const r = p?.row ?? {}
        const init = r.initRxSiteB ?? r.initial?.rxSiteB ?? null
        const curr = r.currentRxSiteB
        const d = (init == null || curr == null) ? null : (curr - init)
        const k = chipForDelta(d)
        return <Chip size="small" color={k.color} icon={k.icon} label={k.label} sx={{ fontWeight:600 }} />
      }
    },

    // Last Event (safe to use valueGetter on the direct field value)
    {
      field:'updatedAt',
      headerName:'Last Event',
      minWidth:170,
      type:'dateTime',
      valueGetter:({ value }) => value ? dayjs(value).toDate() : undefined,
      valueFormatter: (params) =>
        params?.value ? dayjs(params.value).format('YYYY-MM-DD HH:mm') : ''
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
        Deltas compare <strong>current</strong> to the <strong>initial import</strong>. Higher (less negative) dBm is better.
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
                initialState={{ pagination:{ paginationModel:{ pageSize:25 } } }}
                sx={{
                  '.MuiDataGrid-cell:hover':{ bgcolor:'rgba(0,0,0,0.04)' },
                  border:0
                }}
              />
            </Paper>
          </AccordionDetails>
        </Accordion>
      ))}

      {/* ---------- Edit drawer ---------- */}
      <Drawer anchor="right" open={Boolean(edit)} onClose={() => setEdit(null)} ModalProps={{ sx: { zIndex: 2400 } }} slotProps={{ paper: { sx: { pt: 7, width: 380 } } }}>
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
        slotProps={{ paper: { sx: { pt: 7, width: 380 } } }}
      >
        <Box p={3} width={380}>
          <Typography variant="h6" gutterBottom>Level History</Typography>
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
                  <Chip size="small" variant="outlined" label={`Ticket #${h.event.ticketId}`} />
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
