// frontend/src/pages/TechAppointmentDetailPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  Alert,
  Divider,
  Stack,
  Chip,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  IconButton,
  Collapse
} from '@mui/material'
import dayjs from 'dayjs'
import { useParams, useNavigate } from 'react-router-dom'
import { getAppointment, submitJobCard, uploadPhoto, uploadSignature } from '../api/techAppointments'
import {
  enqueueEvent,
  makeClientEventId,
  countQueuedEvents,
  listQueuedEventsForAppointment
} from '../utils/techOfflineQueue'
import { safeFlushQueue } from '../utils/techSync'

// Icons
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import NavigationIcon from '@mui/icons-material/Navigation'
import PhoneIcon from '@mui/icons-material/Phone'
import SyncIcon from '@mui/icons-material/Sync'
import NearMeIcon from '@mui/icons-material/NearMe'
import PlaceIcon from '@mui/icons-material/Place'
import PlayCircleIcon from '@mui/icons-material/PlayCircle'
import CheckCircleIcon from '@mui/icons-material/CheckCircle'
import HelpIcon from '@mui/icons-material/Help'
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera'
import DrawIcon from '@mui/icons-material/Draw'
import TimelineIcon from '@mui/icons-material/Timeline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'

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

function openNavigation(ticket) {
  const lat = ticket?.lat
  const lng = ticket?.lng
  const address = ticket?.address || ''
  const url = (lat != null && lng != null)
    ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
  window.open(url, '_blank', 'noopener,noreferrer')
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
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

const UNSUCCESSFUL_REASONS = [
  { code: 'NO_ACCESS', label: 'No access to site' },
  { code: 'CUSTOMER_NOT_AVAILABLE', label: 'Customer not available' },
  { code: 'FAULT_NOT_RESOLVED', label: 'Fault not resolved' },
  { code: 'POWER_ISSUE', label: 'Power issue' },
  { code: 'CIVILS_REQUIRED', label: 'Civils required' },
  { code: 'OTHER', label: 'Other' }
]

export default function TechAppointmentDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()

  const [appt, setAppt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  const [notes, setNotes] = useState('')
  const [reasonCode, setReasonCode] = useState('NO_ACCESS')
  const [civilsRequired, setCivilsRequired] = useState(false)
  const [customerRating, setCustomerRating] = useState('')

  const [queueCount, setQueueCount] = useState(0)
  const [apptQueueCount, setApptQueueCount] = useState(0)

  const [showCloseout, setShowCloseout] = useState(false)
  const [showTimeline, setShowTimeline] = useState(false)

  const online = navigator.onLine

  async function refreshQueueCounts() {
    const c = await countQueuedEvents()
    setQueueCount(c)
    const per = await listQueuedEventsForAppointment(id)
    setApptQueueCount(per.length)
  }

  async function load() {
    setErr('')
    const r = await getAppointment(id)
    setAppt(r.data)

    await safeFlushQueue()
    await refreshQueueCounts()

    const jc = r.data?.jobCard
    if (jc?.notes && !notes) setNotes(jc.notes)
  }

  useEffect(() => {
    load().catch(e => {
      const status = e?.response?.status
      const m = e?.response?.data?.error || e?.message || 'Failed to load appointment'
      setErr(m)
      if (status === 401 || status === 403) {
        localStorage.removeItem('techToken')
        localStorage.removeItem('techId')
        localStorage.removeItem('techName')
        nav('/tech/login')
      }
    })

    const onOnline = async () => {
      await safeFlushQueue()
      await refreshQueueCounts()
      await load().catch(() => {})
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const ticket = appt?.ticket || {}
  const meta = statusMeta(appt?.status)

  const timeline = useMemo(() => {
    const ev = Array.isArray(appt?.events) ? [...appt.events] : []
    ev.sort((a, b) => {
      const ta = new Date(a.createdAt || a.eventTime || 0).getTime()
      const tb = new Date(b.createdAt || b.eventTime || 0).getTime()
      return tb - ta
    })
    return ev
  }, [appt])

  async function queueAndTrySend({ eventType, status: newStatus, payload }) {
    setErr('')
    setMsg('')
    setBusy(true)
    try {
      const gps = await getGpsOnce()
      await enqueueEvent({
        clientEventId: makeClientEventId('cev_evt'),
        appointmentId: id,
        eventType,
        status: newStatus || null,
        lat: gps?.lat,
        lng: gps?.lng,
        payload: { ...(payload || {}), source: 'tech_detail' },
        eventTime: new Date().toISOString()
      })

      await refreshQueueCounts()

      if (online) {
        await safeFlushQueue()
        await refreshQueueCounts()
        await load()
        setMsg('Saved')
      } else {
        setMsg('Queued offline. Will sync when online.')
      }
    } catch (e) {
      const m = e?.response?.data?.error || e?.message || 'Failed to queue/send event'
      setErr(m)
    } finally {
      setBusy(false)
    }
  }

  async function doSubmitJobCard(outcome) {
    setErr('')
    setMsg('')
    setBusy(true)
    try {
      if (!online) {
        setErr('You are offline. Please submit the job card when you are back online.')
        return
      }

      await submitJobCard(id, {
        clientEventId: makeClientEventId('cev_job'),
        outcome,
        reasonCode: outcome === 'UNSUCCESSFUL' ? reasonCode : null,
        notes: notes || null,
        civilsRequired: Boolean(civilsRequired),
        customerRating: customerRating === '' ? null : Number(customerRating)
      })
      setMsg('Job card submitted')
      await load()
    } catch (e) {
      const m = e?.response?.data?.error || e?.message || 'Failed to submit job card'
      setErr(m)
    } finally {
      setBusy(false)
    }
  }

  async function onPickPhoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return

    setErr('')
    setMsg('')
    setBusy(true)
    try {
      if (!online) {
        setErr('You are offline. Photo upload requires internet for now.')
        return
      }
      const dataUrl = await fileToDataUrl(f)
      await uploadPhoto(id, { clientEventId: makeClientEventId('cev_photo'), dataUrl })
      setMsg('Photo uploaded')
      await load()
    } catch (ex) {
      const m = ex?.response?.data?.error || ex?.message || 'Failed to upload photo'
      setErr(m)
    } finally {
      setBusy(false)
    }
  }

  async function onPickSignature(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return

    setErr('')
    setMsg('')
    setBusy(true)
    try {
      if (!online) {
        setErr('You are offline. Signature upload requires internet for now.')
        return
      }
      const dataUrl = await fileToDataUrl(f)
      await uploadSignature(id, {
        clientEventId: makeClientEventId('cev_sig'),
        dataUrl,
        signedByName: ticket?.customerName || null
      })
      setMsg('Signature uploaded')
      await load()
    } catch (ex) {
      const m = ex?.response?.data?.error || ex?.message || 'Failed to upload signature'
      setErr(m)
    } finally {
      setBusy(false)
    }
  }

  function callCustomer() {
    const phone = ticket?.customerPhone
    if (!phone) return
    window.location.href = `tel:${phone}`
  }

  if (!appt) {
    return (
      <Box sx={{ p: 1.5, maxWidth: 520, mx: 'auto' }}>
        {err ? <Alert severity="error" sx={{ borderRadius: 3 }}>{err}</Alert> : <Typography>Loading…</Typography>}
      </Box>
    )
  }

  return (
    <Box sx={{ p: 1.5, pb: 12, maxWidth: 520, mx: 'auto' }}>
      {/* Sticky top bar */}
      <Paper
        elevation={0}
        sx={{
          p: 1.25,
          borderRadius: 4,
          border: '1px solid',
          borderColor: 'divider',
          position: 'sticky',
          top: 10,
          zIndex: 2,
          bgcolor: 'background.paper'
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1}>
          <IconButton onClick={() => nav('/tech/my-day')} aria-label="Back">
            <ArrowBackIcon />
          </IconButton>

          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography sx={{ fontWeight: 950, lineHeight: 1.1 }}>
              {ticket.externalRef || appt.ticketId}
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.75, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ticket.customerName || ''}
            </Typography>
          </Box>

          <Chip size="small" label={meta.label} color={meta.color} variant={meta.variant} sx={{ fontWeight: 900 }} />
        </Stack>

        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
          <Chip size="small" label={online ? 'Online' : 'Offline'} color={online ? 'success' : 'warning'} sx={{ fontWeight: 900 }} />
          <Chip size="small" variant="outlined" label={`Queued ${queueCount}`} sx={{ fontWeight: 800 }} />
          <Chip size="small" variant="outlined" label={`Here ${apptQueueCount}`} sx={{ fontWeight: 800 }} />
        </Stack>
      </Paper>

      {/* Alerts */}
      <Box sx={{ mt: 1.5 }}>
        {err && <Alert severity="error" sx={{ borderRadius: 3, mb: 1 }}>{err}</Alert>}
        {msg && <Alert severity="info" sx={{ borderRadius: 3, mb: 1 }}>{msg}</Alert>}
      </Box>

      {/* Customer card */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 4, mt: 1.5 }}>
        <Typography sx={{ fontWeight: 950 }}>{ticket.customerName || 'Customer'}</Typography>
        {ticket.customerPhone ? (
          <Typography variant="body2" sx={{ opacity: 0.85, fontWeight: 800, mt: 0.25 }}>
            {ticket.customerPhone}
          </Typography>
        ) : null}
        {ticket.address ? (
          <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.6 }}>
            {ticket.address}
          </Typography>
        ) : null}

        <Divider sx={{ my: 1.25 }} />

        <Stack direction="column" spacing={1}>
          <Button
            variant="contained"
            startIcon={<NavigationIcon />}
            onClick={() => openNavigation(ticket)}
            disabled={busy}
            fullWidth
            sx={{ borderRadius: 999, fontWeight: 900, py: 1.2 }}
          >
            Open navigation
          </Button>

          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<PhoneIcon />}
              onClick={callCustomer}
              disabled={!ticket.customerPhone || busy}
              fullWidth
              sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
            >
              Call
            </Button>
            <Button
              variant="outlined"
              startIcon={<SyncIcon />}
              onClick={async () => { await safeFlushQueue(); await refreshQueueCounts(); await load() }}
              disabled={busy}
              fullWidth
              sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
            >
              Sync
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {/* Photos and signature */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 4, mt: 1.5 }}>
        <Typography sx={{ fontWeight: 950 }}>Photos and signature</Typography>
        <Stack direction="column" spacing={1} sx={{ mt: 1 }}>
          <Button
            variant="outlined"
            component="label"
            startIcon={<PhotoCameraIcon />}
            disabled={busy}
            fullWidth
            sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
          >
            Upload photo
            <input hidden type="file" accept="image/*" capture="environment" onChange={onPickPhoto} />
          </Button>

          <Button
            variant="outlined"
            component="label"
            startIcon={<DrawIcon />}
            disabled={busy}
            fullWidth
            sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
          >
            Upload signature
            <input hidden type="file" accept="image/*" capture="user" onChange={onPickSignature} />
          </Button>
        </Stack>

        <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, mt: 1 }}>
          Uploads need internet for now. Status actions are offline safe.
        </Typography>
      </Paper>

      {/* Close out collapsible */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 4, mt: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography sx={{ fontWeight: 950 }}>Close out</Typography>
          <Button
            onClick={() => setShowCloseout(v => !v)}
            endIcon={showCloseout ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ fontWeight: 900, textTransform: 'none' }}
          >
            {showCloseout ? 'Hide' : 'Open'}
          </Button>
        </Stack>

        <Collapse in={showCloseout} timeout="auto" unmountOnExit>
          <Box sx={{ mt: 1.2 }}>
            <TextField
              label="Notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              fullWidth
              multiline
              minRows={3}
            />

            <Stack direction="column" spacing={1.2} sx={{ mt: 1.5 }}>
              <FormControl size="small" fullWidth>
                <InputLabel>Unsuccessful reason</InputLabel>
                <Select
                  label="Unsuccessful reason"
                  value={reasonCode}
                  onChange={e => setReasonCode(e.target.value)}
                >
                  {UNSUCCESSFUL_REASONS.map(r => (
                    <MenuItem key={r.code} value={r.code}>{r.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth>
                <InputLabel>Civils required</InputLabel>
                <Select
                  label="Civils required"
                  value={civilsRequired ? 'YES' : 'NO'}
                  onChange={e => setCivilsRequired(e.target.value === 'YES')}
                >
                  <MenuItem value="NO">No</MenuItem>
                  <MenuItem value="YES">Yes</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Customer rating (1-5)"
                value={customerRating}
                onChange={e => setCustomerRating(e.target.value)}
                size="small"
                fullWidth
              />
            </Stack>

            <Stack direction="column" spacing={1} sx={{ mt: 1.5 }}>
              <Button
                color="success"
                variant="contained"
                onClick={() => doSubmitJobCard('SUCCESSFUL')}
                disabled={busy}
                fullWidth
                sx={{ borderRadius: 999, fontWeight: 900, py: 1.2 }}
              >
                Submit successful
              </Button>
              <Button
                color="error"
                variant="contained"
                onClick={() => doSubmitJobCard('UNSUCCESSFUL')}
                disabled={busy}
                fullWidth
                sx={{ borderRadius: 999, fontWeight: 900, py: 1.2 }}
              >
                Submit unsuccessful
              </Button>
            </Stack>
          </Box>
        </Collapse>
      </Paper>

      {/* Timeline collapsible */}
      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 4, mt: 1.5 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Stack direction="row" spacing={1} alignItems="center">
            <TimelineIcon />
            <Typography sx={{ fontWeight: 950 }}>Timeline</Typography>
          </Stack>
          <Button
            onClick={() => setShowTimeline(v => !v)}
            endIcon={showTimeline ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ fontWeight: 900, textTransform: 'none' }}
          >
            {showTimeline ? 'Hide' : 'Show'}
          </Button>
        </Stack>

        <Collapse in={showTimeline} timeout="auto" unmountOnExit>
          <Stack spacing={1} sx={{ mt: 1.2 }}>
            {timeline.length === 0 ? (
              <Typography variant="body2" sx={{ opacity: 0.75 }}>
                No events yet.
              </Typography>
            ) : (
              timeline.slice(0, 12).map(ev => (
                <Paper key={ev.id} variant="outlined" sx={{ p: 1.2, borderRadius: 3, bgcolor: 'rgba(0,0,0,0.02)' }}>
                  <Stack direction="row" justifyContent="space-between" alignItems="baseline" spacing={1}>
                    <Typography sx={{ fontWeight: 900 }}>{ev.eventType}</Typography>
                    <Typography variant="caption" sx={{ opacity: 0.75, fontWeight: 800 }}>
                      {dayjs(ev.createdAt || ev.eventTime || new Date()).format('YYYY-MM-DD HH:mm')}
                    </Typography>
                  </Stack>
                  {ev.actorType ? (
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      {ev.actorType}
                    </Typography>
                  ) : null}
                </Paper>
              ))
            )}
          </Stack>
        </Collapse>
      </Paper>

      {/* Sticky bottom action bar (thumb friendly) */}
      <Paper
        elevation={8}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          p: 1.2,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}
      >
        <Box sx={{ maxWidth: 520, mx: 'auto' }}>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              startIcon={<NearMeIcon />}
              onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'NEAR_SITE' })}
              disabled={busy}
              fullWidth
              sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
            >
              Near
            </Button>
            <Button
              variant="outlined"
              startIcon={<PlaceIcon />}
              onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'ARRIVED' })}
              disabled={busy}
              fullWidth
              sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
            >
              Arrived
            </Button>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Button
              variant="outlined"
              startIcon={<PlayCircleIcon />}
              onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'IN_PROGRESS' })}
              disabled={busy}
              fullWidth
              sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
            >
              Start
            </Button>
            <Button
              color="success"
              variant="contained"
              startIcon={<CheckCircleIcon />}
              onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'COMPLETED' })}
              disabled={busy}
              fullWidth
              sx={{ borderRadius: 999, fontWeight: 900, py: 1.1 }}
            >
              Complete
            </Button>
          </Stack>

          <Button
            variant="text"
            startIcon={<HelpIcon />}
            onClick={() => queueAndTrySend({ eventType: 'ASSISTANCE_REQUESTED', status: null, payload: { note: notes || 'Need assistance' } })}
            disabled={busy}
            fullWidth
            sx={{ mt: 0.5, fontWeight: 900, textTransform: 'none' }}
          >
            Request assistance
          </Button>
        </Box>
      </Paper>
    </Box>
  )
}
