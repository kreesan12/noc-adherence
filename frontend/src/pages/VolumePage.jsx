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
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import api from '../api'
import dayjs from 'dayjs'

export default function VolumePage() {
  const [roles, setRoles] = useState([])
  const [forecastRole, setForecastRole] = useState('')
  const [actualRole, setActualRole]     = useState('')
  const [dailyData, setDailyData]       = useState([])
  const [hourlyData, setHourlyData]     = useState([])
  const [selectedDay, setSelectedDay]   = useState(null)

  // 1️⃣ load unique roles from agents
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

  // 2️⃣ handlers for CSV upload
  const handleUpload = async (file, endpoint, role) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        // expect data rows like { dayOfWeek, hour, calls, tickets }
        // annotate each row with role:
        const payload = data.map(row => ({
          ...row,
          role,
          dayOfWeek: Number(row.dayOfWeek),
          hour:      Number(row.hour),
          calls:     Number(row.calls),
          tickets:   Number(row.tickets),
        }))
        await api.post(`/volume/${endpoint}`, { role, data: payload })
        loadDaily()  // reload charts
      }
    })
  }

  // 3️⃣ load the per-day aggregates
  const loadDaily = () => {
    api.get('/reports/volume?group=forecast').then(r => {
      // expect [{ dayOfWeek, forecastCalls, actualCalls }]
      setDailyData(r.data)
      // reset any drilldown
      setSelectedDay(null)
      setHourlyData([])
    })
  }
  useEffect(loadDaily, [])

  // 4️⃣ drill into hourly when clicking a bar
  const onBarClick = (data) => {
    const day = data.dayOfWeek
    setSelectedDay(day)
    api.get('/reports/volume/hourly', { params: { dayOfWeek: day } })
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
            {roles.map(r=> <MenuItem key={r} value={r}>{r}</MenuItem>)}
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
            {roles.map(r=> <MenuItem key={r} value={r}>{r}</MenuItem>)}
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
            if (activePayload && activePayload.length) {
              onBarClick(activePayload[0].payload)
            }
          }}
        >
          <XAxis dataKey="dayOfWeek" tickFormatter={d => dayjs().day(d).format('ddd')} />
          <YAxis />
          <Tooltip labelFormatter={d => dayjs().day(d).format('dddd')} />
          <Bar dataKey="forecastCalls" name="Forecast Calls" fill="#8884d8" />
          <Bar dataKey="actualCalls"   name="Actual Calls"   fill="#82ca9d" />
        </BarChart>
      </ResponsiveContainer>

      {selectedDay !== null && (
        <>
          <Typography variant="h6" sx={{ mt:4 }}>
            Hourly for {dayjs().day(selectedDay).format('dddd')}
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
