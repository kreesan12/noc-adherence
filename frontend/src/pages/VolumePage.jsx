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
  Paper
} from '@mui/material'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import api from '../api'
import dayjs from 'dayjs'

export default function VolumePage() {
  const [roles, setRoles]           = useState([])
  const [forecastRole, setForecastRole] = useState('')
  const [actualRole, setActualRole]     = useState('')
  const [dailyData, setDailyData]       = useState([])
  const [hourlyData, setHourlyData]     = useState([])
  const [selectedDate, setSelectedDate] = useState(null)

  // 1️⃣ load unique roles
  useEffect(() => {
    api.get('/agents').then(r => {
      const uniq = [...new Set(r.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq[0]) {
        setForecastRole(uniq[0])
        setActualRole(uniq[0])
      }
    })
  }, [])

  // 2️⃣ CSV upload handler
  const handleUpload = (file, endpoint, role) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        // expect { role,date,hour,calls,tickets } or {expectedCalls,expectedTickets}
        const payload = data.map(r => ({
          role,
          date:    dayjs(r.date).format('YYYY-MM-DD'),
          hour:    Number(r.hour),
          calls:   Number(r.calls ?? 0),
          tickets: Number(r.tickets ?? 0),
          expectedCalls:   Number(r.expectedCalls ?? 0),
          expectedTickets: Number(r.expectedTickets ?? 0),
        }))
        await api.post(`/volume/${endpoint}`, { role, data: payload })
        loadDaily()
      }
    })
  }

  // 3️⃣ load per‐day aggregates
  const loadDaily = () => {
    api.get('/reports/volume', { params: { role: forecastRole } })
      .then(r => {
        // expect [{ date, forecastCalls, actualCalls }]
        setDailyData(r.data)
        setSelectedDate(null)
        setHourlyData([])
      })
  }
  useEffect(loadDaily, [forecastRole])

  // 4️⃣ drill into hourly for a day
  const onBarClick = (bar) => {
    const { date } = bar.payload
    setSelectedDate(date)
    api.get('/reports/volume/hourly', { params: { role: forecastRole, date } })
      .then(r => setHourlyData(r.data))
  }

  return (
    <Box sx={{ p:3 }}>
      <Typography variant="h5" gutterBottom>Volume Upload</Typography>

      <Paper sx={{ p:2, mb:4 }}>
        <Typography variant="h6">Upload Forecast</Typography>
        <FormControl sx={{ minWidth:200, mr:2 }}>
          <InputLabel>Team</InputLabel>
          <Select
            value={forecastRole}
            label="Team"
            onChange={e => setForecastRole(e.target.value)}
          >
            {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
        </FormControl>
        <Button variant="contained" component="label">
          CSV…
          <input
            type="file" hidden accept=".csv"
            onChange={e => handleUpload(e.target.files[0], 'forecast', forecastRole)}
          />
        </Button>
      </Paper>

      <Paper sx={{ p:2, mb:4 }}>
        <Typography variant="h6">Upload Actual</Typography>
        <FormControl sx={{ minWidth:200, mr:2 }}>
          <InputLabel>Team</InputLabel>
          <Select
            value={actualRole}
            label="Team"
            onChange={e => setActualRole(e.target.value)}
          >
            {roles.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
          </Select>
        </FormControl>
        <Button variant="contained" component="label">
          CSV…
          <input
            type="file" hidden accept=".csv"
            onChange={e => handleUpload(e.target.files[0], 'actual', actualRole)}
          />
        </Button>
      </Paper>

      <Typography variant="h6" gutterBottom>
        Daily: Forecast vs Actual
      </Typography>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={dailyData}
          onClick={({ activePayload }) => {
            if (activePayload?.length) onBarClick(activePayload[0].payload)
          }}
        >
          <XAxis dataKey="date" tickFormatter={d => dayjs(d).format('MMM D')} />
          <YAxis />
          <Tooltip labelFormatter={d => dayjs(d).format('dddd, MMM D')} />
          <Bar dataKey="forecastCalls" name="Forecast Calls" fill="#8884d8" />
          <Bar dataKey="actualCalls"   name="Actual Calls"   fill="#82ca9d" />
        </BarChart>
      </ResponsiveContainer>

      {selectedDate && (
        <>
          <Typography variant="h6" sx={{ mt:4 }}>
            Hourly for {dayjs(selectedDate).format('dddd, MMM D')}
          </Typography>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={hourlyData}>
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="forecastCalls" name="Forecast" fill="#8884d8" />
              <Bar dataKey="actualCalls"   name="Actual"   fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Box>
  )
}
