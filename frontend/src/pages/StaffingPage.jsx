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

  // ─── Build heatmap data ───────────────────────────────────────
  const { scheduled, deficit, maxReq, maxSch, maxDef } = useMemo(() => {
    // 1) build required-agents map
    const reqMap = {}
    forecast.forEach(d => {
      d.staffing.forEach(({ hour, requiredAgents }) => {
        reqMap[`${d.date}|${hour}`] = requiredAgents
      })
    })

    // 2) initial scheduled coverage
    const schedMap = {}
    blocks.forEach(b => {
      getWorkDates(b.startDate, weeks).forEach(date => {
        for (let h = b.startHour; h < b.startHour + b.length; h++) {
          const key = `${date}|${h}`
          schedMap[key] = (schedMap[key] || 0) + b.count
        }
      })
    })

    // 3) deduct lunch breaks per block
    const adjusted = { ...schedMap }
    blocks.forEach(b => {
      getWorkDates(b.startDate, weeks).forEach(date => {
        let breakHour = null
        for (let offset = 1; offset <= 5; offset++) {
          const h = b.startHour + offset
          const key = `${date}|${h}`
          if ((adjusted[key] || 0) - b.count >= (reqMap[key] || 0)) {
            breakHour = h
            break
          }
        }
        if (breakHour === null) {
          breakHour = b.startHour + Math.floor(b.length / 2)
        }
        const bkKey = `${date}|${breakHour}`
        adjusted[bkKey] = (adjusted[bkKey] || 0) - b.count
      })
    })

    // 4) recompute deficit
    const defMap = {}
    Object.entries(adjusted).forEach(([key, val]) => {
      defMap[key] = val - (reqMap[key] || 0)
    })

    // 5) compute max values
    const allReq = Object.values(reqMap)
    const allSch = Object.values(adjusted)
    const allDef = Object.values(defMap).map(v => Math.abs(v))
    return {
      scheduled: adjusted,
      deficit:   defMap,
      maxReq:    allReq.length ? Math.max(...allReq) : 0,
      maxSch:    allSch.length ? Math.max(...allSch) : 0,
      maxDef:    allDef.length ? Math.max(...allDef) : 0,
    }
  }, [blocks, forecast, weeks])

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
  }

  // ─── 2) Assign + build 6-month rotating schedule ─────────────
  const assignToStaff = async () => {
    if (!forecast.length) return alert('Run Forecast first')
    const res = await api.post('/erlang/staff/schedule', {
      staffing:    forecast,
      weeks,
      shiftLength: 9,
      topN:        5,
      ...(useFixedStaff ? { maxStaff: fixedStaff } : {})
    })
    setBestStart(res.data.bestStartHours)
    setBlocks(res.data.solution)

    // build maps for assignment break logic
    const reqMap = {}
    forecast.forEach(d => {
      d.staffing.forEach(({ hour, requiredAgents }) => {
        reqMap[`${d.date}|${hour}`] = requiredAgents
      })
    })
    const schedMap = {}
    res.data.solution.forEach(b => {
      getWorkDates(b.startDate, weeks).forEach(date => {
        for (let h = b.startHour; h < b.startHour + b.length; h++) {
          const key = `${date}|${h}`
          schedMap[key] = (schedMap[key] || 0) + b.count
        }
      })
    })

    // sort, queue, and build personSchedule with breakHour
    const blockTypes = [...res.data.solution].sort((a, b) =>
      a.patternIndex - b.patternIndex || a.startHour - b.startHour
    )
    const totalEmp = blockTypes.reduce((sum, b) => sum + b.count, 0)
    const queue = Array.from({ length: totalEmp }, (_, i) => i + 1)
    const schedByEmp = {}
    queue.forEach(id => schedByEmp[id] = [])

    const horizonEnd = dayjs(startDate).add(HORIZON_MONTHS, 'month')
    const cycles = Math.ceil(
      horizonEnd.diff(startDate, 'day') + 1
      / (weeks * 7)
    )

    for (let cycleIdx = 0; cycleIdx < cycles; cycleIdx++) {
      let offset = 0
      blockTypes.forEach(b => {
        const group = queue.slice(offset, offset + b.count)
        group.forEach(empId => {
          getWorkDates(b.startDate, weeks).forEach(dtStr => {
            const d = dayjs(dtStr).add(cycleIdx * weeks * 7, 'day')
            if (d.isSameOrBefore(horizonEnd, 'day')) {
              const date = d.format('YYYY-MM-DD')
              let breakHour = null
              for (let off = 1; off <= 5; off++) {
                const h = b.startHour + off
                const key = `${date}|${h}`
                if ((schedMap[key] || 0) - 1 >= (reqMap[key] || 0)) {
                  breakHour = h
                  break
                }
              }
              if (breakHour === null) {
                breakHour = b.startHour + Math.floor(b.length / 2)
              }
              schedByEmp[empId].push({
                day:        date,
                hour:       b.startHour,
                breakHour,
              })
            }
          })
        })
        offset += b.count
      })
      queue.unshift(queue.pop())
    }

    setPersonSchedule(schedByEmp)
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

        {/* 1) Required Agents Heatmap */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">
              Required Agents Heatmap (6-Month)
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

        {/* 2) Scheduled Coverage Heatmap */}
        {blocks.length > 0 && (
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
                        <Tooltip key={d.date} title={`Sch: ${cov}`}>
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
        {blocks.length > 0 && (
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
                {blocks.map((b, i) => (
                  <TableRow key={i}>
                    <TableCell>{i + 1}</TableCell>
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
            arr.forEach(({ day, hour }) => { mapDay[day] = hour })
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
