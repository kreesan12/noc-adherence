import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Snackbar,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import dayjs from 'dayjs'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import api from '../api'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

function mapLeave(leaveArr) {
  return leaveArr.map((leave) => ({
    id: leave.id,
    agentId: leave.agent.id,
    agentName: leave.agent.fullName,
    team: leave.agent.role,
    reason: leave.reason,
    startDate: new Date(leave.startsAt),
    endDate: new Date(leave.endsAt),
    createdBy: leave.createdBy,
    createdAt: new Date(leave.createdAt)
  }))
}

export default function LeavePlannerPage() {
  const [rows, setRows] = useState([])
  const [agents, setAgents] = useState([])
  const [open, setOpen] = useState(false)
  const [snack, setSnack] = useState('')
  const [confOpen, setConfOpen] = useState(false)
  const [overlaps, setOverlaps] = useState([])

  const [form, setForm] = useState({
    agentId: '',
    reason: '',
    from: dayjs(),
    to: dayjs().add(1, 'day')
  })

  useEffect(() => {
    ;(async () => {
      const [{ data: a }, { data: l }] = await Promise.all([
        api.get('/agents'),
        api.get('/leave')
      ])
      setAgents(Array.isArray(a) ? a : [])
      setRows(mapLeave(Array.isArray(l) ? l : []))
    })()
  }, [])

  const colourPalette = [
    '#d32f2f',
    '#1976d2',
    '#388e3c',
    '#f57c00',
    '#7b1fa2',
    '#00796b',
    '#c2185b',
    '#512da8',
    '#455a64',
    '#5d4037'
  ]

  const colourMap = useMemo(() => {
    const ids = [...new Set(rows.map((row) => row.agentId))].sort((a, b) => a - b)
    const map = {}
    ids.forEach((id, index) => {
      map[id] = colourPalette[index % colourPalette.length]
    })
    return map
  }, [rows])

  const events = useMemo(
    () =>
      rows.map((row) => ({
        title: row.agentName,
        start: dayjs(row.startDate).format('YYYY-MM-DD'),
        end: dayjs(row.endDate).add(1, 'day').format('YYYY-MM-DD'),
        display: 'block',
        backgroundColor: colourMap[row.agentId],
        borderColor: colourMap[row.agentId]
      })),
    [rows, colourMap]
  )

  const summary = useMemo(() => {
    const now = dayjs()
    const monthStart = now.startOf('month')
    const monthEnd = now.endOf('month')
    const nextTwoWeeksEnd = now.add(14, 'day').endOf('day')

    const thisMonth = rows.filter((row) => {
      const start = dayjs(row.startDate)
      const end = dayjs(row.endDate)
      return start.isBefore(monthEnd) && end.isAfter(monthStart)
    }).length

    const nextTwoWeeks = rows.filter((row) => {
      const start = dayjs(row.startDate)
      const end = dayjs(row.endDate)
      return start.isBefore(nextTwoWeeksEnd) && end.isAfter(now.startOf('day'))
    }).length

    return {
      total: rows.length,
      uniqueAgents: new Set(rows.map((row) => row.agentId)).size,
      thisMonth,
      nextTwoWeeks
    }
  }, [rows])

  async function saveToServer() {
    try {
      await api.post('/leave', {
        agentId: form.agentId,
        reason: form.reason,
        startsAt: form.from.format(),
        endsAt: form.to.format()
      })
      const { data } = await api.get('/leave')
      setRows(mapLeave(Array.isArray(data) ? data : []))
      setSnack('Leave captured')
      setOpen(false)
    } catch {
      setSnack('Save failed')
    }
  }

  function handleSaveClick() {
    const overlapping = rows.filter(
      (row) =>
        row.agentId !== form.agentId &&
        row.startDate <= form.to.toDate() &&
        row.endDate >= form.from.toDate()
    )

    if (overlapping.length) {
      setOverlaps(overlapping)
      setConfOpen(true)
      return
    }

    saveToServer()
  }

  const columns = [
    { field: 'agentName', headerName: 'Agent', flex: 1, minWidth: 180 },
    { field: 'team', headerName: 'Team', flex: 0.8, minWidth: 140 },
    { field: 'reason', headerName: 'Reason', flex: 1.3, minWidth: 180 },
    {
      field: 'startDate',
      headerName: 'Start',
      flex: 0.8,
      minWidth: 130,
      renderCell: (params) => (params.value ? dayjs(params.value).format('YYYY-MM-DD') : '')
    },
    {
      field: 'endDate',
      headerName: 'End',
      flex: 0.8,
      minWidth: 130,
      renderCell: (params) => (params.value ? dayjs(params.value).format('YYYY-MM-DD') : '')
    },
    { field: 'createdBy', headerName: 'Created By', flex: 1, minWidth: 150 },
    {
      field: 'createdAt',
      headerName: 'Created At',
      flex: 0.9,
      minWidth: 140,
      renderCell: (params) => (params.value ? dayjs(params.value).format('YYYY-MM-DD') : '')
    }
  ]

  return (
    <PageShell
      eyebrow="Staffing and Scheduling"
      title="Leave Planner"
      description="Capture planned leave, check overlap risk quickly, and keep a live month view of upcoming coverage impact."
      accent="#7c3aed"
      actions={
        <Button variant="contained" onClick={() => setOpen(true)}>
          Add Leave
        </Button>
      }
      stats={[
        {
          label: 'Leave Entries',
          value: summary.total,
          helper: 'All captured leave records',
          accent: '#7c3aed'
        },
        {
          label: 'Agents Planned',
          value: summary.uniqueAgents,
          helper: 'Unique people with leave in register',
          accent: '#0f766e'
        },
        {
          label: 'This Month',
          value: summary.thisMonth,
          helper: 'Entries overlapping the current month',
          accent: '#d97706'
        },
        {
          label: 'Next 14 Days',
          value: summary.nextTwoWeeks,
          helper: 'Short-range planning view',
          accent: '#2563eb'
        }
      ]}
    >
      <SectionCard
        title="Leave Register"
        subtitle="The table stays best for exact dates and audit detail, while the calendar gives the team view at a glance."
        accent="#7c3aed"
        noPadding
      >
        <Box sx={{ p: 1 }}>
          <FilterStrip>
            <Chip label={`${agents.length} agents loaded`} color="secondary" variant="outlined" />
            <Chip label={`${rows.length} leave rows`} />
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Overlap checks trigger before save so planning can decide whether to proceed.
            </Typography>
          </FilterStrip>
        </Box>

        <Box sx={{ px: 0.6, pb: 0.6 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            autoHeight
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 10, page: 0 } },
              sorting: { sortModel: [{ field: 'startDate', sort: 'asc' }] }
            }}
          />
        </Box>
      </SectionCard>

      <SectionCard
        title="Leave Calendar"
        subtitle="Month view by person so clashes and heavier leave periods are easier to spot."
        accent="#7c3aed"
      >
        <FullCalendar
          plugins={[dayGridPlugin]}
          initialView="dayGridMonth"
          height={640}
          events={events}
          headerToolbar={{
            start: 'title',
            center: '',
            end: 'prev today next'
          }}
        />
      </SectionCard>

      {open ? (
        <Dialog open onClose={() => setOpen(false)} fullWidth maxWidth="xs">
          <DialogTitle>New leave or PTO entry</DialogTitle>
          <DialogContent>
            <Stack spacing={1.1} sx={{ pt: 0.8 }}>
              <TextField
                select
                label="Agent"
                fullWidth
                value={form.agentId}
                onChange={(event) => setForm((state) => ({ ...state, agentId: Number(event.target.value) }))}
              >
                {agents.map((agent) => (
                  <MenuItem key={agent.id} value={agent.id}>
                    {agent.fullName}
                  </MenuItem>
                ))}
              </TextField>

              <TextField
                label="Reason"
                fullWidth
                value={form.reason}
                onChange={(event) => setForm((state) => ({ ...state, reason: event.target.value }))}
              />

              <TextField
                type="date"
                label="From"
                InputLabelProps={{ shrink: true }}
                fullWidth
                value={form.from.format('YYYY-MM-DD')}
                onChange={(event) => setForm((state) => ({ ...state, from: dayjs(event.target.value) }))}
              />

              <TextField
                type="date"
                label="To"
                InputLabelProps={{ shrink: true }}
                fullWidth
                value={form.to.format('YYYY-MM-DD')}
                onChange={(event) => setForm((state) => ({ ...state, to: dayjs(event.target.value) }))}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveClick} disabled={!form.agentId || !form.reason} variant="contained">
              Save Leave
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      {confOpen ? (
        <Dialog open onClose={() => setConfOpen(false)} fullWidth maxWidth="sm">
          <DialogTitle>Overlap detected</DialogTitle>
          <DialogContent dividers>
            <Typography sx={{ mb: 1 }}>
              The following leave entries clash with the selected dates:
            </Typography>
            <Stack spacing={0.35}>
              {overlaps.map((entry) => (
                <Typography key={entry.id}>
                  - {entry.agentName} ({dayjs(entry.startDate).format('YYYY-MM-DD')} to {dayjs(entry.endDate).format('YYYY-MM-DD')})
                </Typography>
              ))}
            </Stack>
            <Typography sx={{ mt: 2 }}>
              Do you want to approve this leave anyway?
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setConfOpen(false)}>Cancel</Button>
            <Button
              variant="contained"
              onClick={() => {
                setConfOpen(false)
                saveToServer()
              }}
            >
              Proceed
            </Button>
          </DialogActions>
        </Dialog>
      ) : null}

      <Snackbar
        open={!!snack}
        message={snack}
        autoHideDuration={4000}
        onClose={() => setSnack('')}
      />
    </PageShell>
  )
}
