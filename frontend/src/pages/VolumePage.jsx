// frontend/src/pages/VolumePage.jsx
import { useEffect, useState } from 'react'
import Papa                     from 'papaparse'
import {
  Box, Button, MenuItem, Select, InputLabel, FormControl, Typography,
  TextField, FormControlLabel, Switch
} from '@mui/material'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend
} from 'recharts'
import {
  LocalizationProvider,
  DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs            from 'dayjs'
import api              from '../api'

export default function VolumePage() {
  /* ─── State ──────────────────────────────────────────────── */
  const [roles,        setRoles]        = useState([])
  const [team,         setTeam]         = useState('')
  const [startDate,    setStartDate]    = useState(dayjs().subtract(6, 'month'))
  const [endDate,      setEndDate]      = useState(dayjs())
  const [lookBack,     setLookBack]     = useState(6)   // months of history
  const [horizon,      setHorizon]      = useState(6)   // months to project
  const [overwrite,    setOverwrite]    = useState(false)

  const [dailyData,    setDailyData]    = useState([])
  const [hourlyData,   setHourlyData]   = useState([])
  const [selectedDate, setSelectedDate] = useState(null)

  /* ─── 1) load roles once ─────────────────────────────────── */
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  /* ─── 2) load daily volume whenever filters change ───────── */
  useEffect(() => {
    if (!team) return
    fetchDaily()
      .then(setDailyData)
      .catch(console.error)
  }, [team, startDate, endDate])

  async function fetchDaily() {
    const { data } = await api.get('/reports/volume', {
      params: {
        role:  team,
        start: startDate.format('YYYY-MM-DD'),
        end:   endDate  .format('YYYY-MM-DD')
      }
    })
    // reset the hourly chart
    setSelectedDate(null)
    setHourlyData(Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      forecastCalls:   0,
      actualCalls:     0,
      forecastTickets: 0,
      actualTickets:   0
    })))
    return data
  }

  /* ─── 3) drill-down on daily bar click ───────────────────── */
  function onBarClick({ activePayload }) {
    if (!activePayload?.length) return
    const { date } = activePayload[0].payload
    setSelectedDate(date)
    api.get('/reports/volume/hourly', { params: { role: team, date } })
      .then(res => {
        const filled = Array.from({ length: 24 }, (_, h) => {
          const entry = res.data.find(e => e.hour === h) || {}
          return {
            hour:            h,
            forecastCalls:   entry.forecastCalls   || 0,
            actualCalls:     entry.actualCalls     || 0,
            forecastTickets: entry.forecastTickets || 0,
            actualTickets:   entry.actualTickets   || 0
          }
        })
        setHourlyData(filled)
      })
      .catch(console.error)
  }

  /* ─── 4) CSV upload helper ───────────────────────────────── */
  const handleUpload = (file, endpoint) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const payload = data.map(r => ({
          date:    r.date,
          hour:    Number(r.hour),
          calls:   Number(r.calls),
          tickets: Number(r.tickets)
        }))
        await api.post(`/volume/${endpoint}`, { role: team, data: payload })
        fetchDaily().then(setDailyData)
      }
    })
  }

  /* ─── 5) build forecast (server-side) ────────────────────── */
  const buildForecast = async () => {
    try {
      await api.post('/volume/build-forecast', {
        role:           team,
        lookBackMonths: lookBack,
        horizonMonths:  horizon,
        overwrite
      })
      // refresh graph to show the new forecast rows
      fetchDaily().then(setDailyData)
    } catch (err) {
      console.error('Build forecast failed', err)
      alert('Failed to build forecast – see console for details.')
    }
  }

  /* ─── UI ──────────────────────────────────────────────────── */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>Volume Dashboard</Typography>

        {/* ▲ Controls */}
        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, mb:4 }}>
          {/* Team selector */}
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team" onChange={e => setTeam(e.target.value)}>
              {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>

          {/* Date range pickers */}
          <DatePicker
            label="Start Date"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={p => <TextField {...p} size="small" />}
          />
          <DatePicker
            label="End Date"
            value={endDate}
            onChange={d => d && setEndDate(d)}
            renderInput={p => <TextField {...p} size="small" />}
          />

          {/* Look-back & horizon selectors */}
          <FormControl sx={{ minWidth:120 }}>
            <InputLabel>Look-back (mo)</InputLabel>
            <Select
              value={lookBack}
              label="Look-back (mo)"
              onChange={e => setLookBack(+e.target.value)}
            >
              {[1,2,3,4,5,6,12,18,24,36].map(m => (
                <MenuItem key={m} value={m}>{m}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl sx={{ minWidth:120 }}>
            <InputLabel>Horizon (mo)</InputLabel>
            <Select
              value={horizon}
              label="Horizon (mo)"
              onChange={e => setHorizon(+e.target.value)}
            >
              {[6,12,18,24].map(m => (
                <MenuItem key={m} value={m}>{m}</MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Overwrite toggle */}
          <FormControlLabel
            control={
              <Switch checked={overwrite} onChange={e => setOverwrite(e.target.checked)} />
            }
            label="Overwrite existing?"
          />

          {/* Buttons */}
          <Button variant="contained" onClick={buildForecast}>
            Build Forecast
          </Button>
          <Button variant="outlined" component="label">
            Upload Forecast CSV
            <input type="file" hidden accept=".csv"
              onChange={e => handleUpload(e.target.files[0], 'forecast')} />
          </Button>
          <Button variant="outlined" component="label">
            Upload Actual CSV
            <input type="file" hidden accept=".csv"
              onChange={e => handleUpload(e.target.files[0], 'actual')} />
          </Button>
        </Box>

        {/* ▼ Daily chart */}
        <Typography variant="h6" gutterBottom>Daily Volume</Typography>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={dailyData} margin={{ top:20, right:30, left:20, bottom:5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="forecastCalls"   name="Forecast Calls"   fill="#8884d8" onClick={onBarClick}/>
            <Bar dataKey="actualCalls"     name="Actual Calls"     fill="#82ca9d" onClick={onBarClick}/>
            <Bar dataKey="forecastTickets" name="Forecast Tickets" fill="#ffc658" onClick={onBarClick}/>
            <Bar dataKey="actualTickets"   name="Actual Tickets"   fill="#ff8042" onClick={onBarClick}/>
          </BarChart>
        </ResponsiveContainer>

        {/* ▼ Hourly drill-down */}
        {selectedDate && (
          <>
            <Typography variant="h6" sx={{ mt:4 }}>
              Hourly Detail – {dayjs(selectedDate).format('YYYY-MM-DD')}
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hourlyData} margin={{ top:20, right:30, left:20, bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" type="number" domain={[0,23]}
                       tickFormatter={h => `${h}:00`} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="forecastCalls"   name="Forecast Calls"   fill="#8884d8" />
                <Bar dataKey="actualCalls"     name="Actual Calls"     fill="#82ca9d" />
                <Bar dataKey="forecastTickets" name="Forecast Tickets" fill="#ffc658" />
                <Bar dataKey="actualTickets"   name="Actual Tickets"   fill="#ff8042" />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </Box>
    </LocalizationProvider>
  )
}
