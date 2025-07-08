// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState, useMemo } from 'react'
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip
} from '@mui/material'
import {
  LocalizationProvider, DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import api from '../api'
import moment from 'moment'

export default function StaffingPage() {
  // ─── state ─────────────────────────────────────────────────────
  const [roles, setRoles]         = useState([])
  const [team, setTeam]           = useState('')
  const [startDate, setStartDate] = useState(dayjs())
  const [callAht, setCallAht]     = useState(300)
  const [ticketAht, setTicketAht] = useState(240)
  const [sl, setSL]               = useState(0.8)
  const [threshold, setThreshold] = useState(20)
  const [shrinkage, setShrinkage] = useState(0.3)
  const [weeks, setWeeks]         = useState(3)

  const [forecast, setForecast]         = useState([])
  const [blocks, setBlocks]             = useState([])
  const [bestStartHours, setBestStart]  = useState([])
  const [personSchedule, setPersonSchedule] = useState({})

  // ─── load roles ─────────────────────────────────────────────────
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // ─── helpers ────────────────────────────────────────────────────
  function getWorkDates(start, weeksCount) {
    const dates = []
    for (let w = 0; w < weeksCount; w++) {
      const base = dayjs(start).add(w * 7, 'day')
      for (let d = 0; d < 5; d++) {
        dates.push(base.add(d, 'day').format('YYYY-MM-DD'))
      }
    }
    return dates
  }

  // build maps for heatmaps
  const { scheduled, deficit, maxReq, maxSch, maxDef } = useMemo(() => {
    const sched = {}
    blocks.forEach(b => {
      getWorkDates(b.startDate, weeks).forEach(date => {
        for (let h = b.startHour; h < b.startHour + b.length; h++) {
          const key = `${date}|${h}`
          sched[key] = (sched[key] || 0) + b.count
        }
      })
    })

    const def = {}
    forecast.forEach(d => {
      d.staffing.forEach(({ hour, requiredAgents }) => {
        const key = `${d.date}|${hour}`
        def[key] = (sched[key] || 0) - requiredAgents
      })
    })

    const rMax = Math.max(0,
      ...forecast.flatMap(d => d.staffing.map(s => s.requiredAgents))
    )
    const sMax = Math.max(0, ...Object.values(sched))
    const dMax = Math.max(0, ...Object.values(def).map(v => Math.abs(v)))
    return { scheduled: sched, deficit: def, maxReq: rMax, maxSch: sMax, maxDef: dMax }
  }, [blocks, forecast, weeks])

  // ─── 1) forecast ────────────────────────────────────────────────
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD')
    const end   = startDate.add(weeks, 'week').subtract(1, 'day').format('YYYY-MM-DD')
    const res = await api.post('/erlang/staff/bulk-range', {
      role: team,
      start, end,
      callAhtSeconds:   callAht,
      ticketAhtSeconds: ticketAht,
      serviceLevel:     sl,
      thresholdSeconds: threshold,
      shrinkage
    })
    setForecast(res.data)
    setBlocks([])
    setBestStart([])
    setPersonSchedule({})
  }

  // ─── 2) assign rotations ─────────────────────────────────────────
  const assignToStaff = async () => {
    if (!forecast.length) return alert('Run Forecast first')
    const res = await api.post('/erlang/staff/schedule', {
      staffing:    forecast,
      weeks,
      shiftLength: 9,
      topN:        5
    })
    setBestStart(res.data.bestStartHours)
    setBlocks(res.data.solution)

    // ─ build per-person schedule ─────────────────────────────────
    let empIdx = 1
    const assignments = []
    res.data.solution.forEach(b => {
      for (let i = 0; i < b.count; i++) {
        assignments.push({ employee: empIdx, ...b })
        empIdx++
      }
    })
    const scheduleByEmp = {}
    assignments.forEach(({ employee, startDate, startHour, length }) => {
      scheduleByEmp[employee] = scheduleByEmp[employee] || []
      getWorkDates(startDate, weeks).forEach(date => {
        scheduleByEmp[employee].push({ day: date, hour: startHour })
      })
    })
    setPersonSchedule(scheduleByEmp)
  }

  // ─── 3) export to Excel ─────────────────────────────────────────
  const exportExcel = async () => {
    const { default: XLSX } = await import('xlsx')
    // flatten to rows
    const rows = []
    Object.entries(personSchedule).forEach(([emp, arr]) => {
      arr.forEach(({ day, hour }) => {
        rows.push({ Employee: emp, Date: day, StartHour: `${hour}:00` })
      })
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
    XLSX.writeFile(wb, 'staff-calendar.xlsx')
  }

  // ─── 4) prepare Gantt data ─────────────────────────────────────
  const [groups, items] = useMemo(() => {
    const gr = Object.keys(personSchedule).map(emp => ({
      id: Number(emp),
      title: `Emp ${emp}`
    }))
    const it = []
    let itemId = 1
    Object.entries(personSchedule).forEach(([emp, arr]) => {
      arr.forEach(({ day, hour }) => {
        const start = moment(`${day} ${hour}`, 'YYYY-MM-DD H')
        const end   = start.clone().add(9, 'hour')
        it.push({
          id: itemId++,
          group: Number(emp),
          title: `${hour}:00`,
          start_time: start,
          end_time:   end,
          itemProps: { 'data-tooltip': `${day} @ ${hour}:00` }
        })
      })
    })
    return [gr, it]
  }, [personSchedule])

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Scheduling
        </Typography>

        {/* ─── Controls ─────────────────────────────────────────────── */}
        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, mb:4 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team" onChange={e=>setTeam(e.target.value)}>
              {roles.map(r=> <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>

          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d=>d&&setStartDate(d)}
            renderInput={p=><TextField {...p} size="small"/>}
          />

          <FormControl sx={{ minWidth:120 }}>
            <InputLabel>Rotation (weeks)</InputLabel>
            <Select value={weeks} label="Rotation" onChange={e=>setWeeks(+e.target.value)}>
              {[1,2,3,4,5].map(w =>
                <MenuItem key={w} value={w}>{w}</MenuItem>
              )}
            </Select>
          </FormControl>

          <TextField
            label="Call AHT (sec)" type="number"
            value={callAht} onChange={e=>setCallAht(+e.target.value)}
            size="small"
          />
          <TextField
            label="Ticket AHT (sec)" type="number"
            value={ticketAht} onChange={e=>setTicketAht(+e.target.value)}
            size="small"
          />
          <TextField
            label="Service Level %" type="number"
            value={sl*100} onChange={e=>setSL(+e.target.value/100)}
            size="small"
          />
          <TextField
            label="Threshold (sec)" type="number"
            value={threshold} onChange={e=>setThreshold(+e.target.value)}
            size="small"
          />
          <TextField
            label="Shrinkage %" type="number"
            value={shrinkage*100} onChange={e=>setShrinkage(+e.target.value/100)}
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

        {/* ─── 1) Required Agents Heatmap ───────────────────────────── */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Required Agents Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d =>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length:24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const req = d.staffing.find(s=>s.hour===h)?.requiredAgents||0
                      const alpha = maxReq ? (req/maxReq)*0.8+0.2 : 0.2
                      return (
                        <Tooltip key={d.date} title={`Req: ${req}`}>
                          <TableCell
                            sx={{ backgroundColor:`rgba(33,150,243,${alpha})` }}
                          >
                            {req}
                          </TableCell>
                        </Tooltip>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── 2) Scheduled Coverage Heatmap ────────────────────────── */}
        {blocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Scheduled Coverage Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d =>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length:24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const cov = scheduled[`${d.date}|${h}`]||0
                      const alpha = maxSch ? (cov/maxSch)*0.8+0.2 : 0.2
                      return (
                        <Tooltip key={d.date} title={`Sch: ${cov}`}>
                          <TableCell
                            sx={{ backgroundColor:`rgba(76,175,80,${alpha})` }}
                          >
                            {cov}
                          </TableCell>
                        </Tooltip>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── 3) Deficit Heatmap ────────────────────────────────────── */}
        {blocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Under-/Over-Staffing Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d =>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({ length:24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const val = deficit[`${d.date}|${h}`]||0
                      const ratio = maxDef ? (Math.abs(val)/maxDef)*0.8+0.2 : 0.2
                      const col  = val < 0
                        ? `rgba(244,67,54,${ratio})`
                        : `rgba(76,175,80,${ratio})`
                      return (
                        <Tooltip key={d.date} title={`Deficit: ${val}`}>
                          <TableCell sx={{ backgroundColor: col }}>
                            {val}
                          </TableCell>
                        </Tooltip>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── 4) Assigned Shift-Block Types ────────────────────────── */}
        {blocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Assigned Shift-Block Types</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length (h)</TableCell>
                  <TableCell>Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map((b,i) => (
                  <TableRow key={i}>
                    <TableCell>{i+1}</TableCell>
                    <TableCell>{b.startDate}</TableCell>
                    <Tooltip title={`Starts at ${b.startHour}:00`}>
                      <TableCell>{b.startHour}:00</TableCell>
                    </Tooltip>
                    <TableCell>{b.length}</TableCell>
                    <TableCell>{b.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── 5) Per-employee Gantt-style calendar ────────────────── */}
        {groups.length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>
              Staff Gantt Calendar (hover for details)
            </Typography>
            <CalendarView
              groups={groups}
              items={items}
              defaultTimeStart={moment(startDate).toDate()}
              defaultTimeEnd={moment(startDate).add(weeks, 'week').toDate()}
            />
            <Button variant="outlined" onClick={exportExcel} sx={{ mt:2 }}>
              Export to Excel
            </Button>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}

/**
 * CalendarView
 * — lazily loads react-calendar-timeline + its CSS
 */
function CalendarView({ groups, items, defaultTimeStart, defaultTimeEnd }) {
  const [Timeline, setTimeline] = useState(null)

  useEffect(() => {
    (async () => {
      const mod = await import('react-calendar-timeline')
      // load the CSS at runtime, too
      await import('react-calendar-timeline/lib/Timeline.css')
      setTimeline(() => mod.default)
    })()
  }, [])

  if (!Timeline) return <Typography>Loading calendar…</Typography>

  return (
    <Timeline
      groups={groups}
      items={items}
      defaultTimeStart={defaultTimeStart}
      defaultTimeEnd={defaultTimeEnd}
      canMove={false}
      canResize={false}
      itemTouchSendsClick={true}
      itemRenderer={({ item, style }) => (
        <div
          style={{
            ...style,
            background: '#1976d2',
            borderRadius: 4,
            padding: '2px 4px',
            color: 'white',
            fontSize: 12
          }}
          title={item.itemProps['data-tooltip']}
        >
          {item.title}
        </div>
      )}
    />
  )
}
