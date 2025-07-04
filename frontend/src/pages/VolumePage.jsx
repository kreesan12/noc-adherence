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
  Paper,
  TextField
} from '@mui/material'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts'
import {
  LocalizationProvider,
  DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import api from '../api'
import dayjs from 'dayjs'

export default function VolumePage() {
  const [roles, setRoles]           = useState([])
  const [team, setTeam]             = useState('')
  const [startDate, setStartDate]   = useState(dayjs().subtract(6, 'day'))
  const [endDate, setEndDate]       = useState(dayjs())
  const [dailyData, setDailyData]   = useState([])
  const [hourlyData, setHourlyData] = useState([])
  const [selectedDate, setSelected] = useState(null)

  // load roles once
  useEffect(() => {
    api.get('/agents').then(r => {
      const uniq = [...new Set(r.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq[0]) setTeam(uniq[0])
    })
  }, [])

  // load daily whenever team, startDate or endDate change
  useEffect(loadDaily, [team, startDate, endDate])

  function loadDaily() {
    api.get('/reports/volume', {
      params: {
        role:  team,
        start: startDate.format('YYYY-MM-DD'),
        end:   endDate  .format('YYYY-MM-DD')
      }
    })
    .then(r => {
      setDailyData(r.data)
      setSelected(null)
      setHourlyData([])
    })
    .catch(console.error)
  }

  // drill in
  function onBarClick(bar) {
    const date = bar.payload.date
    setSelected(date)
    api.get('/reports/volume/hourly', {
      params: { role: team, date }
    })
    .then(r => setHourlyData(r.data))
    .catch(console.error)
  }

  // common CSV upload handler
  const handleUpload = (file, endpoint) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const payload = data.map(row => ({
          date:    row.date,
          hour:    Number(row.hour),
          calls:   Number(row.calls),
          tickets: Number(row.tickets),
        }))
        await api.post(`/volume/${endpoint}`, { role: team, data: payload })
        loadDaily()
      }
    })
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>Volume Dashboard</Typography>

        {/* top controls */}
        <Box sx={{ display:'flex', alignItems:'center', gap:2, mb:4 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select
              value={team}
              label="Team"
              onChange={e => setTeam(e.target.value)}
            >
              {roles.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
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

          <Button
            variant="outlined"
            component="label"
          >
            Upload Forecast
            <input
              type="file" hidden accept=".csv"
              onChange={e => handleUpload(e.target.files[0], 'forecast')}
            />
          </Button>
          <Button
            variant="outlined"
            component="label"
          >
            Upload Actual
            <input
              type="file" hidden accept=".csv"
              onChange={e => handleUpload(e.target.files[0], 'actual')}
            />
          </Button>
        </Box>

        {/* daily bar chart */}
        <Typography variant="h6" gutterBottom>Daily Volume</Typography>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={dailyData}
            onClick={onBarClick}
          >
            <XAxis dataKey="date" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="forecastCalls" name="Forecast" fill="#8884d8" />
            <Bar dataKey="actualCalls"   name="Actual"   fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>

        {/* hourly drill-down */}
        {selectedDate && (
          <>
            <Typography variant="h6" sx={{ mt:4 }}>
              Hourly Detail for {dayjs(selectedDate).format('YYYY-MM-DD')}
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
    </LocalizationProvider>
  )
}
