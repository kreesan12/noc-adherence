// frontend/src/techApp/TechApp.jsx
import { useEffect, useState } from 'react'
import {
  Box, Paper, Typography, Button, Stack, Chip
} from '@mui/material'
import dayjs from 'dayjs'
import { listMyAppointments } from '../api/techAppointments'
import { enqueueEvent, makeClientEventId } from './offlineQueue'
import { flushQueue } from './sync'
import { useNavigate } from 'react-router-dom'

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

export default function TechApp() {
  const nav = useNavigate()
  const [appts, setAppts] = useState([])
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastSync, setLastSync] = useState(null)

  const techName = localStorage.getItem('techName') || 'Technician'
  const token = localStorage.getItem('techToken')

  useEffect(() => {
    if (!token) nav('/tech/login', { replace: true })
  }, [token])

  async function load() {
    setErr('')
    setBusy(true)
    try {
      const from = dayjs().startOf('day').toISOString()
      const to = dayjs().endOf('day').toISOString()
      const techId = localStorage.getItem('techId') || ''
      const r = await listMyAppointments({ technicianId: techId, from, to, mine: true })
      setAppts(r.data || [])
    } catch (e) {
      setErr(e?.response?.data?.error || e.message)
    } finally {
      setBusy(false)
    }
  }

  async function syncNow() {
    setBusy(true)
    try {
      await flushQueue()
      setLastSync(new Date())
      await load()
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
    const onOnline = () => syncNow()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  async function queueStatus(appointmentId, status) {
    const gps = await getGpsOnce()
    await enqueueEvent({
      clientEventId: makeClientEventId(),
      appointmentId,
      eventType: 'STATUS_CHANGED',
      status,
      lat: gps?.lat,
      lng: gps?.lng,
      payload: { source: 'tech_app' },
      eventTime: new Date().toISOString()
    })
    await syncNow()
  }

  function logout() {
    localStorage.removeItem('techToken')
    localStorage.removeItem('techName')
    nav('/tech/login', { replace: true })
  }

  return (
    <Box sx={{ maxWidth: 760, mx: 'auto', p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            {techName}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
            <Chip size="small" label={navigator.onLine ? 'Online' : 'Offline'} />
            <Chip
              size="small"
              label={lastSync ? `Last sync ${lastSync.toLocaleTimeString()}` : 'Not synced yet'}
              variant="outlined"
            />
          </Stack>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" onClick={load} disabled={busy}>Refresh</Button>
          <Button variant="contained" onClick={syncNow} disabled={busy}>Sync</Button>
          <Button variant="text" onClick={logout}>Logout</Button>
        </Stack>
      </Stack>

      {err ? (
        <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 3 }}>
          <Typography sx={{ color: 'crimson' }}>{err}</Typography>
        </Paper>
      ) : null}

      <Stack spacing={1.2}>
        {appts.map(a => (
          <Paper key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 800 }}>
              {a.ticket?.customerName || 'Customer'}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.85 }}>
              {a.ticket?.externalRef || 'Ticket'} | Slot {a.slotNumber || '?'} | {a.status}
            </Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>
              {a.ticket?.address || 'No address'}
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
              <Button size="small" variant="contained" onClick={() => queueStatus(a.id, 'EN_ROUTE')} disabled={busy}>
                Start travel
              </Button>
              <Button size="small" variant="outlined" onClick={() => queueStatus(a.id, 'NEAR_SITE')} disabled={busy}>
                Near site
              </Button>
              <Button size="small" variant="outlined" onClick={() => queueStatus(a.id, 'ARRIVED')} disabled={busy}>
                Arrived
              </Button>
              <Button size="small" variant="outlined" onClick={() => queueStatus(a.id, 'IN_PROGRESS')} disabled={busy}>
                Start work
              </Button>
              <Button size="small" color="success" variant="contained" onClick={() => queueStatus(a.id, 'COMPLETED')} disabled={busy}>
                Complete
              </Button>
            </Stack>
          </Paper>
        ))}

        {appts.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
            <Typography sx={{ opacity: 0.85 }}>
              No appointments assigned for today.
            </Typography>
          </Paper>
        ) : null}
      </Stack>
    </Box>
  )
}
