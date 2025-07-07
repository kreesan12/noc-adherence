// frontend/src/pages/StaffingPage.jsx
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
  const [roles, setRoles]         = useState([])
  const [team, setTeam]           = useState('')
  const [startDate, setStartDate] = useState(dayjs())
  const [endDate, setEndDate]     = useState(dayjs())
  const [callAht, setCallAht]     = useState(300)
  const [ticketAht, setTicketAht] = useState(600)
  const [sl, setSL]               = useState(0.8)
  const [threshold, setThreshold] = useState(20)
  const [shrinkage, setShrinkage] = useState(0.3)

  // block-type recurrence settings
  const [repeatWeeks, setRepeat]  = useState(3)
  const [breakDays, setBreak]     = useState(3)

  // fetched forecast and grouped blocks
  const [forecast, setForecast]   = useState([])    // [{ date, staffing:[{hour, requiredAgents}] }]
  const [blocks, setBlocks]       = useState([])    // [{ startDate, startHour, length, count }]
  
  // load roles once
  useEffect(() => {
    api.get('/agents').then(res => {
      const uniq = [...new Set(res.data.map(a => a.role))]
      setRoles(uniq)
      if (uniq.length) setTeam(uniq[0])
    })
  }, [])

  // 1) fetch multi-day staffing requirement
  const calcForecast = async () => {
    try {
      const params = {
        role:             team,
        start:            startDate.format('YYYY-MM-DD'),
        end:              endDate.format('YYYY-MM-DD'),
        callAhtSeconds:   callAht,
        ticketAhtSeconds: ticketAht,
        serviceLevel:     sl,
        thresholdSeconds: threshold,
        shrinkage
      }
      const res = await api.post('/erlang/staff/bulk-range', params)
      setForecast(res.data)
      setBlocks([])
    } catch (e) {
      console.error(e)
      alert('Forecast error: ' + e.message)
    }
  }

  // 2) send your raw 5-day blocks to be grouped into block-types
  const assignBlocks = async () => {
    if (!forecast.length) {
      alert('Run forecast first.')
      return
    }
    // flatten into raw 5-day/9h blocks
    const raw = forecast.flatMap(day =>
      day.staffing.map(s => ({
        date:      day.date,
        startHour: s.hour,
        length:    9
      }))
    )
    const res = await api.post('/schedule/assign', { shiftBlocks: raw })
    setBlocks(res.data)
  }

  // heatmap helpers
  const maxReq = Math.max(
    0,
    ...forecast.flatMap(d => d.staffing.map(s => s.requiredAgents))
  )

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast & Blocks
        </Typography>

        {/* ── controls ────────────────────────────────────────── */}
        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, mb:4 }}>
          <FormControl sx={{ minWidth:140 }}>
            <InputLabel>Team</InputLabel>
            <Select
              value={team} label="Team"
              onChange={e => setTeam(e.target.value)}
            >
              {roles.map(r =>
                <MenuItem key={r} value={r}>{r}</MenuItem>
              )}
            </Select>
          </FormControl>

          <DatePicker
            label="Start Date" value={startDate}
            onChange={d => d && setStartDate(d)}
            renderInput={params => <TextField {...params} size="small"/>}
          />
          <DatePicker
            label="End Date" value={endDate}
            onChange={d => d && setEndDate(d)}
            renderInput={params => <TextField {...params} size="small"/>}
          />

          <TextField
            label="Call AHT (sec)" type="number"
            value={callAht}
            onChange={e => setCallAht(+e.target.value)}
          />
          <TextField
            label="Ticket AHT (sec)" type="number"
            value={ticketAht}
            onChange={e => setTicketAht(+e.target.value)}
          />
          <TextField
            label="SL (%)" type="number"
            value={sl * 100}
            onChange={e => setSL(+e.target.value / 100)}
          />
          <TextField
            label="Threshold (sec)" type="number"
            value={threshold}
            onChange={e => setThreshold(+e.target.value)}
          />
          <TextField
            label="Shrinkage (%)" type="number"
            value={shrinkage * 100}
            onChange={e => setShrinkage(+e.target.value / 100)}
          />

          <Button variant="contained" onClick={calcForecast}>
            Calculate Forecast
          </Button>
          <Button
            variant="contained"
            onClick={assignBlocks}
            sx={{ ml:1 }}
          >
            Generate Block-Types
          </Button>

          <TextField
            label="Repeat (weeks)" type="number"
            value={repeatWeeks}
            onChange={e => setRepeat(+e.target.value)}
            sx={{ width:120 }}
          />
          <TextField
            label="Break (days)" type="number"
            value={breakDays}
            onChange={e => setBreak(+e.target.value)}
            sx={{ width:120 }}
          />
        </Box>

        {/* ── Required Agents Heatmap ────────────────────────── */}
        {forecast.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
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
                {Array.from({ length:24 }, (_, h) => (
                  <TableRow key={h}>
                    <TableCell>{h}:00</TableCell>
                    {forecast.map(d => {
                      const req = d.staffing.find(s => s.hour===h)?.requiredAgents||0
                      const alpha = maxReq
                        ? (req / maxReq)*0.8 + 0.2
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

        {/* ── Shift-Block Types ───────────────────────────────── */}
        {blocks.length > 0 && (
          <Box sx={{ mb:4, overflowX:'auto' }}>
            <Typography variant="h6">Shift-Block Types</Typography>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>#</TableCell>
                  <TableCell>Start Date</TableCell>
                  <TableCell>Start Hour</TableCell>
                  <TableCell>Length (h)</TableCell>
                  <TableCell>Count</TableCell>
                  <TableCell>Repeat (wks)</TableCell>
                  <TableCell>Break (days)</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {blocks.map((b,i) => (
                  <TableRow key={i}>
                    <TableCell>{i+1}</TableCell>
                    <TableCell>{b.startDate}</TableCell>
                    <TableCell>{b.startHour}:00</TableCell>
                    <TableCell>{b.length}</TableCell>
                    <TableCell>{b.count}</TableCell>
                    <TableCell>{repeatWeeks}</TableCell>
                    <TableCell>{breakDays}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Typography variant="body2" sx={{ mt:1 }}>
              Each block runs {repeatWeeks} weeks on schedule, then {breakDays} days off before rotating to the next block-type.
            </Typography>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  )
}
