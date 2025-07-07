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

  const [forecast, setForecast]   = useState([])
  const [employees, setEmployees] = useState([])

  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  const calcForecast = async () => {
    try {
      const params = {
        role: team,
        start: startDate.format('YYYY-MM-DD'),
        end:   endDate.format('YYYY-MM-DD'),
        callAhtSeconds:   callAht,
        ticketAhtSeconds: ticketAht,
        serviceLevel:     sl,
        thresholdSeconds: threshold,
        shrinkage
      }
      const res = await api.post('/erlang/staff/bulk-range', params)
      console.log('Forecast:', res.data)
      setForecast(res.data)
      setEmployees([])
    } catch (err) {
      console.error('Error fetching forecast', err)
      alert(`Failed to get forecast: ${err.message}`)
    }
  }

  const assignToStaff = async () => {
    if (!forecast.length) {
      alert('Please calculate a forecast first.')
      return
    }
    try {
      console.log('Building daily blocks…')
      const allBlocks = []
      // for each day, fetch that day's shift‐blocks
      for (const day of forecast) {
        const resp = await api.post('/erlang/staff/schedule', {
          staffing: day.staffing.map(h => ({
            hour:           h.hour,
            requiredAgents: h.requiredAgents
          })),
          shiftLength: 9
        })
        console.log(`Day ${day.date} blocks:`, resp.data)
        resp.data.forEach(s => {
          allBlocks.push({
            date:      day.date,
            startHour: s.startHour,
            length:    s.length
          })
        })
      }

      console.log('Sending to /schedule/assign:', allBlocks.length, 'blocks')
      const out = await api.post('/schedule/assign', { shiftBlocks: allBlocks })
      console.log('Assign result:', out.data)
      setEmployees(out.data)
    } catch (err) {
      console.error('Error assigning to staff', err)
      alert(`Failed to assign shifts: ${err.message}`)
    }
  }

  const maxReq = forecast.length
    ? Math.max(...forecast.flatMap(d => d.staffing.map(h => h.requiredAgents)))
    : 0

  // build a coverage map once we have employees
  const coverageMap = {}
  if (forecast.length && employees.length) {
    forecast.forEach(d => {
      coverageMap[d.date] = Array(24).fill(0)
    })
    employees.forEach(emp => {
      emp.shifts.forEach(({ date, startHour, length }) => {
        const row = coverageMap[date]
        for (let h = startHour; h < startHour + length; h++) {
          if (row[h] != null) row[h]++
        }
      })
    })
  }
  const maxCov = Math.max(0, ...Object.values(coverageMap).flat())

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>Staffing Forecast & Scheduling</Typography>

        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, mb:4 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team" onChange={e => setTeam(e.target.value)}>
              {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
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
            label="Call AHT (sec)" type="number"
            value={callAht}
            onChange={e => setCallAht(+e.target.value)}
          />
          <TextField
            label="Ticket AHT (sec)" type="number"
            value={ticketAht}
            onChange={e => setTicketAht(+e.target.value)}
          />
          <TextField
            label="Service Level (%)" type="number"
            value={sl * 100}
            onChange={e => setSL(+e.target.value / 100)}
          />
          <TextField
            label="Threshold (sec)" type="number"
            value={threshold}
            onChange={e => setThreshold(+e.target.value)}
          />
          <TextField
            label="Shrinkage (%)" type="number"
            value={shrinkage * 100}
            onChange={e => setShrinkage(+e.target.value / 100)}
          />

          <Button variant="contained" onClick={calcForecast}>
            Calculate Forecast
          </Button>
          <Button
            variant="contained"
            onClick={() => {
              console.log('🔔 Assign to Staff clicked — forecast.length=', forecast.length);
              if (forecast.length === 0) {
                alert('Please calculate a forecast first.');
                return;
              }
              assignToStaff();
            }}
          >
            Assign to Staff
          </Button>
        </Box>

        {/* Required heatmap */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6" gutterBottom>Required Agents Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => <TableCell key={d.date}>{d.date}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const req = d.staffing.find(x => x.hour === h)?.requiredAgents || 0
                      const alpha = maxReq ? req / maxReq * 0.8 + 0.2 : 0.2
                      return (
                        <TableCell
                          key={d.date}
                          sx={{ backgroundColor: `rgba(33,150,243,${alpha})` }}
                        >
                          {req}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Coverage heatmap */}
        {employees.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6" gutterBottom>Scheduled Coverage Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {Object.keys(coverageMap).map(date => (
                    <TableCell key={date}>{date}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {Object.values(coverageMap).map((row, i) => {
                      const cov = row[h] || 0
                      const alpha = maxCov ? cov / maxCov * 0.8 + 0.2 : 0.2
                      return (
                        <TableCell
                          key={i}
                          sx={{ backgroundColor: `rgba(76,175,80,${alpha})` }}
                        >
                          {cov}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Final schedules */}
        {employees.length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>Assigned Staff Schedules</Typography>
            {employees.map(emp => (
              <Box key={emp.id} sx={{ mb:2, p:2, border:'1px solid #ccc' }}>
                <Typography variant="subtitle1">
                  Employee {emp.id} (Total Hours: {emp.totalHours})
                </Typography>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>#</TableCell>
                      <TableCell>Date</TableCell>
                      <TableCell>Start</TableCell>
                      <TableCell>Length</TableCell>
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
