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
  const [roles, setRoles]               = useState([])
  const [team, setTeam]                 = useState('')
  const [startDate, setStartDate]       = useState(dayjs())
  const [callAht, setCallAht]           = useState(300)
  const [ticketAht, setTicketAht]       = useState(600)
  const [sl, setSL]                     = useState(0.8)
  const [threshold, setThreshold]       = useState(20)
  const [shrinkage, setShrinkage]       = useState(0.3)

  const [forecast, setForecast]         = useState([]) // [{date, staffing}]
  const [blocks, setBlocks]             = useState([]) // [{startDate, startHour, length, count}]
  const [bestStartHours, setBestStart]  = useState([])

  // load roles
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // 1) calc a 3-week forecast
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD')
    const end   = startDate.add(3, 'week').subtract(1, 'day').format('YYYY-MM-DD')
    const res = await api.post('/erlang/staff/bulk-range', {
      role:               team,
      start,
      end,
      callAhtSeconds:     callAht,
      ticketAhtSeconds:   ticketAht,
      serviceLevel:       sl,
      thresholdSeconds:   threshold,
      shrinkage
    })
    setForecast(res.data)
    setBlocks([])
    setBestStart([])
  }

  // 2) assign 3-week rotations
  const assignToStaff = async () => {
    if (!forecast.length) {
      alert('Run Forecast first')
      return
    }
    const res = await api.post('/erlang/staff/schedule', {
      staffing:    forecast,
      weeks:       3,
      shiftLength: 9,
      topN:        5
    })
    setBestStart(res.data.bestStartHours)
    setBlocks(res.data.solution)
  }

  // helper: get work dates for n-week rotation
  function getWorkDates(start, weeks) {
    const dates = []
    for (let w = 0; w < weeks; w++) {
      const base = dayjs(start).add(w * 7, 'day')
      for (let d = 0; d < 5; d++) {
        dates.push(base.add(d, 'day').format('YYYY-MM-DD'))
      }
    }
    return dates
  }

  // build maps
  const scheduled = {}
  const deficit   = {}
  blocks.forEach(b => {
    getWorkDates(b.startDate, 3).forEach(date => {
      for (let h = b.startHour; h < b.startHour + b.length; h++) {
        const key = `${date}|${h}`
        scheduled[key] = (scheduled[key] || 0) + b.count
      }
    })
  })
  forecast.forEach(day => {
    day.staffing.forEach(({ hour, requiredAgents }) => {
      const key = `${day.date}|${hour}`
      deficits = scheduled[key] || 0
      deficit[key] = deficits - requiredAgents
    })
  })

  // heatmap scales
  const maxReq  = Math.max(0, ...forecast.flatMap(d => d.staffing.map(s => s.requiredAgents)))
  const maxSch  = Math.max(0, ...Object.values(scheduled))
  const maxDef  = Math.max(0, ...Object.values(deficit).map(v => Math.abs(v)))

  // 3) build extended 12-week preview
  const extendedBlocks = blocks.flatMap(b =>
    Array.from({ length: 4 }, (_, i) => ({
      ...b,
      cycle: i + 1,
      startDate: dayjs(b.startDate).add(i * 3, 'week').format('YYYY-MM-DD')
    }))
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
            label="Forecast Start"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={params => <TextField {...params} size="small" />}
          />

          <TextField
            label="Call AHT (sec)"
            type="number"
            value={callAht}
            onChange={e => setCallAht(+e.target.value)}
            size="small"
          />
          <TextField
            label="Ticket AHT (sec)"
            type="number"
            value={ticketAht}
            onChange={e => setTicketAht(+e.target.value)}
            size="small"
          />
          <TextField
            label="Service Level %"
            type="number"
            value={sl * 100}
            onChange={e => setSL(+e.target.value / 100)}
            size="small"
          />
          <TextField
            label="Threshold (sec)"
            type="number"
            value={threshold}
            onChange={e => setThreshold(+e.target.value)}
            size="small"
          />
          <TextField
            label="Shrinkage %"
            type="number"
            value={shrinkage * 100}
            onChange={e => setShrinkage(+e.target.value / 100)}
            size="small"
          />

          <Button variant="contained" onClick={calcForecast}>
            Calculate Forecast
          </Button>
          <Button
            variant="contained"
            onClick={assignToStaff}
            disabled={!forecast.length}
            sx={{ ml:2 }}
          >
            Assign to Staff
          </Button>
        </Box>

        {/* ... existing heatmaps and Assigned Shift-Block Types ... */}

        {/* 12-Week Rotation Preview */}
        {extendedBlocks.length > 0 && (
          <Box sx={{ mt:4, overflowX:'auto' }}>
            <Typography variant="h6">12-Week Rotation Preview</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Cycle</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length (h)</TableCell>
                  <TableCell>Staff Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {extendedBlocks.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell>{b.cycle}</TableCell>
                    <TableCell>{b.startDate}</TableCell>
                    <TableCell>{b.startHour}:00</TableCell>
                    <TableCell>{b.length}</TableCell>
                    <TableCell>{b.count}</TableCell>
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
