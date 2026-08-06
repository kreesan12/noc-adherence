import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography,
  Checkbox,
  FormControlLabel
} from '@mui/material'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import ImportExportRoundedIcon from '@mui/icons-material/ImportExportRounded'
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded'
import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded'
import PublishedWithChangesRoundedIcon from '@mui/icons-material/PublishedWithChangesRounded'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import * as XLSX from 'xlsx'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import api from '../api'
import { updateShift, swapShifts, swapRange, reassignRange } from '../api/shifts'
import { PageShell, SectionCard, FilterStrip } from '../components/ui/PageScaffold'

dayjs.extend(utc)

const ACCENT = '#2563eb'

function formatShiftDate(value) {
  return value ? dayjs.utc(value).format('YYYY-MM-DD HH:mm') : '-'
}

export default function ShiftManager() {
  const [rows, setRows] = useState([])
  const [teams, setTeams] = useState([])
  const [agents, setAgents] = useState([])
  const [filters, setFilters] = useState({
    team: '',
    agent: '',
    from: dayjs(),
    to: dayjs().add(7, 'day')
  })
  const [loading, setLoading] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [swapSource, setSwapSource] = useState(null)
  const [snack, setSnack] = useState('')
  const [swapDlgOpen, setSwapDlgOpen] = useState(false)
  const [reassignDlgOpen, setReassignDlgOpen] = useState(false)

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const { data } = await api.get('/agents')
        if (cancelled) return
        setAgents(data ?? [])
        setTeams([...new Set((data ?? []).map((agent) => agent.team).filter(Boolean))].sort())
      } catch (error) {
        console.error('Load agents:', error)
        if (!cancelled) setSnack('Failed to load agents')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    loadShifts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function loadShifts() {
    try {
      setLoading(true)
      const { team, agent, from, to } = filters
      const { data } = await api.get('/shifts', {
        params: {
          team: team || undefined,
          agentId: agent || undefined,
          startDate: from.format('YYYY-MM-DD'),
          endDate: to.format('YYYY-MM-DD')
        }
      })
      setRows(data ?? [])
    } catch (err) {
      console.error('Load shifts:', err)
      setSnack('Failed to fetch shifts')
    } finally {
      setLoading(false)
    }
  }

  function handleExport() {
    if (!rows.length) {
      setSnack('Nothing to export')
      return
    }

    const data = rows.map((row) => ({
      ID: row.id,
      Agent: row.agentName,
      Team: row.team,
      Start: row.startAt ? dayjs.utc(row.startAt).format('YYYY-MM-DD HH:mm') : '',
      End: row.endAt ? dayjs.utc(row.endAt).format('YYYY-MM-DD HH:mm') : '',
      LunchStart: row.breakStart ? dayjs.utc(row.breakStart).format('YYYY-MM-DD HH:mm') : '',
      LunchEnd: row.breakEnd ? dayjs.utc(row.breakEnd).format('YYYY-MM-DD HH:mm') : ''
    }))

    const ws = XLSX.utils.json_to_sheet(data)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Shifts')
    XLSX.writeFile(
      wb,
      `shifts_${filters.from.format('YYYYMMDD')}_${filters.to.format('YYYYMMDD')}.xlsx`
    )
  }

  async function handleEditSave(changes) {
    try {
      await updateShift(editItem.id, changes)
      setSnack('Shift updated')
      setEditItem(null)
      await loadShifts()
    } catch {
      setSnack('Error updating shift')
    }
  }

  async function handleSwap(targetRow) {
    try {
      await swapShifts(swapSource.id, targetRow.id)
      setSnack('Shift swap complete')
      setSwapSource(null)
      await loadShifts()
    } catch {
      setSnack('Swap failed')
    }
  }

  async function submitSwapRange(payload) {
    try {
      await swapRange(payload)
      setSnack('Range swap complete')
      setSwapDlgOpen(false)
      await loadShifts()
    } catch (error) {
      console.error(error)
      setSnack('Range swap failed')
    }
  }

  async function submitReassign(payload) {
    try {
      await reassignRange(payload)
      setSnack('Reassignment complete')
      setReassignDlgOpen(false)
      await loadShifts()
    } catch (error) {
      console.error(error)
      setSnack('Reassignment failed')
    }
  }

  const agentOptions = useMemo(
    () => (filters.team ? agents.filter((agent) => agent.team === filters.team) : agents),
    [agents, filters.team]
  )

  const uniqueAgentsInRows = useMemo(
    () => new Set(rows.map((row) => row.agentName).filter(Boolean)).size,
    [rows]
  )

  const rangeDays = useMemo(
    () => Math.max(1, filters.to.startOf('day').diff(filters.from.startOf('day'), 'day') + 1),
    [filters.from, filters.to]
  )

  const columns = useMemo(
    () => [
      { field: 'id', headerName: 'ID', width: 78 },
      { field: 'agentName', headerName: 'Agent', flex: 1, minWidth: 180 },
      { field: 'team', headerName: 'Team', width: 120 },
      {
        field: 'startAt',
        headerName: 'Start',
        minWidth: 168,
        flex: 0.9,
        renderCell: (params) => formatShiftDate(params.value)
      },
      {
        field: 'endAt',
        headerName: 'End',
        minWidth: 168,
        flex: 0.9,
        renderCell: (params) => formatShiftDate(params.value)
      },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 150,
        sortable: false,
        filterable: false,
        renderCell: (params) => {
          const selectedForSwap = swapSource?.id === params.row.id
          return (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Button
                size="small"
                variant="text"
                startIcon={<EditRoundedIcon sx={{ fontSize: 16 }} />}
                onClick={() => setEditItem(params.row)}
                sx={{ minWidth: 0, px: 0.75 }}
              >
                Edit
              </Button>
              <Button
                size="small"
                variant={selectedForSwap ? 'contained' : 'text'}
                color={selectedForSwap ? 'secondary' : 'primary'}
                startIcon={<SwapHorizRoundedIcon sx={{ fontSize: 16 }} />}
                onClick={() => (swapSource ? handleSwap(params.row) : setSwapSource(params.row))}
                sx={{ minWidth: 0, px: 0.75 }}
              >
                {selectedForSwap ? 'Armed' : 'Swap'}
              </Button>
            </Stack>
          )
        }
      }
    ],
    [swapSource]
  )

  return (
    <PageShell
      eyebrow="Staffing and Scheduling"
      title="Shift Manager"
      description="Review shift coverage, edit individual shifts, and run controlled swap or reassignment operations across a selected date window."
      accent={ACCENT}
      stats={[
        { label: 'Rows Loaded', value: loading ? 'Loading...' : rows.length, helper: 'current shift rows' },
        { label: 'Teams', value: teams.length, helper: 'available teams' },
        { label: 'Agents In View', value: uniqueAgentsInRows, helper: 'from current result set' },
        { label: 'Window', value: `${rangeDays}d`, helper: `${filters.from.format('DD MMM')} to ${filters.to.format('DD MMM')}` }
      ]}
    >
      <SectionCard
        title="Range and Actions"
        subtitle="Filter the view first, then export, swap, or reassign against the same working window."
        accent={ACCENT}
      >
        <FilterStrip>
          <TextField
            select
            label="Team"
            size="small"
            value={filters.team}
            onChange={(event) => setFilters((prev) => ({ ...prev, team: event.target.value, agent: '' }))}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All</MenuItem>
            {teams.map((team) => (
              <MenuItem key={team} value={team}>{team}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Agent"
            size="small"
            value={filters.agent}
            onChange={(event) => setFilters((prev) => ({ ...prev, agent: event.target.value }))}
            sx={{ minWidth: 180 }}
            disabled={agentOptions.length === 0}
          >
            <MenuItem value="">All</MenuItem>
            {agentOptions.map((agent) => (
              <MenuItem key={agent.id} value={agent.id}>{agent.fullName}</MenuItem>
            ))}
          </TextField>

          <TextField
            type="date"
            size="small"
            label="From"
            InputLabelProps={{ shrink: true }}
            value={filters.from.format('YYYY-MM-DD')}
            onChange={(event) => setFilters((prev) => ({ ...prev, from: dayjs(event.target.value) }))}
          />

          <TextField
            type="date"
            size="small"
            label="To"
            InputLabelProps={{ shrink: true }}
            value={filters.to.format('YYYY-MM-DD')}
            onChange={(event) => setFilters((prev) => ({ ...prev, to: dayjs(event.target.value) }))}
          />

          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchRoundedIcon />}
            onClick={loadShifts}
            disabled={loading}
            sx={{ minHeight: 36 }}
          >
            Refresh
          </Button>

          <Button
            variant="outlined"
            startIcon={<FileDownloadRoundedIcon />}
            onClick={handleExport}
            disabled={!rows.length}
            sx={{ minHeight: 36 }}
          >
            Export
          </Button>

          <Button
            variant="outlined"
            startIcon={<AutorenewRoundedIcon />}
            onClick={() => setSwapDlgOpen(true)}
            sx={{ minHeight: 36 }}
          >
            Swap Range
          </Button>

          <Button
            variant="outlined"
            startIcon={<PublishedWithChangesRoundedIcon />}
            onClick={() => setReassignDlgOpen(true)}
            sx={{ minHeight: 36 }}
          >
            Reassign Range
          </Button>

          {swapSource ? (
            <Chip
              color="secondary"
              variant="filled"
              label={`Swap armed: ${swapSource.agentName}`}
              onDelete={() => setSwapSource(null)}
            />
          ) : null}
        </FilterStrip>
      </SectionCard>

      <SectionCard
        title="Shift Grid"
        subtitle="Use edit for direct changes or arm a row for a one-to-one swap inside the current result set."
        accent={ACCENT}
        noPadding
      >
        <Box sx={{ height: 610 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            density="compact"
            disableRowSelectionOnClick
            loading={loading}
            pageSizeOptions={[25, 50, 100]}
            initialState={{
              pagination: { paginationModel: { pageSize: 25, page: 0 } }
            }}
            slots={{ toolbar: GridToolbar }}
            slotProps={{
              toolbar: {
                showQuickFilter: true,
                quickFilterProps: { debounceMs: 250 }
              }
            }}
            sx={{
              border: 0,
              '& .MuiDataGrid-toolbarContainer': {
                px: 1,
                py: 0.7,
                borderBottom: '1px solid',
                borderColor: 'divider'
              },
              '& .MuiDataGrid-cell': {
                alignItems: 'center'
              }
            }}
          />
        </Box>
      </SectionCard>

      {editItem ? (
        <EditShiftDialog shift={editItem} onCancel={() => setEditItem(null)} onSave={handleEditSave} />
      ) : null}
      {swapDlgOpen ? (
        <SwapRangeDialog
          agents={agents}
          teams={teams}
          onCancel={() => setSwapDlgOpen(false)}
          onConfirm={submitSwapRange}
        />
      ) : null}
      {reassignDlgOpen ? (
        <ReassignRangeDialog
          agents={agents}
          teams={teams}
          onCancel={() => setReassignDlgOpen(false)}
          onConfirm={submitReassign}
        />
      ) : null}

      <Snackbar open={!!snack} autoHideDuration={4000} message={snack} onClose={() => setSnack('')} />
    </PageShell>
  )
}

function EditShiftDialog({ shift, onCancel, onSave }) {
  const [start, setStart] = useState(dayjs.utc(shift.startAt).format('YYYY-MM-DDTHH:mm'))
  const [end, setEnd] = useState(dayjs.utc(shift.endAt).format('YYYY-MM-DDTHH:mm'))

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Edit Shift</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <TextField label="Start" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} />
        <TextField label="End" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button onClick={() => onSave({ startAt: start, endAt: end })}>Save</Button>
      </DialogActions>
    </Dialog>
  )
}

function SwapRangeDialog({ agents, teams, onCancel, onConfirm }) {
  const [agentIdA, setAgentA] = useState('')
  const [agentIdB, setAgentB] = useState('')
  const [team, setTeam] = useState('')
  const [from, setFrom] = useState(dayjs().startOf('week'))
  const [to, setTo] = useState(dayjs().endOf('week'))

  const filteredAgents = team ? agents.filter((agent) => agent.team === team) : []
  const disabled = !team || !agentIdA || !agentIdB || agentIdA === agentIdB || from.isAfter(to)

  const submit = () => onConfirm({
    agentIdA: Number(agentIdA),
    agentIdB: Number(agentIdB),
    from: from.format('YYYY-MM-DD'),
    to: to.format('YYYY-MM-DD')
  })

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Swap Shifts Across a Range</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <TextField
          select
          fullWidth
          label="Team"
          value={team}
          onChange={(event) => {
            setTeam(event.target.value)
            setAgentA('')
            setAgentB('')
          }}
        >
          <MenuItem value="">Select team</MenuItem>
          {teams.map((teamValue) => (
            <MenuItem key={teamValue} value={teamValue}>{teamValue}</MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Agent A"
          value={agentIdA}
          onChange={(event) => setAgentA(event.target.value)}
          disabled={!team}
        >
          {filteredAgents.map((agent) => (
            <MenuItem key={agent.id} value={agent.id}>{agent.fullName}</MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="Agent B"
          value={agentIdB}
          onChange={(event) => setAgentB(event.target.value)}
          disabled={!team}
        >
          {filteredAgents.map((agent) => (
            <MenuItem key={agent.id} value={agent.id}>{agent.fullName}</MenuItem>
          ))}
        </TextField>

        <TextField
          type="date"
          label="From"
          InputLabelProps={{ shrink: true }}
          value={from.format('YYYY-MM-DD')}
          onChange={(event) => setFrom(dayjs(event.target.value))}
        />
        <TextField
          type="date"
          label="To"
          InputLabelProps={{ shrink: true }}
          value={to.format('YYYY-MM-DD')}
          onChange={(event) => setTo(dayjs(event.target.value))}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button disabled={disabled} onClick={submit}>Confirm</Button>
      </DialogActions>
    </Dialog>
  )
}

function ReassignRangeDialog({ agents, teams, onCancel, onConfirm }) {
  const [fromAgentId, setFromAgentId] = useState('')
  const [toAgentId, setToAgentId] = useState('')
  const [team, setTeam] = useState('')
  const [from, setFrom] = useState(dayjs().startOf('week'))
  const [to, setTo] = useState(dayjs().endOf('week'))
  const [markLeave, setMarkLeave] = useState(true)

  const filteredAgents = team ? agents.filter((agent) => agent.team === team) : []
  const disabled = !team || !fromAgentId || !toAgentId || fromAgentId === toAgentId || from.isAfter(to)

  const submit = () => onConfirm({
    fromAgentId: Number(fromAgentId),
    toAgentId: Number(toAgentId),
    from: from.format('YYYY-MM-DD'),
    to: to.format('YYYY-MM-DD'),
    markLeave
  })

  return (
    <Dialog open onClose={onCancel} fullWidth maxWidth="sm">
      <DialogTitle>Reassign Shifts Across a Range</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
        <TextField
          select
          fullWidth
          label="Team"
          value={team}
          onChange={(event) => {
            setTeam(event.target.value)
            setFromAgentId('')
            setToAgentId('')
          }}
        >
          <MenuItem value="">Select team</MenuItem>
          {teams.map((teamValue) => (
            <MenuItem key={teamValue} value={teamValue}>{teamValue}</MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="From Agent"
          value={fromAgentId}
          onChange={(event) => setFromAgentId(event.target.value)}
          disabled={!team}
        >
          {filteredAgents.map((agent) => (
            <MenuItem key={agent.id} value={agent.id}>{agent.fullName}</MenuItem>
          ))}
        </TextField>

        <TextField
          select
          label="To Agent"
          value={toAgentId}
          onChange={(event) => setToAgentId(event.target.value)}
          disabled={!team}
        >
          {filteredAgents.map((agent) => (
            <MenuItem key={agent.id} value={agent.id}>{agent.fullName}</MenuItem>
          ))}
        </TextField>

        <TextField
          type="date"
          label="From"
          InputLabelProps={{ shrink: true }}
          value={from.format('YYYY-MM-DD')}
          onChange={(event) => setFrom(dayjs(event.target.value))}
        />
        <TextField
          type="date"
          label="To"
          InputLabelProps={{ shrink: true }}
          value={to.format('YYYY-MM-DD')}
          onChange={(event) => setTo(dayjs(event.target.value))}
        />

        <FormControlLabel
          control={<Checkbox checked={markLeave} onChange={(event) => setMarkLeave(event.target.checked)} />}
          label="Mark the original agent as on leave"
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button disabled={disabled} onClick={submit}>Confirm</Button>
      </DialogActions>
    </Dialog>
  )
}

