// frontend/src/pages/SchedulePage.jsx
import { useEffect, useState } from 'react'
import FullCalendar             from '@fullcalendar/react'
import timeGridPlugin           from '@fullcalendar/timegrid'
import dayjs                    from 'dayjs'
import {
  Box,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  Typography,
} from '@mui/material'
import api                      from '../api'

export default function SchedulePage () {
  const [events,    setEvents]    = useState([])
  const [weekStart,setWeekStart]  = useState(dayjs().startOf('week'))
  const [hourlyTotals, setTotals] = useState(
    Array(7).fill(null).map(() => Array(24).fill(0))
  )

  // a little color palette, semi-transparent
  const shiftColors = [
    'rgba(33,150,243,0.3)',   // blue
    'rgba(76,175,80,0.3)',    // green
    'rgba(255,193,7,0.3)',    // amber
    'rgba(244,67,54,0.3)',    // red
    'rgba(156,39,176,0.3)',   // purple
    'rgba(0,188,212,0.3)',    // teal
    'rgba(255,87,34,0.3)',    // deep orange
  ]

  useEffect(() => {
    api.get('/schedule', {
      params: { week: weekStart.format('YYYY-MM-DD') }
    })
    .then(res => {
      const shifts = res.data

      // 1️⃣ group by exact interval
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

      // 2️⃣ build the calendar events
      setEvents(Object.values(groups).map(g=>({
        title: String(g.count),
        start: g.start,
        end:   g.end,
        backgroundColor: g.color,
        borderColor:     g.color.replace(/0\.3\)$/, '0.8)'),
        extendedProps: { names: g.names }
      })))

      // 3️⃣ compute hourly totals
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

  return (
    <Box sx={{ p:2 }}>
      <Typography variant="h6" gutterBottom>
        Week of {weekStart.format('MMM D, YYYY')}
      </Typography>

      <FullCalendar
        plugins={[timeGridPlugin]}
        initialView="timeGridWeek"
        datesSet={arg => setWeekStart(dayjs(arg.start))}
        events={events}
        height="auto"
        eventDidMount={info => {
          // show names on hover
          info.el.setAttribute(
            'title',
            info.event.extendedProps.names.join('\n')
          )
        }}
      />

      {/* Hourly totals table */}
      <Box sx={{ mt:4, overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Hour</TableCell>
              {Array.from({ length: 7 }).map((_, di) => (
                <TableCell key={di} align="center">
                  {weekStart.add(di, 'day').format('ddd D')}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {Array.from({ length: 24 }).map((_, hour) => (
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
