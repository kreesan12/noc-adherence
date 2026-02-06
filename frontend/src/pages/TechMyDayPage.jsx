// frontend/src/pages/TechMyDayPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Alert,
  Chip,
  Stack,
  IconButton,
  Divider,
  Skeleton
} from '@mui/material'
import dayjs from 'dayjs'
import { listMyAppointments } from '../api/techAppointments'
import { Link, useNavigate } from 'react-router-dom'
import { enqueueEvent, makeClientEventId, countQueuedEvents } from '../utils/techOfflineQueue'
import { safeFlushQueue } from '../utils/techSync'

// Icons
import RefreshIcon from '@mui/icons-material/Refresh'
import LogoutIcon from '@mui/icons-material/Logout'
import DirectionsCarIcon from '@mui/icons-material/DirectionsCar'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import CloudDoneIcon from '@mui/icons-material/CloudDone'

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

function statusMeta(status) {
  const s = String(status || '').toUpperCase()
  if (s === 'COMPLETED') return { label: 'Completed', color: 'success', variant: 'filled' }
  if (s === 'IN_PROGRESS') return { label: 'In progress', color: 'info', variant: 'filled' }
  if (s === 'ARRIVED') return { label: 'Arrived', color: 'primary', variant: 'filled' }
  if (s === 'NEAR_SITE') return { label: 'Near site', color: 'primary', variant: 'outlined' }
  if (s === 'EN_ROUTE') return { label: 'En route', color: 'warning', variant: 'filled' }
  if (s === 'CIVILS_REQUIRED') return { label: 'Civils required', color: 'warning', variant: 'outlined' }
  if (s === 'UNSUCCESSFUL') return { label: 'Unsuccessful', color: 'error', variant: 'filled' }
  if (s === 'SCHEDULED') return { label: 'Scheduled', color: 'default', variant: 'outlined' }
  return { label: status || '-', color: 'default', variant: 'outlined' }
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

  const online = navigator.onLine

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
    <Box sx={{ p: 1.5, maxWidth: 520, mx: 'auto' }}>
      {/* Top header */}
      <Paper
        elevation={0}
        sx={{
          p: 1.5,
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 10,
          zIndex: 2,
          bgcolor: 'background.paper'
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 900, fontSize: 20, lineHeight: 1.1 }}>
              My Day
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.8, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                label={techName || techId || 'Tech'}
                sx={{ fontWeight: 800 }}
              />
              <Chip
                size="small"
                icon={online ? <CloudDoneIcon /> : <CloudOffIcon />}
                color={online ? 'success' : 'warning'}
                label={online ? 'Online' : 'Offline'}
                sx={{ fontWeight: 800 }}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`Queued ${queueCount}`}
                sx={{ fontWeight: 800 }}
              />
            </Stack>
          </Box>

          <Stack direction="row" spacing={0.5}>
            <IconButton onClick={load} disabled={loading} aria-label="Refresh">
              <RefreshIcon />
            </IconButton>
            <IconButton onClick={logout} color="error" aria-label="Logout">
              <LogoutIcon />
            </IconButton>
          </Stack>
        </Stack>

        <Divider sx={{ my: 1.25 }} />

        {/* Date range (stack on phone) */}
        <Stack direction="column" spacing={1}>
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
          <Button
            variant="contained"
            onClick={load}
            disabled={loading}
            startIcon={<RefreshIcon />}
            sx={{ borderRadius: 999, fontWeight: 900, py: 1.2 }}
            fullWidth
          >
            {loading ? 'Loading' : 'Refresh'}
          </Button>
        </Stack>
      </Paper>

      {/* Alerts */}
      <Box sx={{ mt: 1.5 }}>
        {err && <Alert severity="error" sx={{ borderRadius: 3, mb: 1 }}>{err}</Alert>}
        {info && <Alert severity="info" sx={{ borderRadius: 3, mb: 1 }}>{info}</Alert>}
      </Box>

      {/* List header */}
      <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mt: 1.5, mb: 1 }}>
        <Typography sx={{ fontWeight: 900, fontSize: 16 }}>
          Appointments
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.7, fontWeight: 800 }}>
          {sorted.length}
        </Typography>
      </Stack>

      {/* Loading skeletons */}
      {loading && sorted.length === 0 ? (
        <Stack spacing={1.1}>
          {[1, 2, 3].map(x => (
            <Paper key={x} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
              <Skeleton variant="text" width="70%" height={22} />
              <Skeleton variant="text" width="45%" height={18} />
              <Skeleton variant="text" width="90%" height={18} />
              <Skeleton variant="rounded" width="100%" height={44} sx={{ mt: 1 }} />
            </Paper>
          ))}
        </Stack>
      ) : null}

      {/* Empty */}
      {!loading && sorted.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
          <Typography sx={{ fontWeight: 900 }}>No appointments</Typography>
          <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
            Change the dates and refresh.
          </Typography>
        </Paper>
      ) : null}

      {/* Cards */}
      <Stack spacing={1.1}>
        {sorted.map(a => {
          const t = a.ticket || {}
          const meta = statusMeta(a.status)
          const title = `${dayjs(a.appointmentDate).format('YYYY-MM-DD')} • Slot ${a.slotNumber || '-'}`
          const ref = t.externalRef || a.ticketId
          const customer = t.customerName || ''
          const address = t.address || ''

          return (
            <Paper
              key={a.id}
              variant="outlined"
              sx={{
                p: 1.5,
                borderRadius: 4,
                overflow: 'hidden'
              }}
            >
              <Stack spacing={0.8}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 900, lineHeight: 1.15 }}>
                      {ref}
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.75, fontWeight: 800 }}>
                      {title}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={meta.label}
                    color={meta.color}
                    variant={meta.variant}
                    sx={{ fontWeight: 900 }}
                  />
                </Stack>

                {customer ? (
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>
                    {customer}
                  </Typography>
                ) : null}

                {address ? (
                  <Stack direction="row" spacing={0.7} alignItems="center">
                    <LocationOnIcon sx={{ fontSize: 18, opacity: 0.7 }} />
                    <Typography
                      variant="body2"
                      sx={{
                        opacity: 0.8,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {address}
                    </Typography>
                  </Stack>
                ) : null}

                <Stack direction="column" spacing={1} sx={{ mt: 0.5 }}>
                  <Button
                    variant="contained"
                    startIcon={<DirectionsCarIcon />}
                    disabled={loading}
                    onClick={() => startTravel(a.id)}
                    sx={{ borderRadius: 999, fontWeight: 900, py: 1.2 }}
                    fullWidth
                  >
                    Start travel
                  </Button>

                  <Button
                    component={Link}
                    to={`/tech/appointments/${a.id}`}
                    variant="outlined"
                    endIcon={<ChevronRightIcon />}
                    sx={{ borderRadius: 999, fontWeight: 900, py: 1.05 }}
                    fullWidth
                  >
                    Open
                  </Button>
                </Stack>
              </Stack>
            </Paper>
          )
        })}
      </Stack>

      <Box sx={{ height: 16 }} />
    </Box>
  )
}
