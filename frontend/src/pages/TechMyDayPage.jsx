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
import AssignmentIcon from '@mui/icons-material/Assignment'
import LocationOnIcon from '@mui/icons-material/LocationOn'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import CloudOffIcon from '@mui/icons-material/CloudOff'
import CloudDoneIcon from '@mui/icons-material/CloudDone'
import BadgeIcon from '@mui/icons-material/Badge'

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

  const online = navigator.onLine

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, maxWidth: 860, mx: 'auto' }}>
      {/* Header */}
      <Paper
        elevation={0}
        sx={{
          p: 2,
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(245,247,250,1) 100%)'
        }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 900, letterSpacing: 0.2 }}>
              Tech Appointments
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <Chip
                size="small"
                icon={<BadgeIcon />}
                label={techName ? techName : (techId ? `Tech ${techId}` : 'Technician')}
                sx={{ fontWeight: 700 }}
              />
              <Chip
                size="small"
                icon={online ? <CloudDoneIcon /> : <CloudOffIcon />}
                color={online ? 'success' : 'warning'}
                label={online ? 'Online' : 'Offline'}
                sx={{ fontWeight: 700 }}
              />
              <Chip
                size="small"
                variant="outlined"
                label={`Queued ${queueCount}`}
                sx={{ fontWeight: 700 }}
              />
            </Stack>
          </Box>

          <Stack direction="row" spacing={1}>
            <IconButton onClick={load} disabled={loading} aria-label="Refresh">
              <RefreshIcon />
            </IconButton>
            <IconButton onClick={logout} color="error" aria-label="Logout">
              <LogoutIcon />
            </IconButton>
          </Stack>
        </Stack>

        <Divider sx={{ my: 2 }} />

        {/* Date range */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Chip size="small" icon={<CalendarMonthIcon />} label="Date range" variant="outlined" />
          <TextField
            label="From"
            type="date"
            value={from}
            onChange={e => setFrom(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            sx={{ maxWidth: 240 }}
          />
          <TextField
            label="To"
            type="date"
            value={to}
            onChange={e => setTo(e.target.value)}
            InputLabelProps={{ shrink: true }}
            size="small"
            sx={{ maxWidth: 240 }}
          />
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={load}
            disabled={loading}
            startIcon={<RefreshIcon />}
            sx={{ borderRadius: 999, px: 2.2, fontWeight: 800 }}
          >
            {loading ? 'Loading' : 'Refresh'}
          </Button>
        </Stack>
      </Paper>

      {/* Alerts */}
      <Box sx={{ mt: 2 }}>
        {err && <Alert severity="error" sx={{ borderRadius: 3, mb: 1.5 }}>{err}</Alert>}
        {info && <Alert severity="info" sx={{ borderRadius: 3, mb: 1.5 }}>{info}</Alert>}
      </Box>

      {/* List */}
      <Box sx={{ mt: 1.5 }}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 900 }}>
            Today view
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.75, fontWeight: 700 }}>
            {sorted.length} appointment{sorted.length === 1 ? '' : 's'}
          </Typography>
        </Stack>

        {loading && sorted.length === 0 ? (
          <Stack spacing={1.2}>
            {[1, 2, 3].map(x => (
              <Paper key={x} variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Skeleton variant="text" width="60%" height={26} />
                <Skeleton variant="text" width="35%" height={20} />
                <Skeleton variant="text" width="80%" height={20} />
                <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
                  <Skeleton variant="rounded" width={120} height={34} />
                  <Skeleton variant="rounded" width={100} height={34} />
                </Stack>
              </Paper>
            ))}
          </Stack>
        ) : null}

        {!loading && sorted.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3 }}>
            <Typography sx={{ fontWeight: 800 }}>No appointments in this range</Typography>
            <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
              Adjust your dates, then refresh.
            </Typography>
          </Paper>
        ) : null}

        <Stack spacing={1.2}>
          {sorted.map(a => {
            const t = a.ticket || {}
            const meta = statusMeta(a.status)
            const primary = `${dayjs(a.appointmentDate).format('YYYY-MM-DD')}  Slot ${a.slotNumber || ''}  ${t.externalRef || a.ticketId}`
            const subtitle = t.customerName || ''
            const address = t.address || ''

            return (
              <Paper
                key={a.id}
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 3,
                  borderColor: 'divider',
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                  '&:active': { transform: 'scale(0.995)' }
                }}
              >
                <Stack direction="row" spacing={1.5} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: 2.5,
                      display: 'grid',
                      placeItems: 'center',
                      bgcolor: 'rgba(0,0,0,0.04)',
                      flex: '0 0 auto'
                    }}
                  >
                    <AssignmentIcon />
                  </Box>

                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 900, lineHeight: 1.2 }}>
                      {primary}
                    </Typography>

                    <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.4, fontWeight: 700 }}>
                      {subtitle}
                    </Typography>

                    {address ? (
                      <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mt: 0.6 }}>
                        <LocationOnIcon sx={{ fontSize: 18, opacity: 0.7 }} />
                        <Typography variant="body2" sx={{ opacity: 0.78, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {address}
                        </Typography>
                      </Stack>
                    ) : null}

                    <Stack direction="row" spacing={1} sx={{ mt: 1.2, flexWrap: 'wrap' }}>
                      <Chip
                        size="small"
                        label={meta.label}
                        color={meta.color}
                        variant={meta.variant}
                        sx={{ fontWeight: 800 }}
                      />
                    </Stack>
                  </Box>

                  <Stack spacing={1} alignItems="flex-end" sx={{ flex: '0 0 auto' }}>
                    <Button
                      variant="contained"
                      startIcon={<DirectionsCarIcon />}
                      disabled={loading}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        startTravel(a.id)
                      }}
                      sx={{ borderRadius: 999, fontWeight: 900, px: 2 }}
                    >
                      Start travel
                    </Button>

                    <Button
                      component={Link}
                      to={`/tech/appointments/${a.id}`}
                      variant="text"
                      endIcon={<ChevronRightIcon />}
                      sx={{ fontWeight: 900, textTransform: 'none' }}
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
    </Box>
  )
}
