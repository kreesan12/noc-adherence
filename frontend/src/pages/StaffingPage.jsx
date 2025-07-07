// frontend/src/pages/StaffingPage.jsx
import { useEffect, useState } from 'react'
import {
  Box, TextField, Button, Typography, MenuItem, Select, InputLabel, FormControl
} from '@mui/material'
import {
  LocalizationProvider, DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend
} from 'recharts'
import api from '../api'
import dayjs from 'dayjs'

export default function StaffingPage() {
  const [roles, setRoles]           = useState([])
  const [team, setTeam]             = useState('')
  const [startDate, setStartDate]   = useState(dayjs())
  const [endDate, setEndDate]       = useState(dayjs())
  const [callAht, setCallAht]       = useState(300)
  const [ticketAht, setTicketAht]   = useState(600)
  const [sl, setSL]                 = useState(0.8)
  const [threshold, setThreshold]   = useState(20)
  const [shrinkage, setShrinkage]   = useState(0.3)

  const [forecast, setForecast]     = useState([]) // [{ date, staffing: [...] }]
  const [shifts, setShifts]         = useState([]) // [{ startHour, length }]

  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  const calcForecast = async () => {
    const params = {
      role:               team,
      start:              startDate.format('YYYY-MM-DD'),
      end:                endDate.format('YYYY-MM-DD'),
      callAhtSeconds:     callAht,
      ticketAhtSeconds:   ticketAht,
      serviceLevel:       sl,
      thresholdSeconds:   threshold,
      shrinkage
    }
    const res = await api.post('/erlang/staff/bulk-range', params)
    setForecast(res.data)
    setShifts([])
  }

  const calcSchedule = async () => {
    // flatten all days into one 24*h array or just pick one day
    const allHours = forecast.flatMap(d => d.staffing)
    const res      = await api.post('/erlang/staff/schedule', {
      staffing:    allHours,
      shiftLength: 8
    })
    setShifts(res.data)
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>Staffing</Typography>

        {/* controls */}
        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, my:2 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select
              value={team}
              label='Team'
              onChange={e => setTeam(e.target.value)}
            >
              {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>

          <DatePicker
            label='Start Date'
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={params => <TextField {...params} size='small' />}
          />
          <DatePicker
            label='End Date'
            value={endDate}
            onChange={d => d && setEndDate(d)}
            renderInput={params => <TextField {...params} size='small' />}
          />

          <TextField
            label='Call AHT (sec)'
            type='number'
            value={callAht}
            onChange={e => setCallAht(+e.target.value)}
          />
          <TextField
            label='Ticket AHT (sec)'
            type='number'
            value={ticketAht}
            onChange={e => setTicketAht(+e.target.value)}
          />
          <TextField
            label='Service Level %'
            type='number'
            value={sl * 100}
            onChange={e => setSL(+e.target.value / 100)}
          />
          <TextField
            label='Threshold (sec)'
            type='number'
            value={threshold}
            onChange={e => setThreshold(+e.target.value)}
          />
          <TextField
            label='Shrinkage %'
            type='number'
            value={shrinkage * 100}
            onChange={e => setShrinkage(+e.target.value / 100)}
          />

          <Button variant='contained' onClick={calcForecast}>
            Calculate Forecast
          </Button>
          <Button
            variant='outlined'
            disabled={!forecast.length}
            onClick={calcSchedule}
          >
            Generate Shifts
          </Button>
        </Box>

        {/* multi-day charts */}
        {forecast.map(day => (
          <Box key={day.date} sx={{ mb:4 }}>
            <Typography variant='h6'>{day.date}</Typography>
            <ResponsiveContainer width='100%' height={200}>
              <BarChart data={day.staffing}>
                <CartesianGrid strokeDasharray='3 3' />
                <XAxis dataKey='hour' />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey='requiredAgents' name='Agents Needed' />
              </BarChart>
            </ResponsiveContainer>
          </Box>
        ))}

        {/* shift blocks */}
        {shifts.length > 0 && (
          <Box sx={{ mt:4 }}>
            <Typography variant='h6'>Shift Blocks</Typography>
            {shifts.map((s,i) => (
              <Typography key={i}>
                Start {s.startHour}:00 for {s.length} hours
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}
