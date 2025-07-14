// frontend/src/pages/SchedulePage.jsx
import { useEffect, useState } from 'react'
import FullCalendar          from '@fullcalendar/react'
import timeGridPlugin        from '@fullcalendar/timegrid'
import dayjs                 from 'dayjs'
import {
  Box,
  Button,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  TextField,
  MenuItem
} from '@mui/material'
import {
  DatePicker,
  LocalizationProvider
} from '@mui/x-date-pickers'
import { AdapterDayjs }      from '@mui/x-date-pickers/AdapterDayjs'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from 'recharts'
import api from '../api'

export default function SchedulePage () {
  /* ─── state ───────────────────────────────────────── */
  const [events,       setEvents]       = useState([])
  const [weekStart,    setWeekStart]    = useState(dayjs().startOf('week'))
  const [team,         setTeam]         = useState('')   // current filter
  const [roles,        setRoles]        = useState([])   // dropdown list
  const [hourlyTotals, setHourlyTotals] = useState(
    Array(7).fill(null).map(() => Array(24).fill(0))
  )
  const [staffingDate, setStaffingDate] = useState(dayjs())
  const [staffingData, setStaffingData] = useState([])

  /* colours for compressed multi-agent bars */
  const shiftColors = [
    'rgba(33,150,243,0.5)',  'rgba(76,175,80,0.5)',  'rgba(255,193,7,0.5)',
    'rgba(244,67,54,0.5)',   'rgba(156,39,176,0.5)', 'rgba(0,188,212,0.5)',
    'rgba(255,87,34,0.5)'
  ]

  /* ─── 0) one-time load of team list ───────────────── */
  useEffect(() => {
    api.get('/agents')
       .then(res => {
         const uniq = [...new Set(res.data.map(a => a.role))].sort()
         setRoles(uniq)
       })
       .catch(console.error)
  }, [])

  /* ─── 1) fetch shifts whenever week OR team changes ─ */
  useEffect(() => {
    api.get('/schedule', {
      params: {
        week : weekStart.format('YYYY-MM-DD'),
        role : team || undefined
      }
    })
    .then(({ data: shifts }) => {
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
        const displayName =
          s.agent?.fullName ?? s.agentName ?? `Emp #${s.agentId ?? '?'}`
        groups[key].names.push(displayName)
      })

      /* 🔹 convert ISO strings → Date objects here */
      setEvents(Object.values(groups).map(g => ({
        title          : String(g.count),
        start          : new Date(g.start),
        end            : new Date(g.end),
        backgroundColor: g.color,
        borderColor    : g.color.replace(/0\.5\)$/, '0.8)'),
        extendedProps  : { names: g.names }
      })))

      /* build [day][hour] totals */
      const counts = Array(7).fill(null).map(() => Array(24).fill(0))
      shifts.forEach(s => {
        let cur = dayjs(s.startAt).startOf('hour')
        const end = dayjs(s.endAt)
        while (cur.isBefore(end)) {
          const di = cur.diff(weekStart, 'day')
          if (di >= 0 && di < 7) counts[di][cur.hour()]++
          cur = cur.add(1, 'hour')
        }
      })
      setHourlyTotals(counts)
    })
    .catch(console.error)
  }, [weekStart, team])

  /* ─── 2) staffing report for selected day ─────────── */
  useEffect(() => {
    api.get('/reports/staffing', {
      params: { date: staffingDate.format('YYYY-MM-DD') }
    })
    .then(res => setStaffingData(res.data))
    .catch(console.error)
  }, [staffingDate])

  /* helpers */
  const prevWeek = () => setWeekStart(w => w.subtract(1, 'week'))
  const nextWeek = () => setWeekStart(w => w.add(1,  'week'))

  /* ─── render ──────────────────────────────────────── */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p: 2 }}>
        {/* header & week selector */}
        <Box sx={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', mb: 2
        }}>
          <Typography variant='h6'>
            Week of {weekStart.format('MMM D, YYYY')}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Button onClick={prevWeek} variant='outlined' sx={{ mr: 1 }}>
              Prev
            </Button>

            <DatePicker
              label='Jump to week'
              views={['day']}
              value={weekStart}
              onChange={d => d && setWeekStart(dayjs(d).startOf('week'))}
              slotProps={{ textField: { size: 'small', sx:{ mx: 1 } } }}
            />

            {/* Team selector */}
            <TextField
              select
              label='Team'
              size='small'
              value={team}
              onChange={e => setTeam(e.target.value)}
              sx={{ minWidth: 150, ml: 2 }}
            >
              <MenuItem value=''>All</MenuItem>
              {roles.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </TextField>

            <Button onClick={nextWeek} variant='outlined' sx={{ ml: 1 }}>
              Next
            </Button>
          </Box>
        </Box>

        {/* FullCalendar week view */}
        <Paper variant='outlined' sx={{ mb: 4, p: 0 }}>
          <FullCalendar
            plugins={[timeGridPlugin]}
            initialView='timeGridWeek'
            timeZone='local'                       /* ← simplest & safe */
            initialDate={weekStart.toDate()}       /* ensure correct week */
            headerToolbar={false}
            datesSet={({ start }) => setWeekStart(dayjs(start))}
            events={events}
            height={650}                           /* fixes zero-height issue */
            eventDidMount={info =>
              info.el.setAttribute(
                'title',
                info.event.extendedProps.names.join('\n')
              )
            }
          />
        </Paper>

        {/* staffing chart */}
        <Box sx={{ display:'flex', alignItems:'center', mb:2, gap:2 }}>
          <Typography variant='h6'>Staffing vs Required</Typography>

          <DatePicker
            label='Select day'
            value={staffingDate}
            onChange={d => d && setStaffingDate(d)}
            slotProps={{ textField:{ size:'small' } }}
          />
        </Box>

        <ResponsiveContainer width='100%' height={300}>
          <ComposedChart data={staffingData}>
            <XAxis dataKey='hour' />
            <YAxis />
            <Tooltip />
            <Bar  dataKey='staffedHeads'   name='On Shift' fill='#00e676' barSize={20} />
            <Line type='monotone' dataKey='requiredHeads' name='Required'
                  stroke='#ff1744' dot={false} strokeWidth={2} />
          </ComposedChart>
        </ResponsiveContainer>

        {/* hour-by-hour table */}
        <Box sx={{ mt:4, overflowX:'auto' }}>
          <Typography variant='h6' gutterBottom>
            Shift Counts by Hour & Day
          </Typography>
          <Table size='small'>
            <TableHead>
              <TableRow>
                <TableCell>Hour</TableCell>
                {Array.from({ length: 7 }).map((_, di) => (
                  <TableCell key={di} align='center'>
                    {weekStart.add(di, 'day').format('ddd D')}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {hourlyTotals[0].map((_, hour) => (
                <TableRow key={hour}>
                  <TableCell>{hour}:00</TableCell>
                  {hourlyTotals.map((dayCounts, di) => (
                    <TableCell key={di} align='center'>
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
