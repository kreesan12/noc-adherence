// frontend/src/pages/LeavePlannerPage.jsx
import { useEffect, useState, useMemo } from 'react'
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

// calendar
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'

import api from '../api'

export default function LeavePlannerPage () {
  /* --------------------------------------------------------------------- */
  /* state                                                                 */
  /* --------------------------------------------------------------------- */
  const [rows,   setRows]   = useState([])
  const [open,   setOpen]   = useState(false)        // add-leave dialog
  const [agents, setAgents] = useState([])
  const [snack,  setSnack]  = useState('')

  // leave form
  const [form, setForm] = useState({
    agentId : '',
    reason  : '',
    from    : dayjs(),
    to      : dayjs().add(1, 'day')
  })

  /* overlap-confirm dialog */
  const [confOpen,   setConfOpen]   = useState(false)
  const [overlaps,   setOverlaps]   = useState([])   // array of overlapping rows

  /* --------------------------------------------------------------------- */
  /* data load                                                             */
  /* --------------------------------------------------------------------- */
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

  /* helper: transform API → grid rows */
  function mapLeave (leaveArr) {
    return leaveArr.map(leave => ({
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
  }

  /* --------------------------------------------------------------------- */
  /* save logic with overlap check                                         */
  /* --------------------------------------------------------------------- */
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
    /* find overlaps – other agents whose leave intersects chosen range    */
    const overlapping = rows.filter(r =>
      r.agentId !== form.agentId &&
      r.startDate <= form.to.toDate() &&
      r.endDate   >= form.from.toDate()
    )
    if (overlapping.length) {
      setOverlaps(overlapping)
      setConfOpen(true)           // show confirm dialog
    } else {
      saveToServer()
    }
  }

  /* --------------------------------------------------------------------- */
  /* grid + calendar derived data                                          */
  /* --------------------------------------------------------------------- */
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

  /* FullCalendar events (all-day, end exclusive) */
  const events = useMemo(() =>
    rows.map(r => ({
      title : `${r.agentName} – ${r.team}`,
      start : dayjs(r.startDate).format('YYYY-MM-DD'),
      end   : dayjs(r.endDate).add(1, 'day').format('YYYY-MM-DD'),
      display: 'block'
    })), [rows])

  /* --------------------------------------------------------------------- */
  /* render                                                                */
  /* --------------------------------------------------------------------- */
  return (
    <Box p={2}>
      <Typography variant='h5' gutterBottom>Planned leave</Typography>

      <Button onClick={() => setOpen(true)}
              variant='contained'
              sx={{ mb: 2 }}>
        + Add leave
      </Button>

      {/* existing leave table */}
      <Box sx={{ height: 400, width: '100%', mb: 4 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          pageSize={5}
          rowsPerPageOptions={[5, 10, 20]}
          disableSelectionOnClick
        />
      </Box>

      {/* month view calendar */}
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

      {/* ----------------------------------------------------------------- */}
      {/* add-leave dialog                                                  */}
      {/* ----------------------------------------------------------------- */}
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

      {/* ----------------------------------------------------------------- */}
      {/* overlap confirmation dialog                                       */}
      {/* ----------------------------------------------------------------- */}
      {confOpen && (
        <Dialog open onClose={() => setConfOpen(false)}>
          <DialogTitle>Overlap detected</DialogTitle>
          <DialogContent dividers>
            <Typography sx={{ mb: 1 }}>
              The following people are already on leave during the selected period:
            </Typography>
            {overlaps.map(o => (
              <Typography key={o.id}>• {o.agentName} ({dayjs(o.startDate).format('YYYY-MM-DD')} → {dayjs(o.endDate).format('YYYY-MM-DD')})</Typography>
            ))}
            <Typography sx={{ mt: 2 }}>
              Do you want to save this leave anyway?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfOpen(false)}>Cancel</Button>
            <Button
              onClick={() => { setConfOpen(false); saveToServer() }}
              variant='contained'>
              Proceed
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {/* snack messages */}
      <Snackbar
        open={!!snack}
        message={snack}
        autoHideDuration={4000}
        onClose={() => setSnack('')}
      />
    </Box>
  )
}
