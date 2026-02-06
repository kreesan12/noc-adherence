// frontend/src/pages/TechMyDayPage.jsx
import { useEffect, useState } from 'react'
import {
  Box, Paper, Typography, TextField, Button,
  List, ListItem, ListItemText, Alert
} from '@mui/material'
import dayjs from 'dayjs'
import { listMyAppointments } from '../api/techAppointments'
import { Link, useNavigate } from 'react-router-dom'

export default function TechMyDayPage() {
  const nav = useNavigate()

  const [from, setFrom] = useState(dayjs().format('YYYY-MM-DD'))
  const [to, setTo] = useState(dayjs().add(1, 'day').format('YYYY-MM-DD'))
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const techToken = localStorage.getItem('techToken') || ''
  const techId = localStorage.getItem('techId') || ''
  const techName = localStorage.getItem('techName') || ''

  async function load() {
    setErr('')

    if (!techToken || !techId) {
      nav('/tech/login')
      return
    }

    setLoading(true)
    try {
      // NOTE:
      // This expects your techAppointments API helper to attach Authorization
      // and either:
      // 1) accept technicianId param (current backend style), or
      // 2) ignore technicianId and use req.user.id when mine=true (preferred)
      const r = await listMyAppointments({
        technicianId: techId, // keep for compatibility
        from,
        to,
        mine: true            // harmless if backend ignores, useful if implemented
      })

      setItems(r.data || [])
    } catch (e) {
      console.error(e)
      const status = e?.response?.status
      const msg = e?.response?.data?.error || e?.message || 'Failed to load appointments'

      // If token expired or missing, bounce to login
      if (status === 401 || status === 403) {
        localStorage.removeItem('techToken')
        localStorage.removeItem('techId')
        localStorage.removeItem('techName')
        nav('/tech/login')
        return
      }

      setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!techToken || !techId) nav('/tech/login')
    else load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function logout() {
    localStorage.removeItem('techToken')
    localStorage.removeItem('techId')
    localStorage.removeItem('techName')
    nav('/tech/login')
  }

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h4" gutterBottom>Tech Appointments</Typography>

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="body2" sx={{ mb: 1 }}>
          {techName ? `Logged in as: ${techName}` : `Technician: ${techId || '-'}`}
        </Typography>

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

        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          <Button variant="contained" onClick={load} fullWidth disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button variant="outlined" color="error" onClick={logout}>
            Logout
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>
          My list ({items.length})
        </Typography>

        <List>
          {items.map(a => (
            <ListItem
              key={a.id}
              disableGutters
              component={Link}
              to={`/tech/appointments/${a.id}`}
              sx={{ textDecoration: 'none', color: 'inherit' }}
            >
              <ListItemText
                primary={`${dayjs(a.appointmentDate).format('YYYY-MM-DD')}  Slot ${a.slotNumber || ''}  ${a.ticket?.externalRef || a.ticketId}`}
                secondary={`${a.ticket?.customerName || ''}  ${a.ticket?.address || ''}`}
              />
            </ListItem>
          ))}
        </List>

        {!loading && items.length === 0 && (
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            No appointments in this range.
          </Typography>
        )}
      </Paper>
    </Box>
  )
}
