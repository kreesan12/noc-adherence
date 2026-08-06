import { useEffect, useMemo, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import timeGridPlugin from '@fullcalendar/timegrid'
import dayjs from 'dayjs'
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material'
import { DatePicker, LocalizationProvider } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import api from '../api'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

function fmtCount(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

export default function SchedulePage() {
  const [events, setEvents] = useState([])
  const [weekStart, setWeekStart] = useState(dayjs().startOf('week'))
  const [team, setTeam] = useState('')
  const [roles, setRoles] = useState([])
  const [hourlyTotals, setHourlyTotals] = useState(Array(7).fill(null).map(() => Array(24).fill(0)))
  const [staffingDate, setStaffingDate] = useState(dayjs())
  const [staffingData, setStaffingData] = useState([])

  const shiftColors = [
    'rgba(33,150,243,0.5)',
    'rgba(76,175,80,0.5)',
    'rgba(255,193,7,0.5)',
    'rgba(244,67,54,0.5)',
    'rgba(156,39,176,0.5)',
    'rgba(0,188,212,0.5)',
    'rgba(255,87,34,0.5)'
  ]

  useEffect(() => {
    api.get('/agents')
      .then((res) => {
        const uniq = [...new Set(res.data.map((agent) => agent.role))].sort()
        setRoles(uniq)
      })
      .catch(console.error)
  }, [])

  useEffect(() => {
    api.get('/schedule', {
      params: {
        week: weekStart.format('YYYY-MM-DD'),
        team: team.trim() ? team.trim() : undefined
      }
    })
      .then(({ data: shifts }) => {
        const groups = {}
        shifts.forEach((shift) => {
          const key = `${shift.startAt}|${shift.endAt}`
          if (!groups[key]) {
            const idx = Object.keys(groups).length
            groups[key] = {
              start: shift.startAt,
              end: shift.endAt,
              count: 0,
              names: [],
              color: shiftColors[idx % shiftColors.length]
            }
          }
          groups[key].count += 1
          const displayName = shift.agent?.fullName ?? shift.agentName ?? `Emp #${shift.agentId ?? '?'}`
          groups[key].names.push(displayName)
        })

        setEvents(Object.values(groups).map((group) => ({
          title: String(group.count),
          start: new Date(group.start),
          end: new Date(group.end),
          backgroundColor: group.color,
          borderColor: group.color.replace(/0\.5\)$/, '0.8)'),
          extendedProps: { names: group.names }
        })))

        const counts = Array(7).fill(null).map(() => Array(24).fill(0))
        shifts.forEach((shift) => {
          let cur = dayjs(shift.startAt).startOf('hour')
          const end = dayjs(shift.endAt)
          while (cur.isBefore(end)) {
            const di = cur.diff(weekStart, 'day')
            if (di >= 0 && di < 7) counts[di][cur.hour()] += 1
            cur = cur.add(1, 'hour')
          }
        })
        setHourlyTotals(counts)
      })
      .catch(console.error)
  }, [weekStart, team])

  useEffect(() => {
    api.get('/reports/staffing', {
      params: { date: staffingDate.format('YYYY-MM-DD') }
    })
      .then((res) => setStaffingData(res.data))
      .catch(console.error)
  }, [staffingDate])

  const prevWeek = () => setWeekStart((value) => value.subtract(1, 'week'))
  const nextWeek = () => setWeekStart((value) => value.add(1, 'week'))

  const totalBodies = useMemo(
    () => hourlyTotals.flat().reduce((sum, value) => sum + Number(value || 0), 0),
    [hourlyTotals]
  )

  const peakCoverage = useMemo(
    () => Math.max(0, ...hourlyTotals.flat().map((value) => Number(value || 0))),
    [hourlyTotals]
  )

  const stats = [
    { label: 'Shift Blocks', value: fmtCount(events.length), helper: team || 'All teams' },
    { label: 'Coverage Hours', value: fmtCount(totalBodies), helper: 'Summed across this week', accent: '#2563eb' },
    { label: 'Peak Hour Load', value: fmtCount(peakCoverage), helper: 'Highest simultaneous bodies', accent: '#16a34a' },
    { label: 'Teams', value: fmtCount(roles.length), helper: 'Available filter groups', accent: '#7c3aed' }
  ]

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <PageShell
        eyebrow="Daily Operations"
        title="Weekly Schedule Console"
        description="Review the weekly shift shape, switch between teams quickly, and compare scheduled bodies against the staffing report for a selected day."
        accent="#0f766e"
        stats={stats}
        actions={
          <Box sx={{ display: 'flex', gap: 0.7, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button variant="outlined" onClick={prevWeek}>Prev Week</Button>
            <Chip label={`Week of ${weekStart.format('DD MMM YYYY')}`} color="primary" />
            <Button variant="outlined" onClick={nextWeek}>Next Week</Button>
          </Box>
        }
      >
        <SectionCard
          title="Weekly Shift Map"
          subtitle="Jump to a different week, narrow the view by team, and hover over blocks to see the grouped employee names."
          accent="#0f766e"
          noPadding
        >
          <Box sx={{ p: 1.05, display: 'grid', gap: 0.95 }}>
            <FilterStrip>
              <DatePicker
                label="Jump to week"
                views={['day']}
                value={weekStart}
                onChange={(value) => value && setWeekStart(dayjs(value).startOf('week'))}
                slotProps={{ textField: { size: 'small', sx: { minWidth: 180 } } }}
              />

              <TextField
                select
                label="Team"
                size="small"
                value={team}
                onChange={(event) => setTeam(event.target.value)}
                sx={{ minWidth: 150 }}
              >
                <MenuItem value="">All teams</MenuItem>
                {roles.map((role) => (
                  <MenuItem key={role} value={role}>{role}</MenuItem>
                ))}
              </TextField>
            </FilterStrip>

            <Box sx={{ borderRadius: 2.2, overflow: 'hidden', border: '1px solid', borderColor: 'divider', bgcolor: '#fff' }}>
              <FullCalendar
                key={weekStart.toISOString() + events.length}
                plugins={[timeGridPlugin]}
                initialView="timeGridWeek"
                initialDate={weekStart.toDate()}
                timeZone="local"
                height={600}
                headerToolbar={false}
                datesSet={({ start }) => setWeekStart(dayjs(start))}
                events={events}
                eventDidMount={(info) => {
                  info.el.setAttribute('title', info.event.extendedProps.names.join('\n'))
                }}
              />
            </Box>
          </Box>
        </SectionCard>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1.15fr 0.85fr' }, gap: 1.05 }}>
          <SectionCard
            title="Hourly Shift Counts"
            subtitle="Quick grid to spot concentration by day and hour across the selected week."
            accent="#2563eb"
          >
            <Box sx={{ overflowX: 'auto' }}>
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
                      <TableCell>{hour}:00</TableCell>
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
          </SectionCard>

          <SectionCard
            title="Daily Staffing Report"
            subtitle="Choose a day and compare required versus scheduled staffing in one compact visual."
            accent="#7c3aed"
          >
            <Box sx={{ display: 'grid', gap: 0.9 }}>
              <FilterStrip>
                <DatePicker
                  label="Staffing report date"
                  value={staffingDate}
                  onChange={(value) => value && setStaffingDate(value)}
                  slotProps={{ textField: { size: 'small', sx: { minWidth: 180 } } }}
                />
              </FilterStrip>

              <Box sx={{ height: 280 }}>
                <ResponsiveContainer>
                  <ComposedChart data={staffingData}>
                    <XAxis dataKey="hour" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="scheduledAgents" fill="rgba(15,118,110,0.7)" name="Scheduled" />
                    <Line type="monotone" dataKey="requiredAgents" stroke="#7c3aed" strokeWidth={2.2} name="Required" />
                  </ComposedChart>
                </ResponsiveContainer>
              </Box>

              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Report date: {staffingDate.format('YYYY-MM-DD')}
              </Typography>
            </Box>
          </SectionCard>
        </Box>
      </PageShell>
    </LocalizationProvider>
  )
}
