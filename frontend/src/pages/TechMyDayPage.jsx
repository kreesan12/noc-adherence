// frontend/src/pages/TechMyDayPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, TextField, Button,
  List, ListItem, ListItemText, Alert, Chip, Stack
} from '@mui/material'
import dayjs from 'dayjs'
import { listMyAppointments } from '../api/techAppointments'
import { Link, useNavigate } from 'react-router-dom'
import { enqueueEvent, makeClientEventId, countQueuedEvents } from '../utils/techOfflineQueue'
import { safeFlushQueue } from '../utils/techSync'

async function getGpsOnce() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 20000 }
    )
  })
}

export default function TechMyDayPage() {
  const nav = useNavigate()

  const [from, setFrom] = useState(dayjs().format('YYYY-MM-DD'))
  const [to, setTo] = useState(dayjs().add(1, 'day').format('YYYY-MM-DD'))
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState('')
  const [queueCount, setQueueCount] = useState(0)

  const techToken = localStorage.getItem('techToken') || ''
  const techId = localStorage.getItem('techId') || ''
  const techName = localStorage.getItem('techName') || ''

  async function refreshQueueCount() {
    const c = await countQueuedEvents()
    setQueueCount(c)
  }

  async function load() {
    setErr('')
    setInfo('')

    if (!techToken || !techId) {
      nav('/tech/login')
      return
    }

    setLoading(true)
    try {
      // try to flush any pending events first when online
      await safeFlushQueue()
      await refreshQueueCount()

      const r = await listMyAppointments({
        technicianId: techId,
        from,
        to,
        mine: true
      })

      setItems(r.data || [])
    } catch (e) {
      console.error(e)
      const status = e?.response?.status
      const msg = e?.response?.data?.error || e?.message || 'Failed to load appointments'

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

    const onOnline = async () => {
      await safeFlushQueue()
      await refreshQueueCount()
      await load()
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function startTravel(apptId) {
    setErr('')
    setInfo('')
    setLoading(true)
    try {
      const gps = await getGpsOnce()

      // Always queue first (so it’s offline-safe even if signal drops mid-click)
      await enqueueEvent({
        clientEventId: makeClientEventId('cev_travel'),
        appointmentId: apptId,
        eventType: 'STATUS_CHANGED',
        status: 'EN_ROUTE',
        lat: gps?.lat,
        lng: gps?.lng,
        payload: { source: 'tech_my_day' },
        eventTime: new Date().toISOString()
      })

      await refreshQueueCount()

      // If online, try flush immediately
      await safeFlushQueue()
      await refreshQueueCount()

      setInfo('Start travel captured. Opening appointment…')
      nav(`/tech/appointments/${apptId}`)
    } catch (e) {
      const msg = e?.response?.data?.error || e?.message || 'Failed to start travel'
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  function logout() {
    localStorage.removeItem('techToken')
    localStorage.removeItem('techId')
    localStorage.removeItem('techName')
    nav('/tech/login')
  }

  const sorted = useMemo(() => {
    const s = [...items]
    s.sort((a, b) => {
      const da = new Date(a.appointmentDate).getTime()
      const db = new Date(b.appointmentDate).getTime()
      if (da !== db) return da - db
      return (a.slotNumber || 999) - (b.slotNumber || 999)
    })
    return s
  }, [items])

  return (
    <Box sx={{ p: 2, maxWidth: 780, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }} spacing={2}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800 }} gutterBottom>
            Tech Appointments
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            <Chip size="small" label={techName ? `Logged in as ${techName}` : `Technician ${techId || '-'}`} />
            <Chip size="small" color={navigator.onLine ? 'success' : 'warning'} label={navigator.onLine ? 'Online' : 'Offline'} />
            <Chip size="small" variant="outlined" label={`Queued: ${queueCount}`} />
          </Stack>
        </Box>

        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
          <Button variant="outlined" onClick={load} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </Button>
          <Button variant="outlined" color="error" onClick={logout}>
            Logout
          </Button>
        </Stack>
      </Stack>

      {err && <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert>}
      {info && <Alert severity="info" sx={{ mb: 2 }}>{info}</Alert>}

      <Paper sx={{ p: 2, mb: 2, borderRadius: 3 }} variant="outlined">
        <Typography variant="subtitle2" sx={{ opacity: 0.8, mb: 1 }}>
          Date range
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <TextField
            label="From"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            sx={{ minWidth: 240 }}
          />
          <TextField
            label="To"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            sx={{ minWidth: 240 }}
          />
        </Box>
      </Paper>

      <Paper sx={{ p: 2, borderRadius: 3 }} variant="outlined">
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 800 }}>
          My list ({sorted.length})
        </Typography>

        <List disablePadding>
          {sorted.map(a => {
            const t = a.ticket || {}
            const primary = `${dayjs(a.appointmentDate).format('YYYY-MM-DD')}  Slot ${a.slotNumber || ''}  ${t.externalRef || a.ticketId}`
            const secondary = `${t.customerName || ''}${t.address ? `  •  ${t.address}` : ''}`

            return (
              <Paper key={a.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2, mb: 1.2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'center' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <ListItem
                      disableGutters
                      component={Link}
                      to={`/tech/appointments/${a.id}`}
                      sx={{ textDecoration: 'none', color: 'inherit', px: 0, py: 0 }}
                    >
                      <ListItemText
                        primary={primary}
                        secondary={secondary}
                        primaryTypographyProps={{ sx: { fontWeight: 800 } }}
                      />
                    </ListItem>
                    <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                      <Chip size="small" label={`Status: ${a.status || '-'}`} variant="outlined" />
                    </Stack>
                  </Box>

                  <Stack spacing={1} alignItems="flex-end">
                    <Button
                      variant="contained"
                      disabled={loading}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); startTravel(a.id) }}
                    >
                      Start travel
                    </Button>

                    <Button
                      variant="text"
                      component={Link}
                      to={`/tech/appointments/${a.id}`}
                      sx={{ textTransform: 'none' }}
                    >
                      Open
                    </Button>
                  </Stack>
                </Box>
              </Paper>
            )
          })}
        </List>

        {!loading && sorted.length === 0 && (
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            No appointments in this range.
          </Typography>
        )}
      </Paper>
    </Box>
  )
}
