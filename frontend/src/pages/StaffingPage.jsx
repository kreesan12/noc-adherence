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
import dayjs from 'dayjs'
import api from '../api'
import * as XLSX from 'xlsx'

export default function StaffingPage() {
  // ─── state ─────────────────────────────────────────────────────
  const [roles, setRoles]         = useState([])
  const [team, setTeam]           = useState('')
  const [startDate, setStartDate] = useState(dayjs())
  const [callAht, setCallAht]     = useState(300)
  const [ticketAht, setTicketAht] = useState(600)
  const [sl, setSL]               = useState(0.75)
  const [threshold, setThreshold] = useState(20)
  const [shrinkage, setShrinkage] = useState(0.3)
  const [weeks, setWeeks]         = useState(3)    // later make 1–5

  const [forecast, setForecast]           = useState([])
  const [blocks, setBlocks]               = useState([])
  const [bestStartHours, setBestStart]    = useState([])
  const [personSchedule, setPersonSchedule] = useState([])

  // ─── load roles ─────────────────────────────────────────────────
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

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
    setPersonSchedule([])
    setBestStart([])
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

    // ─ build per-person schedule ───────────────────────────────
    // round-robin assign each block’s `count` slots to “employees” 1…N
    const assignments = []
    let empIdx = 1
    res.data.solution.forEach(b => {
      for (let i = 0; i < b.count; i++) {
        assignments.push({ employee: empIdx, ...b })
        empIdx += 1
      }
    })
    // for each employee, collect all dates they work
    const scheduleByEmp = {}
    assignments.forEach(({ employee, startDate, startHour, length }) => {
      const dates = []
      for (let w = 0; w < weeks; w++) {
        const base = dayjs(startDate).add(w * 7, 'day')
        for (let d = 0; d < 5; d++) {
          const day = base.add(d, 'day').format('YYYY-MM-DD')
          dates.push({ day, hour: startHour })
        }
      }
      scheduleByEmp[employee] = (scheduleByEmp[employee]||[]).concat(dates)
    })
    setPersonSchedule(scheduleByEmp)
  }

  // ─── export to Excel ────────────────────────────────────────────
  const exportExcel = () => {
    // flatten personSchedule to rows { Employee, Date, StartHour }
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

        {/* ─── Controls ─────────────────────────────────────────────── */}
        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, mb:4 }}>
          {/* Team */}
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team" onChange={e=>setTeam(e.target.value)}>
              {roles.map(r=> <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>

          {/* Forecast start */}
          <DatePicker
            label="Forecast Start"
            value={startDate}
            onChange={d=>d&&setStartDate(d)}
            renderInput={p=><TextField {...p} size="small"/>}
          />

          {/* Rotation length */}
          <FormControl sx={{ minWidth:120 }}>
            <InputLabel>Rotation (weeks)</InputLabel>
            <Select
              value={weeks}
              label="Rotation"
              onChange={e=>setWeeks(+e.target.value)}
            >
              {[1,2,3,4,5].map(w=>
                <MenuItem key={w} value={w}>{w}</MenuItem>
              )}
            </Select>
          </FormControl>

          {/* AHTs & SL */}
          <TextField
            label="Call AHT (sec)"
            type="number"
            value={callAht}
            onChange={e=>setCallAht(+e.target.value)}
            size="small"
          />
          <TextField
            label="Ticket AHT (sec)"
            type="number"
            value={ticketAht}
            onChange={e=>setTicketAht(+e.target.value)}
            size="small"
          />
          <TextField
            label="Service Level %"
            type="number"
            value={sl*100}
            onChange={e=>setSL(+e.target.value/100)}
            size="small"
          />
          <TextField
            label="Threshold (sec)"
            type="number"
            value={threshold}
            onChange={e=>setThreshold(+e.target.value)}
            size="small"
          />
          <TextField
            label="Shrinkage %"
            type="number"
            value={shrinkage*100}
            onChange={e=>setShrinkage(+e.target.value/100)}
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

        {/* ─── Your heatmaps & Assigned blocks tables here ─────────── */}

        {/* ─── Per-employee calendar ─────────────────────────────────── */}
        {Object.keys(personSchedule).length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant="h6" gutterBottom>
              Staff Calendar (click “Export to Excel” to share)
            </Typography>
            <CalendarView scheduleByEmp={personSchedule} />
            <Button 
              variant="outlined" 
              onClick={exportExcel} 
              sx={{ mt:2 }}
            >
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
 * — renders a day-by-day horizontal scrollable grid.
 * Props:
 *   scheduleByEmp: { [empId]: [ { day: 'YYYY-MM-DD', hour } ] }
 */
function CalendarView({ scheduleByEmp }) {
  // collect all dates across all employees
  const allDates = Array.from(new Set(
    Object.values(scheduleByEmp)
      .flatMap(arr => arr.map(e=>e.day))
  )).sort()

  return (
    <Box sx={{ overflowX: 'auto', border: '1px solid #ddd' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Employee</TableCell>
            {allDates.map(d=>(
              <TableCell key={d} sx={{ minWidth: 80, textAlign:'center' }}>
                {dayjs(d).format('MM/DD')}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {Object.entries(scheduleByEmp).map(([emp, arr])=> {
            const set = new Set(arr.map(e=>e.day))
            const color = '#' + ((emp * 1234567) % 0xffffff).toString(16).padStart(6,'0')
            return (
              <TableRow key={emp}>
                <TableCell>Emp {emp}</TableCell>
                {allDates.map(d=>(
                  <TableCell 
                    key={d}
                    sx={{
                      backgroundColor: set.has(d)? color+'33' : undefined
                    }}
                  >
                    {set.has(d) ? '●' : ''}
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
