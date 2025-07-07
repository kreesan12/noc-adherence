// frontend/src/pages/VolumePage.jsx
import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import {
  Box,
  Button,
  MenuItem,
  Select,
  InputLabel,
  FormControl,
  Typography,
  TextField
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
import api from '../api'
import dayjs from 'dayjs'

export default function VolumePage() {
  const [roles,        setRoles]        = useState([])
  const [team,         setTeam]         = useState('')
  const [startDate,    setStartDate]    = useState(dayjs().subtract(6, 'day'))
  const [endDate,      setEndDate]      = useState(dayjs())
  const [dailyData,    setDailyData]    = useState([])
  const [hourlyData,   setHourlyData]   = useState([])
  const [selectedDate, setSelectedDate] = useState(null)

  // 1️⃣ load roles once
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // 2️⃣ reload daily data whenever team, startDate or endDate change
  useEffect(() => {
    if (!team) return
    api.get('/reports/volume', {
      params: {
        role:  team,
        start: startDate.format('YYYY-MM-DD'),
        end:   endDate  .format('YYYY-MM-DD')
      }
    })
    .then(res => {
      setDailyData(res.data)
      setSelectedDate(null)
      // reset hourly placeholders with tickets
      setHourlyData(Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        forecastCalls:   0,
        actualCalls:     0,
        forecastTickets: 0,
        actualTickets:   0
      })))
    })
    .catch(console.error)
  }, [team, startDate, endDate])

  // 3️⃣ drill into hourly when clicking a bar
  function onBarClick({ activePayload }) {
    if (!activePayload?.length) return
    const { date } = activePayload[0].payload
    setSelectedDate(date)
    api.get('/reports/volume/hourly', {
      params: { role: team, date }
    })
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

  // 4️⃣ CSV upload
  const handleUpload = (file, endpoint) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const payload = data.map(row => ({
          date:    row.date,
          hour:    Number(row.hour),
          calls:   Number(row.calls),
          tickets: Number(row.tickets)
        }))
        await api.post(`/volume/${endpoint}`, { role: team, data: payload })
        // refresh daily
        const r = await api.get('/reports/volume', {
          params: {
            role:  team,
            start: startDate.format('YYYY-MM-DD'),
            end:   endDate  .format('YYYY-MM-DD')
          }
        })
        setDailyData(r.data)
      }
    })
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>Volume Dashboard</Typography>

        {/* Controls */}
        <Box sx={{ display:'flex', alignItems:'center', gap:2, mb:4 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select
              value={team}
              label="Team"
              onChange={e => setTeam(e.target.value)}
            >
              {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </Select>
          </FormControl>

          <DatePicker
            label="Start Date"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={params => <TextField {...params} size="small" />}
          />
          <DatePicker
            label="End Date"
            value={endDate}
            onChange={d => d && setEndDate(d)}
            renderInput={params => <TextField {...params} size="small" />}
          />

          <Button variant="outlined" component="label">
            Upload Forecast
            <input
              type="file" hidden accept=".csv"
              onChange={e => handleUpload(e.target.files[0], 'forecast')}
            />
          </Button>
          <Button variant="outlined" component="label">
            Upload Actual
            <input
              type="file" hidden accept=".csv"
              onChange={e => handleUpload(e.target.files[0], 'actual')}
            />
          </Button>
        </Box>

        {/* Daily Chart */}
        <Typography variant="h6" gutterBottom>Daily Volume</Typography>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={dailyData}
            margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="forecastCalls"
              name="Forecast Calls"
              fill="#8884d8"
              onClick={onBarClick}
            />
            <Bar
              dataKey="actualCalls"
              name="Actual Calls"
              fill="#82ca9d"
              onClick={onBarClick}
            />
            <Bar
              dataKey="forecastTickets"
              name="Forecast Tickets"
              fill="#ffc658"
              onClick={onBarClick}
            />
            <Bar
              dataKey="actualTickets"
              name="Actual Tickets"
              fill="#ff8042"
              onClick={onBarClick}
            />
          </BarChart>
        </ResponsiveContainer>

        {/* Hourly Drilldown */}
        {selectedDate && (
          <>
            <Typography variant="h6" sx={{ mt:4 }}>
              Hourly Detail for {dayjs(selectedDate).format('YYYY-MM-DD')}
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={hourlyData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="hour"
                  type="number"
                  domain={[0, 23]}
                  tickFormatter={h => `${h}:00`}
                />
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
