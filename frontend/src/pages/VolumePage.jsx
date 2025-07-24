// frontend/src/pages/VolumePage.jsx
import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import {
  Box, Button, MenuItem, Select, InputLabel, FormControl,
  Typography, TextField, FormControlLabel, Switch
} from '@mui/material'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend
} from 'recharts'
import {
  LocalizationProvider, DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import api   from '../api'
import dayjs from 'dayjs'

/* ────────────────────────────────────────────────────────── */
export default function VolumePage() {
  /* ─── state ─────────────────────────────────────────────── */
  const [roles,           setRoles]           = useState([])
  const [team,            setTeam]            = useState('')

  /* range for ACTUAL chart (defaults: last 6 days) */
  const [startDate,       setStartDate]       = useState(dayjs().subtract(45, 'day'))
  const [endDate,         setEndDate]         = useState(dayjs())

  /* range for FORECAST chart (defaults: today → +6 mo) */
  const [fcStart,         setFcStart]         = useState(dayjs())
  const [fcEnd,           setFcEnd]           = useState(dayjs().add(6, 'month').subtract(1, 'day'))

  /* look-back / horizon selectors for Build Forecast */
  const monthChoices = [1,2,3,4,5,6,12,18,24,36]
  const [lookBack,   setLookBack]   = useState(6)
  const [horizon,    setHorizon]    = useState(6)
  const [overwrite,  setOverwrite]  = useState(false)

  /* chart data */
  const [dailyData,      setDailyData]     = useState([])
  const [hourlyData,     setHourlyData]    = useState([])
  const [selectedDate,   setSelectedDate]  = useState(null)

  const [fcDailyData,    setFcDailyData]   = useState([])   // forecast
  const [stackAutomation, setStackAutomation] = useState(true)
  const [uploading,  setUploading]  = useState(false) // spinner / disable btn
  const [uploadMsg, setUploadMsg]  = useState('')     // success / error text

  /* ─── 1) load role list once ─────────────────────────────── */
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  /* ─── 2) fetch ACTUAL daily whenever team / range change ─── */
  useEffect(() => {
    if (!team) return
    fetchDailyActual()
      .then(setDailyData)
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, startDate, endDate])

  async function fetchDailyActual() {
    const { data } = await api.get('/reports/volume', {
      params: {
        role:  team,
        start: startDate.format('YYYY-MM-DD'),
        end:   endDate  .format('YYYY-MM-DD')
      }
    })
    /* reset hourly placeholder */
    setSelectedDate(null)
    setHourlyData(Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      forecastCalls:   0,
      actualCalls:     0,
      forecastTickets: 0,
      actualTickets:   0,
      manualTickets:   0,           
      autoDfa:         0,           
      autoMnt:         0,          
      autoOutage:      0,           
      autoMntSolved:   0          
    })))
    return data
  }

  /* ─── 3) fetch FORECAST daily whenever fc range changes ──── */
  useEffect(() => {
    if (!team) return
    fetchDailyForecast()
      .then(setFcDailyData)
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team, fcStart, fcEnd])

  async function fetchDailyForecast() {
    const { data } = await api.get('/reports/volume/forecast', {
      params: {
        role:  team,
        start: fcStart.format('YYYY-MM-DD'),
        end:   fcEnd  .format('YYYY-MM-DD')
      }
    })
    return data
  }

  /* ─── 4) drill-down hourly on bar click (actuals) ────────── */
  function onBarClick({ activePayload }) {
    if (!activePayload?.length) return
    const { date } = activePayload[0].payload
    setSelectedDate(date)

    api.get('/reports/volume/hourly', { params: { role: team, date } })
      .then(res => {
        const filled = Array.from({ length: 24 }, (_, h) => {
          const e = res.data.find(r => r.hour === h) || {}
          return {
            hour:            h,
            forecastCalls:   e.forecastCalls   || 0,
            actualCalls:     e.actualCalls     || 0,
            forecastTickets: e.forecastTickets || 0,
            actualTickets:   e.actualTickets   || 0,
            manualTickets:   e.manualTickets   || 0,          // ✨ NEW
            autoDfa:         e.autoDfa         || 0,          // ✨ NEW
            autoMnt:         e.autoMnt         || 0,          // ✨ NEW
            autoOutage:      e.autoOutage      || 0,          // ✨ NEW
            autoMntSolved:   e.autoMntSolved   || 0           // ✨ NEW
          }
        })
        setHourlyData(filled)
      })
      .catch(console.error)
  }

  /* ─── 5) CSV upload (forecast | actual) ──────────────────── */
  const handleUploadActual = (file) => {
    setUploading(true)
    setUploadMsg('')
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        try {
          const payload = data.map(row => ({
            date:    row.date,
            hour:    Number(row.hour),
            calls:   Number(row.calls),
            tickets: Number(row.tickets),
            priority1:  Number(row.priority1  ?? 0),
            autoDfa:    Number(row.autoDfa    ?? 0),
            autoMnt:    Number(row.autoMnt    ?? 0),
            autoOutage: Number(row.autoOutage ?? 0),
            autoMntSolved: Number(row.autoMntSolved ?? 0)
          }))
          await api.post('/volume/actual', { role: team, data: payload })
          await fetchDailyActual().then(setDailyData)
          setUploadMsg('Upload successful ✔︎')
        } catch (err) {
          console.error(err)
          setUploadMsg('Upload failed ✖︎')
        } finally {
          setUploading(false)
        }
      }
    })
  }

  /* ─── 6) Build Forecast (backend) ─────────────────────────── */
  async function buildForecast() {
    try {
      await api.post('/volume/build-forecast', {
        role:           team,
        lookBackMonths: lookBack,
        horizonMonths:  horizon,
        overwrite
      })
      /* refresh forecast date-range to new horizon & reload */
      const newStart = dayjs().startOf('day')
      const newEnd   = dayjs().add(horizon, 'month').subtract(1, 'day')
      setFcStart(newStart)
      setFcEnd(newEnd)
      fetchDailyForecast().then(setFcDailyData)
    } catch (err) {
      console.error(err)
      alert('Failed to build forecast – see console for details.')
    }
  }

  /* ─── render ─────────────────────────────────────────────── */
  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>Volume Dashboard</Typography>

        {/* ── 1) TEAM SELECT ─────────────────────────────── */}
        <Box sx={{ display:'flex', alignItems:'center', gap:2, mb:3, flexWrap:'wrap' }}>
          <FormControl sx={{ minWidth:160 }}>
            <InputLabel>Team</InputLabel>
            <Select value={team} label="Team" onChange={e => setTeam(e.target.value)}>
              {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        {/* ── 2) FORECASTING PANEL ───────────────────────── */}
        <Box sx={{
          display:'flex', alignItems:'center', gap:2, mb:3, flexWrap:'wrap',
          bgcolor:'#fafafa', p:2, borderRadius:1
        }}>
          <Typography variant="subtitle1" sx={{ fontWeight:600, mr:1 }}>
            Forecasting
          </Typography>

          {/* look-back / horizon */}
          <FormControl sx={{ minWidth:110 }}>
            <InputLabel>Look-back (mo)</InputLabel>
            <Select value={lookBack} label="Look-back (mo)"
                    onChange={e => setLookBack(+e.target.value)}>
              {monthChoices.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControl sx={{ minWidth:110 }}>
            <InputLabel>Horizon (mo)</InputLabel>
            <Select value={horizon} label="Horizon (mo)"
                    onChange={e => setHorizon(+e.target.value)}>
              {monthChoices.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControlLabel
            control={<Switch checked={overwrite}
                            onChange={e => setOverwrite(e.target.checked)} />}
            label="Overwrite?"
          />

          <Button variant="contained" onClick={buildForecast}>
            Build Forecast
          </Button>

          {/* Upload ACTUAL CSV only */}
          <Button
            variant="outlined"
            component="label"
            disabled={uploading}
          >
            {uploading ? 'Uploading…' : 'Upload Actual CSV'}
            <input hidden type="file" accept=".csv"
                  onChange={e => handleUploadActual(e.target.files[0])} />
          </Button>

          {uploadMsg && (
            <Typography variant="body2" sx={{ ml:1 }}>
              {uploadMsg}
            </Typography>
          )}
        </Box>

        {/* ── DAILY ACTUAL chart ───────────────────────────── */}
        <Box sx={{ display:'flex', alignItems:'center', gap:2, mb:4, flexWrap:'wrap' }}>
          <Typography variant="h6" gutterBottom>Daily Actual Volume</Typography>
          <DatePicker
            label="Actual from"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={p => <TextField {...p} size="small" />}
          />
          <DatePicker
            label="Actual to"
            value={endDate}
            onChange={d => d && setEndDate(d)}
            renderInput={p => <TextField {...p} size="small" />}
          />
          <FormControlLabel
            control={<Switch checked={stackAutomation}
                            onChange={e => setStackAutomation(e.target.checked)} />}
            label="Show automation contribution"
          />
        </Box>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={dailyData} margin={{ top:20,right:30,left:20,bottom:5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="actualCalls"     name="Calls"   fill="#82ca9d" onClick={onBarClick}/>
            {stackAutomation ? (
              <>
                <Bar dataKey="manualTickets" name="Manual"    fill="#ff8042" stackId="tickets" onClick={onBarClick}/>
                <Bar dataKey="autoDfa"       name="Auto DFA"  fill="#a4de6c" stackId="tickets" onClick={onBarClick}/>
                <Bar dataKey="autoMnt"       name="Auto MNT"  fill="#ffc658" stackId="tickets" onClick={onBarClick}/>
                <Bar dataKey="autoOutage"    name="Auto Outage Linked" fill="#8884d8" stackId="tickets" onClick={onBarClick}/>
                <Bar dataKey="autoMntSolved" name="Auto MNT Solved" fill="#d0ed57" stackId="tickets" onClick={onBarClick}/>
              </>
            ) : (
              <Bar dataKey="actualTickets" name="Tickets" fill="#ff8042" onClick={onBarClick}/>
            )}
          </BarChart>
        </ResponsiveContainer>

        {/* ── HOURLY drill-down (actual) ───────────────────── */}
        {selectedDate && (
          <>
            <Typography variant="h6" sx={{ mt:4 }}>
              Hourly Actual for {dayjs(selectedDate).format('YYYY-MM-DD')}
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={hourlyData} margin={{ top:20,right:30,left:20,bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" type="number" domain={[0,23]} tickFormatter={h => `${h}:00`} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="actualCalls"   name="Calls"   fill="#82ca9d" />
                {stackAutomation ? (
                  <>
                    <Bar dataKey="manualTickets" name="Manual"    fill="#ff8042" stackId="tickets" onClick={onBarClick}/>
                    <Bar dataKey="autoDfa"       name="Auto DFA"  fill="#a4de6c" stackId="tickets" onClick={onBarClick}/>
                    <Bar dataKey="autoMnt"       name="Auto MNT"  fill="#ffc658" stackId="tickets" onClick={onBarClick}/>
                    <Bar dataKey="autoOutage"    name="Auto Outage linked" fill="#8884d8" stackId="tickets" onClick={onBarClick}/>
                    <Bar dataKey="autoMntSolved" name="Auto MNT Solved" fill="#d0ed57" stackId="tickets" onClick={onBarClick}/>
                  </>
                ) : (
                  <Bar dataKey="actualTickets" name="Tickets" fill="#ff8042" onClick={onBarClick}/>
                )}
              </BarChart>
            </ResponsiveContainer>
          </>
        )}

        {/* ── DAILY FORECAST chart ─────────────────────────── */}
        {fcDailyData.length > 0 && (
          <>
            <Box sx={{ mt:6, display:'flex', gap:2, flexWrap:'wrap', alignItems:'center' }}>
              <Typography variant="h6" sx={{ mr:2 }}>Daily Forecast Volume</Typography>
              <DatePicker
                label="Forecast - from"
                value={fcStart}
                onChange={d => d && setFcStart(d)}
                renderInput={p => <TextField {...p} size="small" />}
              />
              <DatePicker
                label="Forecast - to"
                value={fcEnd}
                onChange={d => d && setFcEnd(d)}
                renderInput={p => <TextField {...p} size="small" />}
              />
            </Box>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={fcDailyData} margin={{ top:20,right:30,left:20,bottom:5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="forecastCalls"   name="Forecast Calls"   fill="#8884d8" />
                {stackAutomation ? (
                  <>
                    <Bar dataKey="manualTickets" name="Manual"    fill="#ff8042" stackId="forecast" />
                    <Bar dataKey="autoDfa"       name="Auto DFA"  fill="#a4de6c" stackId="forecast" />
                    <Bar dataKey="autoMnt"       name="Auto MNT"  fill="#ffc658" stackId="forecast" />
                    <Bar dataKey="autoOutage"    name="Auto Outage linked" fill="#8884d8" stackId="forecast" />
                    <Bar dataKey="autoMntSolved" name="Auto MNT Solved" fill="#d0ed57" stackId="forecast" />
                  </>
                ) : (
                  <Bar dataKey="forecastTickets" name="Forecast Tickets" fill="#ff8042" />
                )}
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </Box>
    </LocalizationProvider>
  )
}
