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
  // ─── Constants ───────────────────────────────────────────────
  const HORIZON_MONTHS = 6    // span for required-agent forecast
  const SHIFT_LENGTH   = 9    // hours per shift

  // ─── State ───────────────────────────────────────────────────
  const [roles, setRoles]               = useState([])
  const [team, setTeam]                 = useState('')
  const [startDate, setStartDate]       = useState(dayjs())
  const [callAht, setCallAht]           = useState(300)
  const [ticketAht, setTicketAht]       = useState(240)
  const [sl, setSL]                     = useState(0.8)
  const [threshold, setThreshold]       = useState(20)
  const [shrinkage, setShrinkage]       = useState(0.3)
  const [weeks, setWeeks]               = useState(3)

  const [forecast, setForecast]           = useState([])
  const [blocks, setBlocks]               = useState([])
  const [bestStartHours, setBestStart]    = useState([])
  const [personSchedule, setPersonSchedule] = useState({})
  const [useFixedStaff, setUseFixedStaff] = useState(false)
  const [fixedStaff,    setFixedStaff]    = useState(0)

  // ─── Load roles ───────────────────────────────────────────────
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // ─── Helper: N-week × 5-day blocks ────────────────────────────
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

  // ─── Build heatmap data from personSchedule & forecast ─────────
  const { scheduled, deficit, maxReq, maxSch, maxDef } = useMemo(() => {
    // 1) build required-agents map
    const reqMap = {}
    forecast.forEach(d => {
      d.staffing.forEach(({ hour, requiredAgents }) => {
        reqMap[`${d.date}|${hour}`] = requiredAgents
      })
    })

    // 2) build scheduled coverage from personSchedule
    const schedMap = {}
    Object.values(personSchedule).forEach(arr => {
      arr.forEach(({ day, hour, breakHour }) => {
        for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
          if (h === breakHour) continue   // skip lunch hour
          const key = `${day}|${h}`
          schedMap[key] = (schedMap[key] || 0) + 1
        }
      })
    })

    // 3) compute deficit = scheduled - required
    const defMap = {}
    const allKeys = new Set([...Object.keys(reqMap), ...Object.keys(schedMap)])
    allKeys.forEach(key => {
      defMap[key] = (schedMap[key] || 0) - (reqMap[key] || 0)
    })

    // 4) compute max values for color scaling
    const allReq = Object.values(reqMap)
    const allSch = Object.values(schedMap)
    const allDef = Object.values(defMap).map(v => Math.abs(v))

    return {
      scheduled: schedMap,
      deficit:   defMap,
      maxReq:    allReq.length ? Math.max(...allReq) : 0,
      maxSch:    allSch.length ? Math.max(...allSch) : 0,
      maxDef:    allDef.length ? Math.max(...allDef) : 0,
    }
  }, [personSchedule, forecast])

  // ─── Helper: measure worst under/over staffing ───────────────
  function measureDeficit(defMap) {
    const values = Object.values(defMap)
    const worstShort = Math.max(0, ...values.filter(v => v < 0).map(v => -v))
    const worstOver  = Math.max(0, ...values.filter(v => v > 0))
    return { worstShort, worstOver }
  }

  // ─── 1) 6-month required-agent forecast ───────────────────────
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD')
    const end   = startDate
      .add(HORIZON_MONTHS, 'month')
      .subtract(1, 'day')
      .format('YYYY-MM-DD')

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
    // reset any prior cap
    setUseFixedStaff(false)
    setFixedStaff(0)
  }

  // ─── 2) Assign + auto-refine staff cap ────────────────────────
  const assignToStaff = async () => {
    if (!forecast.length) return alert('Run Forecast first')

    // ensure fixed-staff mode on
    setUseFixedStaff(true)
    let cap = fixedStaff || 0
    setFixedStaff(cap)

    // iterate until deficits and overs zero out (or max 5 loops)
    let iteration = 0
    let worstShort = Infinity, worstOver = Infinity
    let finalBlocks = []
    let finalSchedule = {}

    while (iteration < 5) {
      iteration++

      // call solver with current cap
      const res = await api.post('/erlang/staff/schedule', {
        staffing:    forecast,
        weeks,
        shiftLength: SHIFT_LENGTH,
        topN:        5,
        maxStaff:    cap,
      })
      const solution = res.data.solution
      finalBlocks = solution
      setBestStart(res.data.bestStartHours)
      setBlocks(solution)

      // build personSchedule based on solution
      const reqMap = {}
      forecast.forEach(d =>
        d.staffing.forEach(({ hour, requiredAgents }) =>
          (reqMap[`${d.date}|${hour}`] = requiredAgents)
        )
      )

      const schedByEmp = {}
      // total slots
      const totalEmp = solution.reduce((sum,b) => sum + b.count, 0)
      const queue = Array.from({ length: totalEmp }, (_, i) => i+1)
      queue.forEach(id => schedByEmp[id] = [])

      const horizonEnd = dayjs(startDate).add(HORIZON_MONTHS, 'month')
      const cycles = Math.ceil(
        horizonEnd.diff(startDate, 'day') + 1
        / (weeks * 7)
      )

      // assign cycles
      const blockTypes = [...solution].sort((a,b)=>
        a.patternIndex - b.patternIndex || a.startHour - b.startHour
      )

      for (let ci = 0; ci < cycles; ci++) {
        let offset = 0
        blockTypes.forEach(b => {
          const group = queue.slice(offset, offset + b.count)
          group.forEach(empId => {
            getWorkDates(b.startDate, weeks).forEach(dtStr => {
              const d = dayjs(dtStr).add(ci * weeks * 7, 'day')
              if (d.isSameOrBefore(horizonEnd,'day')) {
                const date = d.format('YYYY-MM-DD')
                // find break hour
                let breakHour = null
                for (let off = 1; off <= 5; off++) {
                  const h = b.startHour + off
                  const key = `${date}|${h}`
                  // simple check using reqMap (not actual coverage)
                  if ((reqMap[key]||0) >= 0) { breakHour = h; break }
                }
                if (breakHour===null) {
                  breakHour = b.startHour + Math.floor(b.length/2)
                }
                schedByEmp[empId].push({
                  day, hour: b.startHour, breakHour
                })
              }
            })
          })
          offset += b.count
        })
        queue.unshift(queue.pop())
      }

      // compute deficit for this schedule
      const schedMap = {}
      Object.values(schedByEmp).forEach(arr =>
        arr.forEach(({day,hour,breakHour}) => {
          for (let h = hour; h < hour + SHIFT_LENGTH; h++) {
            if (h === breakHour) continue
            const key = `${day}|${h}`
            schedMap[key] = (schedMap[key] || 0) + 1
          }
        })
      )
      const defMap = {}
      const allKeys = new Set([
        ...Object.keys(reqMap),
        ...Object.keys(schedMap)
      ])
      allKeys.forEach(k => {
        defMap[k] = (schedMap[k]||0) - (reqMap[k]||0)
      })

      // measure worst under/over
      const measured = measureDeficit(defMap)
      worstShort = measured.worstShort
      worstOver  = measured.worstOver

      // done if perfect
      if (worstShort === 0 && worstOver === 0) {
        finalSchedule = schedByEmp
        break
      }

      // adjust cap
      cap = Math.max(0, cap + worstShort - worstOver)
      setFixedStaff(cap)
      finalSchedule = schedByEmp
    }

    // set final schedule
    setPersonSchedule(finalSchedule)
  }

  // ─── 3) Export to Excel ───────────────────────────────────────
  const exportExcel = () => {
    const rows = []
    Object.entries(personSchedule).forEach(([emp, arr]) => {
      arr.forEach(({ day, hour, breakHour }) => {
        rows.push({
          Employee:  emp,
          Date:      day,
          StartHour: `${hour}:00`,
          Type:      'Shift',
        })
        if (breakHour != null) {
          rows.push({
            Employee:  emp,
            Date:      day,
            StartHour: `${breakHour}:00`,
            Type:      'Lunch Break',
          })
        }
      })
    })
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

        {/* ─── Controls ───────────────────────────────────────────── */}
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

        {/* ─── 1) Required Agents Heatmap ───────────────────────── */}
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
                      const req = d.staffing.find(s => s.hour === h)?.requiredAgents || 0
                      const alpha = maxReq ? (req / maxReq) * 0.8 + 0.2 : 0.2
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

        {/* ─── 2) Scheduled Coverage Heatmap ──────────────────────── */}
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
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const cov = scheduled[`${d.date}|${h}`] || 0
                      const alpha = maxSch ? (cov / maxSch) * 0.8 + 0.2 : 0.2
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

        {/* ─── 3) Under-/Over-Staffing Heatmap ────────────────────── */}
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
                {Array.from({ length: 24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const val   = deficit[`${d.date}|${h}`] || 0
                      const ratio = maxDef ? (Math.abs(val) / maxDef) * 0.8 + 0.2 : 0.2
                      const col   = val < 0
                        ? `rgba(244,67,54,${ratio})`
                        : `rgba(76,175,80,${ratio})`
                      return (
                        <Tooltip key={d.date} title={`Deficit: ${val}`}>
                          <TableCell sx={{ backgroundColor: col }}>{val}</TableCell>
                        </Tooltip>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── 4) Assigned Shift-Block Types ──────────────────────── */}
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

        {/* ─── 5) 6-Month Rotating Calendar ───────────────────────── */}
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
                  ? `Staff cap set to ${fixedStaff}. Coverage generated across ${weeks}-week cycles.`
                  : `Full-coverage schedule uses ${Object.keys(personSchedule).length} staff.`}
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}

/** CalendarView: day-by-day grid with start-hour text */
function CalendarView({ scheduleByEmp }) {
  const allDates = Array.from(
    new Set(Object.values(scheduleByEmp)
      .flatMap(arr => arr.map(e => e.day)))
  ).sort()

  return (
    <Box sx={{ overflowX:'auto', border:'1px solid #ddd' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Employee</TableCell>
            {allDates.map(d => (
              <TableCell key={d} sx={{ minWidth:80, textAlign:'center' }}>
                {dayjs(d).format('MM/DD')}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {Object.entries(scheduleByEmp).map(([emp, arr]) => {
            const mapDay = {}
            arr.forEach(({day,hour}) => { mapDay[day] = hour })
            const color = '#' + ((emp * 1234567) % 0xffffff)
              .toString(16).padStart(6,'0')
            return (
              <TableRow key={emp}>
                <TableCell>Emp {emp}</TableCell>
                {allDates.map(d => (
                  <TableCell
                    key={d}
                    sx={{
                      backgroundColor: mapDay[d]!=null ? color+'33' : undefined,
                      textAlign: 'center',
                      fontSize: 12
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
