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

  // final employee schedules: [{ id, shifts:[{date,startHour,length}], totalHours }]
  const [employees, setEmployees] = useState([])

  // load available roles once
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // 1️⃣ fetch multi-day forecast
  const calcForecast = async () => {
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
    setForecast(res.data)
    setEmployees([])
  }

  // 2️⃣ weekly‐rotate assignment (up to 3 weeks) + reuse across weeks
  const assignToStaff = async () => {
    // build daily demand by pattern
    const daily = {}
    forecast.forEach(day => {
      day.staffing.forEach(h => {
        const key = `${h.hour}-${9}`      // length=9 fixed
        daily[key] = daily[key]||{}
        daily[key][day.date] = h.requiredAgents
      })
    })

    // group by pattern → week → weekday counts
    const weekly = {}
    Object.entries(daily).forEach(([pattern,map]) => {
      weekly[pattern] = {}
      Object.entries(map).forEach(([date,count]) => {
        const ws = dayjs(date).startOf('isoWeek').format('YYYY-MM-DD')
        const wd = dayjs(date).isoWeekday() // 1=Mon…7=Sun
        weekly[pattern][ws] = weekly[pattern][ws]||{}
        weekly[pattern][ws][wd] = count
      })
    })

    // turn into shiftBlocks for /schedule/assign
    // but we’re doing assignment client-side now
    const emps = []
    let id = 1

    for (const [pattern, weeksMap] of Object.entries(weekly)) {
      const [startHour, length] = pattern.split('-').map(Number)

      // sort iso-week starts
      const allWeeks = Object.keys(weeksMap).sort()
      // cap at 3-week rotation
      const useWeeks = allWeeks.slice(0, 3)

      // compute total headcount needed = max demand across any weekday in those weeks
      let needed = 0
      useWeeks.forEach(ws => {
        needed = Math.max(
          needed,
          ...Object.values(weeksMap[ws] || {})
        )
      })

      // for each “slot” k < needed, build that employee’s shifts
      for (let k = 0; k < needed; k++) {
        const shifts = []
        useWeeks.forEach(ws => {
          const dayCounts = weeksMap[ws] || {}
          Object.entries(dayCounts).forEach(([wd, cnt]) => {
            if (cnt > k) {
              // that employee covers this weekday
              const date = dayjs(ws).isoWeekday(Number(wd)).format('YYYY-MM-DD')
              shifts.push({ date, startHour, length })
            }
          })
        })
        emps.push({
          id,
          shifts,
          totalHours: shifts.length * length
        })
        id++
      }
    }

    setEmployees(emps)
  }

  // heatmap coloring helpers
  const maxReq = forecast.length
    ? Math.max(...forecast.flatMap(d => d.staffing.map(h => h.requiredAgents)))
    : 0

  // build scheduled coverage map once employees are set
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
  const maxCov = Math.max(
    0,
    ...Object.values(coverageMap).flat()
  )

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

        {/* Required heatmap */}
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
                      const req = d.staffing.find(x => x.hour === h)?.requiredAgents || 0
                      const alpha = maxReq ? (req / maxReq * 0.8 + 0.2) : 0.2
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

        {/* Scheduled Coverage heatmap */}
        {employees.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6" gutterBottom>
              Scheduled Coverage Heatmap
            </Typography>
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
                      const alpha = maxCov ? (cov / maxCov * 0.8 + 0.2) : 0.2
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

        {/* Final 5-day / multi-week schedules */}
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
