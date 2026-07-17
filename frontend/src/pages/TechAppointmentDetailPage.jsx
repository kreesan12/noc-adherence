// frontend/src/pages/TechAppointmentDetailPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Button, TextField, Alert, Divider,
  Stack, Chip, MenuItem, Select, FormControl, InputLabel, Checkbox, FormControlLabel
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

function normalizeStatus(s) {
  return String(s || '').toUpperCase()
}

function shouldTrackForStatus(status) {
  // Status driven tracking:
  // - Track only while EN_ROUTE (moving)
  // - Stop on site: NEAR_SITE/ARRIVED/IN_PROGRESS and anything closed
  const st = normalizeStatus(status)
  return st === 'EN_ROUTE'
}

function canChangeToEnRoute(status) {
  const st = normalizeStatus(status)
  return !['EN_ROUTE', 'NEAR_SITE', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'UNSUCCESSFUL', 'CIVILS_REQUIRED', 'CANCELLED'].includes(st)
}

function formatWSOBlock(form) {
  // Clean block that lands in existing jobCard.notes without schema changes
  // Keep it readable for ops + auditable.
  const lines = []
  lines.push('WSO_FORM v1')
  lines.push(`RT Ticket Ref: ${form.rtTicketRef || ''}`)
  lines.push(`Link Label: ${form.linkLabel || ''}`)
  lines.push(`Assigned Contractor: ${form.assignedContractor || ''}`)
  lines.push(`Category: ${form.category || ''}`)
  lines.push(`Work Type: ${[form.workRepair ? 'Repair' : null, form.workReplace ? 'Replace' : null].filter(Boolean).join(', ')}`)
  lines.push(`Terminal Equipment Damaged: ${form.terminalEquipmentDamaged ? 'Yes' : 'No'}`)
  lines.push(`Relocation of link: ${form.relocationOfLink ? 'Yes' : 'No'}`)
  lines.push(`Hours on site start: ${form.hoursOnSiteStart || ''}`)
  lines.push(`Hours on site end: ${form.hoursOnSiteEnd || ''}`)
  lines.push(`Findings: ${form.findings || ''}`)
  lines.push(`Items to be replaced: ${form.itemsToBeReplaced || ''}`)
  lines.push(`Customer consent: over18=${form.consentOver18 ? 'Yes' : 'No'}, authorised=${form.consentAuthorised ? 'Yes' : 'No'}, goAhead=${form.consentGoAhead ? 'Yes' : 'No'}, 30mCosts=${form.consent30mCosts ? 'Yes' : 'No'}`)
  lines.push(`Customer not prepared to sign: ${form.notPreparedToSign ? 'Yes' : 'No'}`)
  if (form.notPreparedToSign) lines.push(`Reason: ${form.notPreparedReason || ''}`)
  return lines.join('\n')
}

export default function TechAppointmentDetailPage() {
  const { id } = useParams()
  const nav = useNavigate()

  const [appt, setAppt] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // Job card related
  const [notes, setNotes] = useState('')
  const [reasonCode, setReasonCode] = useState('NO_ACCESS')
  const [civilsRequired, setCivilsRequired] = useState(false)
  const [customerRating, setCustomerRating] = useState('')

  // Work Service Order form (based on your PDF)
  const [wso, setWso] = useState({
    rtTicketRef: '',
    linkLabel: '',
    assignedContractor: '',
    category: 'Link damaged, rebuild/replace/repair',
    workReplace: false,
    workRepair: true,
    terminalEquipmentDamaged: false,
    relocationOfLink: false,
    hoursOnSiteStart: '',
    hoursOnSiteEnd: '',
    findings: '',
    itemsToBeReplaced: '',
    consentOver18: true,
    consentAuthorised: true,
    consentGoAhead: true,
    consent30mCosts: false,
    notPreparedToSign: false,
    notPreparedReason: ''
  })

  const [queueCount, setQueueCount] = useState(0)
  const [apptQueueCount, setApptQueueCount] = useState(0)

  // Tracking internals (no UI toggle)
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

    const ticket = r.data?.ticket || {}
    const techName = r.data?.technician?.name || localStorage.getItem('techName') || ''

    // Prepopulate WSO fields when empty
    setWso(prev => ({
      ...prev,
      rtTicketRef: prev.rtTicketRef || (ticket.externalRef || r.data?.ticketId || ''),
      linkLabel: prev.linkLabel || (ticket.linkLabel || ''),
      assignedContractor: prev.assignedContractor || techName
    }))

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
  const st = normalizeStatus(status)

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
        payload: { ...(payload || {}), source: 'tech_detail', accuracy: gps?.accuracy ?? null },
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

      if (navigator.onLine) {
        await safeFlushQueue()
        await refreshQueueCounts()
      } else {
        await refreshQueueCounts()
      }
    } catch {
      // keep silent
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

  // ✅ STATUS DRIVEN tracking (no tech control)
  useEffect(() => {
    const shouldTrack = shouldTrackForStatus(st)

    if (shouldTrack) startTracking()
    else stopTracking()

    return () => stopTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st, id])

  useEffect(() => {
    return () => stopTracking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function saveWSOForm() {
    // Offline safe: store as appointmentEvent payload for audit trail
    await queueAndTrySend({
      eventType: 'FORM_UPDATED',
      status: null,
      payload: {
        formType: 'WSO_FORM',
        version: 1,
        data: wso
      }
    })
  }

  function buildFinalNotes(outcome) {
    const wsoBlock = formatWSOBlock(wso)

    // Put WSO in notes for now so your existing backend stores it without schema changes.
    // Also keep tech free text notes separate.
    const parts = []
    parts.push('--- TECH NOTES ---')
    parts.push((notes || '').trim())
    parts.push('')
    parts.push('--- WORK SERVICE ORDER ---')
    parts.push(wsoBlock)
    parts.push('')

    if (outcome === 'UNSUCCESSFUL') {
      parts.push('--- UNSUCCESSFUL ---')
      parts.push(`Reason: ${reasonCode}`)
      parts.push(`Civils required: ${civilsRequired ? 'Yes' : 'No'}`)
      parts.push('')
    }

    return parts.join('\n').trim()
  }

  async function doSubmitJobCard(outcome) {
    setErr('')
    setMsg('')
    setBusy(true)
    try {
      if (!navigator.onLine) {
        setErr('You are offline. Please submit the job card when you are back online.')
        return
      }

      // Optional: save a form snapshot before submit (online only here)
      // so your backend has the last state even if notes get edited later.
      await saveWSOForm()

      await submitJobCard(id, {
        clientEventId: makeClientEventId('cev_job'),
        outcome,
        reasonCode: outcome === 'UNSUCCESSFUL' ? reasonCode : null,
        notes: buildFinalNotes(outcome),
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

      // Save form snapshot before signature so it lines up with consent
      await saveWSOForm()

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
      <Box sx={{ maxWidth: 820, mx: 'auto' }}>
        {err ? <Alert severity="error">{err}</Alert> : <Typography>Loading…</Typography>}
      </Box>
    )
  }

  const trackingLive = shouldTrackForStatus(st)

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto' }}>
      <Stack spacing={1} sx={{ mb: 1.25 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
          {ticket.externalRef || appt.ticketId}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={`Status: ${status || '-'}`} />
          <Chip size="small" color={navigator.onLine ? 'success' : 'warning'} label={navigator.onLine ? 'Online' : 'Offline'} />
          <Chip size="small" variant="outlined" label={`Queued: ${queueCount}`} />
          <Chip size="small" variant="outlined" label={`Here: ${apptQueueCount}`} />
          <Chip
            size="small"
            color={trackingLive ? 'success' : 'default'}
            variant="outlined"
            label={trackingLive ? 'Live tracking: ACTIVE (EN_ROUTE)' : 'Live tracking: OFF'}
          />
        </Stack>

        {err && <Alert severity="error">{err}</Alert>}
        {msg && <Alert severity="info">{msg}</Alert>}
      </Stack>

      {/* Map + directions */}
      <TechRouteMap ticket={ticket} />

      <Paper sx={{ p: 1.5, mt: 1.5, borderRadius: 2.5 }} variant="outlined">
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

        <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, flexWrap: 'wrap' }}>
          <Button variant="outlined" onClick={callCustomer} disabled={!ticket.customerPhone || busy} sx={{ borderRadius: 2 }}>
            Call customer
          </Button>
          <Button
            variant="outlined"
            onClick={async () => { await safeFlushQueue(); await refreshQueueCounts(); await load() }}
            disabled={busy}
            sx={{ borderRadius: 2 }}
          >
            Sync now
          </Button>

          {canChangeToEnRoute(st) ? (
            <Button
              variant="contained"
              onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'EN_ROUTE' })}
              disabled={busy}
              sx={{ borderRadius: 2 }}
            >
              Start travel
            </Button>
          ) : null}
        </Stack>

        <Typography variant="caption" sx={{ display: 'block', opacity: 0.75, mt: 1 }}>
          Tracking is automatic. It pings GPS every {Math.round(GPS_PING_INTERVAL_MS / 1000)} seconds while EN_ROUTE, and stops when you arrive/on site.
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
            sx={{ borderRadius: 2 }}
          >
            Near site
          </Button>
          <Button
            variant="outlined"
            onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'ARRIVED' })}
            disabled={busy}
            sx={{ borderRadius: 2 }}
          >
            Arrived
          </Button>
          <Button
            variant="outlined"
            onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'IN_PROGRESS' })}
            disabled={busy}
            sx={{ borderRadius: 2 }}
          >
            Start work
          </Button>
          <Button
            color="success"
            variant="contained"
            onClick={() => queueAndTrySend({ eventType: 'STATUS_CHANGED', status: 'COMPLETED' })}
            disabled={busy}
            sx={{ borderRadius: 2 }}
          >
            Mark complete
          </Button>
          <Button
            variant="outlined"
            onClick={() => queueAndTrySend({ eventType: 'ASSISTANCE_REQUESTED', status: null, payload: { note: notes || 'Need assistance' } })}
            disabled={busy}
            sx={{ borderRadius: 2 }}
          >
            Request assistance
          </Button>
        </Stack>
      </Paper>

      {/* ✅ Work Service Order form (based on your PDF) */}
      <Paper sx={{ p: 1.5, mt: 1.5, borderRadius: 2.5 }} variant="outlined">
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
            Work Service Order
          </Typography>
          <Chip size="small" variant="outlined" label="Customer consent + findings" />
        </Stack>

        <Stack spacing={0.75}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="RT Ticket Ref"
              value={wso.rtTicketRef}
              onChange={e => setWso(v => ({ ...v, rtTicketRef: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Assigned Contractor"
              value={wso.assignedContractor}
              onChange={e => setWso(v => ({ ...v, assignedContractor: e.target.value }))}
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Link label"
              value={wso.linkLabel}
              onChange={e => setWso(v => ({ ...v, linkLabel: e.target.value }))}
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                label="Category"
                value={wso.category}
                onChange={e => setWso(v => ({ ...v, category: e.target.value }))}
              >
                <MenuItem value="Link damaged, rebuild/replace/repair">Link damaged, rebuild/replace/repair</MenuItem>
                <MenuItem value="Repair of components of link">Repair of components of link</MenuItem>
                <MenuItem value="Terminal Equipment damaged">Terminal Equipment damaged</MenuItem>
                <MenuItem value="Relocation of link">Relocation of link</MenuItem>
                <MenuItem value="Other">Other</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <TextField
              label="Hours on site start"
              placeholder="HH:mm"
              value={wso.hoursOnSiteStart}
              onChange={e => setWso(v => ({ ...v, hoursOnSiteStart: e.target.value }))}
              fullWidth
            />
            <TextField
              label="Hours on site end"
              placeholder="HH:mm"
              value={wso.hoursOnSiteEnd}
              onChange={e => setWso(v => ({ ...v, hoursOnSiteEnd: e.target.value }))}
              fullWidth
            />
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={wso.workRepair}
                  onChange={e => setWso(v => ({ ...v, workRepair: e.target.checked }))}
                />
              }
              label="Repair"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={wso.workReplace}
                  onChange={e => setWso(v => ({ ...v, workReplace: e.target.checked }))}
                />
              }
              label="Replace"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={wso.terminalEquipmentDamaged}
                  onChange={e => setWso(v => ({ ...v, terminalEquipmentDamaged: e.target.checked }))}
                />
              }
              label="Terminal equipment damaged"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={wso.relocationOfLink}
                  onChange={e => setWso(v => ({ ...v, relocationOfLink: e.target.checked }))}
                />
              }
              label="Relocation of link"
            />
          </Stack>

          <TextField
            label="Short description of findings"
            value={wso.findings}
            onChange={e => setWso(v => ({ ...v, findings: e.target.value }))}
            fullWidth
            multiline
            minRows={3}
          />

          <TextField
            label="Items to be replaced (list)"
            value={wso.itemsToBeReplaced}
            onChange={e => setWso(v => ({ ...v, itemsToBeReplaced: e.target.value }))}
            fullWidth
            multiline
            minRows={3}
            placeholder="Example: Call out fee, Patchcord, ONT power supply..."
          />

          <Divider />

          <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
            Customer consent
          </Typography>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Checkbox checked={wso.consentOver18} onChange={e => setWso(v => ({ ...v, consentOver18: e.target.checked }))} />}
              label="Customer is over 18"
            />
            <FormControlLabel
              control={<Checkbox checked={wso.consentAuthorised} onChange={e => setWso(v => ({ ...v, consentAuthorised: e.target.checked }))} />}
              label="Authorised to sign"
            />
            <FormControlLabel
              control={<Checkbox checked={wso.consentGoAhead} onChange={e => setWso(v => ({ ...v, consentGoAhead: e.target.checked }))} />}
              label="Go ahead given"
            />
            <FormControlLabel
              control={<Checkbox checked={wso.consent30mCosts} onChange={e => setWso(v => ({ ...v, consent30mCosts: e.target.checked }))} />}
              label="Accepts costs beyond 30m"
            />
          </Stack>

          <FormControlLabel
            control={<Checkbox checked={wso.notPreparedToSign} onChange={e => setWso(v => ({ ...v, notPreparedToSign: e.target.checked }))} />}
            label="Customer not prepared to sign"
          />

          {wso.notPreparedToSign ? (
            <TextField
              label="Reason"
              value={wso.notPreparedReason}
              onChange={e => setWso(v => ({ ...v, notPreparedReason: e.target.value }))}
              fullWidth
            />
          ) : null}

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button variant="outlined" onClick={saveWSOForm} disabled={busy} sx={{ borderRadius: 2 }}>
              Save form
            </Button>
          </Stack>
        </Stack>
      </Paper>

      <Paper sx={{ p: 1.5, mt: 1.5, borderRadius: 2.5 }} variant="outlined">
        <Typography variant="subtitle1" sx={{ fontWeight: 900 }} gutterBottom>
          Photos and signature
        </Typography>

        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          <Button variant="outlined" component="label" disabled={busy} sx={{ borderRadius: 2 }}>
            Upload photo
            <input hidden type="file" accept="image/*" capture="environment" onChange={onPickPhoto} />
          </Button>

          <Button variant="outlined" component="label" disabled={busy} sx={{ borderRadius: 2 }}>
            Upload signature
            <input hidden type="file" accept="image/*" capture="user" onChange={onPickSignature} />
          </Button>
        </Stack>

        <Typography variant="caption" sx={{ display: 'block', opacity: 0.75, mt: 1 }}>
          Photo and signature uploads are online-only for now. Status actions remain offline-safe.
        </Typography>
      </Paper>

      <Paper sx={{ p: 1.5, mt: 1.5, borderRadius: 2.5 }} variant="outlined">
        <Typography variant="subtitle1" sx={{ fontWeight: 900 }} gutterBottom>
          Close out
        </Typography>

        <TextField
          label="Tech notes (free text)"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          fullWidth
          multiline
          minRows={3}
        />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.25 }}>
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

        <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, flexWrap: 'wrap' }}>
          <Button
            color="success"
            variant="contained"
            onClick={() => doSubmitJobCard('SUCCESSFUL')}
            disabled={busy}
            sx={{ borderRadius: 2 }}
          >
            Submit successful
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => doSubmitJobCard('UNSUCCESSFUL')}
            disabled={busy}
            sx={{ borderRadius: 2 }}
          >
            Submit unsuccessful
          </Button>
        </Stack>
      </Paper>

      <Paper sx={{ p: 1.5, mt: 1.5, borderRadius: 2.5 }} variant="outlined">
        <Typography variant="subtitle1" sx={{ fontWeight: 900 }} gutterBottom>
          Timeline
        </Typography>

        {timeline.length === 0 ? (
          <Typography variant="body2" sx={{ opacity: 0.75 }}>
            No events yet.
          </Typography>
        ) : (
          <Stack spacing={0.75}>
            {timeline.slice(0, 12).map(ev => (
              <Paper key={ev.id} variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
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
