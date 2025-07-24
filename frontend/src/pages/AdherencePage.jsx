// frontend/src/pages/AdherencePage.jsx
import { useEffect, useState } from 'react'
import {
  DataGrid,
  GridToolbar,
  GridActionsCellItem
} from '@mui/x-data-grid'
import {
  Box,
  Chip,
  TextField,
  MenuItem
} from '@mui/material'
import {
  DatePicker,
  LocalizationProvider
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import EditIcon   from '@mui/icons-material/Edit'
import SaveIcon   from '@mui/icons-material/Save'
import CancelIcon from '@mui/icons-material/Close'
import dayjs from 'dayjs'
import api   from '../api'

/* ────────────────────────────────────────────────────────── */

const statusOptions = [
  { value: 'pending',         label: 'Pending' },
  { value: 'present',         label: 'On time' },
  { value: 'late',            label: 'Late' },
  { value: 'off_sick',        label: 'Off sick' },
  { value: 'emergency_leave', label: 'Emergency leave' },
  { value: 'awol',            label: 'AWOL' },
]

const dutyOptions = [
  { value: '',                 label: '' },
  { value: 'Tickets/Calls',    label: 'Tickets/Calls' },
  { value: 'Tickets',          label: 'Tickets' },
  { value: 'Calls',            label: 'Calls' },
  { value: 'WhatsApp/Tickets', label: 'WhatsApp/Tickets' },
  { value: 'WhatsApp only',    label: 'WhatsApp only' },
  { value: 'Changes',          label: 'Changes' },
  { value: 'Adhoc',            label: 'Adhoc' }
]

const colorMap = {
  present: { background: '#00e676', color: '#000' },
  late:    { background: '#ff1744', color: '#fff' },
  pending: { background: '#2979ff', color: '#fff' }
}

/* ────────────────────────────────────────────────────────── */

export default function AdherencePage () {
  /* state */
  const [rows,  setRows]  = useState([])
  const [date,  setDate]  = useState(dayjs())
  const [team,  setTeam]  = useState('')          // ← new
  const [teams, setTeams] = useState([])          // ← new
  const [rowModesModel, setRowModesModel] = useState({})

  /* load team list once (from /agents) */
  useEffect(() => {
    api.get('/agents')
       .then(res => {
         setTeams([...new Set(res.data.map(a => a.role))].sort())
       })
  }, [])

  /* load schedule whenever date OR team changes */
  useEffect(() => {
    api.get('/shifts', {
      params: {
        team      : team || undefined,
        startDate : date.format('YYYY-MM-DD'),
        endDate   : date.format('YYYY-MM-DD')
      }
    })
    .then(res => {
      /* 🔹 robust mapping — works whether the backend returns
         { agentName } or a full { agent:{ fullName, phone } } object */
      setRows(res.data.map(s => ({
        id:        s.id,
        agentName: s.agent?.fullName ?? s.agentName ?? '—',
        phone:     s.agent?.phone    ?? s.phone      ?? '',
        status:     s.attendance?.status       ?? 'pending',
        duty:       s.attendance?.duty?.name   ?? '',
        lunchStart: (s.attendance?.lunchStart ?? s.breakStart)
                    ? dayjs(s.attendance?.lunchStart ?? s.breakStart)
                        .format('HH:mm')
                    : '',
        lunchEnd:   (s.attendance?.lunchEnd   ?? s.breakEnd)
                    ? dayjs(s.attendance?.lunchEnd   ?? s.breakEnd)
                        .format('HH:mm')
                    : '',
        start: dayjs(s.startAt).format('HH:mm'),
        end:   dayjs(s.endAt).format('HH:mm')
      })))
    })
  }, [date, team])

  /* inline-save handler (unchanged) */
  const processRowUpdate = async newRow => {
    const ls = newRow.lunchStart
      ? dayjs(`${date.format('YYYY-MM-DD')}T${newRow.lunchStart}`).toISOString()
      : null
    const le = newRow.lunchEnd
      ? dayjs(`${date.format('YYYY-MM-DD')}T${newRow.lunchEnd}`).toISOString()
      : null

    await api.patch(`/attendance/${newRow.id}`, {
      status:     newRow.status,
      dutyName:   newRow.duty,
      lunchStart: ls,
      lunchEnd:   le
    })
    return newRow
  }

  /* grid columns (unchanged except minor formatting) */
  const columns = [
    { field: 'agentName', headerName: 'Agent', width: 260, flex: 0 },   // 🔹 field renamed
    { field: 'phone',     headerName: 'Phone', width: 130 },
    /* status */
    {
      field: 'status',
      headerName: 'Status',
      width: 200,
      editable: true,
      renderCell: params => {
        const opt = statusOptions.find(o => o.value === params.value)
        return (
          <Chip
            label={opt?.label || ''}
            sx={colorMap[params.value] ?? {}}
            size="small"
          />
        )
      },
      renderEditCell: params => (
        <TextField
          select
          value={params.value}
          onChange={e => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'status',
              value: e.target.value
            })
          }}
          fullWidth
        >
          {statusOptions.map(o => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </TextField>
      )
    },
    /* duty */
    {
      field: 'duty',
      headerName: 'Duty',
      width: 200,
      editable: true,
      renderCell: p => dutyOptions.find(o => o.value === p.value)?.label || '',
      renderEditCell: params => (
        <TextField
          select
          value={params.value}
          onChange={e => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'duty',
              value: e.target.value
            })
          }}
          fullWidth
        >
          {dutyOptions.map(o => (
            <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
          ))}
        </TextField>
      )
    },
    /* lunch */
    {
      field: 'lunchStart',
      headerName: 'Lunch Start',
      width: 150,
      editable: true,
      renderEditCell: params => (
        <TextField
          type="time"
          value={params.value}
          onChange={e => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'lunchStart',
              value: e.target.value
            })
          }}
          fullWidth
        />
      )
    },
    {
      field: 'lunchEnd',
      headerName: 'Lunch End',
      width: 150,
      editable: true,
      renderEditCell: params => (
        <TextField
          type="time"
          value={params.value}
          onChange={e => {
            params.api.setEditCellValue({
              id: params.id,
              field: 'lunchEnd',
              value: e.target.value
            })
          }}
          fullWidth
        />
      )
    },
    { field: 'start', headerName: 'Start', width: 150 },
    { field: 'end',   headerName: 'End',   width: 150 },
    /* actions menu */
    {
      field: 'actions',
      type: 'actions',
      headerName: 'Actions',
      width: 150,
      getActions: ({ id }) => {
        const isEditing = rowModesModel[id]?.mode === 'edit'
        return isEditing
          ? [
              <GridActionsCellItem
                key="save"
                icon={<SaveIcon />}
                label="Save"
                onClick={() =>
                  setRowModesModel({ ...rowModesModel, [id]: { mode: 'view' } })
                }
                color="primary"
              />,
              <GridActionsCellItem
                key="cancel"
                icon={<CancelIcon />}
                label="Cancel"
                onClick={() =>
                  setRowModesModel({
                    ...rowModesModel,
                    [id]: { mode: 'view', ignoreModifications: true }
                  })
                }
                color="inherit"
              />
            ]
          : [
              <GridActionsCellItem
                key="edit"
                icon={<EditIcon />}
                label="Edit"
                onClick={() =>
                  setRowModesModel({ ...rowModesModel, [id]: { mode: 'edit' } })
                }
                showInMenu
              />
            ]
      }
    }
  ]

  /* ── render ──────────────────────────────────────────── */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      {/* header controls */}
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2 }}>
        <DatePicker
          label="Select date"
          value={date}
          onChange={setDate}
          disableFuture                     
          maxDate={dayjs()}           
          renderInput={props => <TextField {...props} size="small" />}
        />

        {/* Team selector */}
        <TextField
          select
          label="Team"
          size="small"
          value={team}
          onChange={e => setTeam(e.target.value)}
          sx={{ minWidth: 180 }}
        >
          <MenuItem value="">All</MenuItem>
          {teams.map(t => (
            <MenuItem key={t} value={t}>{t}</MenuItem>
          ))}
        </TextField>
      </Box>

      {/* data grid */}
      <Box sx={{ height: 600 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          disableSelectionOnClick
          editMode="row"
          processRowUpdate={processRowUpdate}
          rowModesModel={rowModesModel}
          onRowModesModelChange={setRowModesModel}
          experimentalFeatures={{ newEditingApi: true }}
          slots={{ toolbar: GridToolbar }}
          initialState={{
            sorting: { sortModel: [{ field: 'start', sort: 'asc' }] }
          }}
        />
      </Box>
    </LocalizationProvider>
  )
}
