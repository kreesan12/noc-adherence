import { useEffect, useState } from 'react'
import { Box, Paper, Typography, TextField, Button, List, ListItem, ListItemText } from '@mui/material'
import dayjs from 'dayjs'
import { listMyAppointments } from '../api/techAppointments'
import { Link } from 'react-router-dom'

export default function TechMyDayPage() {
  const [technicianId, setTechnicianId] = useState('tech_lutendo_001')
  const [from, setFrom] = useState(dayjs().format('YYYY-MM-DD'))
  const [to, setTo] = useState(dayjs().add(1, 'day').format('YYYY-MM-DD'))
  const [items, setItems] = useState([])

  async function load() {
    const r = await listMyAppointments({ technicianId, from, to })
    setItems(r.data)
  }

  useEffect(() => { load() }, [])

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom>Tech Appointments</Typography>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Temporary technician picker for now
        </Typography>

        <TextField
          label="Technician ID"
          value={technicianId}
          onChange={e => setTechnicianId(e.target.value)}
          size="small"
          fullWidth
          sx={{ mb: 2 }}
        />

        <Box sx={{ display: 'flex', gap: 2 }}>
          <TextField
            label="From"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            fullWidth
          />
          <TextField
            label="To"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            fullWidth
          />
        </Box>

        <Button variant="contained" onClick={load} sx={{ mt: 2 }} fullWidth>
          Refresh
        </Button>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>My list</Typography>
        <List>
          {items.map(a => (
            <ListItem key={a.id} disableGutters component={Link} to={`/tech/appointments/${a.id}`} sx={{ textDecoration: 'none', color: 'inherit' }}>
              <ListItemText
                primary={`${dayjs(a.appointmentDate).format('YYYY-MM-DD')}  Slot ${a.slotNumber || ''}  ${a.ticket?.externalRef || a.ticketId}`}
                secondary={`${a.ticket?.customerName || ''}  ${a.ticket?.address || ''}`}
              />
            </ListItem>
          ))}
        </List>
      </Paper>
    </Box>
  )
}
