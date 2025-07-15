import { useEffect, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  MenuItem,
  Snackbar,
  TextField,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import dayjs from 'dayjs'
import api from '../api'

export default function LeavePlannerPage () {
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ agentId:'', reason:'', from:dayjs(), to:dayjs().add(1,'day') })
  const [agents, setAgents] = useState([])
  const [snack, setSnack] = useState('')

  useEffect(() => {
    ;(async () => {
      const [{ data: a },{ data: l }] = await Promise.all([
        api.get('/agents'),
        api.get('/leave')
      ])
      setAgents(a)
      setRows(l.map(leave => ({
        id: leave.id,
        agentName: leave.agent.fullName,
        team: leave.agent.role,
        reason: leave.reason,
        startDate: leave.startsAt,
        endDate: leave.endsAt,
        createdBy: leave.createdBy,
        createdAt: leave.createdAt
      })))
    })()
  }, [])

  async function handleSave () {
    try {
      await api.post('/leave', {
        ...form,
        startsAt : form.from.format(),
        endsAt   : form.to.format()
      })
      setSnack('Leave captured')
      setOpen(false)
      const { data } = await api.get('/leave')
      setRows(data.map(leave => ({
        id: leave.id,
        agentName: leave.agent.fullName,
        team: leave.agent.role,
        reason: leave.reason,
        startDate: leave.startsAt,
        endDate: leave.endsAt,
        createdBy: leave.createdBy,
        createdAt: leave.createdAt
      })))
    } catch {
      setSnack('Save failed')
    }
  }

  const columns = [
    { field:'agentName', headerName:'Agent', flex:1 },
    { field:'team',      headerName:'Team', flex:1 },
    { field:'reason',    headerName:'Reason', flex:1.5 },
    {
      field:'startDate', headerName:'Start', flex:1,
      valueFormatter: params => params.value ? dayjs(params.value).format('YYYY-MM-DD') : ''
    },
    {
      field:'endDate', headerName:'End', flex:1,
      valueFormatter: params => params.value ? dayjs(params.value).format('YYYY-MM-DD') : ''
    },
    { field:'createdBy', headerName:'Created By', flex:1 },
    {
      field:'createdAt', headerName:'Created At', flex:1,
      valueFormatter: params => params.value ? dayjs(params.value).format('YYYY-MM-DD HH:mm') : ''
    }
  ]

  return (
    <Box p={2}>
      <Typography variant='h5' gutterBottom>Planned leave</Typography>

      <Button onClick={() => setOpen(true)} variant='contained' sx={{ mb:2 }}>
        + Add leave
      </Button>

      <div style={{ height: 400, width: '100%', marginBottom: 16 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          pageSize={5}
          rowsPerPageOptions={[5, 10, 20]}
          disableSelectionOnClick
        />
      </div>

      {open && (
        <Dialog open onClose={() => setOpen(false)}>
          <DialogTitle>New leave / PTO</DialogTitle>
          <DialogContent sx={{ display:'flex', flexDirection:'column', gap:2, mt:1, minWidth:280 }}>
            <TextField
              select
              label='Agent'
              value={form.agentId}
              onChange={e => setForm(f => ({ ...f, agentId:+e.target.value }))}
            >
              {agents.map(a => (
                <MenuItem key={a.id} value={a.id}>{a.fullName}</MenuItem>
              ))}
            </TextField>

            <TextField
              label='Reason'
              fullWidth
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason:e.target.value }))}
            />

            <TextField
              type='date'
              label='From'
              InputLabelProps={{ shrink:true }}
              value={form.from.format('YYYY-MM-DD')}
              onChange={e => setForm(f => ({ ...f, from:dayjs(e.target.value) }))}
            />
            <TextField
              type='date'
              label='To'
              InputLabelProps={{ shrink:true }}
              value={form.to.format('YYYY-MM-DD')}
              onChange={e => setForm(f => ({ ...f, to:dayjs(e.target.value) }))}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.agentId || !form.reason}>
              Save
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Snackbar
        open={!!snack}
        message={snack}
        autoHideDuration={4000}
        onClose={()=>setSnack('')}
      />
    </Box>
  )
}
