// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState } from 'react'
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl,
  Table, TableHead, TableBody, TableRow, TableCell
} from '@mui/material'
import {
  LocalizationProvider, DatePicker
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

  // forecast: [{ date, staffing: [{ hour, requiredAgents }] }]
  const [forecast, setForecast]   = useState([])

  // employee assignments: [{ id, shifts:[{date,startHour,length}], totalHours }]
  const [employees, setEmployees] = useState([])

  // load roles once
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // fetch multi-day forecast
  const calcForecast = async () => {
    try {
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
    } catch (err) {
      console.error(err)
      alert('Forecast failed: ' + err.message)
    }
  }

  // greedy assign 5-day/9-hour blocks
  const assignToStaff = () => {
    if (!forecast.length) {
      alert('Please calculate a forecast first.')
      return
    }

    const DATES = forecast.map(d => d.date)
    const N     = DATES.length
    const L     = 9   // 9h per shift (incl. lunch)
    // build demand matrix D[dayIndex][hour]
    const D = forecast.map(d =>
      d.staffing.map(s => s.requiredAgents)
    )

    // precompute all possible 5-day windows × start-hours
    const patterns = []
    for (let startDay = 0; startDay + 5 <= N; startDay++) {
      for (let startHour = 0; startHour + L <= 24; startHour++) {
        // collect all covered (day,hour) cells
        const coords = []
        for (let di = 0; di < 5; di++) {
          for (let hh = 0; hh < L; hh++) {
            coords.push([startDay + di, startHour + hh])
          }
        }
        patterns.push({ startDay, startHour, coords })
      }
    }

    const assignments = []
    // keep going until all demands are zero
    while (true) {
      // find pattern with largest *sum* of remaining demand
      let best = null, bestSum = 0
      for (const p of patterns) {
        const sum = p.coords.reduce((acc, [di, hh]) =>
          acc + Math.max(0, D[di][hh])
        , 0)
        if (sum > bestSum) {
          bestSum = sum
          best    = p
        }
      }
      if (!best || bestSum <= 0) break

      // how many employees do we need on *this* block?
      // equal to the *max* remaining demand in its coords
      const count = best.coords.reduce((m, [di, hh]) =>
        Math.max(m, D[di][hh])
      , 0)

      // record assignment
      assignments.push({
        startDay:   best.startDay,
        startHour:  best.startHour,
        count
      })

      // subtract coverage from D
      for (const [di, hh] of best.coords) {
        D[di][hh] = Math.max(0, D[di][hh] - count)
      }
    }

    // expand into per-employee records
    const emps = []
    let   id   = 1
    for (const a of assignments) {
      for (let i = 0; i < a.count; i++) {
        const shifts = []
        for (let di = 0; di < 5; di++) {
          shifts.push({
            date:      DATES[a.startDay + di],
            startHour: a.startHour,
            length:    L
          })
        }
        emps.push({
          id,
          shifts,
          totalHours: 5 * L
        })
        id++
      }
    }

    setEmployees(emps)
  }

  // compute heatmap maxima
  const maxReq = Math.max(
    0,
    ...forecast.flatMap(d => d.staffing.map(s => s.requiredAgents))
  )
  // build coverage map
  const coverageMap = {}
  for (const d of forecast) {
    coverageMap[d.date] = Array(24).fill(0)
  }
  for (const emp of employees) {
    for (const sh of emp.shifts) {
      const row = coverageMap[sh.date]
      for (let hh = sh.startHour; hh < sh.startHour + sh.length; hh++) {
        if (row[hh] != null) row[hh]++
      }
    }
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
            onClick={assignToStaff}
            sx={{ ml:1 }}
          >
            Assign to Staff
          </Button>
        </Box>

        {/* Required heatmap */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Required Agents Heatmap</Typography>
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
                      const req = d.staffing.find(s => s.hour===h)?.requiredAgents||0
                      const alpha = maxReq ? (req/maxReq)*0.8 + 0.2 : 0.2
                      return (
                        <TableCell
                          key={d.date}
                          sx={{ backgroundColor:`rgba(33,150,243,${alpha})` }}
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
            <Typography variant="h6">Scheduled Coverage Heatmap</Typography>
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
                    {Object.values(coverageMap).map((row,i) => {
                      const cov = row[h] || 0
                      const alpha = maxCov ? (cov/maxCov)*0.8 + 0.2 : 0.2
                      return (
                        <TableCell
                          key={i}
                          sx={{ backgroundColor:`rgba(76,175,80,${alpha})` }}
                        >
