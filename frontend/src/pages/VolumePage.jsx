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
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer
} from 'recharts'
import dayjs from 'dayjs'
import api from '../api'

export default function VolumePage() {
  const [roles, setRoles]         = useState([])
  const [forecastRole, setForecastRole] = useState('')
  const [actualRole, setActualRole]     = useState('')
  const [dailyData, setDailyData]       = useState([])
  const [hourlyData, setHourlyData]     = useState([])
  const [selectedDate, setSelectedDate] = useState(null)

  // load roles
  useEffect(() => {
    api.get('/agents').then(r => {
      const uniq = [...new Set(r.data.map(a=>a.role))]
      setRoles(uniq)
      if (uniq.length) {
        setForecastRole(uniq[0])
        setActualRole(uniq[0])
      }
    })
  }, [])

  // upload helper
  const handleUpload = (file, endpoint, role) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const payload = data.map(r => ({
          date: r.date,
          hour: Number(r.hour),
          calls: Number(r.calls),
          tickets: Number(r.tickets)
        }))
        await api.post(`/volume/${endpoint}`, { role, data: payload })
        loadDaily()
      }
    })
  }

  // load daily
  const loadDaily = () => {
    api.get('/reports/volume', { params: { role: forecastRole } })
       .then(r => {
         setDailyData(r.data)
         setSelectedDate(null)
         setHourlyData([])
       })
  }
  useEffect(loadDaily, [forecastRole])

  // drill into hourly
  const onBarClick = d => {
    setSelectedDate(d.date)
    api.get('/reports/volume/hourly', {
      params: { role: forecastRole, date: d.date }
    }).then(r => setHourlyData(r.data))
  }

  return (
    <Box sx={{ p:3 }}>
      <Typography variant="h5" gutterBottom>
        Volume Upload & Reporting
      </Typography>

      <Box sx={{ display:'flex', gap:2, mb:4 }}>
        <Paper sx={{ p:2, flex:1 }}>
          <Typography variant="subtitle1">Forecast CSV</Typography>
          <FormControl fullWidth sx={{ my:1 }}>
            <InputLabel>Team</InputLabel>
            <Select
              value={forecastRole}
              label="Team"
              onChange={e=>setForecastRole(e.target.value)}
            >
              {roles.map(r=>(
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" component="label">
            Upload…
            <input
              type="file"
              hidden accept=".csv"
              onChange={e=>handleUpload(e.target.files[0],'forecast',forecastRole)}
            />
          </Button>
        </Paper>

        <Paper sx={{ p:2, flex:1 }}>
          <Typography variant="subtitle1">Actual CSV</Typography>
          <FormControl fullWidth sx={{ my:1 }}>
            <InputLabel>Team</InputLabel>
            <Select
              value={actualRole}
              label="Team"
              onChange={e=>setActualRole(e.target.value)}
            >
              {roles.map(r=>(
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button variant="contained" component="label">
            Upload…
            <input
              type="file"
              hidden accept=".csv"
              onChange={e=>handleUpload(e.target.files[0],'actual',actualRole)}
            />
          </Button>
        </Paper>
      </Box>

      <Typography variant="h6" gutterBottom>
        Daily Forecast vs Actual ({forecastRole})
      </Typography>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={dailyData}
          margin={{ top:20, right:30, left:0, bottom:40 }}
          onClick={({ activePayload })=>{
            if(activePayload?.length) onBarClick(activePayload[0].payload)
          }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            angle={-45}
            textAnchor="end"
            tickFormatter={d=>dayjs(d).format('MMM D')}
          />
          <YAxis />
          <Tooltip
            labelFormatter={d=>dayjs(d).format('dddd, MMM D')}
          />
          <Legend verticalAlign="top" />
          <Bar dataKey="forecastCalls" name="Forecast" fill="#8884d8" barSize={20} />
          <Bar dataKey="actualCalls"   name="Actual"   fill="#82ca9d" barSize={20} />
        </BarChart>
      </ResponsiveContainer>

      {selectedDate && (
        <>
          <Typography variant="h6" sx={{ mt:4 }}>
            Hourly on {dayjs(selectedDate).format('dddd, MMM D')}
          </Typography>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart
              data={hourlyData}
              margin={{ top:20, right:30, left:0, bottom:20 }}
            >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="forecastCalls" name="Forecast" fill="#8884d8" barSize={15} />
              <Bar dataKey="actualCalls"   name="Actual"   fill="#82ca9d" barSize={15} />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </Box>
  )
}
