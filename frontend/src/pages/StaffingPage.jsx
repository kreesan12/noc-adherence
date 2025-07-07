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
import api from '../api'
import dayjs from 'dayjs'

export default function StaffingPage() {
  // … your existing state hooks …

  const [forecast, setForecast] = useState([])  // demand heatmap
  const [blocks,   setBlocks]   = useState([])  // assigned block types

  // 1) fetch your demand
  const calcForecast = async () => {
    const res = await api.post('/erlang/staff/bulk-range', {
      role:               team,
      start:              startDate.format('YYYY-MM-DD'),
      end:                endDate  .format('YYYY-MM-DD'),
      callAhtSeconds:     callAht,
      ticketAhtSeconds:   ticketAht,
      serviceLevel:       sl,
      thresholdSeconds:   threshold,
      shrinkage
    })
    setForecast(res.data)
    setBlocks([])
  }

  // 2) assign minimal blocks via our new greedy solver
  const assignToStaff = async () => {
    if (!forecast.length) {
      alert('Run Forecast first')
      return
    }
    const res = await api.post('/schedule/assign', {
      forecast,
      windowDays: 5,
      shiftLength: 9
    })
    setBlocks(res.data)
  }

  // 3) build your scheduled‐coverage heatmap from blocks
  //    keyed same as forecast: { "YYYY-MM-DD|H": sum }
  const scheduled = {}
  blocks.forEach(b => {
    const { startDate, startHour, length, count } = b
    const days = Array.from({length:5}, (_,i) =>
      dayjs(startDate).add(i,'day').format('YYYY-MM-DD')
    )
    days.forEach(dd => {
      for (let h = startHour; h < startHour + length; h++) {
        const key = `${dd}|${h}`
        scheduled[key] = (scheduled[key]||0) + count
      }
    })
  })

  // helpers for rendering heatmaps
  const maxReq = Math.max(
    0,
    ...forecast.flatMap(d => d.staffing.map(s => s.requiredAgents))
  )
  const maxSch = Math.max(
    0,
    ...forecast.flatMap(d => d.staffing.map(s => scheduled[`${d.date}|${s.hour}`]||0))
  )

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Scheduling
        </Typography>

        {/* ─── Controls ──────────────────────────────────────── */}
        {/* … your existing controls + Forecast/Assign buttons … */}

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

        {/* ─── Required Agents Heatmap ───────────────────────── */}
        {forecast.length > 0 && (
          <Box sx={{ mt:4, overflowX:'auto' }}>
            <Typography variant="h6">Required Agents Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d =>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({length:24}, (_,h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const req = d.staffing.find(s=>s.hour===h)?.requiredAgents||0
                      const alpha = maxReq
                        ? (req/maxReq)*0.8+0.2
                        : 0.2
                      return (
                        <TableCell
                          key={d.date}
                          sx={{ backgroundColor:`rgba(33,150,243,${alpha})` }}
                        >
                          {req}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── Scheduled Coverage Heatmap ────────────────────── */}
        {blocks.length > 0 && (
          <Box sx={{ mt:4, overflowX:'auto' }}>
            <Typography variant="h6">Scheduled Coverage Heatmap</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Hour</TableCell>
                  {forecast.map(d =>
                    <TableCell key={d.date}>{d.date}</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {Array.from({length:24}, (_,h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const cov = scheduled[`${d.date}|${h}`]||0
                      const alpha = maxSch
                        ? (cov/maxSch)*0.8+0.2
                        : 0.2
                      return (
                        <TableCell
                          key={d.date}
                          sx={{ backgroundColor:`rgba(76,175,80,${alpha})` }}
                        >
                          {cov}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}

        {/* ─── Shift Block Types ──────────────────────────────── */}
        {blocks.length > 0 && (
          <Box sx={{ mt:4, overflowX:'auto' }}>
            <Typography variant="h6">Assigned Shift-Block Types</Typography>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length</TableCell>
                  <TableCell>Count</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map((b,i) => (
                  <TableRow key={i}>
                    <TableCell>{i+1}</TableCell>
                    <TableCell>{b.startDate}</TableCell>
                    <TableCell>{b.startHour}:00</TableCell>
                    <TableCell>{b.length}h</TableCell>
                    <TableCell>{b.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}
