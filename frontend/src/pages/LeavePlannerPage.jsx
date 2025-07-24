// frontend/src/pages/LeavePlannerPage.jsx
import { useEffect, useState, useMemo } from 'react'
import {
  Box, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  MenuItem, Snackbar, TextField, Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import dayjs from 'dayjs'

// calendar
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
// v6 style sheets
import '@fullcalendar/core/index.css'
import '@fullcalendar/daygrid/index.css'

// React wrapper needs this once in your bundle (before any FullCalendar CSS)
import '@fullcalendar/core/vdom'

import api from '../api'

export default function LeavePlannerPage () {
  /* ------------------------------------------------------------------ */
  /* state                                                              */
  /* ------------------------------------------------------------------ */
  const [rows,   setRows]   = useState([])
  const [agents, setAgents] = useState([])

  const [open,   setOpen]   = useState(false)  // add-leave dialog
  const [snack,  setSnack]  = useState('')

  const [form, setForm] = useState({
    agentId : '',
    reason  : '',
    from    : dayjs(),
    to      : dayjs().add(1, 'day')
  })

  const [confOpen, setConfOpen] = useState(false)
  const [overlaps, setOverlaps] = useState([])

  /* ------------------------------------------------------------------ */
  /* fetch data                                                         */
  /* ------------------------------------------------------------------ */
  useEffect(() => {
    ;(async () => {
      const [{ data: a }, { data: l }] = await Promise.all([
        api.get('/agents'),
        api.get('/leave')
      ])
      setAgents(a)
      setRows(mapLeave(l))
    })()
  }, [])

  const mapLeave = leaveArr =>
    leaveArr.map(leave => ({
      id        : leave.id,
      agentId   : leave.agent.id,
      agentName : leave.agent.fullName,
      team      : leave.agent.role,
      reason    : leave.reason,
      startDate : new Date(leave.startsAt),
      endDate   : new Date(leave.endsAt),
      createdBy : leave.createdBy,
      createdAt : new Date(leave.createdAt)
    }))

  /* ------------------------------------------------------------------ */
  /* helpers                                                            */
  /* ------------------------------------------------------------------ */
  const colourPalette = [
    '#d32f2f', '#1976d2', '#388e3c', '#f57c00', '#7b1fa2',
    '#00796b', '#c2185b', '#512da8', '#455a64', '#5d4037'
  ]

  /* consistent colour per agent - deterministic on agentId order */
  const colourMap = useMemo(() => {
    const ids = [...new Set(rows.map(r => r.agentId))].sort((a, b) => a - b)
    const map = {}
    ids.forEach((id, idx) => {
      map[id] = colourPalette[idx % colourPalette.length]
    })
    return map
  }, [rows])

  const events = useMemo(() =>
    rows.map(r => ({
      title          : r.agentName,
      start          : dayjs(r.startDate).format('YYYY-MM-DD'),
      end            : dayjs(r.endDate).add(1, 'day').format('YYYY-MM-DD'), // all-day end exclusive
      display        : 'block',
      backgroundColor: colourMap[r.agentId],
      borderColor    : colourMap[r.agentId]
    })), [rows, colourMap])

  /* ------------------------------------------------------------------ */
  /* save logic with overlap warning                                    */
  /* ------------------------------------------------------------------ */
  const saveToServer = async () => {
    try {
      await api.post('/leave', {
        agentId : form.agentId,
        reason  : form.reason,
        startsAt: form.from.format(),
        endsAt  : form.to.format()
      })
      const { data } = await api.get('/leave')
      setRows(mapLeave(data))
      setSnack('Leave captured')
      setOpen(false)
    } catch {
      setSnack('Save failed')
    }
  }

  const handleSaveClick = () => {
    const overlapping = rows.filter(r =>
      r.agentId !== form.agentId &&
      r.startDate <= form.to.toDate() &&
      r.endDate   >= form.from.toDate()
    )
    if (overlapping.length) {
      setOverlaps(overlapping)
      setConfOpen(true)
    } else {
      saveToServer()
    }
  }

  /* ------------------------------------------------------------------ */
  /* grid columns                                                       */
  /* ------------------------------------------------------------------ */
  const columns = [
    { field: 'agentName', headerName: 'Agent', flex: 1 },
    { field: 'team',      headerName: 'Team',  flex: 1 },
    { field: 'reason',    headerName: 'Reason',flex: 1.5 },
    {
      field: 'startDate', headerName: 'Start', flex: 1,
      renderCell: p => p.value ? dayjs(p.value).format('YYYY-MM-DD') : ''
    },
    {
      field: 'endDate',   headerName: 'End',   flex: 1,
      renderCell: p => p.value ? dayjs(p.value).format('YYYY-MM-DD') : ''
    },
    { field: 'createdBy', headerName: 'Created By', flex: 1 },
    {
      field: 'createdAt', headerName: 'Created At', flex: 1,
      renderCell: p => p.value ? dayjs(p.value).format('YYYY-MM-DD') : ''
    }
  ]

  /* ------------------------------------------------------------------ */
  /* render                                                             */
  /* ------------------------------------------------------------------ */
  return (
    <Box p={2}>
      <Typography variant='h5' gutterBottom>Planned leave</Typography>

      <Button variant='contained' sx={{ mb: 2 }} onClick={() => setOpen(true)}>
        + Add leave
      </Button>

      {/* leave table */}
      <Box sx={{ height: 400, width: '100%', mb: 4 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          pageSize={5}
          rowsPerPageOptions={[5, 10, 20]}
          disableSelectionOnClick
        />
      </Box>

      {/* month calendar */}
      <FullCalendar
        plugins={[dayGridPlugin]}
        initialView='dayGridMonth'
        height={600}
        events={events}
        headerToolbar={{
          start : 'title',
          center: '',
          end   : 'prev today next'
        }}
      />

      {/* add-leave dialog */}
      {open && (
        <Dialog open onClose={() => setOpen(false)}>
          <DialogTitle>New leave / PTO</DialogTitle>
          <DialogContent
            sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1, minWidth: 300 }}>

            <TextField
              select label='Agent' fullWidth
              value={form.agentId}
              onChange={e => setForm(f => ({ ...f, agentId: +e.target.value }))}
            >
              {agents.map(a => (
                <MenuItem key={a.id} value={a.id}>{a.fullName}</MenuItem>
              ))}
            </TextField>

            <TextField
              label='Reason' fullWidth
              value={form.reason}
              onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}
            />

            <TextField
              type='date'
              label='From'
              InputLabelProps={{ shrink: true }}
              fullWidth
              value={form.from.format('YYYY-MM-DD')}
              onChange={e => setForm(f => ({ ...f, from: dayjs(e.target.value) }))}
            />

            <TextField
              type='date'
              label='To'
              InputLabelProps={{ shrink: true }}
              fullWidth
              value={form.to.format('YYYY-MM-DD')}
              onChange={e => setForm(f => ({ ...f, to: dayjs(e.target.value) }))}
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              onClick={handleSaveClick}
              disabled={!form.agentId || !form.reason}>
              Save
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* overlap-confirm dialog */}
      {confOpen && (
        <Dialog open onClose={() => setConfOpen(false)}>
          <DialogTitle>Overlap detected</DialogTitle>
          <DialogContent dividers>
            <Typography sx={{ mb: 1 }}>
              The following leave entries clash with the selected dates:
            </Typography>
            {overlaps.map(o => (
              <Typography key={o.id}>
                • {o.agentName} ({dayjs(o.startDate).format('YYYY-MM-DD')} → {dayjs(o.endDate).format('YYYY-MM-DD')})
              </Typography>
            ))}
            <Typography sx={{ mt: 2 }}>
              Do you want to approve this leave anyway?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfOpen(false)}>Cancel</Button>
            <Button
              variant='contained'
              onClick={() => { setConfOpen(false); saveToServer() }}>
              Proceed
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* snack */}
      <Snackbar
        open={!!snack}
        message={snack}
        autoHideDuration={4000}
        onClose={() => setSnack('')}
      />
    </Box>
  )
}
