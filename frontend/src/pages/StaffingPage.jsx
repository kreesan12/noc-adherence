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
import api from '../api'
import dayjs from 'dayjs'

export default function StaffingPage() {
  const [roles, setRoles]         = useState([])
  const [team, setTeam]           = useState('')
  const [startDate, setStartDate] = useState(dayjs())
  const [endDate, setEndDate]     = useState(dayjs())
  const [callAht, setCallAht]     = useState(300)
  const [ticketAht, setTicketAht] = useState(600)
  const [sl, setSL]               = useState(0.8)
  const [threshold, setThreshold] = useState(20)
  const [shrinkage, setShrinkage] = useState(0.3)

  // forecast: [{ date, staffing: [{ hour, calls, tickets, requiredAgents }] }]
  const [forecast, setForecast]   = useState([])

  // assigned employees: [{ id, shifts:[…], totalHours }]
  const [employees, setEmployees] = useState([])

  // load available roles once
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // 1️⃣ compute multi-day staffing forecast
  const calcForecast = async () => {
    const params = {
      role:             team,
      start:            startDate.format('YYYY-MM-DD'),
      end:              endDate.format('YYYY-MM-DD'),
      callAhtSeconds:   callAht,
      ticketAhtSeconds: ticketAht,
      serviceLevel:     sl,
      thresholdSeconds: threshold,
      shrinkage
    }
    const res = await api.post('/erlang/staff/bulk-range', params)
    setForecast(res.data)
    setEmployees([])
  }

  // 2️⃣ assign forecast blocks to staff
  const assignToStaff = async () => {
    // build one block per required agent per day/hour
    const shiftBlocks = forecast.flatMap(day =>
      day.staffing.flatMap(h =>
        Array.from({ length: h.requiredAgents }, () => ({
          date:      day.date,
          startHour: h.hour,
          length:    9      // fixed 9h shift including 1h lunch
        }))
      )
    )

    const res = await api.post('/schedule/assign', { shiftBlocks })
    setEmployees(res.data)
  }

  // for heatmap coloring
  const maxAgents = forecast.length
    ? Math.max(...forecast.flatMap(d => d.staffing.map(h => h.requiredAgents)))
    : 0

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Scheduling
        </Typography>

        {/* Controls */}
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
            variant="contained"
            disabled={!forecast.length}
            onClick={assignToStaff}
          >
            Assign to Staff
          </Button>
        </Box>

        {/* Heatmap of required agents */}
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

        {/* Assigned employees */}
        {employees.length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>
              Assigned Staff Schedules
            </Typography>
            {employees.map(emp => (
              <Box key={emp.id} sx={{ mb:2, p:2, border:'1px solid #ccc' }}>
                <Typography variant="subtitle1">
                  Employee {emp.id} (Total Hours: {emp.totalHours})
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Shift #</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Start</TableCell>
                      <TableCell>Length (hrs)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {emp.shifts.map((sh, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{idx+1}</TableCell>
                        <TableCell>{sh.date}</TableCell>
                        <TableCell>{sh.startHour}:00</TableCell>
                        <TableCell>{sh.length}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}
