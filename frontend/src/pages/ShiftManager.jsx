import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  TextField,
  Typography,
  Checkbox,
  FormControlLabel
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'

// dayjs plugins --------------------------------------------------------------
dayjs.extend(utc)

// api wrappers ----------------------------------------------------------------
import api from '../api'
import {
  updateShift,
  swapShifts,
  swapRange,
  reassignRange
} from '../api/shifts'

/*
───────────────────────────────────────────────────────────────────────────────
 ShiftManager.jsx – now supports
   • one‑by‑one swap (existing)
   • swap *range* between two agents
   • re‑assign range from Agent A → B (optionally mark A on leave)
───────────────────────────────────────────────────────────────────────────────*/
export default function ShiftManager () {
  /* ───────── state ─────────────────────────────────── */
  const [rows, setRows]       = useState([])
  const [teams, setTeams]     = useState([])
  const [agents, setAgents]   = useState([])
  const [filters, setFilters] = useState({
    team : '',
    agent: '',
    from : dayjs(),
    to   : dayjs().add(7, 'day')
  })
  const [loading,      setLoading]      = useState(false)
  const [editItem,     setEditItem]     = useState(null)
  const [swapSource,   setSwapSource]   = useState(null) // single‑shift swap
  const [snack,        setSnack]        = useState('')
  // dialogs for range ops
  const [swapDlgOpen,      setSwapDlgOpen]      = useState(false)
  const [reassignDlgOpen,  setReassignDlgOpen]  = useState(false)

  /* ───────── 1) load agents once  ───────────────────── */
  useEffect(() => {
    (async () => {
      const { data } = await api.get('/agents')
      setAgents(data)
      setTeams([...new Set(data.map(a => a.role))])
    })()
  }, [])

  /* ───────── 2) fetch shifts on demand ──────────────── */
  async function loadShifts () {
    try {
      setLoading(true)
      const { team, agent, from, to } = filters
      const { data } = await api.get('/shifts', {
        params: {
          role     : team  || undefined,
          agentId  : agent || undefined,
          startDate: from.format('YYYY-MM-DD'),
          endDate  : to.format('YYYY-MM-DD')
        }
      })
      setRows(data)
    } catch (err) {
      console.error('Load shifts:', err)
      setSnack('Failed to fetch shifts')
    } finally {
      setLoading(false)
    }
  }

  /* ───────── 3) export selected rows to XLSX ────────── */
  function handleExport () {
    if (!rows.length) {
      setSnack('Nothing to export')
      return
    }

    const data = rows.map(r => ({
      ID        : r.id,
      Agent     : r.agentName,
      Team      : r.team,
      Start     : r.startAt   ? dayjs.utc(r.startAt).format('YYYY-MM-DD HH:mm') : '',
      End       : r.endAt     ? dayjs.utc(r.endAt).format('YYYY-MM-DD HH:mm')   : '',
      LunchStart: r.breakStart? dayjs.utc(r.breakStart).format('YYYY-MM-DD HH:mm'): '',
      LunchEnd  : r.breakEnd  ? dayjs.utc(r.breakEnd).format('YYYY-MM-DD HH:mm') : ''
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Shifts')
    XLSX.writeFile(
      wb,
      `shifts_${filters.from.format('YYYYMMDD')}_${filters.to.format('YYYYMMDD')}.xlsx`
    )
  }

  /* ───────── 4) grid columns  ───────────────────────── */
  const columns = useMemo(() => [
    { field: 'id',        headerName: 'ID',    width: 70  },
    { field: 'agentName', headerName: 'Agent', flex: 1    },
    { field: 'team',      headerName: 'Team',  flex: 0.7  },
    {
      field: 'startAt', headerName: 'Start', flex: 1,
      renderCell: p => p.value ? dayjs.utc(p.value).format('YYYY-MM-DD HH:mm') : '—'
    },
    {
      field: 'endAt', headerName: 'End', flex: 1,
      renderCell: p => p.value ? dayjs.utc(p.value).format('YYYY-MM-DD HH:mm') : '—'
    },
    {
      field: 'actions', headerName: '', width: 120, sortable: false,
      renderCell: params => (
        <>
          <Button size='small' onClick={() => setEditItem(params.row)}>✏️</Button>
          <Button
            size='small'
            onClick={() => swapSource ? handleSwap(params.row) : setSwapSource(params.row)}
            color={swapSource && swapSource.id === params.row.id ? 'secondary' : 'primary'}
          >↔︎</Button>
        </>
      )
    }
  ], [swapSource])

  /* ───────── 5) helpers (edit / swap single) ─────────── */
  async function handleEditSave (changes) {
    try {
      await updateShift(editItem.id, changes)
      setSnack('Shift updated')
      setEditItem(null)
      await loadShifts()
    } catch {
      setSnack('Error updating shift')
    }
  }

  async function handleSwap (targetRow) {
    try {
      await swapShifts(swapSource.id, targetRow.id)
      setSnack('Shift swap complete')
      setSwapSource(null)
      await loadShifts()
    } catch {
      setSnack('Swap failed')
    }
  }

  /* ───────── derived agent list for team filter ─────── */
  const agentOptions = useMemo(() => (
    filters.team ? agents.filter(a => a.role === filters.team) : agents
  ), [agents, filters.team])

  /* ───────── range‑op submit handlers ───────────────── */
  async function submitSwapRange (payload) {
    try {
      await swapRange(payload)
      setSnack('Range swap complete')
      setSwapDlgOpen(false)
      await loadShifts()
    } catch (e) {
      console.error(e)
      setSnack('Range swap failed')
    }
  }

  async function submitReassign (payload) {
    try {
      await reassignRange(payload)
      setSnack('Re‑assignment complete')
      setReassignDlgOpen(false)
      await loadShifts()
    } catch (e) {
      console.error(e)
      setSnack('Re‑assignment failed')
    }
  }

  /* ───────── render ─────────────────────────────────── */
  return (
    <Box p={2}>
      <Typography variant='h5' gutterBottom>Shift manager</Typography>

      {/* Filters */}
      <Box display='flex' gap={2} mb={2} flexWrap='wrap' alignItems='flex-end'>
        {/* team */}
        <TextField select label='Team' size='small' value={filters.team}
          onChange={e => setFilters(p => ({ ...p, team: e.target.value, agent: '' }))}
          sx={{ minWidth: 160 }}>
          <MenuItem value=''>All</MenuItem>
          {teams.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
        </TextField>

        {/* agent */}
        <TextField select label='Agent' size='small' value={filters.agent}
          onChange={e => setFilters(p => ({ ...p, agent: e.target.value }))}
          sx={{ minWidth: 160 }} disabled={agentOptions.length === 0}>
          <MenuItem value=''>All</MenuItem>
          {agentOptions.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
        </TextField>

        {/* date range */}
        <TextField type='date' size='small' label='From' InputLabelProps={{ shrink: true }}
          value={filters.from.format('YYYY-MM-DD')}
          onChange={e => setFilters(p => ({ ...p, from: dayjs(e.target.value) }))} />
        <TextField type='date' size='small' label='To' InputLabelProps={{ shrink: true }}
          value={filters.to.format('YYYY-MM-DD')}
          onChange={e => setFilters(p => ({ ...p, to: dayjs(e.target.value) }))} />

        {/* actions */}
        <Button variant='contained' onClick={loadShifts} disabled={loading} sx={{ height: 40 }}>
          {loading ? <CircularProgress size={22} /> : 'Load shifts'}
        </Button>
        <Button variant='outlined' onClick={handleExport} disabled={!rows.length} sx={{ height: 40 }}>Export</Button>
        {/* range op launch buttons */}
        <Button variant='outlined' onClick={() => setSwapDlgOpen(true)} sx={{ height: 40 }}>Swap range</Button>
        <Button variant='outlined' onClick={() => setReassignDlgOpen(true)} sx={{ height: 40 }}>Re‑assign range</Button>
      </Box>

      {/* Table */}
      <div style={{ height: 560, width: '100%' }}>
        <DataGrid rows={rows} columns={columns} pageSize={25} />
      </div>

      {/* dialogs */}
      {editItem && <EditShiftDialog shift={editItem} onCancel={() => setEditItem(null)} onSave={handleEditSave} />}
      {swapDlgOpen  && <SwapRangeDialog    agents={agents} teams={teams}     onCancel={()=>setSwapDlgOpen(false)}     onConfirm={submitSwapRange}   />}
      {reassignDlgOpen && <ReassignRangeDialog agents={agents} teams={teams} onCancel={()=>setReassignDlgOpen(false)} onConfirm={submitReassign}    />}

      {/* snack */}
      <Snackbar open={!!snack} autoHideDuration={4000} message={snack} onClose={()=>setSnack('')} />
    </Box>
  )
}

/* ───────── dialog – single shift edit ───────────────────── */
function EditShiftDialog ({ shift, onCancel, onSave }) {
  const [start, setStart] = useState(dayjs.utc(shift.startAt).format('YYYY-MM-DDTHH:mm'))
  const [end,   setEnd]   = useState(dayjs.utc(shift.endAt  ).format('YYYY-MM-DDTHH:mm'))
  return (
    <Dialog open onClose={onCancel}>
      <DialogTitle>Edit shift</DialogTitle>
      <DialogContent sx={{ display:'flex', flexDirection:'column', gap:2, mt:1 }}>
        <TextField label='Start' type='datetime-local' value={start} onChange={e => setStart(e.target.value)} />
        <TextField label='End'   type='datetime-local' value={end}   onChange={e => setEnd(e.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={()=>onSave({ startAt:start, endAt:end })}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

/* ───────── dialog – swap shifts across range ───────────── */
function SwapRangeDialog ({ agents, teams, onCancel, onConfirm }) {
  const [agentIdA, setA] = useState('')
  const [agentIdB, setB] = useState('')
  const [team,        setTeam] = useState('')
  const [from, setFrom]  = useState(dayjs().startOf('week'))
  const [to,   setTo]    = useState(dayjs().endOf('week'))

  // only show agents on the chosen team
  const filteredAgents = team
    ? agents.filter(a => a.role === team)
    : []

  const disabled = !team || !agentIdA || !agentIdB || agentIdA === agentIdB || from.isAfter(to)

  const submit = () => onConfirm({ agentIdA:Number(agentIdA), agentIdB:Number(agentIdB), from:from.format('YYYY-MM-DD'), to:to.format('YYYY-MM-DD') })

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth='sm'>
      <DialogTitle>Swap shifts between two agents</DialogTitle>
      <DialogContent sx={{ display:'flex', flexDirection:'column', gap:2, mt:1 }}>
        {/* 1) Team picker */}
        <TextField
          select fullWidth label='Team'
          value={team}
          onChange={e => {
            setTeam(e.target.value)
            setA('')      // reset agent selections
            setB('')
          }}
          margin='normal'
        >
          <MenuItem value=''>Select team</MenuItem>
          {teams.map(t => (
            <MenuItem key={t} value={t}>{t}</MenuItem>
          ))}
        </TextField>
        {/* 2) Agent A picker */}
        <TextField
          select label='Agent A'
          value={agentIdA}
          onChange={e=>setA(e.target.value)}
          disabled={!team}
        >
          {filteredAgents.map(a => (
            <MenuItem key={a.id} value={a.id}>
              {a.fullName}
            </MenuItem>
          ))}
         </TextField>
                 {/* 3) Agent B picker */}
        <TextField
          select label='Agent B'
          value={agentIdB}
          onChange={e=>setB(e.target.value)}
          disabled={!team}
        >
          {filteredAgents.map(a => (
            <MenuItem key={a.id} value={a.id}>
              {a.fullName}
            </MenuItem>
          ))}
         </TextField>

        <TextField type='date' label='From' InputLabelProps={{ shrink:true }} value={from.format('YYYY-MM-DD')} onChange={e=>setFrom(dayjs(e.target.value))} />
        <TextField type='date' label='To'   InputLabelProps={{ shrink:true }} value={to.format('YYYY-MM-DD')}   onChange={e=>setTo(dayjs(e.target.value))} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button disabled={disabled} onClick={submit}>Confirm</Button>
      </DialogActions>
    </Dialog>
  )
}

/* ───────── dialog – reassign range ─────────────────────── */
function ReassignRangeDialog ({ agents, teams, onCancel, onConfirm }) {
  const [fromAgentId, setFromAgent] = useState('')
  const [toAgentId,   setToAgent]   = useState('')
  const [team,         setTeam]     = useState('')
  const [from,        setFrom]      = useState(dayjs().startOf('week'))
  const [to,          setTo]        = useState(dayjs().endOf('week'))
  const [markLeave,   setMarkLeave] = useState(true)

  const filteredAgents = team
  ? agents.filter(a => a.role === team)
  : []

  const disabled = !team || !fromAgentId || !toAgentId || fromAgentId === toAgentId || from.isAfter(to)

  const submit = () => onConfirm({
    fromAgentId:Number(fromAgentId),
    toAgentId  :Number(toAgentId),
    from:from.format('YYYY-MM-DD'),
    to  :to.format('YYYY-MM-DD'),
    markLeave
  })

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth='sm'>
      <DialogTitle>Re‑assign shifts from one agent to another</DialogTitle>
      <DialogContent sx={{ display:'flex', flexDirection:'column', gap:2, mt:1 }}>
        {/* 1) Team picker */}
        <TextField
          select fullWidth label='Team'
          value={team}
          onChange={e => {
            setTeam(e.target.value)
            setFromAgent('')
            setToAgent('')
          }}
          margin='normal'
        >
          <MenuItem value=''>Select team</MenuItem>
          {teams.map(t => (
            <MenuItem key={t} value={t}>{t}</MenuItem>
          ))}
        </TextField>

        {/* 2) From agent */}
        <TextField
          select label='From (agent on leave)'
          value={fromAgentId}
          onChange={e=>setFromAgent(e.target.value)}
          disabled={!team}
        >
          {filteredAgents.map(a => (
            <MenuItem key={a.id} value={a.id}>
              {a.fullName}
            </MenuItem>
          ))}
         </TextField>

        {/* 3) To agent */}
        <TextField
          select label='To (covering agent)'
          value={toAgentId}
          onChange={e=>setToAgent(e.target.value)}
          disabled={!team}
        >
          {filteredAgents.map(a => (
            <MenuItem key={a.id} value={a.id}>
              {a.fullName}
            </MenuItem>
          ))}
         </TextField>
        <TextField type='date' label='From' InputLabelProps={{ shrink:true }} value={from.format('YYYY-MM-DD')} onChange={e=>setFrom(dayjs(e.target.value))} />
        <TextField type='date' label='To' InputLabelProps={{ shrink:true }} value={to.format('YYYY-MM-DD')} onChange={e=>setTo(dayjs(e.target.value))} />
        <FormControlLabel control={<Checkbox checked={markLeave} onChange={e=>setMarkLeave(e.target.checked)} />} label='Mark original agent as on leave' />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button disabled={disabled} onClick={submit}>Confirm</Button>
      </DialogActions>
    </Dialog>
  )
}

/*
───────────────────────────────────────────────────────────────
Future enhancement → generate iCalendar invites (.ics)
----------------------------------------------------------------
Use `ical-generator` in the backend to create VEVENTS, then e‑mail to
agents once range operations succeed.
*/
