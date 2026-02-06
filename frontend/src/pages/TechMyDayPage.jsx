// frontend/src/pages/TechMyDayPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, TextField, Button,
  Alert, Chip, Stack, Skeleton
} from '@mui/material'
import dayjs from 'dayjs'
import { listMyAppointments } from '../api/techAppointments'
import { Link, useNavigate } from 'react-router-dom'
import { enqueueEvent, makeClientEventId, countQueuedEvents } from '../utils/techOfflineQueue'
import { safeFlushQueue } from '../utils/techSync'
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'

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
      nav('/tech/login', { replace: true })
      return
    }

    setLoading(true)
    try {
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
      const status = e?.response?.status
      const msg = e?.response?.data?.error || e?.message || 'Failed to load appointments'

      if (status === 401 || status === 403) {
        localStorage.removeItem('techToken')
        localStorage.removeItem('techId')
        localStorage.removeItem('techName')
        nav('/tech/login', { replace: true })
        return
      }
      setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()

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
      await safeFlushQueue()
      await refreshQueueCount()

      setInfo('Travel started. Opening appointment…')
      nav(`/tech/appointments/${apptId}`)
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || 'Failed to start travel')
    } finally {
      setLoading(false)
    }
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
    <Box sx={{ maxWidth: 860, mx: 'auto' }}>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 950 }}>
          Tech Appointments
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" label={techName ? `Logged in: ${techName}` : `Tech ${techId || '-'}`} />
          <Chip size="small" color={navigator.onLine ? 'success' : 'warning'} label={navigator.onLine ? 'Online' : 'Offline'} />
          <Chip size="small" variant="outlined" label={`Queued: ${queueCount}`} />
        </Stack>

        <Paper sx={{ p: 2, borderRadius: 4 }} variant="outlined">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }}>
            <TextField
              label="From"
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: { xs: '100%', sm: 240 } }}
            />
            <TextField
              label="To"
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: { xs: '100%', sm: 240 } }}
            />

            <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
              <Button variant="outlined" onClick={load} disabled={loading} sx={{ borderRadius: 3 }}>
                {loading ? 'Loading…' : 'Refresh'}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {err && <Alert severity="error">{err}</Alert>}
        {info && <Alert severity="info">{info}</Alert>}
      </Stack>

      <Stack spacing={1.5}>
        {loading && sorted.length === 0 ? (
          <>
            <Skeleton variant="rounded" height={110} />
            <Skeleton variant="rounded" height={110} />
            <Skeleton variant="rounded" height={110} />
          </>
        ) : null}

        {!loading && sorted.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 4 }}>
            <Typography sx={{ fontWeight: 900 }}>No appointments</Typography>
            <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5 }}>
              Nothing scheduled in this date range.
            </Typography>
          </Paper>
        ) : null}

        {sorted.map(a => {
          const t = a.ticket || {}
          const ref = t.externalRef || a.ticketId
          const top = `${dayjs(a.appointmentDate).format('YYYY-MM-DD')}  •  Slot ${a.slotNumber || '-'}`
          const addr = t.address || ''

          return (
            <Paper key={a.id} variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 950, fontSize: 16, lineHeight: 1.2 }}>
                    {ref}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.2 }}>
                    {top}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 1, fontWeight: 800 }}>
                    {t.customerName || ''}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.2 }}>
                    {addr}
                  </Typography>

                  <Stack direction="row" spacing={1} sx={{ mt: 1.2, flexWrap: 'wrap' }}>
                    <Chip size="small" variant="outlined" label={`Status: ${a.status || '-'}`} />
                  </Stack>
                </Box>

                <Stack spacing={1} alignItems="flex-end" sx={{ minWidth: 120 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<DirectionsCarIcon />}
                    disabled={loading}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); startTravel(a.id) }}
                    sx={{ borderRadius: 3 }}
                  >
                    Start
                  </Button>

                  <Button
                    fullWidth
                    component={Link}
                    to={`/tech/appointments/${a.id}`}
                    variant="outlined"
                    endIcon={<ChevronRightIcon />}
                    sx={{ borderRadius: 3 }}
                  >
                    Open
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )
        })}
      </Stack>
    </Box>
  )
}
