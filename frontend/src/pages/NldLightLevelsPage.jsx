// frontend/src/pages/NldLightLevelsPage.jsx
import { useEffect, useState, useMemo } from 'react'
import dayjs                 from 'dayjs'
import {
  Box, Paper, Typography, IconButton, Tooltip, Stack,
  TextField, Button, Drawer, Accordion, AccordionSummary,
  AccordionDetails, Chip
} from '@mui/material'
import { DataGrid }          from '@mui/x-data-grid'
import EditNoteIcon          from '@mui/icons-material/EditNote'
import HistoryIcon           from '@mui/icons-material/History'
import ExpandMoreIcon        from '@mui/icons-material/ExpandMore'
import { useAuth }           from '../context/AuthContext'
import api                   from '../api'

export default function NldLightLevelsPage () {
  const { user } = useAuth()

  /* ── state ─────────────────────────────────────────── */
  const [rows, setRows] = useState([])
  const [edit, setEdit] = useState(null)   // { id, rxA, rxB }
  const [hist, setHist] = useState(null)

  /* ── initial fetch ────────────────────────────────── */
  useEffect(() => {
    api.get('/engineering/circuits').then(r => setRows(r.data))
  }, [])

  /* ── helpers ──────────────────────────────────────── */
  const groupBy = (arr, key) =>
    arr.reduce((m, r) => ((m[r[key] ?? '—'] ??= []).push(r), m), {})

  async function openHist (id) {
    const { data } = await api.get(`/engineering/circuit/${id}`)
    setHist(data.levelHistory)
  }

  function startEdit (r) {
    setEdit({ id: r.id, rxA: r.currentRxSiteA ?? '', rxB: r.currentRxSiteB ?? '' })
  }

  async function saveEdit () {
    await api.post(`/engineering/circuit/${edit.id}`, {
      currentRxSiteA: +edit.rxA,
      currentRxSiteB: +edit.rxB,
      reason: 'value adjusted via UI'
    })
    setRows((await api.get('/engineering/circuits')).data)
    setEdit(null)
  }

  /* ── datagrid columns (memoised) ───────────────────── */
  const columns = useMemo(() => [
    { field:'circuitId', headerName:'Circuit', flex:1, minWidth:160 },
    { field:'nodeA',     headerName:'Node A',  flex:1, minWidth:120 },
    { field:'nodeB',     headerName:'Node B',  flex:1, minWidth:120 },
    { field:'techType',  headerName:'Tech',    width:80 },
    { field:'currentRxSiteA', headerName:'Rx A (dBm)', width:110, type:'number' },
    { field:'currentRxSiteB', headerName:'Rx B (dBm)', width:110, type:'number' },
    {
      field:'updatedAt',
      headerName:'Updated',
      minWidth:170,
      type:'dateTime',
      valueGetter:({ value }) => value ? dayjs(value).toDate() : null,
      valueFormatter:({ value }) =>
        value ? dayjs(value).format('YYYY-MM-DD HH:mm') : ''
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
      <Typography variant="h5" fontWeight={700} mb={2}>
        NLD Light-Level Dashboard
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
      <Drawer anchor="right" open={Boolean(edit)} onClose={() => setEdit(null)}>
        <Box p={3} width={320}>
          <Typography variant="h6" mb={2}>Edit Levels</Typography>
          <Stack spacing={2}>
            <TextField
              label="Rx A"
              value={edit?.rxA ?? ''}
              onChange={e => setEdit(s => ({ ...s, rxA: e.target.value }))}
            />
            <TextField
              label="Rx B"
              value={edit?.rxB ?? ''}
              onChange={e => setEdit(s => ({ ...s, rxB: e.target.value }))}
            />
            <Button variant="contained" onClick={saveEdit}>Save</Button>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
          </Stack>
        </Box>
      </Drawer>

      {/* ---------- History drawer ---------- */}
      <Drawer anchor="right" open={Boolean(hist)} onClose={() => setHist(null)}>
        <Box p={3} width={360}>
          <Typography variant="h6" gutterBottom>Level History</Typography>
          {hist?.map(h => (
            <Box key={h.id} mb={1} p={1.5} sx={{ borderBottom:'1px solid #eee' }}>
              <Typography variant="body2" fontWeight={600}>
                {dayjs(h.changedAt).format('YYYY-MM-DD HH:mm')}
              </Typography>
              <Typography variant="body2">
                RxA:&nbsp;{h.rxSiteA ?? '—'}&nbsp;&nbsp;
                RxB:&nbsp;{h.rxSiteB ?? '—'}
              </Typography>
              <Typography variant="caption">{h.reason}</Typography>
            </Box>
          ))}
        </Box>
      </Drawer>
    </Box>
  )
}
