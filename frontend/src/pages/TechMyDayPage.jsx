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
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 20000 }
    )
  })
}

function isStartedStatus(status) {
  const s = String(status || '').toUpperCase()
  return ['EN_ROUTE', 'NEAR_SITE', 'ARRIVED', 'IN_PROGRESS'].includes(s)
}

function isClosedStatus(status) {
  const s = String(status || '').toUpperCase()
  return ['COMPLETED', 'UNSUCCESSFUL', 'CIVILS_REQUIRED', 'CANCELLED'].includes(s)
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
        payload: { source: 'tech_my_day', accuracy: gps?.accuracy ?? null },
        eventTime: new Date().toISOString()
      })

      await refreshQueueCount()
      if (navigator.onLine) {
        await safeFlushQueue()
        await refreshQueueCount()
      }

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
    <Box sx={{ maxWidth: 820, mx: 'auto' }}>
      <Stack spacing={1} sx={{ mb: 1.25 }}>
        <Typography variant="h6" sx={{ fontWeight: 900 }}>
          Tech Appointments
        </Typography>

        <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" label={techName ? `Logged in: ${techName}` : `Tech ${techId || '-'}`} />
          <Chip size="small" color={navigator.onLine ? 'success' : 'warning'} label={navigator.onLine ? 'Online' : 'Offline'} />
          <Chip size="small" variant="outlined" label={`Queued: ${queueCount}`} />
        </Stack>

        <Paper sx={{ p: 1.5, borderRadius: 2.5 }} variant="outlined">
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField
              label="From"
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: { xs: '100%', sm: 220 } }}
            />
            <TextField
              label="To"
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ width: { xs: '100%', sm: 220 } }}
            />

            <Stack direction="row" spacing={0.75} sx={{ ml: 'auto' }}>
              <Button variant="outlined" onClick={load} disabled={loading} sx={{ borderRadius: 2 }}>
                {loading ? 'Loading…' : 'Refresh'}
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {err && <Alert severity="error">{err}</Alert>}
        {info && <Alert severity="info">{info}</Alert>}
      </Stack>

      <Stack spacing={1}>
        {loading && sorted.length === 0 ? (
          <>
            <Skeleton variant="rounded" height={110} />
            <Skeleton variant="rounded" height={110} />
            <Skeleton variant="rounded" height={110} />
          </>
        ) : null}

        {!loading && sorted.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 1.75, borderRadius: 2.5 }}>
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
          const st = String(a.status || '').toUpperCase()

          const started = isStartedStatus(st)
          const closed = isClosedStatus(st)

          // Primary action rules:
          // - If not started and not closed: show Start travel
          // - Else: show Open/View only
          const canStartTravel = !started && !closed

          const openLabel =
            closed ? 'View' :
            started ? 'Open (in progress)' :
            'Open'

          return (
            <Paper key={a.id} variant="outlined" sx={{ p: 1.5, borderRadius: 2.5 }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 900, fontSize: 14.5, lineHeight: 1.15 }}>
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

                  <Stack direction="row" spacing={0.75} sx={{ mt: 0.85, flexWrap: 'wrap' }}>
                    <Chip size="small" variant="outlined" label={`Status: ${a.status || '-'}`} />
                  </Stack>
                </Box>

                <Stack spacing={0.75} alignItems="flex-end" sx={{ minWidth: 150 }}>
                  {canStartTravel ? (
                    <Button
                      fullWidth
                      variant="contained"
                      startIcon={<DirectionsCarIcon />}
                      disabled={loading}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); startTravel(a.id) }}
                      sx={{ borderRadius: 2 }}
                    >
                      Start travel
                    </Button>
                  ) : (
                    <Button
                      fullWidth
                      variant="outlined"
                      disabled
                      sx={{ borderRadius: 2 }}
                    >
                      {started ? 'Already en route' : 'Closed'}
                    </Button>
                  )}

                  <Button
                    fullWidth
                    component={Link}
                    to={`/tech/appointments/${a.id}`}
                    variant="outlined"
                    endIcon={<ChevronRightIcon />}
                    sx={{ borderRadius: 2 }}
                  >
                    {openLabel}
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
