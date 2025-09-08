// frontend/src/pages/NldMapPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, LayersControl
} from 'react-leaflet'
import {
  Box, Paper, Typography, List, ListItemButton, ListItemText, Chip,
  Stack, TextField, IconButton, Divider, Switch, FormControlLabel, Button
} from '@mui/material'
import RestartAltIcon from '@mui/icons-material/RestartAlt'
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong'
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff'
import api from '../api'

const { BaseLayer } = LayersControl

export default function NldMapPage () {
  /* ---------------- state + refs ---------------- */
  const [spans, setSpans] = useState([])               // API results (each: circuitId, nldGroup, nodeA, nodeB)
  const [query, setQuery] = useState('')               // search box
  const [showMarkers, setShowMarkers] = useState(true) // marker toggle
  const [selectedCircuitId, setSelectedCircuitId] = useState(null)
  const [activeGroups, setActiveGroups] = useState(new Set())  // which NLD groups are visible (empty = all)
  const mapRef = useRef(null)

  /* ---------------- fetch once ------------------ */
  useEffect(() => {
    api.get('/nlds.json')
      .then(r => {
        setSpans(r.data ?? [])
      })
      .catch(console.error)
  }, [])

  /* ---------------- palette & helpers ----------- */
  const palette = [
    '#1976d2', '#009688', '#ef6c00', '#8e24aa',
    '#d81b60', '#43a047', '#f9a825', '#5c6bc0',
  ]

  const colour = (nldLike) => {
    const str = String(nldLike ?? 'Unassigned')
    const digits = str.replace(/\D/g, '')
    const num = parseInt(digits, 10)
    if (Number.isFinite(num) && num > 0) return palette[(num - 1) % palette.length]
    // stable hash for non-numeric groups
    let hash = 0
    for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) - hash) + str.charCodeAt(i)
    const idx = Math.abs(hash) % palette.length
    return palette[idx]
  }

  const validLatLon = node => {
    const lat = Number(node?.lat), lon = Number(node?.lon)
    return Number.isFinite(lat) && Number.isFinite(lon)
  }
  const hasBothEnds = span => validLatLon(span?.nodeA) && validLatLon(span?.nodeB)

  /* ---------------- URL sync for ?circuit= ------ */
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const fromUrl = p.get('circuit')
    if (fromUrl) setSelectedCircuitId(fromUrl)
  }, [])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    if (selectedCircuitId) {
      p.set('circuit', selectedCircuitId)
    } else {
      p.delete('circuit')
    }
    const newUrl = `${window.location.pathname}?${p.toString()}${window.location.hash}`
    window.history.replaceState({}, '', newUrl)
  }, [selectedCircuitId])

  /* ---------------- derived data ---------------- */
  const allGroups = useMemo(() => {
    const s = new Set()
    for (const sp of spans) s.add(sp?.nldGroup ?? 'Unassigned')
    return Array.from(s).sort()
  }, [spans])

  // active groups: empty Set => treat as "all on"
  const isGroupActive = (g) => activeGroups.size === 0 || activeGroups.has(g)

  const filteredSpans = useMemo(() => {
    const q = query.trim().toLowerCase()
    return spans
      .filter(hasBothEnds)
      .filter(s => isGroupActive(s?.nldGroup ?? 'Unassigned'))
      .filter(s => {
        if (!q) return true
        const a = `${s?.nodeA?.name ?? ''}`.toLowerCase()
        const b = `${s?.nodeB?.name ?? ''}`.toLowerCase()
        const id = `${s?.circuitId ?? ''}`.toLowerCase()
        const g = `${s?.nldGroup ?? ''}`.toLowerCase()
        return a.includes(q) || b.includes(q) || id.includes(q) || g.includes(q)
      })
  }, [spans, query, activeGroups])

  const groups = useMemo(
    () => filteredSpans.reduce((m, s) => {
      const key = s?.nldGroup ?? 'Unassigned'
      ;(m[key] ??= []).push(s)
      return m
    }, {}),
    [filteredSpans]
  )

  const selectedSpan = useMemo(
    () => filteredSpans.find(s => s.circuitId === selectedCircuitId) || null,
    [filteredSpans, selectedCircuitId]
  )

  /* ---------------- bounds helpers -------------- */
  const boundsForSpan = (span) => {
    if (!hasBothEnds(span)) return null
    return [
      [Number(span.nodeA.lat), Number(span.nodeA.lon)],
      [Number(span.nodeB.lat), Number(span.nodeB.lon)],
    ]
  }

  const boundsForSpans = (items) => {
    const pts = []
    items.forEach(s => {
      if (hasBothEnds(s)) {
        pts.push([Number(s.nodeA.lat), Number(s.nodeA.lon)])
        pts.push([Number(s.nodeB.lat), Number(s.nodeB.lon)])
      }
    })
    if (!pts.length) return null
    // compute min/max
    let minLat = pts[0][0], maxLat = pts[0][0], minLon = pts[0][1], maxLon = pts[0][1]
    for (const [lat, lon] of pts) {
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lon < minLon) minLon = lon
      if (lon > maxLon) maxLon = lon
    }
    return [[minLat, minLon], [maxLat, maxLon]]
  }

  const fitSpan = (span) => {
    const b = boundsForSpan(span)
    if (!b) return
    mapRef.current?.fitBounds(b, { padding: [40, 40] })
  }
  const fitAll = () => {
    const b = boundsForSpans(filteredSpans)
    if (!b) return
    mapRef.current?.fitBounds(b, { padding: [40, 40] })
  }
  const fitGroup = (groupKey) => {
    const b = boundsForSpans(groups[groupKey] ?? [])
    if (!b) return
    mapRef.current?.fitBounds(b, { padding: [40, 40] })
  }

  // auto-fit when data/filters change (but preserve user manual zoom if a circuit is selected)
  useEffect(() => {
    if (!selectedCircuitId) fitAll()
  }, [filteredSpans]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------------- UI actions ------------------ */
  const toggleGroup = (g) => {
    setSelectedCircuitId(null)
    setActiveGroups(prev => {
      const next = new Set(prev)
      if (next.has(g)) {
        next.delete(g)
      } else {
        next.add(g)
      }
      // if all groups become active, collapse to empty Set (means "all on")
      if (next.size === allGroups.length) return new Set()
      return next
    })
  }

  const clearFilters = () => {
    setQuery('')
    setActiveGroups(new Set())
    setSelectedCircuitId(null)
  }

  /* ---------------- render ---------------------- */
  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
      {/* ---------- left panel ---------- */}
      <Paper elevation={1} sx={{ width: 360, overflow: 'auto', p: 2, borderRight: theme => `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h6" sx={{ mb: 1 }}>NLD Explorer</Typography>

        {/* Search + controls */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <TextField
            value={query}
            onChange={e => setQuery(e.target.value)}
            size="small"
            fullWidth
            placeholder="Search circuit / node / NLD…"
          />
          <IconButton aria-label="fit all" onClick={fitAll} title="Fit all">
            <CenterFocusStrongIcon />
          </IconButton>
          <IconButton aria-label="clear filters" onClick={clearFilters} title="Clear filters">
            <FilterAltOffIcon />
          </IconButton>
          <IconButton aria-label="reset view" onClick={() => { setSelectedCircuitId(null); fitAll() }} title="Reset view">
            <RestartAltIcon />
          </IconButton>
        </Stack>

        <FormControlLabel
          control={
            <Switch checked={showMarkers} onChange={(_, v) => setShowMarkers(v)} />
          }
          label="Show node markers"
          sx={{ mb: 1 }}
        />

        {/* Group chips (filter + legend) */}
        <Typography variant="subtitle2" sx={{ mt: 1, mb: 0.5 }}>NLD Groups</Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 1 }}>
          {allGroups.map(g => {
            const on = isGroupActive(g)
            return (
              <Chip
                key={g}
                label={g}
                clickable
                onClick={() => toggleGroup(g)}
                onDelete={() => { /* noop to show x only when filtered off */ }}
                variant={on ? 'filled' : 'outlined'}
                sx={{
                  borderColor: colour(g),
                  backgroundColor: on ? `${colour(g)}22` : 'transparent',
                  color: 'inherit'
                }}
              />
            )
          })}
        </Stack>

        <Divider sx={{ my: 1 }} />

        {/* Grouped list */}
        <Stack spacing={1}>
          {Object.entries(groups).sort(([a], [b]) => String(a).localeCompare(String(b))).map(([nld, list]) => (
            <Box key={nld}>
              <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ pr: 1 }}>
                <Typography sx={{ pl: 1, fontWeight: 700, color: colour(nld) }}>{nld}</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip label={list.length} size="small" />
                  <Button size="small" onClick={() => fitGroup(nld)}>Fit</Button>
                </Stack>
              </Stack>

              <List dense disablePadding>
                {list
                  .slice() // copy
                  .sort((a,b) => String(a.circuitId).localeCompare(String(b.circuitId)))
                  .map(s => {
                    const isSel = s.circuitId === selectedCircuitId
                    return (
                      <ListItemButton
                        key={s.circuitId}
                        onClick={() => { setSelectedCircuitId(s.circuitId); fitSpan(s) }}
                        selected={isSel}
                        sx={{ borderLeft: `3px solid ${isSel ? colour(nld) : 'transparent'}` }}
                      >
                        <ListItemText
                          primary={s.circuitId ?? '(no circuit id)'}
                          secondary={`${s?.nodeA?.name ?? 'Unknown'} ↔ ${s?.nodeB?.name ?? 'Unknown'}`}
                          primaryTypographyProps={{ noWrap: true }}
                          secondaryTypographyProps={{ noWrap: true }}
                        />
                      </ListItemButton>
                    )
                  })}
              </List>
            </Box>
          ))}
        </Stack>
      </Paper>

      {/* ---------- map ---------- */}
      <MapContainer
        center={[-29, 24]} zoom={6} minZoom={4} style={{ flex: 1 }}
        whenCreated={(m) => { mapRef.current = m }}
        zoomControl
      >
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

        {/* polylines */}
        {filteredSpans.map(s => {
          const isSel = s.circuitId === selectedCircuitId
          const weight = isSel ? 6 : 4
          const color = colour(s?.nldGroup)
          const positions = [
            [Number(s.nodeA.lat), Number(s.nodeA.lon)],
            [Number(s.nodeB.lat), Number(s.nodeB.lon)],
          ]
          return (
            <Polyline
              key={s.circuitId}
              positions={positions}
              pathOptions={{
                color,
                weight,
                opacity: isSel ? 0.95 : 0.75
              }}
              eventHandlers={{
                click: () => { setSelectedCircuitId(s.circuitId); fitSpan(s) },
                mouseover: (e) => e.target.setStyle({ weight: isSel ? 7 : 6, opacity: 1 }),
                mouseout:  (e) => e.target.setStyle({ weight, opacity: isSel ? 0.95 : 0.75 }),
              }}
            >
              <Tooltip sticky>
                <Stack spacing={0.5}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color }}>{s.circuitId}</Typography>
                  <Typography variant="caption">{s?.nldGroup ?? 'Unassigned'}</Typography>
                  <Typography variant="caption">{s?.nodeA?.name ?? 'Unknown'} ↔ {s?.nodeB?.name ?? 'Unknown'}</Typography>
                </Stack>
              </Tooltip>
            </Polyline>
          )
        })}

        {/* markers (optional) */}
        {showMarkers && filteredSpans.flatMap(s => ([
          { ...s.nodeA, circuitId: s.circuitId, nldGroup: s.nldGroup },
          { ...s.nodeB, circuitId: s.circuitId, nldGroup: s.nldGroup },
        ])).map(n => {
          const lat = Number(n.lat), lon = Number(n.lon)
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
          const color = '#333'
          return (
            <CircleMarker
              key={`${n?.name ?? 'Unknown'}-${n?.circuitId ?? 'na'}`}
              center={[lat, lon]}
              radius={4}
              pathOptions={{ color, weight: 1, fillColor: '#fff', fillOpacity: 1 }}
              eventHandlers={{
                click: () => {
                  setSelectedCircuitId(n.circuitId)
                  const span = filteredSpans.find(s => s.circuitId === n.circuitId)
                  if (span) fitSpan(span)
                }
              }}
            >
              <Tooltip permanent direction="top" offset={[0, -8]}>
                <a
                  href={`/noc-adherence/#/engineering/nlds?circuit=${encodeURIComponent(n?.circuitId ?? '')}`}
                  style={{ textDecoration: 'none', color: 'inherit', fontWeight: 600 }}
                  onClick={(e) => {
                    // keep SPA feel by preventing full nav; still update URL param and fit
                    e.preventDefault()
                    setSelectedCircuitId(n.circuitId)
                    const span = filteredSpans.find(s => s.circuitId === n.circuitId)
                    if (span) fitSpan(span)
                  }}
                >
                  {n?.name ?? 'Unknown'}
                </a>
              </Tooltip>
            </CircleMarker>
          )
        })}
      </MapContainer>
    </Box>
  )
}
