// frontend/src/pages/VolumePage.jsx
import { useEffect, useState } from 'react'
import Papa from 'papaparse'
import dayjs from 'dayjs'
import api from '../api'

import {
  Box,
  Paper,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Grid,
  TextField
} from '@mui/material'

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip
} from 'recharts'

import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'

export default function VolumePage() {
  const [roles, setRoles]         = useState([])
  const [team, setTeam]           = useState('')
  const [startDate, setStartDate] = useState(dayjs().subtract(6, 'day'))
  const [endDate, setEndDate]     = useState(dayjs())
  const [dailyData, setDailyData] = useState([])
  const [hourlyData, setHourlyData] = useState([])
  const [selectedDay, setSelectedDay] = useState(null)

  // load unique teams
  useEffect(() => {
    api.get('/agents').then(r => {
      const uniq = [...new Set(r.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq[0]) setTeam(uniq[0])
    })
  }, [])

  // reload daily whenever team / date range change
  useEffect(() => {
    if (!team || !startDate || !endDate) return
    api.get('/reports/volume', {
      params: {
        role: team,
        start: startDate.format('YYYY-MM-DD'),
        end:   endDate.format('YYYY-MM-DD')
      }
    }).then(r => {
      setDailyData(r.data)
      setSelectedDay(null)
      setHourlyData([])
    })
  }, [team, startDate, endDate])

  // drill down hourly
  const onBarClick = payload => {
    if (!payload) return
    const { day } = payload
    setSelectedDay(day)
    api.get('/reports/volume/hourly', {
      params: { role: team, day }
    }).then(r => setHourlyData(r.data))
  }

  // CSV upload handler
  const handleUpload = (file, endpoint) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        const payload = data.map(row => ({
          ...row,
          role: team,
          date: row.date,
          hour: Number(row.hour),
          calls: Number(row.calls),
          tickets: Number(row.tickets),
        }))
        await api.post(`/volume/${endpoint}`, { role: team, data: payload })
        // re-load charts
        api.get('/reports/volume', {
          params: {
            role: team,
            start: startDate.format('YYYY-MM-DD'),
            end:   endDate.format('YYYY-MM-DD')
          }
        }).then(r => setDailyData(r.data))
      }
    })
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
    <Box sx={{ p:3 }}>
      <Typography variant="h4" gutterBottom>
        Volume Dashboard
      </Typography>

      {/* controls + uploads */}
      <Grid container spacing={2} alignItems="center">
        <Grid item xs={12} md={6} lg={4}>
          <FormControl fullWidth>
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
        </Grid>

        <Grid item xs={6} md={3} lg={2}>
          <DatePicker
            label="Start Date"
            value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={params => <TextField {...params} fullWidth />}
          />
        </Grid>

        <Grid item xs={6} md={3} lg={2}>
          <DatePicker
            label="End Date"
            value={endDate}
            onChange={d => d && setEndDate(d)}
            renderInput={params => <TextField {...params} fullWidth />}
          />
        </Grid>

        <Grid item xs={12} md={6} lg={4} container spacing={1} justifyContent="flex-end">
          <Grid item>
            <Button variant="outlined" component="label" size="small">
              Upload Forecast
              <input
                type="file"
                hidden accept=".csv"
                onChange={e => handleUpload(e.target.files[0], 'forecast')}
              />
            </Button>
          </Grid>
          <Grid item>
            <Button variant="outlined" component="label" size="small">
              Upload Actual
              <input
                type="file"
                hidden accept=".csv"
                onChange={e => handleUpload(e.target.files[0], 'actual')}
              />
            </Button>
          </Grid>
        </Grid>
      </Grid>

      {/* daily bar chart */}
      <Box sx={{ mt:4, height:300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={dailyData}
            onClick={({ activePayload }) =>
              onBarClick(activePayload?.[0]?.payload)
            }
          >
            <XAxis dataKey="day" />
            <YAxis />
            <Tooltip />
            <Bar dataKey="forecastCalls" fill="#8884d8" />
            <Bar dataKey="actualCalls"   fill="#82ca9d" />
          </BarChart>
        </ResponsiveContainer>
      </Box>

      {/* hourly drilldown */}
      {selectedDay !== null && (
        <Box sx={{ mt:4, height:300 }}>
          <Typography variant="h6" gutterBottom>
            Hourly for {dayjs().day(selectedDay).format('dddd')}
          </Typography>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourlyData}>
              <XAxis dataKey="hour" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="forecastCalls" fill="#8884d8" />
              <Bar dataKey="actualCalls"   fill="#82ca9d" />
            </BarChart>
          </ResponsiveContainer>
        </Box>
      )}
    </Box>
    </LocalizationProvider>
  )
}
