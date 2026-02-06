// frontend/src/pages/RocAppointmentsPage.jsx
import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemText, Divider, Alert, Stack, Chip, IconButton,
  CircularProgress
} from '@mui/material'
import dayjs from 'dayjs'
import AddIcon from '@mui/icons-material/Add'
import RefreshIcon from '@mui/icons-material/Refresh'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import DragIndicatorIcon from '@mui/icons-material/DragIndicator'
import MapIcon from '@mui/icons-material/Map'
import CloseIcon from '@mui/icons-material/Close'

import {
  DndContext,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter
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

/* ------------------------------------------------------------------ */
/* Google Maps: safe loader (NO @googlemaps/js-api-loader dependency)  */
/* ------------------------------------------------------------------ */
let __gmapsPromise = null
function loadGoogleMaps() {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'))
  if (window.google?.maps) return Promise.resolve(window.google)

  if (__gmapsPromise) return __gmapsPromise

  const key = import.meta.env?.VITE_GOOGLE_MAPS_API_KEY
  if (!key) {
    __gmapsPromise = Promise.reject(new Error('Missing VITE_GOOGLE_MAPS_API_KEY'))
    return __gmapsPromise
  }

  __gmapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-maps="1"]')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google))
      existing.addEventListener('error', () => reject(new Error('Failed to load Google Maps')))
      return
    }

    const s = document.createElement('script')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places`
    s.async = true
    s.defer = true
    s.dataset.googleMaps = '1'
    s.onload = () => resolve(window.google)
    s.onerror = () => reject(new Error('Failed to load Google Maps'))
    document.head.appendChild(s)
  })

  return __gmapsPromise
}

function RouteDialog({ open, onClose, tech, date, appts, route }) {
  const mapRef = useRef(null)
  const mapObjRef = useRef(null)
  const dirRendererRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState(false)

  const stops = useMemo(() => {
    const items = (appts || [])
      .filter(a => a?.slotNumber != null)
      .slice()
      .sort((a, b) => (a.slotNumber || 999) - (b.slotNumber || 999))
      .map(a => ({
        slotNumber: a.slotNumber,
        lat: a.ticket?.lat,
        lng: a.ticket?.lng,
        address: a.ticket?.address || '',
        ref: a.ticket?.externalRef || a.ticketId
      }))
      .filter(x => x.lat != null && x.lng != null)

    return items
  }, [appts])

  useEffect(() => {
    let cancelled = false

    async function init() {
      setErr('')
      setReady(false)
      if (!open) return

      try {
        setBusy(true)
        await loadGoogleMaps()
        if (cancelled) return

        const g = window.google
        if (!mapRef.current) return

        // Create map once
        if (!mapObjRef.current) {
          mapObjRef.current = new g.maps.Map(mapRef.current, {
            zoom: 11,
            center: { lat: tech?.homeLat || -33.9249, lng: tech?.homeLng || 18.4241 },
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true
          })
        }

        // Clear previous directions renderer
        if (dirRendererRef.current) {
          dirRendererRef.current.setMap(null)
          dirRendererRef.current = null
        }

        // Nothing to route
        if (!stops.length) {
          mapObjRef.current.setCenter({ lat: tech?.homeLat || -33.9249, lng: tech?.homeLng || 18.4241 })
          mapObjRef.current.setZoom(11)
          setReady(true)
          return
        }

        const home = tech?.homeLat != null && tech?.homeLng != null
          ? { lat: tech.homeLat, lng: tech.homeLng }
          : null

        const origin = home || { lat: stops[0].lat, lng: stops[0].lng }
        const destination = { lat: stops[stops.length - 1].lat, lng: stops[stops.length - 1].lng }
        const waypoints = stops.slice(0, -1).map(s => ({
          location: new g.maps.LatLng(s.lat, s.lng),
          stopover: true
        }))

        const ds = new g.maps.DirectionsService()
        const dr = new g.maps.DirectionsRenderer({
          suppressMarkers: false,
          preserveViewport: false
        })
        dr.setMap(mapObjRef.current)
        dirRendererRef.current = dr

        ds.route(
          {
            origin,
            destination,
            waypoints,
            optimizeWaypoints: false,
            travelMode: g.maps.TravelMode.DRIVING
          },
          (result, status) => {
            if (cancelled) return
            if (status !== 'OK' || !result) {
              setErr(`Directions failed: ${status}`)
              setReady(true)
              return
            }
            dr.setDirections(result)
            setReady(true)
          }
        )
      } catch (e) {
        if (cancelled) return
        setErr(e?.message || 'Failed to load route map')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    init()
    return () => { cancelled = true }
  }, [open, tech, date, stops])

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 950 }} noWrap>
            Route: {tech?.name || '-'}  •  {date}
          </Typography>
          <Typography variant="caption" sx={{ opacity: 0.75 }}>
            Stops: {stops.length}{route?.totals ? `  •  ~${Math.round(route.totals.totalKm || 0)} km  •  ~${Math.round(route.totals.totalMinutes || 0)} mins` : ''}
          </Typography>
        </Box>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent>
        {err ? <Alert severity="error" sx={{ mb: 2 }}>{err}</Alert> : null}

        {!import.meta.env?.VITE_GOOGLE_MAPS_API_KEY ? (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Missing VITE_GOOGLE_MAPS_API_KEY. Add it to your frontend env to enable the route map.
          </Alert>
        ) : null}

        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <Box
            ref={mapRef}
            sx={{
              height: { xs: 340, md: 520 },
              width: '100%',
              bgcolor: 'background.default'
            }}
          />
        </Paper>

        {!busy && ready && stops.length === 0 ? (
          <Typography variant="body2" sx={{ mt: 1, opacity: 0.8 }}>
            No geocoded stops for this technician on this date (tickets need lat/lng).
          </Typography>
        ) : null}

        {busy ? (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
            <CircularProgress size={18} />
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Loading map…
            </Typography>
          </Stack>
        ) : null}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}

// -------- DND helpers ----------
function DraggableTicket({ ticket, disabled }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `ticket:${ticket.id}`,
    disabled,
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
      {...(!disabled ? { ...listeners, ...attributes } : {})}
      sx={{
        p: 1.25,
        borderRadius: 2,
        mb: 1,
        cursor: disabled ? 'default' : 'grab',
        userSelect: 'none',
        touchAction: 'none',
        ...style
      }}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        <IconButton
          size="small"
          disabled={disabled}
          sx={{ mt: 0.2, cursor: disabled ? 'default' : 'grab' }}
        >
          <DragIndicatorIcon sx={{ opacity: 0.6 }} />
        </IconButton>

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
        minHeight: 140,
        bgcolor: isOver ? 'rgba(25,118,210,0.08)' : 'background.paper',
        borderColor: isOver ? 'primary.main' : 'divider',
        transition: 'all 120ms ease'
      }}
    >
      {children}
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

  // Route dialog
  const [routeOpen, setRouteOpen] = useState(false)
  const [routeTechId, setRouteTechId] = useState(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const regions = useMemo(() => {
    const set = new Set()
    for (const t of techs) if (t.region) set.add(t.region)
    return ['ALL', ...Array.from(set).sort()]
  }, [techs])

  const filteredTechs = useMemo(() => {
    if (region === 'ALL') return techs
    return techs.filter(t => (t.region || '') === region)
  }, [techs, region])

  // default tech selection when region changes
  useEffect(() => {
    if (!techs.length) return
    const defaults = (region === 'ALL' ? techs : techs.filter(t => (t.region || '') === region))
      .map(t => t.id)
    setTechIds(defaults)
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

  const techMap = useMemo(() => Object.fromEntries(techs.map(t => [t.id, t])), [techs])

  function openCreateModal() {
    setCreateOpen(true)
    setPickedTicket(null)
    setSuggested(null)
  }

  async function onPickTicketForModal(t) {
    setPickedTicket(t)
    try {
      setSuggested(null)
      if (!techIds.length) return

      const ranked = await Promise.all(
        techIds.map(async tid => {
          const s = await computeSuggestionForTech(tid, t.id).catch(() => null)
          const best = s?.rankedSlots?.[0]
          return {
            techId: tid,
            techName: techMap[tid]?.name || tid,
            recommendedSlotNumber: s?.recommendedSlotNumber ?? null,
            score: best?.score ?? Number.MAX_SAFE_INTEGER
          }
        })
      )
      ranked.sort((a, b) => a.score - b.score)
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

  const routeTech = routeTechId ? techMap[routeTechId] : null
  const routePayload = routeTechId ? (sched?.[routeTechId] || {}) : {}

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <Box sx={{ p: 2 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 2 }} spacing={2}>
          <Box>
            <Typography variant="h4" sx={{ fontWeight: 900 }}>
              ROC Appointments
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              <Chip size="small" label={`Date: ${date}`} />
              <Chip size="small" label={`Techs: ${techIdsResolved.length}`} />
              <Chip size="small" color={loading ? 'warning' : 'success'} label={loading ? 'Loading…' : 'Ready'} />
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

            <FormControl sx={{ minWidth: 320, flex: 1 }} size="small">
              <InputLabel>Technicians</InputLabel>
              <Select
                multiple
                value={techIds}
                label="Technicians"
                onChange={e => setTechIds(e.target.value)}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.slice(0, 6).map(id => (
                      <Chip key={id} size="small" label={techMap[id]?.name || id} />
                    ))}
                    {selected.length > 6 ? <Chip size="small" label={`+${selected.length - 6}`} /> : null}
                  </Box>
                )}
              >
                {filteredTechs.map(t => (
                  <MenuItem key={t.id} value={t.id}>
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
                  unassigned.map(t => <DraggableTicket key={t.id} ticket={t} disabled={false} />)
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

                        {route?.totals ? (
                          <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                            <Chip size="small" label={`Travel mins ~${Math.round(route.totals.totalMinutes || 0)}`} />
                            <Chip size="small" label={`Km ~${Math.round(route.totals.totalKm || 0)}`} />
                            <Chip size="small" variant="outlined" label={`Stops: ${day.length}`} />
                          </Stack>
                        ) : null}
                      </Box>

                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          startIcon={<MapIcon />}
                          onClick={() => {
                            setRouteTechId(tid)
                            setRouteOpen(true)
                          }}
                          disabled={loading}
                        >
                          Route
                        </Button>

                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => setTechIds([tid])}
                          disabled={techIdsResolved.length === 1}
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
                            <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>
                              {s.label}
                            </Typography>
                            <Typography variant="caption" sx={{ opacity: 0.8 }}>
                              {s.start} to {s.end}
                            </Typography>

                            <Divider sx={{ my: 1 }} />

                            {!a ? (
                              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                                Drop ticket here
                              </Typography>
                            ) : (
                              <>
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
                                      onClick={() => moveSlot({ technicianId: tid, fromSlot: s.n, toSlot: x.n })}
                                      disabled={loading}
                                      sx={{ textTransform: 'none' }}
                                    >
                                      Move to {x.n}
                                    </Button>
                                  ))}
                                </Stack>
                              </>
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

        {/* Route dialog */}
        <RouteDialog
          open={routeOpen}
          onClose={() => setRouteOpen(false)}
          tech={routeTech}
          date={date}
          appts={routePayload?.appts || []}
          route={routePayload?.route || null}
        />

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

            <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
              Quick suggestion across selected techs
            </Typography>

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
                {suggested.ranked.slice(0, 5).map((x) => (
                  <ListItem key={x.techId} disableGutters>
                    <ListItemText
                      primary={`${x.techName}`}
                      secondary={
                        x.recommendedSlotNumber
                          ? `Recommended slot ${x.recommendedSlotNumber} (score ~${x.score})`
                          : `No slot suggestion`
                      }
                    />
                  </ListItem>
                ))}
              </List>
            )}

            <Divider sx={{ my: 2 }} />

            <Typography variant="subtitle2">Choose technician + slot</Typography>
            <Typography variant="caption" sx={{ opacity: 0.75 }}>
              Slot buttons create the appointment for the first selected technician only (drag-drop is better for multi-tech mode).
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
      </Box>
    </DndContext>
  )
}
