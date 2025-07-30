// frontend/src/pages/NldLightLevelsPage.jsx
import { useEffect, useState } from 'react'
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Stack,
  TextField,
  Button,
  Drawer,
  Accordion,
  AccordionSummary,
  AccordionDetails
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import EditNoteIcon    from '@mui/icons-material/EditNote'
import HistoryIcon     from '@mui/icons-material/History'
import Badge           from '@mui/material/Badge'
import ExpandMoreIcon  from '@mui/icons-material/ExpandMore'
import { useAuth }     from '../context/AuthContext'
import api             from '../api'

export default function NldLightLevelsPage () {
  const { user }  = useAuth()

  /* ─── state ───────────────────────────────────────────── */
  const [rows,   setRows]   = useState([])
  const [editId, setEditId] = useState(null)
  const [editA,  setEditA]  = useState('')
  const [editB,  setEditB]  = useState('')
  const [hist,   setHist]   = useState(null)

  /* ─── load data once ─────────────────────────────────── */
  useEffect(() => {
    api.get('/engineering/circuits').then(r => setRows(r.data))
  }, [])

  /* ─── helpers ────────────────────────────────────────── */
  const groupBy = (arr, key) =>
    arr.reduce((m,r) => ((m[r[key] ?? '—'] = m[r[key] ?? '—'] ?? []).push(r), m), {})

  async function openHist (id) {
    const { data } = await api.get(`/engineering/circuit/${id}`)
    setHist(data.levelHistory)
  }

  function startEdit (row) {
    setEditId(row.id)
    setEditA(row.currentRxSiteA ?? '')
    setEditB(row.currentRxSiteB ?? '')
  }

  async function saveEdit () {
    await api.post(`/engineering/circuit/${editId}`, {
      currentRxSiteA: parseFloat(editA),
      currentRxSiteB: parseFloat(editB),
      reason: 'value adjusted via UI'
    })
    const { data } = await api.get('/engineering/circuits')
    setRows(data)
    setEditId(null)
  }

  /* ─── datagrid columns ───────────────────────────────── */
  const cols = [
    { field:'circuitId',        headerName:'Circuit',    width:180 },
    { field:'nodeA',            headerName:'Node A',     width:120 },
    { field:'nodeB',            headerName:'Node B',     width:120 },
    { field:'techType',         headerName:'Tech',       width:90  },
    { field:'currentRxSiteA',   headerName:'Rx A (dBm)', width:130 },
    { field:'currentRxSiteB',   headerName:'Rx B (dBm)', width:130 },
    { field:'updatedAt',
      headerName:'Updated',
      width:180,
      valueFormatter:({ value }) =>
        value ? new Date(value).toLocaleString() : '' 
    },
    { field:'actions',
      headerName:'',
      width:90,
      sortable:false,
      filterable:false,
      renderCell:(p) => (
        <Stack direction="row" spacing={0.5}>
          {user?.role === 'engineering' && (
            <Tooltip title="Edit levels">
              <IconButton size="small" onClick={() => startEdit(p.row)}>
                <EditNoteIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="View history">
            <IconButton size="small" onClick={() => openHist(p.row.id)}>
              <Badge
                badgeContent={p.row._count?.levelHistory ?? 0}
                color="secondary"
                overlap="circular"
              >
                <HistoryIcon fontSize="inherit" />
              </Badge>
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ]

  /* ─── render ─────────────────────────────────────────── */
  return (
    <Box p={2}>
      <Typography variant="h5" gutterBottom>
        NLD Light-Level Dashboard
      </Typography>

      {/* accordion per NLD group */}
      {Object.entries(groupBy(rows,'nldGroup')).map(([grp,list]) => (
        <Accordion key={grp} defaultExpanded sx={{ mb:1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon/>}>
            <Typography sx={{ fontWeight:600 }}>
              {grp} &nbsp; <Typography component="span" variant="caption">({list.length} circuits)</Typography>
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            <DataGrid
              rows={list}
              columns={cols}
              autoHeight
              density="compact"
              getRowId={(r) => r.id}
            />
          </AccordionDetails>
        </Accordion>
      ))}

      {/* inline edit panel */}
      {editId && (
        <Box mt={2} p={2} sx={{ border:'1px solid #ccc', borderRadius:2 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography>
              Edit&nbsp;{rows.find(r => r.id === editId)?.circuitId}
            </Typography>
            <TextField
              label="Rx A"
              size="small"
              value={editA}
              onChange={e => setEditA(e.target.value)}
            />
            <TextField
              label="Rx B"
              size="small"
              value={editB}
              onChange={e => setEditB(e.target.value)}
            />
            <Button variant="contained" onClick={saveEdit}>Save</Button>
            <Button onClick={() => setEditId(null)}>Cancel</Button>
          </Stack>
        </Box>
      )}

      {/* history slide-out */}
      <Drawer anchor="right" open={Boolean(hist)} onClose={() => setHist(null)}>
        <Box p={2} width={360}>
          <Typography variant="h6" gutterBottom>Level History</Typography>
          {hist?.map(h => (
            <Box key={h.id} mb={1} p={1} sx={{ borderBottom:'1px solid #eee' }}>
              <Typography variant="body2">
                {new Date(h.changedAt).toLocaleString()}
              </Typography>
              <Typography variant="body2">
                RxA:&nbsp;{h.rxSiteA ?? '—'}&nbsp;&nbsp;RxB:&nbsp;{h.rxSiteB ?? '—'}
              </Typography>
              <Typography variant="caption">{h.reason}</Typography>
            </Box>
          ))}
        </Box>
      </Drawer>
    </Box>
  )
}
