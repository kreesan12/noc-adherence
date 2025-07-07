// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState } from 'react'
import {
  Box,
  TextField,
  Button,
  Typography,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell
} from '@mui/material'
import {
  LocalizationProvider,
  DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend
} from 'recharts'
import api from '../api'
import dayjs from 'dayjs'

export default function StaffingPage() {
  const [roles, setRoles]           = useState([])
  const [team, setTeam]             = useState('')
  const [startDate, setStartDate]   = useState(dayjs())
  const [endDate, setEndDate]       = useState(dayjs())
  const [callAht, setCallAht]       = useState(300)
  const [ticketAht, setTicketAht]   = useState(600)
  const [sl, setSL]                 = useState(0.8)
  const [threshold, setThreshold]   = useState(20)
  const [shrinkage, setShrinkage]   = useState(0.3)

  // forecast: [{ date, staffing: [{ hour, calls, tickets, requiredAgents }] }]
  const [forecast, setForecast]     = useState([])

  // shifts: [{ startHour, length }]
  const [shifts, setShifts]         = useState([])

  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // multi-day forecast
  const calcForecast = async () => {
    const params = {
      role:               team,
      start:              startDate.format('YYYY-MM-DD'),
      end:                endDate.format('YYYY-MM-DD'),
      callAhtSeconds:     callAht,
      ticketAhtSeconds:   ticketAht,
      serviceLevel:       sl,
      thresholdSeconds:   threshold,
      shrinkage
    }
    const res = await api.post('/erlang/staff/bulk-range', params)
    setForecast(res.data)
    setShifts([])
  }

  // generate shifts
  const calcSchedule = async () => {
    const allHours = forecast.flatMap(day => day.staffing)
    const res      = await api.post('/erlang/staff/schedule', {
      staffing:    allHours,
      shiftLength: 9      // now default to 9-hour shifts (incl. 1h lunch)
    })
    setShifts(res.data)
  }

  // compute max for heatmap coloring
  const maxAgents = forecast.length
    ? Math.max(
        ...forecast.flatMap(d => d.staffing.map(h => h.requiredAgents))
      )
    : 0

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Scheduling
        </Typography>

        {/* controls */}
        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, mb:4 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select
              value={team}
              label="Team"
              onChange={e => setTeam(e.target.value)}
            >
              {roles.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <DatePicker
            label="Start Date"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={params => <TextField {...params} size="small" />}
          />
          <DatePicker
            label="End Date"
            value={endDate}
            onChange={d => d && setEndDate(d)}
            renderInput={params => <TextField {...params} size="small" />}
          />

          <TextField
            label="Call AHT (sec)"
            type="number"
            value={callAht}
            onChange={e => setCallAht(+e.target.value)}
          />
          <TextField
            label="Ticket AHT (sec)"
            type="number"
            value={ticketAht}
            onChange={e => setTicketAht(+e.target.value)}
          />
          <TextField
            label="Service Level %"
            type="number"
            value={sl * 100}
            onChange={e => setSL(+e.target.value / 100)}
          />
          <TextField
            label="Threshold (sec)"
            type="number"
            value={threshold}
            onChange={e => setThreshold(+e.target.value)}
          />
          <TextField
            label="Shrinkage %"
            type="number"
            value={shrinkage * 100}
            onChange={e => setShrinkage(+e.target.value / 100)}
          />

          <Button variant="contained" onClick={calcForecast}>
            Calculate Forecast
          </Button>
          <Button
            variant="outlined"
            disabled={!forecast.length}
            onClick={calcSchedule}
          >
            Generate Shifts
          </Button>
        </Box>

        {/* Heatmap table */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6" gutterBottom>
              Required Agents Heatmap
            </Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => (
                    <TableCell key={d.date}>{d.date}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const entry = d.staffing.find(x => x.hour === h) || { requiredAgents: 0 }
                      const val   = entry.requiredAgents
                      const alpha = maxAgents ? (val / maxAgents * 0.8 + 0.2) : 0.2
                      const bg    = `rgba(33,150,243,${alpha})`
                      return (
                        <TableCell key={d.date} sx={{ backgroundColor: bg }}>
                          {val}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* multi-day bar charts */}
        {forecast.map(day => (
          <Box key={day.date} sx={{ mb:4 }}>
            <Typography variant="h6">{day.date}</Typography>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={day.staffing}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="requiredAgents" name="Agents Needed" />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        ))}

        {/* shift blocks table */}
        {shifts.length > 0 && (
          <Box sx={{ mt:4, overflowX:'auto' }}>
            <Typography variant="h6" gutterBottom>
              Generated Shift Blocks
            </Typography>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length (hrs)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {shifts.map((s, i) => (
                  <TableRow key={i}>
                    <TableCell>{i+1}</TableCell>
                    <TableCell>{s.startHour}:00</TableCell>
                    <TableCell>{s.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}
