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
import * as XLSX from 'xlsx'

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

  // ─── helper: get the 5-on days × weeks from a start date ───────
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

  // ─── build heatmap lookups ───────────────────────────────────
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

  // ─── 1) multi-day forecast ───────────────────────────────────
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

  // ─── 2) assign & build 6-month rotating schedule ─────────────
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

    // 1) sort block-types by weekday then startHour
    const blockTypes = [...res.data.solution].sort((a,b) => {
      const da = dayjs(a.startDate).day(), db = dayjs(b.startDate).day()
      if (da !== db) return da - db
      return a.startHour - b.startHour
    })

    // 2) total employees
    const totalEmp = blockTypes.reduce((sum,b)=>sum+b.count,0)

    // 3) init queue [1…N]
    let queue = Array.from({length: totalEmp}, (_,i)=>i+1)

    // 4) init sched map
    const schedByEmp = {}
    queue.forEach(id=>schedByEmp[id]=[])

    // 5) horizon = six months from forecast start
    const horizonEnd = dayjs(startDate).add(6,'month')

    // 6) cycle through until beyond horizon
    let cycle = 0
    while (true) {
      let offset = 0
      blockTypes.forEach(b => {
        const group = queue.slice(offset, offset + b.count)
        group.forEach(empId => {
          getWorkDates(b.startDate, weeks)
            .map(dt => dayjs(dt).add(cycle * weeks * 7, 'day'))
            .filter(d => d.isSameOrBefore(horizonEnd,'day'))
            .forEach(d => {
              schedByEmp[empId].push({
                day:  d.format('YYYY-MM-DD'),
                hour: b.startHour
              })
            })
        })
        offset += b.count
      })

      // prepare next cycle
      cycle++
      const firstDate = getWorkDates(blockTypes[0].startDate, weeks)[0]
      const nextFirst = dayjs(firstDate).add(cycle * weeks * 7, 'day')
      if (nextFirst.isAfter(horizonEnd,'day')) break

      // rotate forward one
      queue.unshift(queue.pop())
    }

    console.log('Built 6-month schedule:', schedByEmp)
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
          {/* … same controls as before … */}
        </Box>

        {/* 1) Required Agents Heatmap */}
        {forecast.length > 0 && ( /* … */ )}

        {/* 2) Scheduled Coverage Heatmap */}
        {blocks.length > 0 && ( /* … */ )}

        {/* 3) Under-/Over-Staffing Heatmap */}
        {blocks.length > 0 && ( /* … */ )}

        {/* 4) Assigned Shift-Block Types */}
        {blocks.length > 0 && ( /* … */ )}

        {/* 5) 6-Month Rotating Calendar */}
        {blocks.length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>
              6-Month Staff Calendar (rotating every {weeks} weeks)
            </Typography>
            <Button
              variant="outlined"
              onClick={exportExcel}
              sx={{ mb:2 }}
            >
              Export to Excel
            </Button>
            <CalendarView scheduleByEmp={personSchedule}/>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}

/** CalendarView: day-by-day grid with start-hour text */
function CalendarView({ scheduleByEmp }) {
  const allDates = Array.from(new Set(
    Object.values(scheduleByEmp).flatMap(arr => arr.map(e=>e.day))
  )).sort()

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
          {Object.entries(scheduleByEmp).map(([emp, arr]) => {
            const mapDay = {}
            arr.forEach(({day, hour}) => mapDay[day] = hour)
            const color = '#' + ((emp * 1234567) % 0xffffff)
              .toString(16).padStart(6,'0')
            return (
              <TableRow key={emp}>
                <TableCell>Emp {emp}</TableCell>
                {allDates.map(d=>(
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
