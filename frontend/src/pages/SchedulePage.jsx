// frontend/src/pages/SchedulePage.jsx
import { useEffect, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayjs from 'dayjs'
import {
  Box,
  Button,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Typography,
  TextField
} from '@mui/material'
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import api from '../api'

export default function SchedulePage () {
  const [events, setEvents] = useState([])
  const [weekStart, setWeekStart] = useState(dayjs().startOf('week'))
  const [hourlyTotals, setTotals] = useState(
    Array(7).fill(null).map(() => Array(24).fill(0))
  )

  // semi‐transparent shift colors
  const shiftColors = [
    'rgba(33,150,243,0.5)',
    'rgba(76,175,80,0.5)',
    'rgba(255,193,7,0.5)',
    'rgba(244,67,54,0.5)',
    'rgba(156,39,176,0.5)',
    'rgba(0,188,212,0.5)',
    'rgba(255,87,34,0.5)',
  ]

  useEffect(() => {
    api.get('/schedule', {
      params: { week: weekStart.format('YYYY-MM-DD') }
    })
    .then(res => {
      const shifts = res.data

      // group identical start/end into buckets
      const groups = {}
      shifts.forEach(s => {
        const key = `${s.startAt}|${s.endAt}`
        if (!groups[key]) {
          const idx = Object.keys(groups).length
          groups[key] = {
            start: s.startAt,
            end:   s.endAt,
            count: 0,
            names: [],
            color: shiftColors[idx % shiftColors.length]
          }
        }
        groups[key].count++
        groups[key].names.push(s.agent.fullName)
      })

      // calendar events: one bar per bucket
      setEvents(Object.values(groups).map(g => ({
        title: String(g.count),
        start: g.start,
        end:   g.end,
        backgroundColor: g.color,
        borderColor:     g.color.replace(/0\.5\)$/, '0.8)'),
        extendedProps: { names: g.names }
      })))

      // compute per‐hour totals
      const counts = Array(7).fill(null).map(() => Array(24).fill(0))
      shifts.forEach(s => {
        const dayIdx = dayjs(s.startAt).diff(weekStart, 'day')
        const startH = dayjs(s.startAt).hour()
        const endH   = dayjs(s.endAt).hour()
        for (let h = startH; h < endH; h++) {
          counts[dayIdx][h]++
        }
      })
      setTotals(counts)
    })
    .catch(console.error)
  }, [weekStart])

  const prevWeek = () => setWeekStart(w => w.subtract(1, 'week'))
  const nextWeek = () => setWeekStart(w => w.add(1, 'week'))

  return (
    <Box sx={{ p:2 }}>
      {/* header with title + controls */}
      <Box sx={{ display:'flex', justifyContent:'space-between', alignItems:'center', mb:2 }}>
        <Typography variant="h6">
          Week of {weekStart.format('MMM D, YYYY')}
        </Typography>
        <Box sx={{ display:'flex', alignItems:'center' }}>
          <Button onClick={prevWeek} variant="outlined" sx={{ mr:1 }}>
            Prev
          </Button>
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="Jump to week"
              value={weekStart}
              onChange={newDate => {
                if (newDate) setWeekStart(dayjs(newDate).startOf('week'))
              }}
              renderInput={params => <TextField {...params} size="small" sx={{ mx:1 }} />}
            />
          </LocalizationProvider>
          <Button onClick={nextWeek} variant="outlined" sx={{ ml:1 }}>
            Next
          </Button>
        </Box>
      </Box>

      {/* calendar */}
      <FullCalendar
        plugins={[timeGridPlugin]}
        initialView="timeGridWeek"
        timeZone="Africa/Johannesburg"
        datesSet={arg => setWeekStart(dayjs(arg.start))}
        events={events}
        height="auto"
        eventDidMount={info => {
          info.el.setAttribute('title', info.event.extendedProps.names.join('\n'))
        }}
      />

      {/* hourly totals */}
      <Box sx={{ mt:4, overflowX:'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Hour</TableCell>
              {Array.from({ length:7 }).map((_, di) => (
                <TableCell key={di} align="center">
                  {weekStart.add(di,'day').format('ddd D')}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length:24 }).map((_, hour) => (
              <TableRow key={hour}>
                <TableCell>{`${hour}:00`}</TableCell>
                {hourlyTotals.map((dayCounts, di) => (
                  <TableCell key={di} align="center">
                    {dayCounts[hour]}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}
