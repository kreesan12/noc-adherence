import { useEffect, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayjs from 'dayjs'
import { Box, Stack, Button, TextField } from '@mui/material'
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import api from '../api'

export default function SchedulePage () {
  const [events, setEvents]   = useState([])
  const [weekStart, setWeekStart] = useState(dayjs().startOf('week'))

  // load whenever the weekStart changes
  useEffect(() => {
    api.get('/schedule', { params: { week: weekStart.format('YYYY-MM-DD') } })
      .then(res => {
        const rows = res.data.map(s => ({
          title: s.agent.fullName,
          start: s.startAt,
          end:   s.endAt,
          color: s.attendance?.status === 'late'    ? 'rgba(255,23,68,0.6)' :
                 s.attendance?.status === 'present' ? 'rgba(0,230,118,0.6)' : 'rgba(41,121,255,0.6)',
          extendedProps: { names: [s.agent.fullName] }
        }))
        setEvents(rows)
      })
      .catch(err => console.error(err))
  }, [weekStart])

  return (
    <Box>
      {/* Week selector & navigation */}
      <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={2} sx={{ mb: 2 }}>
        <Button variant="outlined" size="small" onClick={() => setWeekStart(ws => ws.subtract(1, 'week'))}>
          Previous
        </Button>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <DatePicker
            label="Week of"
            views={[ 'day' ]}
            value={weekStart}
            onChange={newDate => newDate && setWeekStart(dayjs(newDate).startOf('week'))}
            renderInput={params => <TextField {...params} size="small" />}
          />
        </LocalizationProvider>
        <Button variant="outlined" size="small" onClick={() => setWeekStart(ws => ws.add(1, 'week'))}>
          Next
        </Button>
      </Stack>

      <FullCalendar
        plugins={[ timeGridPlugin ]}
        initialView="timeGridWeek"
        timeZone="Africa/Johannesburg"
        headerToolbar={{ left: '', center: '', right: '' }}
        events={events}
        height="auto"
        datesSet={arg => setWeekStart(dayjs(arg.start))}
        eventDidMount={info => {
          // show agent names on hover
          info.el.setAttribute('title', info.event.extendedProps.names.join('\n'))
        }}
      />
    </Box>
  )
}
