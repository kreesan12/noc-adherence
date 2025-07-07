import { useState } from 'react'
import {
  Box, TextField, Button, Typography
} from '@mui/material'
import {
  LocalizationProvider,
  DatePicker
} from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend
} from 'recharts'
import api from '../api'
import dayjs from 'dayjs'

export default function StaffingPage() {
  const [date, setDate]               = useState(dayjs())
  const [callAht, setCallAht]         = useState(300)
  const [ticketAht, setTicketAht]     = useState(600)
  const [serviceLevel, setSL]         = useState(0.8)
  const [threshold, setThreshold]     = useState(20)
  const [shrinkage, setShrinkage]     = useState(0.3)
  const [data, setData]               = useState([])

  const calculate = async () => {
    const payload = {
      role:               'NOC-I',               // or let user pick a team
      date:               date.format('YYYY-MM-DD'),
      callAhtSeconds:     callAht,
      ticketAhtSeconds:   ticketAht,
      serviceLevel,
      thresholdSeconds:   threshold,
      shrinkage
    }
    const res = await api.post('/erlang/staff/bulk', payload)
    setData(res.data)
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ p:3 }}>
        <Typography variant="h4" gutterBottom>
          Staffing Forecast
        </Typography>

        <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, my:2 }}>
          <DatePicker
            label="Date"
            value={date}
            onChange={d => d && setDate(d)}
            renderInput={params => <TextField {...params} size="small" />}
          />
          <TextField
            label="Call AHT (sec)"
            type="number"
            value={callAht}
            onChange={e => setCallAht(+e.target.value)}
          />
          <TextField
            label="Ticket AHT (sec)"
            type="number"
            value={ticketAht}
            onChange={e => setTicketAht(+e.target.value)}
          />
          <TextField
            label="Service Level %"
            type="number"
            value={serviceLevel * 100}
            onChange={e => setSL(+e.target.value / 100)}
          />
          <TextField
            label="Threshold (sec)"
            type="number"
            value={threshold}
            onChange={e => setThreshold(+e.target.value)}
          />
          <TextField
            label="Shrinkage %"
            type="number"
            value={shrinkage * 100}
            onChange={e => setShrinkage(+e.target.value / 100)}
          />
          <Button variant="contained" onClick={calculate}>
            Calculate
          </Button>
        </Box>

        {!!data.length && (
          <>
            <Typography variant="h6" sx={{ mb:2 }}>
              Agents Required per Hour
            </Typography>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={data}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar
                  dataKey="requiredAgents"
                  name="Agents Needed"
                  onClick={e => console.log(e)}
                />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </Box>
    </LocalizationProvider>
  )
}
