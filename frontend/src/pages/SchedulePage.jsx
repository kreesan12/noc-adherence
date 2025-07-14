// frontend/src/pages/SchedulePage.jsx
import { useEffect, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayjs from 'dayjs'
import {
  Box, Button, Table, TableHead, TableBody,
  TableRow, TableCell, Typography, TextField, Paper
} from '@mui/material'
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import api from '../api'

export default function SchedulePage () {
  /* ── state ─────────────────────────────────────────── */
  const [events,       setEvents]       = useState([])
  const [weekStart,    setWeekStart]    = useState(dayjs().startOf('week'))
  const [hourlyTotals, setHourlyTotals] = useState(
    Array.from({ length: 7 }, () => Array(24).fill(0))
  )
  const [staffingDate, setStaffingDate] = useState(dayjs())
  const [staffingData, setStaffingData] = useState([])

  const calendarRef = useRef(null)

  /* colours for grouped-shift bars */
  const shiftColors = [
    'rgba(33,150,243,0.5)',
    'rgba(76,175,80,0.5)',
    'rgba(255,193,7,0.5)',
    'rgba(244,67,54,0.5)',
    'rgba(156,39,176,0.5)',
    'rgba(0,188,212,0.5)',
    'rgba(255,87,34,0.5)'
  ]

  /* ── 1) fetch shifts whenever visible week changes ── */
  useEffect(() => {
    api.get('/schedule', { params: { week: weekStart.format('YYYY-MM-DD') } })
      .then(res => {
        const shifts = res.data

        /* group by identical start/end within the same day */
        const groups = {}
        shifts.forEach(s => {
          const key = `${s.startAt}|${s.endAt}`
          if (!groups[key]) {
            const idx = Object.keys(groups).length
            groups[key] = {
              start : s.startAt,
              end   : s.endAt,
              count : 0,
              names : [],
              color : shiftColors[idx % shiftColors.length]
            }
          }
          groups[key].count++
          groups[key].names.push(s.agent.fullName)
        })

        setEvents(
          Object.values(groups).map(g => ({
            title            : String(g.count),
            start            : g.start,
            end              : g.end,
            backgroundColor  : g.color,
            borderColor      : g.color.replace(/0\.5\)$/, '0.8)'),
            extendedProps    : { names: g.names }
          }))
        )

        /* hourly totals table */
        const counts = Array.from({ length: 7 }, () => Array(24).fill(0))
        shifts.forEach(s => {
          const di = dayjs(s.startAt).diff(weekStart, 'day')
          if (di < 0 || di > 6) return     // safety
          const sh = dayjs(s.startAt).hour()
          const eh = dayjs(s.endAt).hour()
          for (let h = sh; h < eh; h++) counts[di][h]++
        })
        setHourlyTotals(counts)
      })
      .catch(console.error)
  }, [weekStart])

  /* ── 2) staffing report for single date ─────────────── */
  useEffect(() => {
    api.get('/reports/staffing', {
      params: { date: staffingDate.format('YYYY-MM-DD') }
    })
      .then(res => setStaffingData(res.data))
      .catch(console.error)
  }, [staffingDate])

  /* ── calendar navigation helpers ────────────────────── */
  const api = () => calendarRef.current?.getApi()

  const prevWeek = () => api()?.prev()
  const nextWeek = () => api()?.next()
  const gotoWeek = date => {
    api()?.gotoDate(date.toDate())
  }

  /* ── render ─────────────────────────────────────────── */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 2 }}>
        {/* header */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">
            Week of {weekStart.format('MMM D, YYYY')}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Button onClick={prevWeek} variant="outlined" sx={{ mr: 1 }}>
              Prev
            </Button>

            <DatePicker
              label="Jump to week"
              value={weekStart}
              views={['day']}
              onChange={d => d && gotoWeek(dayjs(d).startOf('week'))}
              renderInput={p => <TextField {...p} size="small" sx={{ mx: 1 }} />}
            />

            <Button onClick={nextWeek} variant="outlined" sx={{ ml: 1 }}>
              Next
            </Button>
          </Box>
        </Box>

        {/* calendar */}
        <Paper variant="outlined" sx={{ mb: 4 }}>
          <FullCalendar
            ref={calendarRef}
            plugins={[timeGridPlugin]}
            initialView="timeGridWeek"
            timeZone="Africa/Johannesburg"
            headerToolbar={false}
            events={events}
            height="auto"
            datesSet={arg => setWeekStart(dayjs(arg.start))}
            eventDidMount={info =>
              info.el.setAttribute('title', info.event.extendedProps.names.join('\n'))
            }
          />
        </Paper>

        {/* staffing chart */}
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, gap: 2 }}>
          <Typography variant="h6">Staffing vs Required</Typography>
          <DatePicker
            label="Select day"
            value={staffingDate}
            onChange={d => d && setStaffingDate(d)}
            renderInput={p => <TextField {...p} size="small" />}
          />
        </Box>

        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={staffingData}>
            <XAxis dataKey="hour" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="staffedHeads" name="On Shift" fill="#00e676" barSize={20} />
            <Line
              type="monotone"
              dataKey="requiredHeads"
              name="Required"
              stroke="#ff1744"
              dot={false}
              strokeWidth={2}
            />
          </ComposedChart>
        </ResponsiveContainer>

        {/* hourly totals table */}
        <Box sx={{ mt: 4, overflowX: 'auto' }}>
          <Typography variant="h6" gutterBottom>
            Shift Counts by Hour &amp; Day
          </Typography>
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
              {hourlyTotals[0].map((_, hour) => (
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
    </LocalizationProvider>
  )
}
