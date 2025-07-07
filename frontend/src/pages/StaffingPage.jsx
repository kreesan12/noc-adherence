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
  // ── State ──────────────────────────────────────────────
  const [roles, setRoles]             = useState([])
  const [team, setTeam]               = useState('')
  const [startDate, setStartDate]     = useState(dayjs())
  const [callAht, setCallAht]         = useState(300)
  const [ticketAht, setTicketAht]     = useState(600)
  const [sl, setSL]                   = useState(0.8)
  const [threshold, setThreshold]     = useState(20)
  const [shrinkage, setShrinkage]     = useState(0.3)

  const [forecast, setForecast]       = useState([]) // [{ date, staffing }]
  const [blocks, setBlocks]           = useState([]) // [{ startDate, startHour, length, count, patternIndex }]
  const [bestStartHours, setBestStart] = useState([])

  // ── Load roles ─────────────────────────────────────────
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // ── Forecast 3 weeks ───────────────────────────────────
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

  // ── Assign rotations ───────────────────────────────────
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

  // ── Helpers ────────────────────────────────────────────
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

  // ── Build coverage & deficit maps ─────────────────────
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
      const got = scheduled[key] || 0
      deficit[key] = got - requiredAgents
    })
  })

  // ── Heatmap scales ─────────────────────────────────────
  const maxReq = Math.max(0, ...forecast.flatMap(d => d.staffing.map(s => s.requiredAgents)))
  const maxSch = Math.max(0, ...Object.values(scheduled))
  const maxDef = Math.max(0, ...Object.values(deficit).map(v => Math.abs(v)))

  // ── 12-Week Preview of Block Assignments ──────────────
  const extendedBlocks = blocks.flatMap(b =>
    Array.from({ length: 4 }, (_, i) => ({
      ...b,
      cycle: i + 1,
      startDate: dayjs(b.startDate).add(i * 3, 'week').format('YYYY-MM-DD')
    }))
  )

  // ── Build per-person 7-cycle (21-week) schedules ───────
  const totalPatterns = 7
  const slotRing = blocks.flatMap(b =>
    Array.from({ length: b.count }, () => ({
      patternIndex: b.patternIndex,
      startDate:    b.startDate
    }))
  )
  const slotSchedules = slotRing.map((slot, idx) => {
    const sched = []
    for (let c = 0; c < totalPatterns; c++) {
      const patternIndex = (slot.patternIndex + c) % totalPatterns
      const cycleStart   = dayjs(slot.startDate).add(c * 3, 'week').format('YYYY-MM-DD')
      sched.push({
        cycle:       c + 1,
        patternIndex,
        workDates:   getWorkDates(cycleStart, 3)
      })
    }
    return { person: idx + 1, sched }
  })

  // ── Render ─────────────────────────────────────────────
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
            <Select value={team} label="Team" onChange={e => setTeam(e.target.value)}>
              {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>
          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={params => <TextField {...params} size="small" />}
          />
          <TextField label="Call AHT (sec)"   type="number" value={callAht}   onChange={e => setCallAht(+e.target.value)}   size="small"/>
          <TextField label="Ticket AHT (sec)" type="number" value={ticketAht} onChange={e => setTicketAht(+e.target.value)} size="small"/>
          <TextField label="SL %"             type="number" value={sl*100}   onChange={e => setSL(+e.target.value/100)}     size="small"/>
          <TextField label="Threshold (sec)"  type="number" value={threshold} onChange={e => setThreshold(+e.target.value)}size="small"/>
          <TextField label="Shrinkage %"      type="number" value={shrinkage*100} onChange={e => setShrinkage(+e.target.value/100)} size="small"/>
          <Button variant="contained" onClick={calcForecast}>Calculate Forecast</Button>
          <Button variant="contained" onClick={assignToStaff} disabled={!forecast.length} sx={{ ml:2 }}>
            Assign to Staff
          </Button>
        </Box>

        {/* Required Agents Heatmap */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Required Agents</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => <TableCell key={d.date}>{d.date}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length:24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const req = d.staffing.find(s=>s.hour===h)?.requiredAgents||0
                      const alpha = maxReq ? (req/maxReq)*0.8+0.2 : 0.2
                      return <TableCell key={d.date} sx={{ backgroundColor:`rgba(33,150,243,${alpha})` }}>{req}</TableCell>
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Scheduled Coverage Heatmap */}
        {blocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Scheduled Coverage</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => <TableCell key={d.date}>{d.date}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length:24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const cov   = scheduled[`${d.date}|${h}`]||0
                      const alpha = maxSch ? (cov/maxSch)*0.8+0.2 : 0.2
                      return <TableCell key={d.date} sx={{ backgroundColor:`rgba(76,175,80,${alpha})` }}>{cov}</TableCell>
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Deficit Heatmap */}
        {blocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Deficit (Assigned − Required)</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d => <TableCell key={d.date}>{d.date}</TableCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length:24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const diff  = deficit[`${d.date}|${h}`]||0
                      const alpha = maxDef ? (Math.abs(diff)/maxDef)*0.8+0.2 : 0.2
                      const bg    = diff>=0 ? `rgba(76,175,80,${alpha})` : `rgba(244,67,54,${alpha})`
                      return <TableCell key={d.date} sx={{ backgroundColor:bg }}>{diff}</TableCell>
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* Assigned Shift-Block Types */}
        {blocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Assigned Shift-Block Types</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length</TableCell>
                  <TableCell>Count</TableCell>
                  <TableCell>Pattern</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map((b,i) => (
                  <TableRow key={i}>
                    <TableCell>{i+1}</TableCell>
                    <TableCell>{b.startDate}</TableCell>
                    <TableCell>{b.startHour}:00</TableCell>
                    <TableCell>{b.length}</TableCell>
                    <TableCell>{b.count}</TableCell>
                    <TableCell>{['Sun–Thu','Mon–Fri','Tue–Sat','Wed–Sun','Thu–Mon','Fri–Tue','Sat–Wed'][b.patternIndex]}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* 12-Week Rotation Preview */}
        {extendedBlocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">12-Week Rotation Preview</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Cycle</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length</TableCell>
                  <TableCell>Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {extendedBlocks.map((b,i) => (
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

        {/* Per-Person 21-Week Schedule */}
        {slotSchedules.length > 0 && (
          <Box sx={{ mt:4, overflowX:'auto' }}>
            <Typography variant="h6">Per-Person 21-Week Rotation</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Person</TableCell>
                  {slotSchedules[0].sched.map(e => (
                    <TableCell key={e.cycle}>Cycle {e.cycle}</TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {slotSchedules.map(p => (
                  <TableRow key={p.person}>
                    <TableCell>{p.person}</TableCell>
                    {p.sched.map(e => (
                      <TableCell key={e.cycle}>
                        {e.workDates[0]} – {e.workDates[e.workDates.length-1]}
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
