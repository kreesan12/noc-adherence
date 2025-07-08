// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState, useMemo } from 'react'
import {
  Box, TextField, Button, Typography,
  MenuItem, Select, InputLabel, FormControl,
  Table, TableHead, TableBody, TableRow, TableCell,
  Tooltip
} from '@mui/material'
import {
  LocalizationProvider,
  DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import api from '../api'
import moment from 'moment'
import * as XLSX from 'xlsx'
import Timeline from 'react-calendar-timeline'
import 'react-calendar-timeline/lib/Timeline.css'

export default function StaffingPage() {
  // ─── state ─────────────────────────────────────────────────────
  const [roles, setRoles]               = useState([])
  const [team, setTeam]                 = useState('')
  const [startDate, setStartDate]       = useState(dayjs())
  const [callAht, setCallAht]           = useState(300)
  const [ticketAht, setTicketAht]       = useState(240)
  const [sl, setSL]                     = useState(0.8)
  const [threshold, setThreshold]       = useState(20)
  const [shrinkage, setShrinkage]       = useState(0.3)
  const [weeks, setWeeks]               = useState(3)

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

  // ─── helper: Mon–Fri dates for N weeks ──────────────────────────
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

  // ─── build heatmap maps ─────────────────────────────────────────
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

  // ─── 1) Multi-day forecast ──────────────────────────────────────
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

  // ─── 2) Assign rotations over 6-month horizon ──────────────────
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

    // build flat “seats” list of block-indices
    const seats = []
    res.data.solution.forEach((b, idx) => {
      for (let i = 0; i < b.count; i++) seats.push(idx)
    })

    // rotate each emp through seats
    const scheduleByEmp = {}
    const horizonEnd = dayjs().add(6, 'month')

    for (let emp = 1; emp <= seats.length; emp++) {
      scheduleByEmp[emp] = []
      let cycle = 0
      while (true) {
        const seatIdx = (emp - 1 + cycle) % seats.length
        const block   = res.data.solution[ seats[seatIdx] ]
        const cycleStart = dayjs(block.startDate).add(cycle * weeks, 'week')
        if (cycleStart.isAfter(horizonEnd)) break

        getWorkDates(cycleStart.format('YYYY-MM-DD'), weeks)
          .forEach(day => scheduleByEmp[emp].push({
            day,
            hour: block.startHour
          }))

        cycle++
      }
    }
    setPersonSchedule(scheduleByEmp)
  }

  // ─── 3) Export to Excel ─────────────────────────────────────────
  const exportExcel = () => {
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

  // ─── 4) Gantt data ─────────────────────────────────────────────
  const [groups, items] = useMemo(() => {
    const gr = Object.keys(personSchedule).map(emp => ({
      id:   Number(emp),
      title:`Emp ${emp}`
    }))
    let itemId = 1
    const it = []
    Object.entries(personSchedule).forEach(([emp, arr]) => {
      arr.forEach(({ day, hour }) => {
        const start = moment(`${day} ${hour}`, 'YYYY-MM-DD H')
        const end   = start.clone().add(9, 'hour')
        it.push({
          id:         itemId++,
          group:      Number(emp),
          title:      `${hour}:00`,
          start_time: start,
          end_time:   end,
          itemProps:  { 'data-tooltip': `${day} @ ${hour}:00` }
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
            renderInput={p => <TextField {...p} size="small"/>}
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
          <Button
            variant="outlined"
            onClick={exportExcel}
            disabled={!Object.keys(personSchedule).length}
            sx={{ ml:2 }}
          >
            Export to Excel
          </Button>
        </Box>

        {/* (…heatmaps and blocks table as before…) */}

        {/* Gantt */}
        {groups.length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>
              Staff Gantt Calendar
            </Typography>
            <Timeline
              groups={groups}
              items={items}
              defaultTimeStart={moment(startDate.format('YYYY-MM-DD'))}
              defaultTimeEnd={moment(startDate.add(weeks, 'week').format('YYYY-MM-DD'))}
              canMove={false}
              canResize={false}
              itemTouchSendsClick
              itemRenderer={({ item, style }) => (
                <div
                  style={{ ...style, background: '#1976d2', borderRadius: 4, padding: '2px 4px' }}
                  title={item.itemProps['data-tooltip']}
                >
                  {item.title}
                </div>
              )}
            />
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}
