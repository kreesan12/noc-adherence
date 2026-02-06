// frontend/src/pages/RocAppointmentsPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  Alert,
  Stack,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress
} from '@mui/material'
import dayjs from 'dayjs'
import {
  listTechnicians,
  searchTickets,
  listAppointments,
  createAppointment,
  moveAppointment,
  suggestSlot,
  routeSummary
} from '../api/rocAppointments'

import RefreshIcon from '@mui/icons-material/Refresh'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import MapIcon from '@mui/icons-material/Map'
import SwapHorizIcon from '@mui/icons-material/SwapHoriz'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'

const SLOTS = [
  { n: 1, label: 'Slot 1', start: '08:00', end: '10:00' },
  { n: 2, label: 'Slot 2', start: '10:00', end: '12:00' },
  { n: 3, label: 'Slot 3', start: '12:00', end: '14:00' },
  { n: 4, label: 'Slot 4', start: '14:00', end: '16:00' },
  { n: 5, label: 'Slot 5', start: '16:00', end: '18:00' }
]

function slotLabel(n) {
  const s = SLOTS.find(x => x.n === n)
  return s ? `${s.label} (${s.start}-${s.end})` : `Slot ${n}`
}

function buildMapsDirectionsUrl(stops) {
  // stops: array of address strings or "lat,lng"
  // Google Maps Directions URL (works without a key)
  if (!stops || stops.length < 2) return ''
  const origin = encodeURIComponent(stops[0])
  const destination = encodeURIComponent(stops[stops.length - 1])
  const waypoints = stops.slice(1, -1).map(s => encodeURIComponent(s)).join('%7C')
  const wp = waypoints ? `&waypoints=${waypoints}` : ''
  return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${wp}&travelmode=driving`
}

function buildMapsEmbedUrl(stops) {
  // Requires VITE_GOOGLE_MAPS_EMBED_KEY
  const key = import.meta.env.VITE_GOOGLE_MAPS_EMBED_KEY
  if (!key) return ''
  if (!stops || stops.length < 2) return ''
  const origin = encodeURIComponent(stops[0])
  const destination = encodeURIComponent(stops[stops.length - 1])
  const waypoints = stops.slice(1, -1).map(s => encodeURIComponent(s)).join('%7C')
  const wp = waypoints ? `&waypoints=${waypoints}` : ''
  return `https://www.google.com/maps/embed/v1/directions?key=${key}&origin=${origin}&destination=${destination}${wp}&mode=driving`
}

function stopFromTicket(t) {
  // Prefer lat/lng if available, else address
  if (t?.lat != null && t?.lng != null) return `${t.lat},${t.lng}`
  return t?.address || ''
}

export default function RocAppointmentsPage() {
  const [techs, setTechs] = useState([])
  const [techId, setTechId] = useState('')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [appts, setAppts] = useState([])
  const [route, setRoute] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [ticketSearch, setTicketSearch] = useState('')
  const [ticketResults, setTicketResults] = useState([])
  const [pickedTicket, setPickedTicket] = useState(null)
  const [suggested, setSuggested] = useState(null)
  const [creatingSlot, setCreatingSlot] = useState(null)

  // Top bar: quick assignment check
  const [checkSearch, setCheckSearch] = useState('')
  const [checkResult, setCheckResult] = useState(null)
  const [checkBusy, setCheckBusy] = useState(false)

  useEffect(() => {
    listTechnicians().then(r => {
      setTechs(r.data || [])
      if ((r.data || []).length) setTechId(r.data[0].id)
    })
  }, [])

  async function load() {
    if (!techId) return
    setLoading(true)
    setError('')
    try {
      const r = await listAppointments({ from: date, to: date, technicianId: techId })
      setAppts(r.data || [])
      const rr = await routeSummary({ technicianId: techId, date })
      setRoute(rr.data || null)
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [techId, date])

  const apptBySlot = useMemo(() => {
    const m = {}
    for (const a of appts) if (a.slotNumber) m[a.slotNumber] = a
    return m
  }, [appts])

  async function doTicketSearch() {
    const r = await searchTickets(ticketSearch, { unassignedOnly: true })
    setTicketResults(r.data || [])
  }

  async function doCheckAssignment() {
    setCheckBusy(true)
    setCheckResult(null)
    try {
      const r = await searchTickets(checkSearch, { unassignedOnly: false, includeAssigned: true })
      // pick best match if backend returns multiple
      setCheckResult((r.data || [])[0] || null)
    } catch (e) {
      setCheckResult({ error: e?.response?.data?.error || e?.message || 'Search failed' })
    } finally {
      setCheckBusy(false)
    }
  }

  async function computeSuggestion(ticketId) {
    const r = await suggestSlot({ technicianId: techId, date, ticketId })
    setSuggested(r.data || null)
  }

  function openCreate() {
    setCreateOpen(true)
    setTicketSearch('')
    setTicketResults([])
    setPickedTicket(null)
    setSuggested(null)
    setCreatingSlot(null)
  }

  async function createInSlot(slotNumber) {
    if (!pickedTicket) return
    const win = SLOTS.find(s => s.n === slotNumber)
    setCreatingSlot(slotNumber)
    try {
      const payload = {
        ticketId: pickedTicket.id,
        technicianId: techId,
        appointmentDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
        slotNumber,
        windowStartTime: win.start,
        windowEndTime: win.end
      }
      await createAppointment(payload)
      setCreateOpen(false)
      await load()
    } finally {
      setCreatingSlot(null)
    }
  }

  async function moveSlot(fromSlot, toSlot) {
    const a = apptBySlot[fromSlot]
    if (!a) return
    await moveAppointment(a.id, {
      technicianId: techId,
      appointmentDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
      slotNumber: toSlot
    })
    await load()
  }

  // Build stops for mapping. If you have a depot or tech start location, insert it as first stop.
  const orderedStops = useMemo(() => {
    const slots = SLOTS.map(s => apptBySlot[s.n]).filter(Boolean)
    const stops = slots.map(a => stopFromTicket(a.ticket || {})).filter(Boolean)
    return stops
  }, [apptBySlot])

  const mapsUrl = useMemo(() => buildMapsDirectionsUrl(orderedStops), [orderedStops])
  const embedUrl = useMemo(() => buildMapsEmbedUrl(orderedStops), [orderedStops])

  return (
    <Box sx={{ p: 2 }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2} sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 950, lineHeight: 1.1 }}>
            ROC Appointments
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.7, fontWeight: 700, mt: 0.5 }}>
            Plan the day, optimise the route, keep tickets clean.
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} disabled={!techId}>
            Add appointment
          </Button>
          <Button variant="outlined" startIcon={<RefreshIcon />} onClick={load} disabled={loading}>
            Refresh
          </Button>
        </Stack>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2, borderRadius: 3 }}>{error}</Alert>}

      {/* Toolbar */}
      <Paper variant="outlined" sx={{ p: 2, borderRadius: 4, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <FormControl sx={{ minWidth: 260 }} size="small">
            <InputLabel>Technician</InputLabel>
            <Select value={techId} label="Technician" onChange={e => setTechId(e.target.value)}>
              {techs.map(t => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name} {t.region ? `(${t.region})` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Date"
            type="date"
            size="small"
            value={date}
            onChange={e => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          <Chip
            label={loading ? 'Loading…' : `${appts.length} appointments`}
            sx={{ fontWeight: 900 }}
            variant="outlined"
          />

          <Box sx={{ flex: 1 }} />

          {/* Quick assignment check */}
          <TextField
            size="small"
            label="Check ticket assignment"
            value={checkSearch}
            onChange={e => setCheckSearch(e.target.value)}
            sx={{ minWidth: 320 }}
            InputLabelProps={{ shrink: true }}
          />
          <Button
            variant="outlined"
            startIcon={checkBusy ? <CircularProgress size={16} /> : <SearchIcon />}
            onClick={doCheckAssignment}
            disabled={!checkSearch || checkBusy}
          >
            Check
          </Button>

          {checkResult?.error ? (
            <Chip color="error" label="Check failed" />
          ) : checkResult ? (
            <Tooltip
              title={
                checkResult.assignedTo
                  ? `Assigned to ${checkResult.assignedTo?.techName || 'tech'} on ${checkResult.assignedTo?.date || ''} slot ${checkResult.assignedTo?.slotNumber || ''}`
                  : 'Not assigned'
              }
            >
              <Chip
                color={checkResult.assignedTo ? 'warning' : 'success'}
                label={checkResult.assignedTo ? 'Assigned' : 'Not assigned'}
                sx={{ fontWeight: 900 }}
              />
            </Tooltip>
          ) : null}
        </Stack>
      </Paper>

      {/* Main layout */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1.2fr', gap: 2 }}>
        {/* Day view */}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 950 }}>Day view</Typography>
            <Chip size="small" variant="outlined" label="Click a slot to add" sx={{ fontWeight: 900 }} />
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1.2 }}>
            {SLOTS.map(s => {
              const a = apptBySlot[s.n]
              const t = a?.ticket || {}
              const isEmpty = !a

              return (
                <Paper
                  key={s.n}
                  variant="outlined"
                  sx={{
                    p: 1.3,
                    minHeight: 210,
                    borderRadius: 3,
                    cursor: isEmpty ? 'pointer' : 'default',
                    bgcolor: isEmpty ? 'transparent' : 'rgba(0,0,0,0.02)',
                    borderColor: isEmpty ? 'divider' : 'rgba(0,0,0,0.12)',
                    '&:hover': isEmpty ? { bgcolor: 'rgba(0,0,0,0.03)' } : undefined
                  }}
                  onClick={() => isEmpty && openCreate()}
                >
                  <Stack spacing={0.8}>
                    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
                      <Typography sx={{ fontWeight: 950 }}>{s.label}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 800 }}>
                        {s.start}-{s.end}
                      </Typography>
                    </Stack>

                    <Divider />

                    {isEmpty ? (
                      <Box>
                        <Typography variant="body2" sx={{ opacity: 0.75 }}>
                          Empty slot
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.7 }}>
                          Click to add a ticket
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        <Typography sx={{ fontWeight: 950, lineHeight: 1.15 }}>
                          {t.externalRef || a.ticketId}
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>
                          {t.customerName || ''}
                        </Typography>
                        <Typography variant="caption" sx={{ opacity: 0.75 }}>
                          {t.address || ''}
                        </Typography>

                        <Stack direction="row" spacing={0.8} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
                          <Chip size="small" variant="outlined" label="Assigned" sx={{ fontWeight: 900 }} />
                        </Stack>

                        <Divider sx={{ my: 0.6 }} />

                        <Stack direction="row" spacing={0.8} sx={{ flexWrap: 'wrap' }}>
                          {SLOTS.filter(x => x.n !== s.n && !apptBySlot[x.n]).slice(0, 2).map(x => (
                            <Tooltip key={x.n} title={`Move to ${slotLabel(x.n)}`}>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<SwapHorizIcon />}
                                onClick={e => { e.stopPropagation(); moveSlot(s.n, x.n) }}
                                sx={{ borderRadius: 999, fontWeight: 900, textTransform: 'none' }}
                              >
                                {x.n}
                              </Button>
                            </Tooltip>
                          ))}
                        </Stack>
                      </>
                    )}
                  </Stack>
                </Paper>
              )
            })}
          </Box>
        </Paper>

        {/* Route + Map */}
        <Paper variant="outlined" sx={{ p: 2, borderRadius: 4 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6" sx={{ fontWeight: 950 }}>Route</Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              {mapsUrl ? (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<OpenInNewIcon />}
                  onClick={() => window.open(mapsUrl, '_blank', 'noopener,noreferrer')}
                  sx={{ borderRadius: 999, fontWeight: 900, textTransform: 'none' }}
                >
                  Open in Maps
                </Button>
              ) : null}
            </Stack>
          </Stack>

          {!route ? (
            <Typography variant="body2" sx={{ opacity: 0.7 }}>No route yet</Typography>
          ) : (
            <>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Total minutes: ${Math.round(route.totals?.totalMinutes || 0)}`}
                  sx={{ fontWeight: 900 }}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  label={`Total km: ${Math.round(route.totals?.totalKm || 0)}`}
                  sx={{ fontWeight: 900 }}
                />
              </Stack>

              <Divider sx={{ my: 1 }} />

              {/* Map */}
              <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden', mb: 1.2 }}>
                {embedUrl ? (
                  <iframe
                    title="Route map"
                    src={embedUrl}
                    width="100%"
                    height="280"
                    style={{ border: 0 }}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                ) : (
                  <Box sx={{ p: 2 }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <MapIcon />
                      <Typography sx={{ fontWeight: 900 }}>Map preview needs a key</Typography>
                    </Stack>
                    <Typography variant="body2" sx={{ opacity: 0.75, mt: 0.5 }}>
                      Add VITE_GOOGLE_MAPS_EMBED_KEY to show the embedded route.
                    </Typography>
                    {mapsUrl ? (
                      <Button
                        sx={{ mt: 1, borderRadius: 999, fontWeight: 900, textTransform: 'none' }}
                        variant="outlined"
                        startIcon={<OpenInNewIcon />}
                        onClick={() => window.open(mapsUrl, '_blank', 'noopener,noreferrer')}
                      >
                        Open route in Google Maps
                      </Button>
                    ) : null}
                  </Box>
                )}
              </Paper>

              {/* Legs */}
              <List dense sx={{ maxHeight: 320, overflow: 'auto' }}>
                {(route.legs || []).map((l, idx) => (
                  <ListItemButton key={idx} disableGutters sx={{ borderRadius: 2, mb: 0.5 }}>
                    <ListItemText
                      primaryTypographyProps={{ sx: { fontWeight: 900 } }}
                      primary={`${idx + 1}. ${l.to} ${l.externalRef ? `• ${l.externalRef}` : ''}`}
                      secondary={`~${l.minutes ?? '-'} min, ~${l.km ? l.km.toFixed(1) : '-'} km`}
                    />
                  </ListItemButton>
                ))}
              </List>
            </>
          )}
        </Paper>
      </Box>

      {/* Create modal */}
      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 950 }}>Create appointment</DialogTitle>
        <DialogContent>
          {/* SLOT SELECTOR MOVED TO TOP */}
          <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ opacity: 0.75, fontWeight: 900 }}>
              Choose slot
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
              {SLOTS.map(s => (
                <Button
                  key={s.n}
                  variant={suggested?.recommendedSlotNumber === s.n ? 'contained' : 'outlined'}
                  disabled={!pickedTicket || Boolean(apptBySlot[s.n]) || creatingSlot != null}
                  onClick={() => createInSlot(s.n)}
                  sx={{ borderRadius: 999, fontWeight: 950, textTransform: 'none' }}
                >
                  {creatingSlot === s.n ? 'Creating…' : `Slot ${s.n}`}
                </Button>
              ))}
            </Stack>
            <Typography variant="caption" sx={{ display: 'block', opacity: 0.7, mt: 1 }}>
              Tip: pick a ticket first, then click a slot. Suggested slot will highlight.
            </Typography>
          </Paper>

          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <TextField
              label="Search tickets (unassigned only)"
              value={ticketSearch}
              onChange={e => setTicketSearch(e.target.value)}
              size="small"
              fullWidth
            />
            <Button variant="outlined" onClick={doTicketSearch} startIcon={<SearchIcon />} sx={{ borderRadius: 999, fontWeight: 900 }}>
              Search
            </Button>
          </Stack>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 2, mt: 1 }}>
            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 950, mb: 1 }}>Results</Typography>
              <List dense sx={{ maxHeight: 360, overflow: 'auto' }}>
                {ticketResults.map(t => (
                  <ListItemButton
                    key={t.id}
                    sx={{ borderRadius: 2, mb: 0.5 }}
                    onClick={() => { setPickedTicket(t); computeSuggestion(t.id) }}
                    selected={pickedTicket?.id === t.id}
                  >
                    <ListItemText
                      primaryTypographyProps={{ sx: { fontWeight: 950 } }}
                      primary={t.externalRef || t.id}
                      secondary={`${t.customerName || ''}${t.address ? ` • ${t.address}` : ''}`}
                    />
                  </ListItemButton>
                ))}
                {ticketResults.length === 0 ? (
                  <Typography variant="body2" sx={{ opacity: 0.7, p: 1 }}>
                    No tickets found. (Only unassigned tickets are shown.)
                  </Typography>
                ) : null}
              </List>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 950 }}>Suggestion</Typography>

              {!pickedTicket ? (
                <Typography variant="body2" sx={{ opacity: 0.7, mt: 1 }}>
                  Select a ticket to get the recommended slot.
                </Typography>
              ) : (
                <>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Ticket: <b>{pickedTicket.externalRef || pickedTicket.id}</b>
                  </Typography>

                  {suggested?.recommendedSlotNumber ? (
                    <>
                      <Chip
                        sx={{ mt: 1, fontWeight: 950 }}
                        color="success"
                        label={`Recommended: Slot ${suggested.recommendedSlotNumber}`}
                      />
                      <Divider sx={{ my: 1 }} />
                      <List dense>
                        {(suggested.rankedSlots || []).slice(0, 5).map((s, idx) => (
                          <ListItemButton key={idx} disableGutters sx={{ borderRadius: 2 }}>
                            <ListItemText
                              primaryTypographyProps={{ sx: { fontWeight: 900 } }}
                              primary={`Slot ${s.slotNumber}`}
                              secondary={`Score ~${s.score} min. Between ${s.insertBetween?.before ?? 'start'} and ${s.insertBetween?.after ?? 'end'}`}
                            />
                          </ListItemButton>
                        ))}
                      </List>
                    </>
                  ) : (
                    <Typography variant="body2" sx={{ opacity: 0.7, mt: 1 }}>
                      No suggestion available.
                    </Typography>
                  )}
                </>
              )}
            </Paper>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setCreateOpen(false)} sx={{ fontWeight: 900 }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
