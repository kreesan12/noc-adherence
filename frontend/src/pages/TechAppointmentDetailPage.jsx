// frontend/src/pages/TechAppointmentDetailPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, TextField, Alert, Divider,
  Stack, Chip, MenuItem, Select, FormControl, InputLabel
} from '@mui/material'
import dayjs from 'dayjs'
import { useParams, useNavigate } from 'react-router-dom'
import {
  getAppointment,
  submitJobCard,
  uploadPhoto,
  uploadSignature
} from '../api/techAppointments'
import {
  enqueueEvent,
  makeClientEventId,
  countQueuedEvents,
  listQueuedEventsForAppointment
} from '../utils/techOfflineQueue'
import { safeFlushQueue } from '../utils/techSync'
import TechRouteMap from '../components/TechRouteMap'

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

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

const UNSUCCESSFUL_REASONS = [
  { code: 'NO_ACCESS', label: 'No access to site' },
  { code: 'CUSTOMER_NOT_AVAILABLE', label: 'Customer not available' },
  { code: 'FAULT_NOT_RESOLVED', label: 'Fault not resolved' },
  { code: 'POWER_ISSUE', label: 'Power issue' },
  { code: 'CIVILS_REQUIRED', label: 'Civils required' },
  { code: 'OTHER', label: 'Other' }
]

// GPS ping settings
const GPS_PING_INTERVAL_MS = 30_000
const GPS_MIN_MOVEMENT_METERS = 35
const GPS_MAX_AGE_MS = 30_000
const GPS_FORCE_SEND_MS = 180_000


function haversineMeters(a, b) {
  if (!a || !b) return null
  const R = 6371e3
  const toRad = x => (x * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
  return R * c
}

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

  // Live tracking UI state
  const [tracking, setTracking] = useState(false)
  const [lastPingAt, setLastPingAt] = useState(null)

  // Refs for interval + movement check
  const pingTimerRef = useRef(null)
  const isPingingRef = useRef(false)
  const lastSentLocRef = useRef(null)
  const lastSentAtRef = useRef(0)

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
      const statusCode = e?.response?.status
      const m = e?.response?.data?.error || e?.message || 'Failed to load appointment'
      setErr(m)
      if (statusCode === 401 || statusCode === 403) {
        localStorage.removeItem('techToken')
        localStorage.removeItem('techId')
        localStorage.removeItem('techName')
        nav('/tech/login', { replace: true })
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
  const status = appt?.status || ''

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

      if (navigator.onLine) {
        await safeFlushQueue()
        await refreshQueueCounts()
        await load()
        setMsg('Sent')
      } else {
        setMsg('Queued (offline). Will sync when online.')
      }
    } catch (e) {
      setErr(e?.response?.data?.error || e?.message || 'Failed to queue/send event')
    } finally {
      setBusy(false)
    }
  }

  async function sendGpsPingOnce() {
    if (isPingingRef.current) return
    isPingingRef.current = true
    try {
      const gps = await getGpsOnce()
      if (!gps?.lat || !gps?.lng) return

      const now = Date.now()
      const prev = lastSentLocRef.current
      const movedM = haversineMeters(prev, { lat: gps.lat, lng: gps.lng })

      const tooSoon = now - (lastSentAtRef.current || 0) < GPS_MAX_AGE_MS
      const force = now - (lastSentAtRef.current || 0) > GPS_FORCE_SEND_MS

      if (!force && prev && movedM != null && movedM < GPS_MIN_MOVEMENT_METERS && tooSoon) return


      await enqueueEvent({
        clientEventId: makeClientEventId('cev_gps'),
        appointmentId: id,
        eventType: 'GPS_PING',
        status: null,
        lat: gps.lat,
        lng: gps.lng,
        payload: { source: 'tech_gps', accuracy: gps.accuracy },
        eventTime: new Date().toISOString()
      })

      lastSentLocRef.current = { lat: gps.lat, lng: gps.lng }
      lastSentAtRef.current = now
      setLastPingAt(new Date().toISOString())

      if (navigator.onLine) {
        await safeFlushQueue()
        await refreshQueueCounts()
      } else {
        await refreshQueueCounts()
      }
    } catch {
      // keep silent, do not spam tech with GPS noise
    } finally {
      isPingingRef.current = false
    }
  }

  function stopTracking() {
    if (pingTimerRef.current) {
      clearInterval(pingTimerRef.current)
      pingTimerRef.current = null
    }
  }

  function startTracking() {
    stopTracking()
    // ping immediately, then interval
    sendGpsPingOnce()
    pingTimerRef.current = setInterval(() => {
      sendGpsPingOnce()
    }, GPS_PING_INTERVAL_MS)
  }

  // Start or stop tracking based on toggle and status
  useEffect(() => {
    const shouldAllow =
      status === 'EN_ROUTE' ||
      status === 'ARRIVED' ||
      status === 'NEAR_SITE' ||
      status === 'IN_PROGRESS'

    if (!shouldAllow) {
      setTracking(false)
      stopTracking()
      return
    }

    if (tracking) startTracking()
    else stopTracking()

    return () => stopTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tracking, status, id])

  // cleanup on unmount
  useEffect(() => {
    return () => stopTracking()
  }, [])

  async function doSubmitJobCard(outcome) {
    setErr('')
    setMsg('')
    setBusy(true)
    try {
      if (!navigator.onLine) {
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
      setErr(e?.response?.data?.error || e?.message || 'Failed to submit job card')
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
      if (!navigator.onLine) {
        setErr('You are offline. Photo upload requires internet for now.')
        return
      }
      const dataUrl = await fileToDataUrl(f)
      await uploadPhoto(id, {
        clientEventId: makeClientEventId('cev_photo'),
        dataUrl
      })
      setMsg('Photo uploaded')
      await load()
    } catch (ex) {
      setErr(ex?.response?.data?.error || ex?.message || 'Failed to upload photo')
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
      if (!navigator.onLine) {
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
      setErr(ex?.response?.data?.error || ex?.message || 'Failed to upload signature')
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
      <Box sx={{ maxWidth: 900, mx: 'auto' }}>
        {err ? <Alert severity="error">{err}</Alert> : <Typography>Loading…</Typography>}
      </Box>
    )
  }

  const trackingAllowed =
    status === 'EN_ROUTE' ||
    status === 'ARRIVED' ||
    status === 'NEAR_SITE' ||
    status === 'IN_PROGRESS'

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Stack spacing={1.5} sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 950 }}>
          {ticket.externalRef || appt.ticketId}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={`Status: ${status || '-'}`} />
          <Chip size="small" color={navigator.onLine ? 'success' : 'warning'} label={navigator.onLine ? 'Online' : 'Offline'} />
          <Chip size="small" variant="outlined" label={`Queued: ${queueCount}`} />
          <Chip size="small" variant="outlined" label={`Here: ${apptQueueCount}`} />
          <Chip
            size="small"
            color={tracking ? 'success' : 'default'}
            variant="outlined"
            label={tracking ? 'Tracking: ON' : 'Tracking: OFF'}
          />
        </Stack>

        {err && <Alert severity="error">{err}</Alert>}
        {msg && <Alert severity="info">{msg}</Alert>}
      </Stack>

      {/* ✅ Map with live directions */}
      <TechRouteMap ticket={ticket} />

      <Paper sx={{ p: 2, mt: 2, borderRadius: 4 }} variant="outlined">
        <Typography sx={{ fontWeight: 900 }}>
          {ticket.customerName || ''}
        </Typography>
        {ticket.customerPhone ? (
          <Typography variant="body2" sx={{ opacity: 0.85 }}>
            {ticket.customerPhone}
          </Typography>
        ) : null}
        <Typography variant="body2" sx={{ mt: 1 }}>
          {ticket.address || ''}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={callCustomer} disabled={!ticket.customerPhone || busy} sx={{ borderRadius: 3 }}>
            Call customer
          </Button>
          <Button
            variant="outlined"
            onClick={async () => { await safeFlushQueue(); await refreshQueueCounts(); await load() }}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Sync now
          </Button>

          <Button
            variant={tracking ? 'contained' : 'outlined'}
            color={tracking ? 'success' : 'primary'}
            onClick={() => setTracking(v => !v)}
            disabled={busy || !trackingAllowed}
            sx={{ borderRadius: 3 }}
          >
            {tracking ? 'Stop live tracking' : 'Start live tracking'}
          </Button>

          <Button
            variant="outlined"
            onClick={async () => { await sendGpsPingOnce(); await refreshQueueCounts() }}
            disabled={busy || !trackingAllowed}
            sx={{ borderRadius: 3 }}
          >
            Ping now
          </Button>
        </Stack>

        <Typography variant="caption" sx={{ display: 'block', opacity: 0.75, mt: 1 }}>
          Live tracking sends GPS pings about every {Math.round(GPS_PING_INTERVAL_MS / 1000)} seconds while EN_ROUTE, ARRIVED, NEAR_SITE, or IN_PROGRESS.
          {lastPingAt ? ` Last ping: ${dayjs(lastPingAt).format('HH:mm:ss')}.` : ''}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ opacity: 0.8, mb: 1 }}>
          Actions
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'NEAR_SITE' })}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Near site
          </Button>
          <Button
            variant="outlined"
            onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'ARRIVED' })}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Arrived
          </Button>
          <Button
            variant="outlined"
            onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'IN_PROGRESS' })}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Start work
          </Button>
          <Button
            color="success"
            variant="contained"
            onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'COMPLETED' })}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Mark complete
          </Button>
          <Button
            variant="outlined"
            onClick={() => queueAndTrySend({ eventType: 'ASSISTANCE_REQUESTED', status: null, payload: { note: notes || 'Need assistance' } })}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Request assistance
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mt: 2, borderRadius: 4 }} variant="outlined">
        <Typography variant="h6" sx={{ fontWeight: 900 }} gutterBottom>
          Photos and signature
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" component="label" disabled={busy} sx={{ borderRadius: 3 }}>
            Upload photo
            <input hidden type="file" accept="image/*" capture="environment" onChange={onPickPhoto} />
          </Button>

          <Button variant="outlined" component="label" disabled={busy} sx={{ borderRadius: 3 }}>
            Upload signature
            <input hidden type="file" accept="image/*" capture="user" onChange={onPickSignature} />
          </Button>
        </Stack>

        <Typography variant="caption" sx={{ display: 'block', opacity: 0.75, mt: 1 }}>
          Photo and signature uploads are online-only for now. Status actions remain offline-safe.
        </Typography>
      </Paper>

      <Paper sx={{ p: 2, mt: 2, borderRadius: 4 }} variant="outlined">
        <Typography variant="h6" sx={{ fontWeight: 900 }} gutterBottom>
          Close out
        </Typography>

        <TextField
          label="Notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          fullWidth
          multiline
          minRows={3}
        />

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 2 }}>
          <FormControl sx={{ minWidth: 260 }} size="small">
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

          <FormControl sx={{ minWidth: 200 }} size="small">
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
            sx={{ width: 200 }}
          />
        </Box>

        <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
          <Button
            color="success"
            variant="contained"
            onClick={() => doSubmitJobCard('SUCCESSFUL')}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Submit successful
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => doSubmitJobCard('UNSUCCESSFUL')}
            disabled={busy}
            sx={{ borderRadius: 3 }}
          >
            Submit unsuccessful
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 2, mt: 2, borderRadius: 4 }} variant="outlined">
        <Typography variant="h6" sx={{ fontWeight: 900 }} gutterBottom>
          Timeline
        </Typography>

        {timeline.length === 0 ? (
          <Typography variant="body2" sx={{ opacity: 0.75 }}>
            No events yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {timeline.slice(0, 12).map(ev => (
              <Paper key={ev.id} variant="outlined" sx={{ p: 1.2, borderRadius: 3 }}>
                <Typography variant="body2" sx={{ fontWeight: 900 }}>
                  {ev.eventType}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                  {dayjs(ev.createdAt || ev.eventTime || new Date()).format('YYYY-MM-DD HH:mm')}
                  {ev.actorType ? `  •  ${ev.actorType}` : ''}
                </Typography>
              </Paper>
            ))}
          </Stack>
        )}
      </Paper>

      <Button variant="text" onClick={() => nav('/tech/my-day')} sx={{ mt: 2 }}>
        Back to list
      </Button>
    </Box>
  )
}
