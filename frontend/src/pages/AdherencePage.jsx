import { useEffect, useMemo, useState } from 'react'
import { DataGrid, GridActionsCellItem, GridToolbar } from '@mui/x-data-grid'
import { Alert, Box, Button, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import EditIcon from '@mui/icons-material/Edit'
import SaveIcon from '@mui/icons-material/Save'
import CancelIcon from '@mui/icons-material/Close'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import dayjs from 'dayjs'
import api from '../api'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

const statusOptions = [
  { value: 'pending', label: 'Pending' },
  { value: 'present', label: 'On time' },
  { value: 'late', label: 'Late' },
  { value: 'off_sick', label: 'Off sick' },
  { value: 'emergency_leave', label: 'Emergency leave' },
  { value: 'awol', label: 'AWOL' }
]

const dutyOptions = [
  { value: '', label: '' },
  { value: 'Tickets/Calls', label: 'Tickets/Calls' },
  { value: 'Tickets', label: 'Tickets' },
  { value: 'Calls', label: 'Calls' },
  { value: 'WhatsApp/Tickets', label: 'WhatsApp/Tickets' },
  { value: 'WhatsApp only', label: 'WhatsApp only' },
  { value: 'Changes', label: 'Changes' },
  { value: 'Adhoc', label: 'Adhoc' }
]

const colorMap = {
  present: { background: '#22c55e', color: '#052e16' },
  late: { background: '#ef4444', color: '#fff' },
  pending: { background: '#2563eb', color: '#fff' },
  off_sick: { background: '#f59e0b', color: '#111827' },
  emergency_leave: { background: '#fb7185', color: '#fff' },
  awol: { background: '#7c3aed', color: '#fff' }
}

function fmtCount(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

function extractError(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

export default function AdherencePage() {
  const [rows, setRows] = useState([])
  const [date, setDate] = useState(dayjs())
  const [team, setTeam] = useState('')
  const [teams, setTeams] = useState([])
  const [rowModesModel, setRowModesModel] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function loadTeams() {
    try {
      const res = await api.get('/agents')
      setTeams([...new Set(res.data.map((agent) => agent.role).filter(Boolean))].sort())
    } catch (err) {
      setError(extractError(err, 'Failed to load adherence teams'))
    }
  }

  async function loadShifts() {
    setLoading(true)
    setError('')
    try {
      const res = await api.get('/shifts', {
        params: {
          team: team || undefined,
          startDate: date.format('YYYY-MM-DD'),
          endDate: date.format('YYYY-MM-DD')
        }
      })

      setRows(res.data.map((shift) => ({
        id: shift.id,
        agentName: shift.agent?.fullName ?? shift.agentName ?? '-',
        phone: shift.agent?.phone ?? shift.phone ?? '',
        status: shift.attendance?.status ?? 'pending',
        duty: shift.attendance?.duty?.name ?? '',
        lunchStart: (shift.attendance?.lunchStart ?? shift.breakStart)
          ? dayjs(shift.attendance?.lunchStart ?? shift.breakStart).format('HH:mm')
          : '',
        lunchEnd: (shift.attendance?.lunchEnd ?? shift.breakEnd)
          ? dayjs(shift.attendance?.lunchEnd ?? shift.breakEnd).format('HH:mm')
          : '',
        start: dayjs(shift.startAt).format('HH:mm'),
        end: dayjs(shift.endAt).format('HH:mm')
      })))
    } catch (err) {
      setError(extractError(err, 'Failed to load adherence shifts'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTeams()
  }, [])

  useEffect(() => {
    loadShifts()
  }, [date, team])

  const processRowUpdate = async (newRow) => {
    const ls = newRow.lunchStart
      ? dayjs(`${date.format('YYYY-MM-DD')}T${newRow.lunchStart}`).toISOString()
      : null
    const le = newRow.lunchEnd
      ? dayjs(`${date.format('YYYY-MM-DD')}T${newRow.lunchEnd}`).toISOString()
      : null

    try {
      await api.patch(`/attendance/${newRow.id}`, {
        status: newRow.status,
        dutyName: newRow.duty,
        lunchStart: ls,
        lunchEnd: le
      })
      return newRow
    } catch (err) {
      setError(extractError(err, 'Failed to save attendance row'))
      throw err
    }
  }

  const stats = useMemo(() => {
    const present = rows.filter((row) => row.status === 'present').length
    const late = rows.filter((row) => row.status === 'late').length
    const pending = rows.filter((row) => row.status === 'pending').length

    return [
      { label: 'Shifts in View', value: fmtCount(rows.length), helper: team || 'All teams' },
      { label: 'On Time', value: fmtCount(present), helper: 'Captured as present', accent: '#16a34a' },
      { label: 'Late', value: fmtCount(late), helper: 'Needs coaching follow-up', accent: '#dc2626' },
      { label: 'Pending', value: fmtCount(pending), helper: 'Still awaiting update', accent: '#2563eb' }
    ]
  }, [rows, team])

  const columns = [
    { field: 'agentName', headerName: 'Agent', width: 220, flex: 0 },
    { field: 'phone', headerName: 'Phone', width: 120 },
    {
      field: 'status',
      headerName: 'Status',
      width: 170,
      editable: true,
      renderCell: (params) => {
        const opt = statusOptions.find((option) => option.value === params.value)
        return <Chip size="small" label={opt?.label || ''} sx={colorMap[params.value] ?? {}} />
      },
      renderEditCell: (params) => (
        <TextField
          select
          value={params.value}
          onChange={(event) => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'status',
              value: event.target.value
            })
          }}
          fullWidth
        >
          {statusOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </TextField>
      )
    },
    {
      field: 'duty',
      headerName: 'Duty',
      width: 180,
      editable: true,
      renderCell: (params) => dutyOptions.find((option) => option.value === params.value)?.label || '',
      renderEditCell: (params) => (
        <TextField
          select
          value={params.value}
          onChange={(event) => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'duty',
              value: event.target.value
            })
          }}
          fullWidth
        >
          {dutyOptions.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </TextField>
      )
    },
    {
      field: 'lunchStart',
      headerName: 'Lunch Start',
      width: 130,
      editable: true,
      renderEditCell: (params) => (
        <TextField
          type="time"
          value={params.value}
          onChange={(event) => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'lunchStart',
              value: event.target.value
            })
          }}
          fullWidth
        />
      )
    },
    {
      field: 'lunchEnd',
      headerName: 'Lunch End',
      width: 130,
      editable: true,
      renderEditCell: (params) => (
        <TextField
          type="time"
          value={params.value}
          onChange={(event) => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'lunchEnd',
              value: event.target.value
            })
          }}
          fullWidth
        />
      )
    },
    { field: 'start', headerName: 'Start', width: 110 },
    { field: 'end', headerName: 'End', width: 110 },
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 110,
      getActions: ({ id }) => {
        const isEditing = rowModesModel[id]?.mode === 'edit'
        return isEditing
          ? [
              <GridActionsCellItem
                key="save"
                icon={<SaveIcon />}
                label="Save"
                onClick={() => setRowModesModel({ ...rowModesModel, [id]: { mode: 'view' } })}
                color="primary"
              />,
              <GridActionsCellItem
                key="cancel"
                icon={<CancelIcon />}
                label="Cancel"
                onClick={() => setRowModesModel({
                  ...rowModesModel,
                  [id]: { mode: 'view', ignoreModifications: true }
                })}
                color="inherit"
              />
            ]
          : [
              <GridActionsCellItem
                key="edit"
                icon={<EditIcon />}
                label="Edit"
                onClick={() => setRowModesModel({ ...rowModesModel, [id]: { mode: 'edit' } })}
                showInMenu
              />
            ]
      }
    }
  ]

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <PageShell
        eyebrow="Daily Operations"
        title="Daily Adherence Monitor"
        description="Track the live attendance view for scheduled shifts, update late and leave outcomes quickly, and keep lunch windows aligned against the day's roster."
        accent="#2563eb"
        stats={stats}
        actions={
          <Stack direction="row" spacing={0.7} flexWrap="wrap">
            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={loadShifts} disabled={loading}>
              Refresh
            </Button>
            <Button variant="outlined" onClick={() => setDate(dayjs())}>Today</Button>
            <Chip label={date.format('dddd, DD MMM YYYY')} color="primary" />
          </Stack>
        }
      >
        {error ? <Alert severity="error">{error}</Alert> : null}

        <SectionCard
          title="Attendance Register"
          subtitle="Use the filters to narrow the shift view, then edit a row to save lunch windows, duty, or attendance outcome."
          accent="#2563eb"
          noPadding
        >
          <Box sx={{ p: 1.05, display: 'grid', gap: 0.95 }}>
            <FilterStrip>
              <DatePicker
                label="Select date"
                value={date}
                onChange={(next) => next && setDate(next)}
                disableFuture
                maxDate={dayjs()}
                slotProps={{ textField: { size: 'small', sx: { minWidth: 190 } } }}
              />

              <TextField
                select
                label="Team"
                size="small"
                value={team}
                onChange={(event) => setTeam(event.target.value)}
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="">All teams</MenuItem>
                {teams.map((value) => (
                  <MenuItem key={value} value={value}>{value}</MenuItem>
                ))}
              </TextField>

              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {fmtCount(rows.length)} shifts loaded for {team || 'all teams'}
              </Typography>
            </FilterStrip>

            <Box sx={{ minHeight: 560 }}>
              <DataGrid
                rows={rows}
                columns={columns}
                loading={loading}
                disableRowSelectionOnClick
                editMode="row"
                processRowUpdate={processRowUpdate}
                rowModesModel={rowModesModel}
                onRowModesModelChange={setRowModesModel}
                slots={{ toolbar: GridToolbar }}
                slotProps={{
                  toolbar: {
                    showQuickFilter: true,
                    quickFilterProps: { debounceMs: 250 }
                  }
                }}
                initialState={{
                  sorting: { sortModel: [{ field: 'start', sort: 'asc' }] },
                  pagination: { paginationModel: { pageSize: 25, page: 0 } }
                }}
                pageSizeOptions={[25, 50, 100]}
              />
            </Box>
          </Box>
        </SectionCard>
      </PageShell>
    </LocalizationProvider>
  )
}
