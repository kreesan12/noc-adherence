// frontend/src/pages/AdherencePage.jsx
import { useEffect, useState } from 'react'
import dayjs from 'dayjs'

import {
  DataGrid
} from '@mui/x-data-grid'
import {
  Box,
  Chip,
  Stack,
  TextField
} from '@mui/material'
import {
  LocalizationProvider,
  DatePicker,
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'

import api from '../api'
import TimeEditCell from '../components/TimeEditCell'

const statusOptions = [
  { value: 'on_time',         label: 'On time' },
  { value: 'late',            label: 'Late' },
  { value: 'off_sick',        label: 'Off sick' },
  { value: 'emergency_leave', label: 'Emergency leave' },
  { value: 'awol',            label: 'AWOL' },
]

export default function AdherencePage() {
  const [date, setDate] = useState(dayjs())
  const [rows, setRows] = useState([])

  useEffect(() => {
    const dstr = date.format('YYYY-MM-DD')
    api.get('/schedule', { params: { date: dstr } })
      .then(res => {
        setRows(res.data.map(s => ({
          id:         s.id,
          agent:      s.agent.fullName,
          phone:      s.agent.phone,
          status:     s.attendance?.status    ?? 'on_time',
          duty:       s.attendance?.duty?.name ?? '',
          lunchStart: s.attendance?.lunchStart ?? null,
          lunchEnd:   s.attendance?.lunchEnd   ?? null,
          start:      dayjs(s.startAt).format('HH:mm'),
          end:        dayjs(s.endAt).format('HH:mm'),
        })))
      })
      .catch(console.error)
  }, [date])

  const columns = [
    { field: 'agent', headerName: 'Agent', flex: 1 },
    { field: 'phone', headerName: 'Phone', width: 120 },

    // ○ Status
    {
      field: 'status',
      headerName: 'Status',
      width: 150,
      editable: true,
      type: 'singleSelect',
      valueOptions: statusOptions.map(o => o.value),
      renderCell: params => {
        const opt = statusOptions.find(o => o.value === params.value) || statusOptions[0]

        const bg =
          params.value === 'late'            ? '#ff1744' :
          params.value === 'on_time'         ? '#00e676' :
                                              '#2979ff'

        return <Chip label={opt.label} sx={{ background: bg, color: '#fff' }}/>
      }
    },

    // ○ Duty (free‐text or you could make singleSelect)
    { field: 'duty', headerName: 'Duty', flex: 1, editable: true },

    // ○ Lunch Start
    {
      field: 'lunchStart',
      headerName: 'Lunch Start',
      width: 140,
      editable: true,
      renderEditCell: p => <TimeEditCell {...p}/>,
      valueFormatter: p => p.value ? dayjs(p.value).format('HH:mm') : ''
    },

    // ○ Lunch End
    {
      field: 'lunchEnd',
      headerName: 'Lunch End',
      width: 140,
      editable: true,
      renderEditCell: p => <TimeEditCell {...p}/>,
      valueFormatter: p => p.value ? dayjs(p.value).format('HH:mm') : ''
    },

    { field: 'start', headerName: 'Start', width: 70 },
    { field: 'end',   headerName: 'End',   width: 70 },
  ]

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <LocalizationProvider dateAdapter={AdapterDayjs}>
        <DatePicker
          label="Select date"
          value={date}
          onChange={newD => setDate(newD || dayjs())}
          renderInput={params => <TextField {...params}/>}
        />
      </LocalizationProvider>

      <Box sx={{ height: 600 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          disableSelectionOnClick
          editMode="row"
          processRowUpdate={async newRow => {
            // send all three back
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
    </Stack>
  )
}
