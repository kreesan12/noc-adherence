// frontend/src/pages/AdherencePage.jsx
import { useEffect, useState } from 'react'
import {
  DataGrid,
  GridToolbar
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
import dayjs from 'dayjs'
import api from '../api'

const statusOptions = [
  { value: 'pending',         label: 'Pending' },
  { value: 'present',         label: 'On time' },
  { value: 'late',            label: 'Late' },
  { value: 'off_sick',        label: 'Off sick' },
  { value: 'emergency_leave', label: 'Emergency leave' },
  { value: 'awol',            label: 'AWOL' },
]

const dutyOptions = [
  { value: '',               label: '' },
  { value: 'Tickets/Calls',  label: 'Tickets/Calls' },
  { value: 'Tickets',        label: 'Tickets' },
  { value: 'Calls',          label: 'Calls' },
  { value: 'WhatsApp/Tickets', label: 'WhatsApp/Tickets' },
  { value: 'WhatsApp only',  label: 'WhatsApp only' },
  { value: 'Changes',        label: 'Changes' },
  { value: 'Adhoc',          label: 'Adhoc' },
]

const colorMap = {
  present: { background: '#00e676', color: '#000' },
  late:    { background: '#ff1744', color: '#fff' },
  pending: { background: '#2979ff', color: '#fff' },
}

export default function AdherencePage() {
  const [rows, setRows] = useState([])
  const [date, setDate] = useState(dayjs())

  useEffect(() => {
    const d = date.format('YYYY-MM-DD')
    api.get(`/schedule?date=${d}`)
      .then(res => {
        setRows(res.data.map(s => ({
          id:         s.id,
          agent:      s.agent.fullName,
          phone:      s.agent.phone,
          status:     s.attendance?.status ?? 'pending',
          duty:       s.attendance?.duty?.name ?? '',
          lunchStart: s.attendance?.lunchStart
                       ? dayjs(s.attendance.lunchStart).format('HH:mm')
                       : '',
          lunchEnd:   s.attendance?.lunchEnd
                       ? dayjs(s.attendance.lunchEnd).format('HH:mm')
                       : '',
          start:      dayjs(s.startAt).format('HH:mm'),
          end:        dayjs(s.endAt).format('HH:mm'),
        })))
      })
  }, [date])

  const columns = [
    { field: 'agent',      headerName: 'Agent',   flex: 1 },
    { field: 'phone',      headerName: 'Phone',   width: 120 },
    {
      field: 'status',
      headerName: 'Status',
      width: 150,
      editable: true,
      renderCell: params => {
        const opt = statusOptions.find(o => o.value === params.value)
        return <Chip label={opt?.label || ''} sx={colorMap[params.value]}/>
      },
      renderEditCell: params => (
        <TextField
          select
          value={params.value || ''}
          onChange={e =>
            params.api.setEditCellValue({
              id: params.id,
              field: params.field,
              value: e.target.value
            })
          }
          fullWidth
        >
          {statusOptions.map(o => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      )
    },
    {
      field: 'duty',
      headerName: 'Duty',
      width: 180,
      editable: true,
      renderCell: params => {
        const opt = dutyOptions.find(o => o.value === params.value)
        return opt?.label || ''
      },
      renderEditCell: params => (
        <TextField
          select
          value={params.value || ''}
          onChange={e =>
            params.api.setEditCellValue({
              id: params.id,
              field: params.field,
              value: e.target.value
            })
          }
          fullWidth
        >
          {dutyOptions.map(o => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      )
    },
    {
      field: 'lunchStart',
      headerName: 'Lunch Start',
      width: 120,
      editable: true,
      renderEditCell: params => (
        <TextField
          type="time"
          value={params.value || ''}
          onChange={e =>
            params.api.setEditCellValue({
              id: params.id,
              field: params.field,
              value: e.target.value
            })
          }
          fullWidth
        />
      )
    },
    {
      field: 'lunchEnd',
      headerName: 'Lunch End',
      width: 120,
      editable: true,
      renderEditCell: params => (
        <TextField
          type="time"
          value={params.value || ''}
          onChange={e =>
            params.api.setEditCellValue({
              id: params.id,
              field: params.field,
              value: e.target.value
            })
          }
          fullWidth
        />
      )
    },
    { field: 'start', headerName: 'Start', width: 70 },
    { field: 'end',   headerName: 'End',   width: 70 },
  ]

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:2, display:'flex', alignItems:'center', gap:2 }}>
        <DatePicker
          label="Select date"
          value={date}
          onChange={newDate => setDate(newDate)}
          renderInput={props => <TextField {...props}/>}
        />
      </Box>

      <Box sx={{ height:600 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          disableSelectionOnClick
          editMode="row"
          slots={{ toolbar: GridToolbar }}
          processRowUpdate={async newRow => {
            await api.patch(`/attendance/${newRow.id}`, {
              status:     newRow.status,
              dutyName:   newRow.duty,
              lunchStart: newRow.lunchStart,
              lunchEnd:   newRow.lunchEnd,
            })
            return newRow
          }}
        />
      </Box>
    </LocalizationProvider>
  )
}
