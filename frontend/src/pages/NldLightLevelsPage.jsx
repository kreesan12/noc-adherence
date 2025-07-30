import { useEffect, useState } from 'react'
import {
  Box, Typography, IconButton, Tooltip, Stack,
  TextField, Button, Drawer                             
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import EditNoteIcon   from '@mui/icons-material/EditNote'
import HistoryIcon   from '@mui/icons-material/History'     // 🔹 NEW
import { useAuth }    from '../contexts/AuthContext'
import api            from '../api'

export default function NldLightLevelsPage () {
  const { user } = useAuth()
  const [rows,   setRows]   = useState([])
  const [editId, setEditId] = useState(null)
  const [editA,  setEditA]  = useState('')
  const [editB,  setEditB]  = useState('')

  const [hist,   setHist]   = useState(null)                 // 🔹 NEW

  useEffect(() => {
    api.get('/engineering/circuits').then(r => setRows(r.data))
  }, [])

  async function openHist(id) {                              // 🔹 NEW
    const { data } = await api.get(`/engineering/circuit/${id}`)
    setHist(data.levelHistory)
  }

  const cols = [
    { field:'circuitId', headerName:'Circuit', width:180 },
    { field:'nodeA',     headerName:'Node A',  width:120 },
    { field:'nodeB',     headerName:'Node B',  width:120 },
    { field:'techType',  headerName:'Tech',    width:90 },
    { field:'currentRxSiteA', headerName:'Rx A (dBm)', width:130 },
    { field:'currentRxSiteB', headerName:'Rx B (dBm)', width:130 },
    { field:'updatedAt', headerName:'Updated', width:180,
      valueGetter:({value}) => new Date(value).toLocaleString() },
    {
      field:'actions', headerName:'', width:90, sortable:false, filterable:false,
      renderCell:(p) => (
        <Stack direction="row" spacing={0.5}>
          {user?.role === 'engineering' && (
            <Tooltip title="Edit levels">
              <IconButton size="small" onClick={() => startEdit(p.row)}>
                <EditNoteIcon fontSize="inherit" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="View history">                     {/* 🔹 NEW */}
            <IconButton size="small" onClick={() => openHist(p.row.id)}>
              <HistoryIcon fontSize="inherit" />
            </IconButton>
          </Tooltip>
        </Stack>
      )
    }
  ]

  function startEdit(row) {
    setEditId(row.id)
    setEditA(row.currentRxSiteA ?? '')
    setEditB(row.currentRxSiteB ?? '')
  }

  async function saveEdit() {
    await api.post(`/engineering/circuit/${editId}`, {
      currentRxSiteA: parseFloat(editA),
      currentRxSiteB: parseFloat(editB),
      reason: 'value adjusted via UI'
    })
    const { data } = await api.get('/engineering/circuits')
    setRows(data)
    setEditId(null)
  }

  return (
    <Box p={2}>
      <Typography variant="h5" gutterBottom>NLD Light-Level Dashboard</Typography>

      <DataGrid rows={rows} columns={cols} autoHeight density="compact" />

      {/* simple inline edit panel */}
      {editId && (
        <Box mt={2} p={2} sx={{ border:'1px solid #ccc', borderRadius:2 }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography>
              Edit Circuit&nbsp;{rows.find(r => r.id === editId)?.circuitId}
            </Typography>
            <TextField size="small"
              label="Rx A" value={editA}
              onChange={e => setEditA(e.target.value)}
            />
            <TextField size="small"
              label="Rx B" value={editB}
              onChange={e => setEditB(e.target.value)}
            />
            <Button variant="contained" onClick={saveEdit}>Save</Button>
            <Button onClick={() => setEditId(null)}>Cancel</Button>
          </Stack>
        </Box>
      )}

     {/*  🔹 HISTORY DRAWER  -------------------------------------- */}
     <Drawer anchor="right" open={Boolean(hist)} onClose={() => setHist(null)}>
       <Box p={2} width={360}>
         <Typography variant="h6" gutterBottom>Level History</Typography>
         {hist?.map(h => (
           <Box key={h.id} mb={1} p={1} sx={{ borderBottom:'1px solid #eee' }}>
             <Typography variant="body2">
               {new Date(h.changedAt).toLocaleString()}
             </Typography>
             <Typography variant="body2">
               RxA: {h.rxSiteA ?? '—'}&nbsp;&nbsp;RxB: {h.rxSiteB ?? '—'}
             </Typography>
             <Typography variant="caption">{h.reason}</Typography>
           </Box>
         ))}
       </Box>
     </Drawer>
    </Box>
  )
}
