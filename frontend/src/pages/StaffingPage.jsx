// frontend/src/pages/StaffingPage.jsx
import { useState } from 'react'
import { Box, TextField, Button, Typography } from '@mui/material'
import api from '../api'

export default function StaffingPage() {
  const [callsPerHour, setCalls] = useState(100)
  const [aht, setAht]             = useState(300)
  const [serviceLevel, setSL]     = useState(0.8)
  const [threshold, setThresh]    = useState(20)
  const [shrinkage, setShrink]    = useState(0.3)
  const [required, setRequired]   = useState(null)

  const calculate = async () => {
    const res = await api.post('/erlang/staff', {
      callsPerHour, ahtSeconds: aht,
      serviceLevel, thresholdSeconds: threshold,
      shrinkage
    })
    setRequired(res.data.requiredAgents)
  }

  return (
    <Box sx={{ p:3 }}>
      <Typography variant="h4">Staffing Calculator</Typography>
      <Box sx={{ display:'flex', flexWrap:'wrap', gap:2, my:2 }}>
        <TextField
          label="Calls / hour"
          type="number" value={callsPerHour}
          onChange={e => setCalls(+e.target.value)}
        />
        <TextField
          label="AHT (sec)"
          type="number" value={aht}
          onChange={e => setAht(+e.target.value)}
        />
        <TextField
          label="Service level (%)"
          type="number" value={serviceLevel*100}
          onChange={e => setSL(+e.target.value/100)}
        />
        <TextField
          label="Threshold (sec)"
          type="number" value={threshold}
          onChange={e => setThresh(+e.target.value)}
        />
        <TextField
          label="Shrinkage (%)"
          type="number" value={shrinkage*100}
          onChange={e => setShrink(+e.target.value/100)}
        />
        <Button variant="contained" onClick={calculate}>Calculate</Button>
      </Box>
      {required != null && (
        <Typography variant="h5">
          Required Agents (incl. shrinkage): {required}
        </Typography>
      )}
    </Box>
  )
}
