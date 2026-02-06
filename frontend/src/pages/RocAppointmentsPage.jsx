// frontend/src/pages/RocAppointmentsPage.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemText, Divider, Alert, Stack, Chip, IconButton,
  CircularProgress, Checkbox, Tooltip, Switch, FormControlLabel
} from '@mui/material'
import dayjs from 'dayjs'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import MapIcon from '@mui/icons-material/Map'
import NearMeIcon from '@mui/icons-material/NearMe'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { Loader } from '@googlemaps/js-api-loader'

import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'

import {
  listTechnicians,
  searchTickets,
  listAppointments,
  createAppointment,
  moveAppointment,
  suggestSlot,
  routeSummary
} from '../api/rocAppointments'

const SLOTS = [
  { n: 1, label: 'Slot 1', start: '08:00', end: '10:00' },
  { n: 2, label: 'Slot 2', start: '10:00', end: '12:00' },
  { n: 3, label: 'Slot 3', start: '12:00', end: '14:00' },
  { n: 4, label: 'Slot 4', start: '14:00', end: '16:00' },
  { n: 5, label: 'Slot 5', start: '16:00', end: '18:00' }
]

function slotWindow(slotNumber) {
  return SLOTS.find(s => s.n === slotNumber) || null
}

function safeText(s) {
  return (s == null) ? '' : String(s)
}

function parseMaybeNumber(v) {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function getGoogleMapsKey() {
  // Prefer Vite env, fallback to plain env if you run CRA style
  return (
    (import.meta?.env?.VITE_GOOGLE_MAPS_API_KEY) ||
    (import.meta?.env?.VITE_GOOGLE_MAPS_KEY) ||
    (process?.env?.REACT_APP_GOOGLE_MAPS_API_KEY) ||
    ''
  )
}

function getGpsOnce(timeoutMs = 8000) {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 }
    )
  })
}

// -------- DND helpers ----------
function DraggableTicket({ ticket, disabled }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `ticket:${ticket.id}`,
    data: { type: 'ticket', ticket }
  })

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    opacity: isDragging ? 0.85 : 1
  }

  return (
    <Paper
      ref={disabled ? null : setNodeRef}
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 2,
        mb: 1,
        cursor: disabled ? 'default' : 'grab',
        userSelect: 'none',
        ...style
      }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <DragIndicatorIcon sx={{ opacity: 0.5, mt: 0.2 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 900 }} noWrap>
            {ticket.externalRef || ticket.id}
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.85 }} noWrap>
            {ticket.customerName || ''}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.75 }} noWrap>
            {ticket.address || ''}
          </Typography>

          {ticket.assignedTo ? (
            <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'warning.main' }}>
              Assigned: {ticket.assignedTo.techName} on {ticket.assignedTo.date} (Slot {ticket.assignedTo.slotNumber ?? '-'})
            </Typography>
          ) : null}
        </Box>

        {!disabled ? (
          <Box {...listeners} {...attributes} />
        ) : null}
      </Stack>
    </Paper>
  )
}

function DroppableSlot({ techId, slotNumber, children, disabled }) {
  const { setNodeRef, isOver } = useDroppable({
    id: `slot:${techId}:${slotNumber}`,
    disabled,
    data: { type: 'slot', techId, slotNumber }
  })

  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={{
        p: 1.25,
        borderRadius: 2,
        minHeight: 150,
        bgcolor: isOver ? 'rgba(25,118,210,0.08)' : 'background.paper',
        borderColor: isOver ? 'primary.main' : 'divider',
        transition: 'all 120ms ease'
      }}
    >
      {children}
    </Paper>
  )
}

// -------- Map helpers ----------
function buildStopsFromAppointments(dayAppts) {
  // Prefer anything geocodable. Addresses are enough for Google Directions.
  // Keep stable order by slotNumber.
  const appts = [...(dayAppts || [])].filter(a => a && a.ticket)
  appts.sort((a, b) => (a.slotNumber || 999) - (b.slotNumber || 999))

  const stops = appts
    .map(a => {
      const t = a.ticket || {}
      const addr = safeText(t.address).trim()
      const lat = parseMaybeNumber(t.lat || t.latitude || t.gpsLat)
      const lng = parseMaybeNumber(t.lng || t.longitude || t.gpsLng)
      return {
        appointmentId: a.id,
        slotNumber: a.slotNumber || null,
        status: a.status || '',
        ref: t.externalRef || a.ticketId,
        customerName: t.customerName || '',
        address: addr,
        lat,
        lng
      }
    })
    .filter(x => x.address || (x.lat != null && x.lng != null))

  return stops
}

function makeDirectionsRequestFromStops(stops, originOverride) {
  if (!stops || stops.length === 0) return null

  const toLoc = (s) => {
    if (s.lat != null && s.lng != null) return { location: { lat: s.lat, lng: s.lng }, stopover: true }
    return { location: s.address, stopover: true }
  }

  // If we have an originOverride (live location or ROC operator location), use that as origin.
  // Otherwise, origin is the first stop, destination is last stop.
  const origin = originOverride
    ? originOverride
    : (stops[0].lat != null && stops[0].lng != null ? { lat: stops[0].lat, lng: stops[0].lng } : stops[0].address)

  if (stops.length === 1) {
    const destination = stops[0].lat != null && stops[0].lng != null ? { lat: stops[0].lat, lng: stops[0].lng } : stops[0].address
    return {
      origin,
      destination,
      travelMode: 'DRIVING'
    }
  }

  const destinationStop = stops[stops.length - 1]
  const destination = destinationStop.lat != null && destinationStop.lng != null
    ? { lat: destinationStop.lat, lng: destinationStop.lng }
    : destinationStop.address

  const middle = stops.slice(0, stops.length - 1)
  // If no originOverride, skip the first stop in waypoints because it is origin already.
  const waypoints = originOverride ? middle.map(toLoc) : middle.slice(1).map(toLoc)

  return {
    origin,
    destination,
    waypoints,
    optimizeWaypoints: false,
    travelMode: 'DRIVING'
  }
}

function MapPanel({
  title,
  subtitle,
  stops,
  originOverride,
  height = 360
}) {
  const mapRef = useRef(null)
  const mapObjRef = useRef(null)
  const rendererRef = useRef(null)
  const loaderRef = useRef(null)
  const [mapErr, setMapErr] = useState('')
  const [ready, setReady] = useState(false)

  const apiKey = getGoogleMapsKey()

  const build = useCallback(async () => {
    setMapErr('')
    setReady(false)

    if (!apiKey) {
      setMapErr('Google Maps API key is missing. Set VITE_GOOGLE_MAPS_API_KEY.')
      return
    }
    if (!mapRef.current) return

    try {
      if (!loaderRef.current) {
        loaderRef.current = new Loader({
          apiKey,
          version: 'weekly',
          libraries: ['places']
        })
      }
      const google = await loaderRef.current.load()

      if (!mapObjRef.current) {
        mapObjRef.current = new google.maps.Map(mapRef.current, {
          center: { lat: -33.9249, lng: 18.4241 },
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true
        })
      }

      if (!rendererRef.current) {
        rendererRef.current = new google.maps.DirectionsRenderer({
          map: mapObjRef.current,
          suppressMarkers: false,
          preserveViewport: false
        })
      }

      const req = makeDirectionsRequestFromStops(stops, originOverride)
      if (!req) {
        setMapErr('No stops to map for this day.')
        setReady(true)
        return
      }

      const svc = new google.maps.DirectionsService()
      svc.route(req, (res, status) => {
        if (status !== 'OK' || !res) {
          setMapErr(`Directions failed: ${status}`)
          setReady(true)
          return
        }
        rendererRef.current.setDirections(res)
        setReady(true)
      })
    } catch (e) {
      setMapErr(e?.message || 'Failed to load map')
      setReady(true)
    }
  }, [apiKey, stops, originOverride])

  useEffect(() => {
    build()
  }, [build])

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <MapIcon sx={{ opacity: 0.7 }} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 900 }} noWrap>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="caption" sx={{ opacity: 0.75 }} noWrap>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        <Chip size="small" variant="outlined" label={ready ? 'Ready' : 'Loading'} />
      </Stack>

      {mapErr ? (
        <Alert severity="warning" sx={{ mb: 1 }}>
          {mapErr}
        </Alert>
      ) : null}

      <Box ref={mapRef} sx={{ width: '100%', height, borderRadius: 2, overflow: 'hidden' }} />
    </Paper>
  )
}

// -------- Main page ----------
export default function RocAppointmentsPage() {
  const [techs, setTechs] = useState([])
  const [region, setRegion] = useState('ALL')
  const [techIds, setTechIds] = useState([]) // multi
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))

  // schedules: { [techId]: { appts: [], route: {...} } }
  const [sched, setSched] = useState({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Unassigned tickets panel
  const [unassignedSearch, setUnassignedSearch] = useState('')
  const [unassigned, setUnassigned] = useState([])
  const [ticketLoading, setTicketLoading] = useState(false)

  // “Check assignment” search
  const [checkSearch, setCheckSearch] = useState('')
  const [checkResults, setCheckResults] = useState([])
  const [checkLoading, setCheckLoading] = useState(false)

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [pickedTicket, setPickedTicket] = useState(null)
  const [suggested, setSuggested] = useState(null)

  // Focus + maps
  const [focusedTechId, setFocusedTechId] = useState(null)
  const [useRocLocationAsOrigin, setUseRocLocationAsOrigin] = useState(false)
  const [rocOrigin, setRocOrigin] = useState(null)

  // Slot detail dialog
  const [slotOpen, setSlotOpen] = useState(false)
  const [slotTechId, setSlotTechId] = useState(null)
  const [slotAppt, setSlotAppt] = useState(null)

  // Live tracking
  const [trackLive, setTrackLive] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const techMap = useMemo(() => Object.fromEntries(techs.map(t => [t.id, t])), [techs])

  const regions = useMemo(() => {
    const set = new Set()
    for (const t of techs) if (t.region) set.add(t.region)
    return ['ALL', ...Array.from(set).sort()]
  }, [techs])

  const filteredTechs = useMemo(() => {
    if (region === 'ALL') return techs
    return techs.filter(t => (t.region || '') === region)
  }, [techs, region])

  const allFilteredTechIds = useMemo(() => filteredTechs.map(t => t.id), [filteredTechs])

  // default tech selection when region changes
  useEffect(() => {
    if (!techs.length) return
    const defaults = (region === 'ALL' ? techs : techs.filter(t => (t.region || '') === region)).map(t => t.id)
    setTechIds(defaults)
    setFocusedTechId(null)
  }, [region, techs])

  useEffect(() => {
    listTechnicians()
      .then(r => setTechs(r.data || []))
      .catch(e => setError(e?.response?.data?.error || e?.message || 'Failed to load technicians'))
  }, [])

  const loadTicketsUnassigned = useCallback(async () => {
    setTicketLoading(true)
    try {
      const r = await searchTickets(unassignedSearch, { unassignedOnly: true })
      setUnassigned(r.data || [])
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load unassigned tickets')
    } finally {
      setTicketLoading(false)
    }
  }, [unassignedSearch])

  const doCheckAssignment = useCallback(async () => {
    if (!checkSearch.trim()) return
    setCheckLoading(true)
    try {
      const r = await searchTickets(checkSearch, { unassignedOnly: false, includeAssigned: true })
      setCheckResults(r.data || [])
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to search')
    } finally {
      setCheckLoading(false)
    }
  }, [checkSearch])

  const loadSchedules = useCallback(async () => {
    if (!techIds.length) return
    setLoading(true)
    setError('')
    try {
      const from = date
      const to = date

      const results = await Promise.all(
        techIds.map(async (tid) => {
          const [ap, rs] = await Promise.all([
            listAppointments({ from, to, technicianId: tid }),
            routeSummary({ technicianId: tid, date })
          ])
          return [tid, { appts: ap.data || [], route: rs.data || null }]
        })
      )

      const next = {}
      for (const [tid, payload] of results) next[tid] = payload
      setSched(next)
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load schedules')
    } finally {
      setLoading(false)
    }
  }, [techIds, date])

  useEffect(() => {
    loadSchedules()
    loadTicketsUnassigned()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techIds, date])

  // Optional: when focused tech is set, capture ROC operator location if toggled
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!useRocLocationAsOrigin) return
      const gps = await getGpsOnce()
      if (!alive) return
      setRocOrigin(gps)
    })()
    return () => { alive = false }
  }, [useRocLocationAsOrigin])

  // Live tracking loop: refresh routeSummary for focused tech and for open slot dialog tech
  useEffect(() => {
    if (!trackLive) return
    const tid = slotOpen ? slotTechId : focusedTechId
    if (!tid) return

    let t = null
    let stopped = false

    async function tick() {
      try {
        const rs = await routeSummary({ technicianId: tid, date })
        if (stopped) return
        setSched(prev => {
          const cur = prev?.[tid] || { appts: [], route: null }
          return { ...prev, [tid]: { ...cur, route: rs.data || null } }
        })
      } catch {
        // ignore live errors so the UI stays calm
      } finally {
        if (!stopped) t = setTimeout(tick, 8000)
      }
    }

    tick()
    return () => {
      stopped = true
      if (t) clearTimeout(t)
    }
  }, [trackLive, focusedTechId, slotOpen, slotTechId, date])

  async function computeSuggestionForTech(technicianId, ticketId) {
    const r = await suggestSlot({ technicianId: technicianId, date, ticketId })
    return r.data
  }

  async function createInSlot({ technicianId, slotNumber, ticket }) {
    const win = slotWindow(slotNumber)
    if (!win) throw new Error('Invalid slot')

    const payload = {
      ticketId: ticket.id,
      technicianId,
      appointmentDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
      slotNumber,
      windowStartTime: win.start,
      windowEndTime: win.end
    }

    await createAppointment(payload)
    await loadSchedules()
    await loadTicketsUnassigned()
  }

  async function moveSlot({ technicianId, fromSlot, toSlot }) {
    const day = sched?.[technicianId]?.appts || []
    const apptBySlot = Object.fromEntries(day.filter(a => a.slotNumber).map(a => [a.slotNumber, a]))
    const a = apptBySlot[fromSlot]
    if (!a) return

    await moveAppointment(a.id, {
      technicianId,
      appointmentDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
      slotNumber: toSlot
    })
    await loadSchedules()
  }

  function openCreateModal() {
    setCreateOpen(true)
    setPickedTicket(null)
    setSuggested(null)
  }

  function openSlotDialog(tid, appt) {
    setSlotTechId(tid)
    setSlotAppt(appt)
    setSlotOpen(true)
  }

  function closeSlotDialog() {
    setSlotOpen(false)
    setSlotTechId(null)
    setSlotAppt(null)
  }

  async function onPickTicketForModal(t) {
    setPickedTicket(t)
    setSuggested(null)

    try {
      if (!techIds.length) return

      // We rank by:
      // - backend suggestion score (lower is better) if returned
      // - open slots count (more open slots is better)
      // - route minutes/km proxy (lower is better) if available from routeSummary
      //
      // This avoids backend changes while still being useful.
      const ranked = await Promise.all(
        techIds.map(async tid => {
          const s = await computeSuggestionForTech(tid, t.id).catch(() => null)
          const best = s?.rankedSlots?.[0]

          const day = sched?.[tid]?.appts || []
          const occupied = new Set(day.filter(a => a.slotNumber).map(a => Number(a.slotNumber)))
          const openSlots = SLOTS.filter(x => !occupied.has(Number(x.n))).length

          const r = sched?.[tid]?.route || null
          const routeMins = parseMaybeNumber(r?.totals?.totalMinutes)
          const routeKm = parseMaybeNumber(r?.totals?.totalKm)

          const suggestionScore = (best?.score != null) ? Number(best.score) : Number.MAX_SAFE_INTEGER
          // Compose a soft score. Lower is better.
          // Weight open slots as a negative contribution.
          const composite =
            suggestionScore +
            (routeMins != null ? routeMins * 0.35 : 0) +
            (routeKm != null ? routeKm * 0.15 : 0) +
            (openSlots * -22)

          return {
            techId: tid,
            techName: techMap[tid]?.name || tid,
            recommendedSlotNumber: s?.recommendedSlotNumber ?? null,
            suggestionScore: Number.isFinite(suggestionScore) ? suggestionScore : null,
            openSlots,
            routeMins,
            routeKm,
            composite
          }
        })
      )

      ranked.sort((a, b) => a.composite - b.composite)
      setSuggested({ ranked })
    } catch {
      // ignore
    }
  }

  async function onDragEnd(evt) {
    const active = evt.active
    const over = evt.over
    if (!active || !over) return

    const aData = active.data?.current
    const oData = over.data?.current
    if (aData?.type !== 'ticket' || oData?.type !== 'slot') return

    const ticket = aData.ticket
    const technicianId = oData.techId
    const slotNumber = oData.slotNumber

    if (ticket?.assignedTo) return

    const dayAppts = sched?.[technicianId]?.appts || []
    const occupied = dayAppts.some(a => Number(a.slotNumber) === Number(slotNumber))
    if (occupied) {
      setError(`Slot ${slotNumber} is already occupied for ${techMap[technicianId]?.name || technicianId}`)
      return
    }

    setLoading(true)
    setError('')
    try {
      await createInSlot({ technicianId, slotNumber, ticket })
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to create appointment')
    } finally {
      setLoading(false)
    }
  }

  const techIdsResolved = useMemo(() => {
    const arr = techIds.filter(Boolean)
    arr.sort((a, b) => (techMap[a]?.name || '').localeCompare(techMap[b]?.name || ''))
    return arr
  }, [techIds, techMap])

  const focusedStops = useMemo(() => {
    if (!focusedTechId) return []
    const day = sched?.[focusedTechId]?.appts || []
    return buildStopsFromAppointments(day)
  }, [focusedTechId, sched])

  const focusedRoute = useMemo(() => (focusedTechId ? (sched?.[focusedTechId]?.route || null) : null), [focusedTechId, sched])

  const focusedLiveLocation = useMemo(() => {
    // Ready for backend support: routeSummary can provide liveLocation: {lat,lng,updatedAt}
    const ll = focusedRoute?.liveLocation || focusedRoute?.lastKnownLocation || null
    const lat = parseMaybeNumber(ll?.lat)
    const lng = parseMaybeNumber(ll?.lng)
    if (lat == null || lng == null) return null
    return { lat, lng, updatedAt: ll?.updatedAt || ll?.time || null }
  }, [focusedRoute])

  const focusedOriginOverride = useMemo(() => {
    if (focusedLiveLocation) return { lat: focusedLiveLocation.lat, lng: focusedLiveLocation.lng }
    if (useRocLocationAsOrigin && rocOrigin) return { lat: rocOrigin.lat, lng: rocOrigin.lng }
    return null
  }, [focusedLiveLocation, useRocLocationAsOrigin, rocOrigin])

  function handleTechMultiChange(e) {
    const val = e.target.value
    // MUI multiple select can return string[] or value[]
    const arr = Array.isArray(val) ? val : []
    if (arr.includes('__ALL__')) {
      setTechIds(allFilteredTechIds)
      return
    }
    if (arr.includes('__NONE__')) {
      setTechIds([])
      return
    }
    setTechIds(arr.filter(x => x !== '__ALL__' && x !== '__NONE__'))
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <Box sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }} spacing={2}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              ROC Appointments
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <Chip size="small" label={`Date: ${date}`} />
              <Chip size="small" label={`Techs: ${techIdsResolved.length}`} />
              <Chip
                size="small"
                color={loading ? 'warning' : 'success'}
                label={loading ? 'Loading…' : 'Ready'}
              />
              {focusedTechId ? <Chip size="small" variant="outlined" label={`Focus: ${techMap[focusedTechId]?.name || focusedTechId}`} /> : null}
            </Stack>
          </Box>

          <Stack direction="row" spacing={1}>
            <Button variant="contained" startIcon={<AddIcon />} onClick={openCreateModal}>
              Add appointment
            </Button>
            <Button variant="outlined" startIcon={<RefreshIcon />} onClick={loadSchedules} disabled={loading}>
              Refresh
            </Button>
          </Stack>
        </Stack>

        {error ? <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert> : null}

        {/* Filters */}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
            <FormControl sx={{ minWidth: 200 }} size="small">
              <InputLabel>Region</InputLabel>
              <Select value={region} label="Region" onChange={e => setRegion(e.target.value)}>
                {regions.map(r => (
                  <MenuItem key={r} value={r}>{r}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl sx={{ minWidth: 340, flex: 1 }} size="small">
              <InputLabel>Technicians</InputLabel>
              <Select
                multiple
                value={techIds}
                label="Technicians"
                onChange={handleTechMultiChange}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.slice(0, 6).map(id => (
                      <Chip key={id} size="small" label={techMap[id]?.name || id} />
                    ))}
                    {selected.length > 6 ? <Chip size="small" label={`+${selected.length - 6}`} /> : null}
                  </Box>
                )}
              >
                <MenuItem value="__ALL__">
                  <Checkbox checked={techIds.length > 0 && techIds.length === allFilteredTechIds.length} />
                  Select all (in region)
                </MenuItem>
                <MenuItem value="__NONE__">
                  <Checkbox checked={techIds.length === 0} />
                  Clear selection
                </MenuItem>
                <Divider />
                {filteredTechs.map(t => (
                  <MenuItem key={t.id} value={t.id}>
                    <Checkbox checked={techIds.includes(t.id)} />
                    {t.name} {t.region ? `(${t.region})` : ''}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              size="small"
              sx={{ minWidth: 200 }}
            />
          </Stack>
        </Paper>

        {/* Focus map panel */}
        {focusedTechId ? (
          <Box sx={{ mb: 2 }}>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6" sx={{ fontWeight: 950 }} noWrap>
                      Route view
                    </Typography>
                    <Tooltip title="Shows directions across today’s stops. Origin is live location if available, else the first stop.">
                      <InfoOutlinedIcon sx={{ opacity: 0.6 }} fontSize="small" />
                    </Tooltip>
                  </Stack>

                  <Typography variant="body2" sx={{ opacity: 0.75 }}>
                    {techMap[focusedTechId]?.name || focusedTechId}  •  {date}
                  </Typography>

                  <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                    {focusedRoute?.totals ? (
                      <>
                        <Chip size="small" label={`Travel mins ~${Math.round(focusedRoute.totals.totalMinutes || 0)}`} />
                        <Chip size="small" label={`Km ~${Math.round(focusedRoute.totals.totalKm || 0)}`} />
                      </>
                    ) : (
                      <Chip size="small" variant="outlined" label="No route summary yet" />
                    )}

                    {focusedLiveLocation ? (
                      <Chip
                        size="small"
                        color="success"
                        icon={<NearMeIcon />}
                        label={`Live: ${focusedLiveLocation.updatedAt ? dayjs(focusedLiveLocation.updatedAt).format('HH:mm') : 'now'}`}
                      />
                    ) : (
                      <Chip size="small" variant="outlined" icon={<NearMeIcon />} label="Live location unavailable" />
                    )}
                  </Stack>
                </Box>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: { md: 'auto' } }}>
                  <FormControlLabel
                    control={<Switch checked={trackLive} onChange={e => setTrackLive(e.target.checked)} />}
                    label="Track live"
                  />
                  <FormControlLabel
                    control={<Switch checked={useRocLocationAsOrigin} onChange={e => setUseRocLocationAsOrigin(e.target.checked)} />}
                    label="Use my location"
                  />
                  <Button
                    variant="outlined"
                    startIcon={<ClearIcon />}
                    onClick={() => { setFocusedTechId(null); setTrackLive(false); setUseRocLocationAsOrigin(false); setRocOrigin(null) }}
                  >
                    Exit focus
                  </Button>
                </Stack>
              </Stack>

              <Divider sx={{ my: 2 }} />

              <MapPanel
                title="Directions for the day"
                subtitle={focusedStops.length ? `${focusedStops.length} stop(s)` : 'No stops'}
                stops={focusedStops}
                originOverride={focusedOriginOverride}
                height={420}
              />
            </Paper>
          </Box>
        ) : null}

        {/* Main layout */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '420px 1fr' },
            gap: 2,
            alignItems: 'start'
          }}
        >
          {/* Left: tickets */}
          <Box>
            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
              <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>
                Unassigned tickets
              </Typography>

              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <TextField
                  value={unassignedSearch}
                  onChange={e => setUnassignedSearch(e.target.value)}
                  placeholder="Search unassigned…"
                  size="small"
                  fullWidth
                />
                <IconButton onClick={loadTicketsUnassigned} disabled={ticketLoading}>
                  {ticketLoading ? <CircularProgress size={18} /> : <SearchIcon />}
                </IconButton>
                <IconButton
                  onClick={() => { setUnassignedSearch(''); setTimeout(loadTicketsUnassigned, 0) }}
                  disabled={ticketLoading}
                >
                  <ClearIcon />
                </IconButton>
              </Stack>

              <Typography variant="caption" sx={{ opacity: 0.75 }}>
                Drag a ticket onto any empty slot to assign it.
              </Typography>

              <Divider sx={{ my: 1.5 }} />

              <Box sx={{ maxHeight: '58vh', overflow: 'auto', pr: 0.5 }}>
                {ticketLoading ? (
                  <Typography variant="body2" sx={{ opacity: 0.75 }}>Loading…</Typography>
                ) : unassigned.length === 0 ? (
                  <Typography variant="body2" sx={{ opacity: 0.75 }}>No unassigned tickets found.</Typography>
                ) : (
                  unassigned.map(t => <DraggableTicket key={t.id} ticket={t} />)
                )}
              </Box>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
              <Typography variant="h6" sx={{ fontWeight: 900, mb: 1 }}>
                Check assignment
              </Typography>

              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <TextField
                  value={checkSearch}
                  onChange={e => setCheckSearch(e.target.value)}
                  placeholder="Search any ticket (ref, name, phone, address)…"
                  size="small"
                  fullWidth
                />
                <Button variant="outlined" onClick={doCheckAssignment} disabled={checkLoading}>
                  {checkLoading ? 'Searching…' : 'Search'}
                </Button>
              </Stack>

              {checkResults.length ? (
                <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
                  {checkResults.map(t => (
                    <Paper key={t.id} variant="outlined" sx={{ p: 1.25, borderRadius: 2, mb: 1 }}>
                      <Typography sx={{ fontWeight: 900 }}>
                        {t.externalRef || t.id}
                      </Typography>
                      <Typography variant="body2" sx={{ opacity: 0.85 }}>
                        {t.customerName || ''}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.75 }}>
                        {t.address || ''}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                        {t.assignedTo
                          ? `Assigned: ${t.assignedTo.techName} on ${t.assignedTo.date} (Slot ${t.assignedTo.slotNumber ?? '-'})`
                          : 'Not assigned'}
                      </Typography>
                    </Paper>
                  ))}
                </Box>
              ) : (
                <Typography variant="caption" sx={{ opacity: 0.75 }}>
                  Use this to check if a ticket is already scheduled.
                </Typography>
              )}
            </Paper>
          </Box>

          {/* Right: stacked tech day views */}
          <Box>
            {techIdsResolved.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Typography variant="body2" sx={{ opacity: 0.75 }}>
                  Select a region or at least one technician.
                </Typography>
              </Paper>
            ) : (
              techIdsResolved.map(tid => {
                const t = techMap[tid]
                const day = sched?.[tid]?.appts || []
                const route = sched?.[tid]?.route || null
                const apptBySlot = Object.fromEntries(day.filter(a => a.slotNumber).map(a => [a.slotNumber, a]))

                const occupiedCount = day.filter(a => a.slotNumber).length
                const openCount = Math.max(0, SLOTS.length - occupiedCount)

                const live = route?.liveLocation || route?.lastKnownLocation || null
                const liveLat = parseMaybeNumber(live?.lat)
                const liveLng = parseMaybeNumber(live?.lng)
                const hasLive = liveLat != null && liveLng != null

                return (
                  <Paper key={tid} variant="outlined" sx={{ p: 2, borderRadius: 3, mb: 2 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                      <Box>
                        <Typography variant="h6" sx={{ fontWeight: 900 }}>
                          {t?.name || tid}
                        </Typography>
                        <Typography variant="body2" sx={{ opacity: 0.75 }}>
                          {t?.region ? `Region: ${t.region}` : 'Region: -'}
                        </Typography>

                        <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                          <Chip size="small" variant="outlined" label={`Open slots: ${openCount}`} />
                          {route?.totals ? (
                            <>
                              <Chip size="small" label={`Travel mins ~${Math.round(route.totals.totalMinutes || 0)}`} />
                              <Chip size="small" label={`Km ~${Math.round(route.totals.totalKm || 0)}`} />
                            </>
                          ) : null}
                          <Chip
                            size="small"
                            variant={hasLive ? 'filled' : 'outlined'}
                            color={hasLive ? 'success' : 'default'}
                            icon={<NearMeIcon />}
                            label={hasLive ? 'Live' : 'No live'}
                          />
                        </Stack>
                      </Box>

                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<MapIcon />}
                          onClick={() => {
                            setTechIds([tid])
                            setFocusedTechId(tid)
                            setTrackLive(false)
                            setUseRocLocationAsOrigin(false)
                            setRocOrigin(null)
                          }}
                        >
                          Focus
                        </Button>
                        <Button size="small" variant="outlined" onClick={loadSchedules} disabled={loading}>
                          Sync
                        </Button>
                      </Stack>
                    </Stack>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(5, 1fr)' }, gap: 1.2 }}>
                      {SLOTS.map(s => {
                        const a = apptBySlot[s.n]
                        const ticket = a?.ticket || {}

                        return (
                          <DroppableSlot key={s.n} techId={tid} slotNumber={s.n} disabled={Boolean(a)}>
                            <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                              <Box>
                                <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                                  {s.label}
                                </Typography>
                                <Typography variant="caption" sx={{ opacity: 0.8 }}>
                                  {s.start} to {s.end}
                                </Typography>
                              </Box>
                              {a?.status ? (
                                <Chip size="small" label={a.status} />
                              ) : null}
                            </Stack>

                            <Divider sx={{ my: 1 }} />

                            {!a ? (
                              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                Drop ticket here
                              </Typography>
                            ) : (
                              <Box
                                sx={{
                                  cursor: 'pointer',
                                  borderRadius: 2,
                                  '&:hover': { bgcolor: 'rgba(25,118,210,0.06)' }
                                }}
                                onClick={() => openSlotDialog(tid, a)}
                              >
                                <Typography sx={{ fontWeight: 900 }} noWrap>
                                  {ticket.externalRef || a.ticketId}
                                </Typography>
                                <Typography variant="body2" sx={{ opacity: 0.85 }} noWrap>
                                  {ticket.customerName || ''}
                                </Typography>
                                <Typography variant="caption" sx={{ opacity: 0.75 }} noWrap>
                                  {ticket.address || ''}
                                </Typography>

                                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                                  {SLOTS.filter(x => x.n !== s.n && !apptBySlot[x.n]).slice(0, 2).map(x => (
                                    <Button
                                      key={x.n}
                                      size="small"
                                      variant="outlined"
                                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); moveSlot({ technicianId: tid, fromSlot: s.n, toSlot: x.n }) }}
                                      disabled={loading}
                                      sx={{ textTransform: 'none' }}
                                    >
                                      Move to {x.n}
                                    </Button>
                                  ))}

                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<MapIcon />}
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      setTechIds([tid])
                                      setFocusedTechId(tid)
                                    }}
                                    sx={{ textTransform: 'none' }}
                                  >
                                    Route
                                  </Button>
                                </Stack>
                              </Box>
                            )}
                          </DroppableSlot>
                        )
                      })}
                    </Box>
                  </Paper>
                )
              })
            )}
          </Box>
        </Box>

        {/* Create modal */}
        <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>Create appointment</DialogTitle>
          <DialogContent>
            <Alert severity="info" sx={{ mb: 2 }}>
              Tip: you can also drag tickets from “Unassigned tickets” straight onto a slot.
            </Alert>

            <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
              Pick a ticket (unassigned)
            </Typography>

            <Box sx={{ maxHeight: 320, overflow: 'auto', mt: 1 }}>
              {unassigned.map(t => (
                <Paper
                  key={t.id}
                  variant="outlined"
                  sx={{
                    p: 1.25,
                    borderRadius: 2,
                    mb: 1,
                    cursor: 'pointer',
                    bgcolor: pickedTicket?.id === t.id ? 'rgba(25,118,210,0.08)' : 'transparent'
                  }}
                  onClick={() => onPickTicketForModal(t)}
                >
                  <Typography sx={{ fontWeight: 900 }}>
                    {t.externalRef || t.id}
                  </Typography>
                  <Typography variant="body2" sx={{ opacity: 0.85 }}>
                    {t.customerName || ''}
                  </Typography>
                  <Typography variant="caption" sx={{ opacity: 0.75 }}>
                    {t.address || ''}
                  </Typography>
                </Paper>
              ))}
            </Box>

            <Divider sx={{ my: 2 }} />

            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
                Suggest tech (open slots + proximity proxy)
              </Typography>
              <Tooltip title="Ranking uses backend slot suggestion score plus how many open slots the tech still has, plus route mins and km if available.">
                <InfoOutlinedIcon sx={{ opacity: 0.6 }} fontSize="small" />
              </Tooltip>
            </Stack>

            {!pickedTicket ? (
              <Typography variant="body2" sx={{ opacity: 0.7, mt: 1 }}>
                Select a ticket above to compute suggestions.
              </Typography>
            ) : !suggested?.ranked?.length ? (
              <Typography variant="body2" sx={{ opacity: 0.7, mt: 1 }}>
                Computing…
              </Typography>
            ) : (
              <List dense>
                {suggested.ranked.slice(0, 8).map((x) => (
                  <ListItem
                    key={x.techId}
                    disableGutters
                    secondaryAction={
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<MyLocationIcon />}
                        onClick={() => {
                          setTechIds([x.techId])
                          setFocusedTechId(x.techId)
                          setCreateOpen(false)
                        }}
                        sx={{ textTransform: 'none' }}
                      >
                        View
                      </Button>
                    }
                  >
                    <ListItemText
                      primary={`${x.techName}`}
                      secondary={
                        [
                          x.recommendedSlotNumber ? `Suggested slot ${x.recommendedSlotNumber}` : 'No slot suggestion',
                          `Open slots: ${x.openSlots}`,
                          x.routeMins != null ? `Route mins ~${Math.round(x.routeMins)}` : null,
                          x.routeKm != null ? `Km ~${Math.round(x.routeKm)}` : null
                        ].filter(Boolean).join('  •  ')
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2">Choose technician + slot</Typography>
            <Typography variant="caption" sx={{ opacity: 0.75 }}>
              Slot buttons create the appointment for the first selected technician only (drag drop is better for multi tech mode).
            </Typography>

            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
              {SLOTS.map(s => (
                <Button
                  key={s.n}
                  variant="contained"
                  disabled={!pickedTicket || !techIdsResolved.length}
                  onClick={async () => {
                    try {
                      const primaryTech = techIdsResolved[0]
                      await createInSlot({ technicianId: primaryTech, slotNumber: s.n, ticket: pickedTicket })
                      setCreateOpen(false)
                      setPickedTicket(null)
                      setSuggested(null)
                    } catch (e) {
                      setError(e?.response?.data?.error || e?.message || 'Failed to create appointment')
                    }
                  }}
                >
                  Slot {s.n}
                </Button>
              ))}
            </Box>
          </DialogContent>

          <DialogActions>
            <Button onClick={() => setCreateOpen(false)}>Close</Button>
          </DialogActions>
        </Dialog>

        {/* Slot detail dialog (ROC map + status) */}
        <Dialog open={slotOpen} onClose={closeSlotDialog} maxWidth="md" fullWidth>
          <DialogTitle>Slot details</DialogTitle>
          <DialogContent>
            {!slotAppt ? (
              <Typography>Loading…</Typography>
            ) : (
              <>
                {(() => {
                  const t = techMap[slotTechId] || {}
                  const ticket = slotAppt.ticket || {}
                  const techName = t.name || slotTechId
                  const ref = ticket.externalRef || slotAppt.ticketId
                  const addr = ticket.address || ''

                  const day = sched?.[slotTechId]?.appts || []
                  const stops = buildStopsFromAppointments(day)
                  const route = sched?.[slotTechId]?.route || null
                  const ll = route?.liveLocation || route?.lastKnownLocation || null
                  const lat = parseMaybeNumber(ll?.lat)
                  const lng = parseMaybeNumber(ll?.lng)
                  const liveOrigin = (lat != null && lng != null) ? { lat, lng } : null

                  return (
                    <Box>
                      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }} alignItems="center">
                        <Chip size="small" label={`Tech: ${techName}`} />
                        <Chip size="small" label={`Slot: ${slotAppt.slotNumber || '-'}`} />
                        <Chip size="small" variant="outlined" label={`Status: ${slotAppt.status || '-'}`} />
                        <Chip size="small" variant="outlined" label={`Ref: ${ref}`} />
                      </Stack>

                      <Typography sx={{ fontWeight: 950, mt: 1 }}>
                        {ticket.customerName || ''}
                      </Typography>
                      <Typography variant="body2" sx={{ opacity: 0.85 }}>
                        {addr}
                      </Typography>

                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, flexWrap: 'wrap' }}>
                        <FormControlLabel
                          control={<Switch checked={trackLive} onChange={e => setTrackLive(e.target.checked)} />}
                          label="Track live location"
                        />
                        <Tooltip title="Live location requires route-summary to include a liveLocation field. If missing, the route still renders.">
                          <InfoOutlinedIcon sx={{ opacity: 0.6 }} fontSize="small" />
                        </Tooltip>
                      </Stack>

                      <Divider sx={{ my: 2 }} />

                      <MapPanel
                        title="Route and directions"
                        subtitle={liveOrigin ? 'Origin is live tech location' : 'Origin is first stop'}
                        stops={stops}
                        originOverride={liveOrigin}
                        height={380}
                      />
                    </Box>
                  )
                })()}
              </>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={closeSlotDialog}>Close</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </DndContext>
  )
}
