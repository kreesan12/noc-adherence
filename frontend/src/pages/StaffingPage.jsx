// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState } from 'react'
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl,
  Table, TableHead, TableBody, TableRow, TableCell
} from '@mui/material'
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import api from '../api'
import dayjs from 'dayjs'

export default function StaffingPage() {
  const [roles, setRoles]             = useState([])
  const [team, setTeam]               = useState('')
  const [startDate, setStartDate]     = useState(dayjs())
  const [callAht, setCallAht]         = useState(300)
  const [ticketAht, setTicketAht]     = useState(600)
  const [sl, setSL]                   = useState(0.8)
  const [threshold, setThreshold]     = useState(20)
  const [shrinkage, setShrinkage]     = useState(0.3)

  const [forecast, setForecast]       = useState([])
  const [blocks, setBlocks]           = useState([])
  const [bestStartHours, setBestStart]= useState([])

  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // 1) 3-week forecast
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD')
    const end   = startDate.add(3, 'week').subtract(1, 'day').format('YYYY-MM-DD')
    const res = await api.post('/erlang/staff/bulk-range', {
      role:               team,
      start, end,
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

  // 2) Assign 3-week rotations
  const assignToStaff = async () => {
    if (!forecast.length) return alert('Run Forecast first')
    const res = await api.post('/erlang/staff/schedule', {
      staffing:    forecast,
      weeks:       3,
      shiftLength: 9,
      topN:        5
    })
    setBestStart(res.data.bestStartHours)
    setBlocks(res.data.solution)
  }

  // helper: get the 5 workdays for n weeks
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

  // build coverage & deficit
  const scheduled = {}, deficit = {}
  blocks.forEach(b => {
    getWorkDates(b.startDate, 3).forEach(date => {
      for (let h = b.startHour; h < b.startHour + b.length; h++) {
        const key = `${date}|${h}`
        scheduled[key] = (scheduled[key]||0) + b.count
      }
    })
  })
  forecast.forEach(day => {
    day.staffing.forEach(({ hour, requiredAgents }) => {
      const key = `${day.date}|${hour}`
      const got = scheduled[key]||0
      deficit[key] = got - requiredAgents
    })
  })

  // scales
  const maxReq = Math.max(0, ...forecast.flatMap(d => d.staffing.map(s=>s.requiredAgents)))
  const maxSch = Math.max(0, ...Object.values(scheduled))
  const maxDef = Math.max(0, ...Object.values(deficit).map(v=>Math.abs(v)))

  // 12-week block preview
  const extendedBlocks = blocks.flatMap(b =>
    Array.from({ length: 4 }, (_, i) => ({
      ...b,
      cycle:     i+1,
      startDate: dayjs(b.startDate).add(i*3,'week').format('YYYY-MM-DD')
    }))
  )

  // ── NEW: per-person 7-cycle schedules ───────────────────
  // flatten blocks into individual slots
  const sortedBlocks = blocks
    .slice()
    .sort((a,b) => a.patternIndex - b.patternIndex || a.startHour - b.startHour)

  // build an array of employeeSlots: one slot per person
  let employeeSlots = []
  sortedBlocks.forEach((b, idx) => {
    for (let i = 0; i < b.count; i++) {
      employeeSlots.push({ blockIndex: idx, ...b })
    }
  })

  // for each “employee” build their 7-cycle itinerary
  const employeeSchedules = employeeSlots.map((slot, empIdx) => {
    const sched = []
    let bi = slot.blockIndex
    for (let cycle = 0; cycle < sortedBlocks.length; cycle++) {
      const blk = sortedBlocks[bi]
      sched.push({
        cycle:       cycle+1,
        patternIndex: blk.patternIndex,
        startDate:    dayjs(blk.startDate).add(cycle*3,'week').format('YYYY-MM-DD'),
        startHour:    blk.startHour,
        length:       blk.length
      })
      bi = (bi + 1) % sortedBlocks.length
    }
    return { employee: empIdx+1, sched }
  })

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Scheduling
        </Typography>

        {/* Controls */}
        <Box sx={{ display:'flex', gap:2, flexWrap:'wrap', mb:4 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} onChange={e=>setTeam(e.target.value)}>
              {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>
          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d=>d&&setStartDate(d)}
            renderInput={p=><TextField {...p} size="small"/>}
          />
          <TextField label="Call AHT"   type="number" size="small"
            value={callAht} onChange={e=>setCallAht(+e.target.value)} />
          <TextField label="Ticket AHT" type="number" size="small"
            value={ticketAht} onChange={e=>setTicketAht(+e.target.value)} />
          <TextField label="SL %"        type="number" size="small"
            value={sl*100} onChange={e=>setSL(+e.target.value/100)} />
          <TextField label="Threshold"  type="number" size="small"
            value={threshold} onChange={e=>setThreshold(+e.target.value)} />
          <TextField label="Shrinkage"  type="number" size="small"
            value={shrinkage*100} onChange={e=>setShrinkage(+e.target.value/100)} />
          <Button variant="contained" onClick={calcForecast}>Calculate Forecast</Button>
          <Button variant="contained" onClick={assignToStaff} disabled={!forecast.length}>
            Assign to Staff
          </Button>
        </Box>

        {/* Required Heatmap */}
        {/* ...same as before... */}

        {/* Scheduled Heatmap */}
        {/* ...same as before... */}

        {/* Deficit Heatmap */}
        {/* ...same as before... */}

        {/* Assigned Blocks */}
        {/* ...same as before, plus you can display patternIndex if desired... */}

        {/* 12-Week Block Preview */}
        {/* ...same as before... */}

        {/* ── Per-Person 21-Week Rotation Grid ───────────────────────── */}
        {employeeSchedules.length > 0 && (
          <Box sx={{ mt:4, overflowX:'auto' }}>
            <Typography variant="h6">Per-Person 21-Week Schedules</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Employee</TableCell>
                  {employeeSchedules[0].sched.map(e =>
                    <TableCell key={e.cycle}>Cycle {e.cycle}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {employeeSchedules.map(emp => (
                  <TableRow key={emp.employee}>
                    <TableCell>{emp.employee}</TableCell>
                    {emp.sched.map(s => (
                      <TableCell key={s.cycle}>
                        {s.startDate} @ {s.startHour}:00
                      </TableCell>
                    ))}
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
