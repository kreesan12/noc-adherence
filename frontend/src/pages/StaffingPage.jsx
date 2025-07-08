// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState, useMemo } from 'react'
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl, Switch,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip, FormControlLabel
} from '@mui/material'
import {
  LocalizationProvider, DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'

import dayjs from 'dayjs'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
dayjs.extend(isSameOrBefore)

import api from '../api'
import * as XLSX from 'xlsx'

export default function StaffingPage() {
  /* ─── Constants ───────────────────────────────────────────── */
  const HORIZON_MONTHS = 6
  const SHIFT_LENGTH   = 9
  const MAX_ITERS      = 50            // binary-search iterations

  /* ─── State (unchanged) ───────────────────────────────────── */
  const [roles, setRoles]               = useState([])
  const [team, setTeam]                 = useState('')
  const [startDate, setStartDate]       = useState(dayjs())
  const [callAht, setCallAht]           = useState(300)
  const [ticketAht, setTicketAht]       = useState(240)
  const [sl, setSL]                     = useState(0.8)
  const [threshold, setThreshold]       = useState(20)
  const [shrinkage, setShrinkage]       = useState(0.3)
  const [weeks, setWeeks]               = useState(3)

  const [forecast, setForecast]             = useState([])
  const [blocks, setBlocks]                 = useState([])
  const [bestStartHours, setBestStart]      = useState([])
  const [personSchedule, setPersonSchedule] = useState({})
  const [useFixedStaff, setUseFixedStaff]   = useState(false)
  const [fixedStaff,    setFixedStaff]      = useState(0)

  /* ─── Load roles once ─────────────────────────────────────── */
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  /* ─── Helper: generate N-week × 5-day date list ───────────── */
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

/* ─── buildSchedule with global-balancing lunches ───────────── */
function buildSchedule(solution, reqMap) {
  const schedByEmp = {}
  const totalEmp   = solution.reduce((s, b) => s + b.count, 0)
  const queue      = Array.from({ length: totalEmp }, (_, i) => i + 1)
  queue.forEach(id => (schedByEmp[id] = []))

  /* running counters of live coverage & lunches per hour */
  const coverMap = {}   // heads on duty (ex-lunch)
  const lunchMap = {}   // heads already at lunch

  const horizonEnd = dayjs(startDate).add(HORIZON_MONTHS, 'month')
  const cycles     = Math.ceil(
    (horizonEnd.diff(startDate, 'day') + 1) / (weeks * 7)
  )

  const sorted = [...solution].sort(
    (a, b) => a.patternIndex - b.patternIndex || a.startHour - b.startHour
  )

  for (let ci = 0; ci < cycles; ci++) {
    let offset = 0
    sorted.forEach(block => {
      const group = queue.slice(offset, offset + block.count)

      group.forEach(empId => {
        getWorkDates(block.startDate, weeks).forEach(dtStr => {
          const d = dayjs(dtStr).add(ci * weeks * 7, 'day')
          if (d.isAfter(horizonEnd, 'day')) return
          const day = d.format('YYYY-MM-DD')

          /* ── choose lunch hour ──────────────────────────── */
          const candidates = []
          for (let off = 2; off <= 5; off++) {
            const h = block.startHour + off
            if (h >= block.startHour + SHIFT_LENGTH) break
            const k = `${day}|${h}`

            const onDuty   = coverMap[k]  || 0
            const lunches  = lunchMap[k]  || 0
            const required = reqMap[k]    ?? 0

            const projected = onDuty - lunches - 1          // after this break
            const surplus   = projected - required          // ≥ 0 means safe

            if (surplus >= 0) {
              candidates.push({ h, surplus, lunches })
            }
          }

          let breakHour
          if (candidates.length) {
            /* minimise surplus → then lunches → then earliest */
            candidates.sort((a, b) =>
              a.surplus  - b.surplus  ||
              a.lunches  - b.lunches  ||
              a.h        - b.h
            )
            breakHour = candidates[0].h
          } else {
            // last resort: mid-shift
             const breakHour = block.breakOffset != null
             ? block.startHour + block.breakOffset          // ← backend value
             : block.startHour + Math.floor(block.length / 2)

          }

          /* record for employee */
          schedByEmp[empId].push({ day, hour: block.startHour, breakHour })

          /* update counters */
          for (let h = block.startHour; h < block.startHour + SHIFT_LENGTH; h++) {
            const k = `${day}|${h}`
            coverMap[k] = (coverMap[k] || 0) + 1
          }
          const lk = `${day}|${breakHour}`
          lunchMap[lk] = (lunchMap[lk] || 0) + 1
        })
      })

      offset += block.count
    })

    /* cycle-rotation so patterns roll forward next period */
    queue.unshift(queue.pop())
  }

  return schedByEmp
}

  /* ─── Heat-map memo (unchanged) ───────────────────────────── */
  const { scheduled, deficit, maxReq, maxSch, maxDef } = useMemo(() => {
    const reqMap = {}
    forecast.forEach(d =>
      d.staffing.forEach(({ hour, requiredAgents }) =>
        (reqMap[`${d.date}|${hour}`] = requiredAgents)
      )
    )
    const schedMap = {}
    Object.values(personSchedule).forEach(arr =>
      arr.forEach(({ day, hour, breakHour }) => {
        for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
          if (h === breakHour) continue
          const k = `${day}|${h}`
          schedMap[k] = (schedMap[k] || 0) + 1
        }
      })
    )
    const defMap = {}
    new Set([...Object.keys(reqMap), ...Object.keys(schedMap)]).forEach(k => {
      defMap[k] = (schedMap[k] || 0) - (reqMap[k] || 0)
    })
    const allReq = Object.values(reqMap)
    const allSch = Object.values(schedMap)
    const allDef = Object.values(defMap).map(v => Math.abs(v))
    return {
      scheduled: schedMap,
      deficit:   defMap,
      maxReq:    allReq.length ? Math.max(...allReq) : 0,
      maxSch:    allSch.length ? Math.max(...allSch) : 0,
      maxDef:    allDef.length ? Math.max(...allDef) : 0
    }
  }, [personSchedule, forecast])

  /* ─── deficit helper ──────────────────────────────────────── */
  const hasShort = def => Object.values(def).some(v => v < 0)

  /* ─── 1) 6-month forecast (unchanged) ─────────────────────── */
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD')
    const end   = startDate.add(HORIZON_MONTHS,'month')
                           .subtract(1,'day')
                           .format('YYYY-MM-DD')
    const { data } = await api.post('/erlang/staff/bulk-range',{
      role:team,start,end,
      callAhtSeconds:callAht,
      ticketAhtSeconds:ticketAht,
      serviceLevel:sl,
      thresholdSeconds:threshold,
      shrinkage
    })
    setForecast(data)
    setBlocks([]); setBestStart([]); setPersonSchedule({})
  }

  /* ─── 2) Assign staff with downward search + console logs ── */
  const assignToStaff = async () => {
    if (!forecast.length) { alert('Run Forecast first'); return }
    setUseFixedStaff(true)

    /* reqMap (for lunch choice) */
    const reqMap = {}
    forecast.forEach(d =>
      d.staffing.forEach(({ hour, requiredAgents }) =>
        (reqMap[`${d.date}|${hour}`] = requiredAgents)
      )
    )

    /* helper: solver → plan */
    const solve = async cap => {
      const body = { staffing:forecast, weeks, shiftLength:SHIFT_LENGTH, topN:5 }
      if (cap > 0) body.maxStaff = cap
      const { data } = await api.post('/erlang/staff/schedule', body)
      const sched = buildSchedule(data.solution, reqMap)
      const cov   = {}
      Object.values(sched).forEach(arr =>
        arr.forEach(({ day, hour, breakHour }) => {
          for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
            if (h === breakHour) continue
            const k = `${day}|${h}`
            cov[k] = (cov[k] || 0) + 1
          }
        })
      )
      const def = {}
      Object.keys(reqMap).forEach(k => { def[k] = (cov[k]||0) - reqMap[k] })
      return {
        solution:  data.solution,
        bestStart: data.bestStartHours,
        schedule:  sched,
        deficit:   def,
        headCnt:   data.solution.reduce((s,b)=>s+b.count,0)
      }
    }

    /* 2-A  exponential upper bound */
    let lo = 0, hi = 1, plan = await solve(hi)
    while (hasShort(plan.deficit)) {
      console.log(`[exp] cap=${hi}  short≥0? ${!hasShort(plan.deficit)}`)
      hi *= 2
      if (hi > 10000) break
      plan = await solve(hi)
    }

    /* 2-B  binary search down ─ with progress logs */
    let best = plan
    for (let i = 0; i < MAX_ITERS && hi - lo > 1; i++) {
      const mid  = Math.floor((lo + hi) / 2)
      const plan = await solve(mid)

      /* worst under/over for logging */
      const vals       = Object.values(plan.deficit)
      const worstShort = Math.max(0, ...vals.filter(v => v < 0).map(v => -v))
      const worstOver  = Math.max(0, ...vals.filter(v => v > 0))

      console.log(
        `[iter ${i}] cap=${mid}  used=${plan.headCnt}  ` +
        `under=${worstShort}  over=${worstOver}`
      )

      if (hasShort(plan.deficit)) {
        lo = mid           // too low
      } else {
        hi   = mid         // feasible
        best = plan
      }
    }

    console.log(
      '%c✔ BEST PLAN  heads=' + best.headCnt,
      'color:limegreen;font-weight:bold'
    )

    /* commit best */
    setFixedStaff(best.headCnt)
    setBlocks(best.solution)
    setBestStart(best.bestStart)
    setPersonSchedule(best.schedule)
  }

  /* ─── 3) Export to Excel (unchanged) ─────────────────────── */
  const exportExcel = () => {
    const rows = []
    Object.entries(personSchedule).forEach(([emp, arr]) =>
      arr.forEach(({ day, hour, breakHour }) => {
        rows.push({ Employee:emp, Date:day, StartHour:`${hour}:00`, Type:'Shift' })
        rows.push({ Employee:emp, Date:day, StartHour:`${breakHour}:00`, Type:'Lunch' })
      })
    )
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule')
    XLSX.writeFile(wb, 'staff-calendar.xlsx')
  }

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
            label="Forecast Start"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={p => <TextField {...p} size="small" />}
          />

          <FormControl sx={{ minWidth:120 }}>
            <InputLabel>Rotation (weeks)</InputLabel>
            <Select
              value={weeks}
              label="Rotation"
              onChange={e => setWeeks(+e.target.value)}
            >
              {[1,2,3,4,5].map(w => (
                <MenuItem key={w} value={w}>{w}</MenuItem>
              ))}
            </Select>
          </FormControl>

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
            value={sl*100}
            onChange={e => setSL(+e.target.value/100)}
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
            value={shrinkage*100}
            onChange={e => setShrinkage(+e.target.value/100)}
            size="small"
          />

          <Button variant="contained" onClick={calcForecast}>
            Calculate 6-Month Forecast
          </Button>
          <Button
            variant="contained"
            onClick={assignToStaff}
            disabled={!forecast.length}
            sx={{ ml:2 }}
          >
            Assign to Staff
          </Button>

          <FormControlLabel
            control={
              <Switch
                checked={useFixedStaff}
                onChange={e => setUseFixedStaff(e.target.checked)}
              />
            }
            label="Use Fixed Staff?"
          />
          {useFixedStaff && (
            <TextField
              label="Staff Cap"
              type="number"
              value={fixedStaff}
              onChange={e => setFixedStaff(+e.target.value)}
              size="small"
              sx={{ width:100 }}
            />
          )}
        </Box>

        {/* 1) Required Agents Heatmap */}
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
                {Array.from({ length:24 }, (_,h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const req = d.staffing.find(s => s.hour===h)?.requiredAgents||0
                      const alpha = maxReq ? (req/maxReq)*0.8+0.2 : 0.2
                      return (
                        <Tooltip key={d.date} title={`Req: ${req}`}>
                          <TableCell sx={{ backgroundColor:`rgba(33,150,243,${alpha})` }}>
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

        {/* 2) Scheduled Coverage Heatmap */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Scheduled Coverage Heatmap</Typography>
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
                {Array.from({ length:24 }, (_,h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const cov = scheduled[`${d.date}|${h}`]||0
                      const alpha = maxSch ? (cov/maxSch)*0.8+0.2 : 0.2
                      return (
                        <Tooltip key={d.date} title={`Cov: ${cov}`}>
                          <TableCell sx={{ backgroundColor:`rgba(76,175,80,${alpha})` }}>
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

        {/* 3) Under-/Over-Staffing Heatmap */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Under-/Over-Staffing Heatmap</Typography>
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
                {Array.from({ length:24 }, (_,h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const val = deficit[`${d.date}|${h}`]||0
                      const ratio = maxDef ? (Math.abs(val)/maxDef)*0.8+0.2 : 0.2
                      const col = val < 0
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

        {/* 4) Assigned Shift-Block Types */}
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

        {/* 5) 6-Month Rotating Calendar */}
        {Object.keys(personSchedule).length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>
              6-Month Staff Calendar (rotating every {weeks} weeks)
            </Typography>
            <Button variant="outlined" onClick={exportExcel} sx={{ mb:2 }}>
              Export to Excel
            </Button>
            <CalendarView scheduleByEmp={personSchedule} />
            <Box sx={{ mt:2, p:2, bgcolor:'#f9f9f9', borderRadius:1 }}>
              <Typography variant="subtitle1">
                {useFixedStaff
                  ? `Staff cap set to ${fixedStaff}.`
                  : `Full-coverage schedule uses ${Object.keys(personSchedule).length} staff.`}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}

// CalendarView (unchanged)
function CalendarView({ scheduleByEmp }) {
  const allDates = Array.from(
    new Set(Object.values(scheduleByEmp).flatMap(arr => arr.map(e => e.day)))
  ).sort()

  return (
    <Box sx={{ overflowX:'auto', border:'1px solid #ddd' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Employee</TableCell>
            {allDates.map(d=>(
              <TableCell key={d} sx={{ minWidth:80, textAlign:'center' }}>
                {dayjs(d).format('MM/DD')}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {Object.entries(scheduleByEmp).map(([emp,arr])=>{
            const mapDay = {}
            arr.forEach(({day,hour})=>{ mapDay[day] = hour })
            const color = '#' + ((emp * 1234567) % 0xffffff)
              .toString(16).padStart(6,'0')
            return (
              <TableRow key={emp}>
                <TableCell>Emp {emp}</TableCell>
                {allDates.map(d=>(
                  <TableCell key={d}
                    sx={{
                      backgroundColor: mapDay[d]!=null
                        ? color+'33'
                        : undefined,
                      textAlign:'center',
                      fontSize:12
                    }}
                  >
                    {mapDay[d]!=null ? `${mapDay[d]}:00` : ''}
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Box>
  )
}
