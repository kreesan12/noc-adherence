import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Tooltip,
  LayersControl,
  useMap
} from 'react-leaflet'
import L from 'leaflet'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import { alpha } from '@mui/material/styles'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis
} from 'recharts'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff'
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded'
import RouteRoundedIcon from '@mui/icons-material/RouteRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import api from '../api'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

const { BaseLayer } = LayersControl

function haversineKm(a, b) {
  const toRad = (d) => (d * Math.PI) / 180
  const R = 6371
  const dLat = toRad(b[0] - a[0])
  const dLon = toRad(b[1] - a[1])
  const lat1 = toRad(a[0])
  const lat2 = toRad(b[0])
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

function fmtDbm(value) {
  if (value == null || value === '' || Number.isNaN(Number(value))) return '--'
  return `${Number(value).toFixed(1)} dBm`
}

function fmtWhen(value) {
  return value ? dayjs(value).format('DD MMM YYYY, HH:mm') : 'Not recorded'
}

function buildHistoryPoints(data) {
  const points = new Map()
  const pointAt = (value) => {
    const timestamp = dayjs(value).valueOf()
    if (!Number.isFinite(timestamp)) return null
    if (!points.has(timestamp)) points.set(timestamp, { timestamp })
    return points.get(timestamp)
  }

  ;(data?.dailyLevels || []).forEach((row) => {
    const point = pointAt(row.sampleTime)
    if (point) point[String(row.side || '').toUpperCase() === 'A' ? 'dailyA' : 'dailyB'] = Number(row.rx)
  })
  ;(data?.lightEvents || []).forEach((row) => {
    const point = pointAt(row.eventDate)
    if (!point) return
    point.eventA = row.sideACurr == null ? null : Number(row.sideACurr)
    point.eventB = row.sideBCurr == null ? null : Number(row.sideBCurr)
  })

  return [...points.values()].sort((a, b) => a.timestamp - b.timestamp)
}

function MapHistoryDrawer({ history, onClose }) {
  const circuit = history?.circuit
  const data = history?.data
  const points = useMemo(() => buildHistoryPoints(data), [data])
  const events = [...(data?.lightEvents || [])].sort((a, b) => dayjs(b.eventDate).valueOf() - dayjs(a.eventDate).valueOf())
  const dailies = data?.dailyLevels || []

  return (
    <Drawer anchor="right" open={Boolean(history)} onClose={onClose} ModalProps={{ sx: { zIndex: 2400 } }} slotProps={{ paper: { sx: { width: { xs: '100vw', md: 860 }, maxWidth: '100vw', pt: 6, bgcolor: '#f8fafc' } } }}>
      <Stack spacing={2} sx={{ p: { xs: 1.5, md: 2.5 }, overflowY: 'auto' }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
          <Box>
            <Typography variant="h6" fontWeight={850}>Circuit level history</Typography>
            <Typography variant="body2" color="text.secondary">
              {circuit ? `${circuit.circuitId} · ${circuit.nodeA?.name ?? circuit.nodeA} → ${circuit.nodeB?.name ?? circuit.nodeB}` : 'Loading circuit history…'}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {circuit?.nldGroup && <Chip label={circuit.nldGroup} color="primary" variant="outlined" />}
            <Button onClick={onClose}>Close</Button>
          </Stack>
        </Stack>

        {history?.loading && <Stack alignItems="center" spacing={1} sx={{ py: 8 }}><CircularProgress /><Typography color="text.secondary">Loading daily levels and events…</Typography></Stack>}
        {!history?.loading && history?.error && <Alert severity="error">{history.error}</Alert>}
        {!history?.loading && data && <>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
            <Chip label={`${dailies.length} daily samples`} color="info" variant="outlined" />
            <Chip label={`${events.length} recorded events`} color="warning" variant="outlined" />
            <Chip label={dailies[0] ? `Latest sample ${fmtWhen(dailies[0].sampleTime)}` : 'No daily samples'} variant="outlined" />
          </Stack>

          <Box sx={{ height: 360, border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.25, bgcolor: '#fff' }}>
            {points.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 8, right: 18, bottom: 5, left: -12 }}><CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" /><XAxis dataKey="timestamp" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value) => dayjs(value).format('DD MMM')} minTickGap={55} /><YAxis tickFormatter={(value) => `${value} dBm`} width={62} /><RechartsTooltip labelFormatter={(value) => fmtWhen(value)} formatter={(value) => fmtDbm(value)} /><Legend /><Line type="monotone" dataKey="dailyA" name="Daily A" stroke="#16a34a" strokeWidth={2} dot={false} connectNulls /><Line type="monotone" dataKey="dailyB" name="Daily B" stroke="#2563eb" strokeWidth={2} dot={false} connectNulls /><Line dataKey="eventA" name="Event A" stroke="#f97316" strokeDasharray="2 3" dot={{ r: 4 }} connectNulls={false} /><Line dataKey="eventB" name="Event B" stroke="#ef4444" strokeDasharray="2 3" dot={{ r: 4 }} connectNulls={false} /></LineChart></ResponsiveContainer> : <Alert severity="info">No level data has been recorded for this circuit yet.</Alert>}
          </Box>

          <Box>
            <Typography variant="subtitle1" fontWeight={800} mb={0.8}>Recent events</Typography>
            {events.length ? <Stack spacing={0.75}>{events.slice(0, 12).map((event) => <Box key={event.id} sx={{ borderLeft: '3px solid #f97316', pl: 1 }}><Typography variant="body2" fontWeight={700}>{fmtWhen(event.eventDate)} · {event.impactType || 'Event'}</Typography><Typography variant="caption" color="text.secondary">A {fmtDbm(event.sideACurr)} · B {fmtDbm(event.sideBCurr)}{event.ticketId ? ` · Ticket ${event.ticketId}` : ''}</Typography></Box>)}</Stack> : <Typography variant="body2" color="text.secondary">No events recorded.</Typography>}
          </Box>
        </>}
      </Stack>
    </Drawer>
  )
}

function MapController({ fitBoundsCmd }) {
  const map = useMap()

  useEffect(() => {
    const onResize = () => map.invalidateSize()
    map.whenReady(() => map.invalidateSize())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [map])

  useEffect(() => {
    if (!fitBoundsCmd) return
    const { bounds, options, method } = fitBoundsCmd
    if (!bounds) return
    const latLngBounds = Array.isArray(bounds[0]) ? L.latLngBounds(bounds) : bounds
    if (!latLngBounds.isValid()) {
      console.warn('MapController: invalid bounds', bounds)
      return
    }
    if (method === 'fly') map.flyToBounds(latLngBounds, options || { padding: [60, 60] })
    else map.fitBounds(latLngBounds, options || { padding: [60, 60] })
  }, [fitBoundsCmd, map])

  return null
}

function DetailRow({ label, value }) {
  return (
    <Stack direction="row" spacing={1} justifyContent="space-between" alignItems="flex-start">
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.45 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right' }}>
        {value}
      </Typography>
    </Stack>
  )
}

function CircuitDetails({ span, colour, onFit, onFitGroup, onOpenHistory }) {
  if (!span) {
    return (
      <Stack spacing={1.1} sx={{ p: 0.15 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Select a circuit from the explorer or click a route on the map to inspect its ends, distance, and light level context.
        </Typography>
        <Chip size="small" label="No circuit selected" sx={{ alignSelf: 'flex-start' }} />
      </Stack>
    )
  }

  const a = [Number(span.nodeA.lat), Number(span.nodeA.lon)]
  const b = [Number(span.nodeB.lat), Number(span.nodeB.lon)]
  const km = haversineKm(a, b)
  const accent = colour(span.nldGroup)

  return (
    <Stack spacing={1.05}>
      <Stack direction="row" spacing={0.85} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label={span.nldGroup ?? 'Unassigned'}
          sx={{ bgcolor: alpha(accent, 0.14), color: accent, fontWeight: 800 }}
        />
        <Typography variant="h6" sx={{ color: accent }}>
          {span.circuitId}
        </Typography>
      </Stack>

      <Stack spacing={0.75}>
        <DetailRow label="Node A" value={span.nodeA?.name ?? 'Unknown'} />
        <DetailRow label="Node B" value={span.nodeB?.name ?? 'Unknown'} />
        <DetailRow label="Approx length" value={`${km.toFixed(1)} km`} />
        <DetailRow label="A coordinates" value={`${a[0].toFixed(4)}, ${a[1].toFixed(4)}`} />
        <DetailRow label="B coordinates" value={`${b[0].toFixed(4)}, ${b[1].toFixed(4)}`} />
        <DetailRow label="Latest Rx A" value={fmtDbm(span?.levels?.aRx)} />
        <DetailRow label="Latest Rx B" value={fmtDbm(span?.levels?.bRx)} />
      </Stack>

      <Divider />

      <Stack direction={{ xs: 'column', sm: 'row', lg: 'column', xl: 'row' }} spacing={0.8}>
        <Button variant="contained" startIcon={<MyLocationRoundedIcon />} onClick={onFit}>
          Fit Circuit
        </Button>
        <Button variant="outlined" startIcon={<HubRoundedIcon />} onClick={onFitGroup}>
          Fit Group
        </Button>
        <Button variant="text" onClick={() => onOpenHistory(span)}>
          Open Level History
        </Button>
      </Stack>
    </Stack>
  )
}

export default function NldMapPage() {
  const [spans, setSpans] = useState([])
  const [query, setQuery] = useState('')
  const [showMarkers, setShowMarkers] = useState(true)
  const [selectedCircuitId, setSelectedCircuitId] = useState(null)
  const [activeGroups, setActiveGroups] = useState(new Set())
  const [fitBoundsCmd, setFitBoundsCmd] = useState(null)
  const [history, setHistory] = useState(null)

  useEffect(() => {
    api.get('/nlds.json')
      .then((r) => setSpans(r.data ?? []))
      .catch(console.error)
  }, [])

  const palette = ['#1976d2', '#009688', '#ef6c00', '#8e24aa', '#d81b60', '#43a047', '#f9a825', '#5c6bc0']

  const colour = (nldLike) => {
    const str = String(nldLike ?? 'Unassigned')
    const digits = str.replace(/\D/g, '')
    const num = parseInt(digits, 10)
    if (Number.isFinite(num) && num > 0) return palette[(num - 1) % palette.length]
    let hash = 0
    for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) - hash) + str.charCodeAt(i)
    return palette[Math.abs(hash) % palette.length]
  }

  const isValidCoordinate = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
  const validLatLon = (node) => isValidCoordinate(node?.lat) && isValidCoordinate(node?.lon)
  const hasBothEnds = (span) => validLatLon(span?.nodeA) && validLatLon(span?.nodeB)

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const fromUrl = p.get('circuit')
    if (fromUrl) setSelectedCircuitId(fromUrl)
  }, [])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (selectedCircuitId) p.set('circuit', selectedCircuitId)
    else p.delete('circuit')
    const nextSearch = p.toString()
    const newUrl = nextSearch ? `${window.location.pathname}?${nextSearch}${window.location.hash}` : `${window.location.pathname}${window.location.hash}`
    window.history.replaceState({}, '', newUrl)
  }, [selectedCircuitId])

  const allGroups = useMemo(() => {
    const s = new Set()
    spans.forEach((sp) => s.add(sp?.nldGroup ?? 'Unassigned'))
    return Array.from(s).sort((a, b) => String(a).localeCompare(String(b)))
  }, [spans])

  const validSpans = useMemo(() => spans.filter(hasBothEnds), [spans])

  const groupMeta = useMemo(() => {
    const counts = new Map()
    validSpans.forEach((span) => {
      const key = span?.nldGroup ?? 'Unassigned'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    })
    return allGroups.map((group) => ({
      group,
      count: counts.get(group) ?? 0,
      color: colour(group)
    }))
  }, [allGroups, validSpans])

  const isGroupActive = (group) => activeGroups.size === 0 || activeGroups.has(group)

  const filteredSpans = useMemo(() => {
    const q = query.trim().toLowerCase()
    return validSpans
      .filter((span) => isGroupActive(span?.nldGroup ?? 'Unassigned'))
      .filter((span) => {
        if (!q) return true
        const haystacks = [span?.nodeA?.name, span?.nodeB?.name, span?.circuitId, span?.nldGroup]
        return haystacks.some((value) => String(value ?? '').toLowerCase().includes(q))
      })
  }, [validSpans, query, activeGroups])

  const groups = useMemo(() => {
    return filteredSpans.reduce((memo, span) => {
      const key = span?.nldGroup ?? 'Unassigned'
      ;(memo[key] ??= []).push(span)
      return memo
    }, {})
  }, [filteredSpans])

  const selectedSpan = useMemo(
    () => filteredSpans.find((span) => span.circuitId === selectedCircuitId) || null,
    [filteredSpans, selectedCircuitId]
  )

  const boundsForSpan = (span) => [
    [Number(span.nodeA.lat), Number(span.nodeA.lon)],
    [Number(span.nodeB.lat), Number(span.nodeB.lon)]
  ]

  const boundsForSpans = (items) => {
    const pts = []
    items.forEach((span) => {
      if (hasBothEnds(span)) {
        pts.push([Number(span.nodeA.lat), Number(span.nodeA.lon)])
        pts.push([Number(span.nodeB.lat), Number(span.nodeB.lon)])
      }
    })
    if (!pts.length) return null
    let [minLat, minLon] = pts[0]
    let [maxLat, maxLon] = pts[0]
    pts.forEach(([lat, lon]) => {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
    })
    return [[minLat, minLon], [maxLat, maxLon]]
  }

  const setFitSpan = (span) => {
    setFitBoundsCmd({ bounds: boundsForSpan(span), method: 'fly', options: { padding: [60, 60] } })
  }

  const openHistory = async (span) => {
    if (!span?.id) {
      setHistory({ circuit: span, loading: false, data: null, error: 'This circuit record is not available for history yet.' })
      return
    }

    setHistory({ circuit: span, loading: true, data: null })
    try {
      const { data } = await api.get(`/engineering/circuit/${span.id}`)
      setHistory({ circuit: span, loading: false, data })
    } catch (error) {
      setHistory({ circuit: span, loading: false, data: null, error: error?.message || 'Unable to load circuit history' })
    }
  }

  const fitAll = () => {
    const bounds = boundsForSpans(filteredSpans)
    if (!bounds) return
    setFitBoundsCmd({ bounds, method: 'fit', options: { padding: [70, 70] } })
  }

  const fitGroup = (groupKey) => {
    const bounds = boundsForSpans(groups[groupKey] ?? [])
    if (!bounds) return
    setFitBoundsCmd({ bounds, method: 'fit', options: { padding: [60, 60] } })
  }

  const clearFilters = () => {
    setQuery('')
    setActiveGroups(new Set())
    setSelectedCircuitId(null)
    const bounds = boundsForSpans(validSpans)
    if (bounds) {
      setFitBoundsCmd({ bounds, method: 'fit', options: { padding: [70, 70] } })
    }
  }

  useEffect(() => {
    if (!selectedCircuitId && filteredSpans.length) fitAll()
  }, [filteredSpans.length])

  const stats = [
    { label: 'Mapped Circuits', value: validSpans.length, helper: 'Circuits with usable coordinates', accent: '#0f766e' },
    { label: 'Groups', value: allGroups.length, helper: activeGroups.size ? `${activeGroups.size} filtered in` : 'All groups visible', accent: '#2563eb' },
    { label: 'In View', value: filteredSpans.length, helper: query ? `Search: ${query}` : 'Current filter result', accent: '#ea580c' },
    { label: 'Selection', value: selectedSpan?.circuitId || 'None', helper: selectedSpan ? (selectedSpan.nldGroup ?? 'Unassigned') : 'Choose a route', accent: '#7c3aed' }
  ]

  return (
    <PageShell
      eyebrow="Engineering"
      title="NLD Map Explorer"
      description="Explore NLD groups, circuit paths, and node positions in one place. The filters and explorer stay lightweight so we can keep this page responsive even as the network grows."
      accent="#0f766e"
      actions={(
        <FilterStrip>
          <TextField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search circuit, node, or NLD group"
            sx={{ minWidth: { xs: '100%', sm: 250 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon fontSize="small" />
                </InputAdornment>
              )
            }}
          />
          <FormControlLabel
            control={<Switch checked={showMarkers} onChange={(_, value) => setShowMarkers(value)} />}
            label="Node markers"
            sx={{ mr: 0.2 }}
          />
          <Button variant="contained" startIcon={<CenterFocusStrongIcon />} onClick={fitAll}>
            Fit View
          </Button>
          <Button variant="outlined" startIcon={<FilterAltOffIcon />} onClick={clearFilters}>
            Clear
          </Button>
          <IconButton onClick={() => { setSelectedCircuitId(null); fitAll() }} title="Reset selection">
            <RestartAltIcon />
          </IconButton>
        </FilterStrip>
      )}
      stats={stats}
    >
      <Box
        sx={{
          display: 'grid',
          gap: 1.05,
          gridTemplateColumns: { xs: '1fr', xl: '320px minmax(0, 1fr)' },
          alignItems: 'start'
        }}
      >
        <SectionCard
          title="Circuit Explorer"
          subtitle="Filter by NLD group, inspect available routes, and jump the map to a chosen area."
          accent="#2563eb"
          noPadding
        >
          <Stack spacing={1} sx={{ p: 1.05 }}>
            <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
              {groupMeta.map(({ group, count, color }) => {
                const active = isGroupActive(group)
                return (
                  <Chip
                    key={group}
                    clickable
                    onClick={() => {
                      setSelectedCircuitId(null)
                      setActiveGroups((prev) => {
                        const next = new Set(prev)
                        if (next.has(group)) next.delete(group)
                        else next.add(group)
                        if (next.size === allGroups.length) return new Set()
                        return next
                      })
                    }}
                    label={`${group} (${count})`}
                    variant={active ? 'filled' : 'outlined'}
                    sx={{
                      bgcolor: active ? alpha(color, 0.14) : 'transparent',
                      borderColor: alpha(color, 0.5),
                      color,
                      fontWeight: 700
                    }}
                  />
                )
              })}
            </Stack>

            <Divider />

            <Box sx={{ maxHeight: { xs: 360, xl: 'calc(100vh - 390px)' }, overflow: 'auto', pr: 0.4 }}>
              <Stack spacing={1}>
                {Object.entries(groups)
                  .sort(([a], [b]) => String(a).localeCompare(String(b)))
                  .map(([groupKey, list]) => (
                    <Box key={groupKey}>
                      <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between" sx={{ mb: 0.45 }}>
                        <Stack direction="row" spacing={0.65} alignItems="center" sx={{ minWidth: 0 }}>
                          <RouteRoundedIcon sx={{ color: colour(groupKey), fontSize: 18 }} />
                          <Typography variant="subtitle2" noWrap sx={{ color: colour(groupKey) }}>
                            {groupKey}
                          </Typography>
                          <Chip size="small" label={list.length} />
                        </Stack>
                        <Button size="small" onClick={() => fitGroup(groupKey)}>
                          Fit
                        </Button>
                      </Stack>

                      <List dense disablePadding>
                        {list
                          .slice()
                          .sort((a, b) => String(a.circuitId).localeCompare(String(b.circuitId)))
                          .map((span) => {
                            const selected = span.circuitId === selectedCircuitId
                            return (
                              <ListItemButton
                                key={span.circuitId}
                                selected={selected}
                                onClick={() => {
                                  setSelectedCircuitId(span.circuitId)
                                  setFitSpan(span)
                                }}
                                sx={{
                                  mb: 0.45,
                                  borderRadius: 1.8,
                                  borderLeft: `3px solid ${selected ? colour(groupKey) : 'transparent'}`,
                                  bgcolor: selected ? alpha(colour(groupKey), 0.08) : 'transparent'
                                }}
                              >
                                <ListItemText
                                  primary={span.circuitId ?? '(no circuit id)'}
                                  secondary={`${span?.nodeA?.name ?? 'Unknown'} <-> ${span?.nodeB?.name ?? 'Unknown'}`}
                                  primaryTypographyProps={{ noWrap: true, fontWeight: 700, fontSize: '0.78rem' }}
                                  secondaryTypographyProps={{ noWrap: true, fontSize: '0.72rem' }}
                                />
                              </ListItemButton>
                            )
                          })}
                      </List>
                    </Box>
                  ))}

                {!filteredSpans.length ? (
                  <Typography variant="body2" sx={{ color: 'text.secondary', py: 1 }}>
                    No mapped circuits matched the current filters.
                  </Typography>
                ) : null}
              </Stack>
            </Box>
          </Stack>
        </SectionCard>

        <Box
          sx={{
            display: 'grid',
            gap: 1.05,
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 310px' },
            alignItems: 'start'
          }}
        >
          <SectionCard
            title="Network View"
            subtitle="Use the layers control and route clicks to move around the national footprint."
            accent="#0f766e"
            noPadding
          >
            <Box sx={{ height: { xs: 420, md: 530, xl: 'calc(100vh - 290px)' }, minHeight: 420 }}>
              <MapContainer center={[-29, 24]} zoom={6} minZoom={4} style={{ height: '100%', width: '100%' }} zoomControl>
                <MapController fitBoundsCmd={fitBoundsCmd} />

                <LayersControl position="topright">
                  <BaseLayer checked name="OpenStreetMap">
                    <TileLayer
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                      attribution="© OpenStreetMap contributors"
                    />
                  </BaseLayer>
                  <BaseLayer name="Carto Light">
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                      attribution="© OpenStreetMap, © Carto"
                    />
                  </BaseLayer>
                  <BaseLayer name="Carto Dark">
                    <TileLayer
                      url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                      attribution="© OpenStreetMap, © Carto"
                    />
                  </BaseLayer>
                </LayersControl>

                {filteredSpans.map((span) => {
                  const selected = span.circuitId === selectedCircuitId
                  const positions = [
                    [Number(span.nodeA.lat), Number(span.nodeA.lon)],
                    [Number(span.nodeB.lat), Number(span.nodeB.lon)]
                  ]
                  const distanceKm = haversineKm(positions[0], positions[1])
                  const routeColor = colour(span?.nldGroup)

                  return (
                    <Polyline
                      key={span.circuitId}
                      positions={positions}
                      pathOptions={{ color: routeColor, weight: selected ? 6 : 4, opacity: selected ? 0.96 : 0.76 }}
                      eventHandlers={{
                        click: () => {
                          setSelectedCircuitId(span.circuitId)
                          setFitSpan(span)
                        },
                        mouseover: (event) => event.target.setStyle({ weight: selected ? 7 : 6, opacity: 1 }),
                        mouseout: (event) => event.target.setStyle({ weight: selected ? 6 : 4, opacity: selected ? 0.96 : 0.76 })
                      }}
                    >
                      <Tooltip sticky>
                        <Stack spacing={0.45}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 800, color: routeColor }}>
                            {span.circuitId}
                          </Typography>
                          <Typography variant="caption">
                            {`${span?.nodeA?.name ?? 'Unknown'} <-> ${span?.nodeB?.name ?? 'Unknown'}`}
                          </Typography>
                          <Typography variant="caption">
                            {span?.nldGroup ?? 'Unassigned'} • {distanceKm.toFixed(1)} km
                          </Typography>
                          <Typography variant="caption">
                            Rx A/B: {fmtDbm(span?.levels?.aRx)} / {fmtDbm(span?.levels?.bRx)}
                          </Typography>
                        </Stack>
                      </Tooltip>
                    </Polyline>
                  )
                })}

                {showMarkers && filteredSpans.flatMap((span) => ([
                  { ...span.nodeA, circuitId: span.circuitId, nldGroup: span.nldGroup },
                  { ...span.nodeB, circuitId: span.circuitId, nldGroup: span.nldGroup }
                ])).map((node) => {
                  const lat = Number(node.lat)
                  const lon = Number(node.lon)
                  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
                  return (
                    <CircleMarker
                      key={`${node?.name ?? 'Unknown'}-${node?.circuitId ?? 'na'}`}
                      center={[lat, lon]}
                      radius={4}
                      pathOptions={{ color: '#334155', weight: 1, fillColor: '#ffffff', fillOpacity: 1 }}
                      eventHandlers={{
                        click: () => {
                          setSelectedCircuitId(node.circuitId)
                          const span = filteredSpans.find((item) => item.circuitId === node.circuitId)
                          if (span) setFitSpan(span)
                        }
                      }}
                    >
                      <Tooltip permanent direction="top" offset={[0, -8]}>
                        <a
                          href={`/engineering/nlds?circuit=${encodeURIComponent(node?.circuitId ?? '')}`}
                          style={{ textDecoration: 'none', color: 'inherit', fontWeight: 700 }}
                          onClick={(event) => {
                            event.preventDefault()
                            setSelectedCircuitId(node.circuitId)
                            const span = filteredSpans.find((item) => item.circuitId === node.circuitId)
                            if (span) setFitSpan(span)
                          }}
                        >
                          {node?.name ?? 'Unknown'}
                        </a>
                      </Tooltip>
                    </CircleMarker>
                  )
                })}
              </MapContainer>
            </Box>
          </SectionCard>

          <SectionCard
            title="Circuit Details"
            subtitle={selectedSpan ? 'Selection context and actions' : 'Waiting for a selection'}
            accent="#7c3aed"
          >
            <CircuitDetails
              span={selectedSpan}
              colour={colour}
              onFit={() => selectedSpan && setFitSpan(selectedSpan)}
              onFitGroup={() => selectedSpan && fitGroup(selectedSpan.nldGroup ?? 'Unassigned')}
              onOpenHistory={openHistory}
            />
          </SectionCard>
        </Box>
      </Box>
      <MapHistoryDrawer history={history} onClose={() => setHistory(null)} />
    </PageShell>
  )
}
