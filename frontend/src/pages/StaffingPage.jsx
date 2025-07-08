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
import api from '../api'
import * as XLSX from 'xlsx'

import dayjs from 'dayjs'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
// **MUST** extend *before* any dayjs().isSameOrBefore() calls!
dayjs.extend(isSameOrBefore)

export default function StaffingPage() {
  // ─── state ───────────────────────────────────────────────────
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

  // ─── load roles ───────────────────────────────────────────────
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // ─── helper: 5-day × N-week block dates ────────────────────────
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

  // ─── heatmap lookups ─────────────────────────────────────────
  const { scheduled, deficit, maxReq, maxSch, maxDef } = useMemo(() => {
    const sched = {}
    blocks.forEach(b => {
      getWorkDates(b.startDate, weeks).forEach(date => {
        for (let h = b.startHour; h < b.startHour + b.length; h++) {
          const key = `${date}|${h}`
          sched[key] = (sched[key]||0) + b.count
        }
      })
    })

    const def = {}
    forecast.forEach(d => {
      d.staffing.forEach(({ hour, requiredAgents }) => {
        const key = `${d.date}|${hour}`
        def[key] = (sched[key]||0) - requiredAgents
      })
    })

    const rMax = Math.max(0, ...forecast.flatMap(d => d.staffing.map(s => s.requiredAgents)))
    const sMax = Math.max(0, ...Object.values(sched))
    const dMax = Math.max(0, ...Object.values(def).map(v => Math.abs(v)))
    return { scheduled: sched, deficit: def, maxReq: rMax, maxSch: sMax, maxDef: dMax }
  }, [blocks, forecast, weeks])

  // ─── 1) forecast ──────────────────────────────────────────────
  const calcForecast = async () => {
    const start = startDate.format('YYYY-MM-DD')
    const end   = startDate.add(weeks, 'week').subtract(1, 'day').format('YYYY-MM-DD')
    const res = await api.post('/erlang/staff/bulk-range', {
      role: team, start, end,
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

  // ─── 2) assign + build 6-month rotating schedule ─────────────
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

    // sort block-types by weekday then hour
    const blockTypes = [...res.data.solution].sort((a,b) => {
      const da = dayjs(a.startDate).day(), db = dayjs(b.startDate).day()
      if (da !== db) return da - db
      return a.startHour - b.startHour
    })

    // total staff slots
    const totalEmp = blockTypes.reduce((sum,b)=>sum+b.count,0)
    const initialQueue = Array.from({ length: totalEmp }, (_,i)=>i+1)
    const schedByEmp = {}
    initialQueue.forEach(id=>schedByEmp[id]=[])

    const horizonEnd = dayjs(startDate).add(6,'month')
    const totalDays  = horizonEnd.diff(startDate,'day') + 1
    const cycles     = Math.ceil(totalDays / (weeks * 7))

    for (let cycleIdx = 0; cycleIdx < cycles; cycleIdx++) {
      // rotate forward by cycleIdx
      const rotated = initialQueue
        .slice(cycleIdx % totalEmp)
        .concat(initialQueue.slice(0, cycleIdx % totalEmp))

      let offset = 0
      blockTypes.forEach(b => {
        const group = rotated.slice(offset, offset + b.count)
        group.forEach(empId => {
          getWorkDates(b.startDate, weeks).forEach(dt => {
            const d = dayjs(dt).add(cycleIdx * weeks * 7, 'day')
            if (d.isSameOrBefore(horizonEnd, 'day')) {
              schedByEmp[empId].push({
                day:  d.format('YYYY-MM-DD'),
                hour: b.startHour
              })
            }
          })
        })
        offset += b.count
      })
    }

    console.log('🔄 schedByEmp:', schedByEmp)
    setPersonSchedule(schedByEmp)
  }

  // ─── 3) export to Excel ───────────────────────────────────────
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

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Scheduling
        </Typography>

        {/* Controls */}
        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, mb:4 }}>
          {/* team, start date, rotation weeks, AHT, etc. */}
          {/* … your controls as before … */}
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

        {/* 1) Required Agents Heatmap */}
        {/* … */}

        {/* 2) Scheduled Coverage Heatmap */}
        {/* … */}

        {/* 3) Under-/Over-Staffing Heatmap */}
        {/* … */}

        {/* 4) Assigned Shift-Block Types */}
        {/* … */}

        {/* 5) 6-Month Rotating Calendar */}
        {Object.keys(personSchedule).length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>
              6-Month Staff Calendar (rotating every {weeks} weeks)
            </Typography>
            <Button variant="outlined" onClick={exportExcel} sx={{ mb:2 }}>
              Export to Excel
            </Button>

            {/* DEBUG DUMP */}
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                maxHeight: 200,
                overflow: 'auto',
                background: '#f7f7f7',
                padding: 8,
                border: '1px solid #ddd',
                marginBottom: 16
              }}
            >
              {JSON.stringify(personSchedule, null, 2)}
            </pre>

            <CalendarView scheduleByEmp={personSchedule}/>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}

/** CalendarView: day-by-day grid with start-hour text */
function CalendarView({ scheduleByEmp }) {
  const allDates = Array.from(
    new Set(Object.values(scheduleByEmp).flatMap(arr => arr.map(e=>e.day)))
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
          {Object.entries(scheduleByEmp).map(([emp, arr])=>{
            const mapDay = {}
            arr.forEach(({day, hour}) => { mapDay[day] = hour })
            const color = '#' + ((emp*1234567) % 0xffffff)
              .toString(16).padStart(6,'0')
            return (
              <TableRow key={emp}>
                <TableCell>Emp {emp}</TableCell>
                {allDates.map(d=>(
                  <TableCell
                    key={d}
                    sx={{
                      backgroundColor: mapDay[d]!=null ? color+'33' : undefined,
                      textAlign:'center', fontSize:12
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
