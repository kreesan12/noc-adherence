// frontend/src/components/TechRouteMap.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Paper, Typography, Alert, Stack, Chip, Button } from '@mui/material'
import MyLocationIcon from '@mui/icons-material/MyLocation'
import DirectionsIcon from '@mui/icons-material/Directions'
import { loadGoogleMaps } from '../utils/googleMapsLoader'

const GOOGLE_MAPS_KEY = 'AIzaSyAhsSZ2GSs2gEWJDvWII8RdCT0qYj5l7fA' // ✅ swap after testing

function getGpsOnce() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 20000 }
    )
  })
}

export default function TechRouteMap({ ticket }) {
  const mapRef = useRef(null)
  const [err, setErr] = useState('')
  const [info, setInfo] = useState({ km: null, mins: null })
  const [loading, setLoading] = useState(false)
  const [lastOrigin, setLastOrigin] = useState(null)

  const destination = useMemo(() => {
    const lat = ticket?.lat
    const lng = ticket?.lng
    if (lat == null || lng == null) return null
    return { lat: Number(lat), lng: Number(lng) }
  }, [ticket])

  async function buildRoute() {
    setErr('')
    setLoading(true)
    setInfo({ km: null, mins: null })

    try {
      if (!destination) {
        setErr('No GPS coordinates on this ticket yet.')
        return
      }

      const origin = await getGpsOnce()
      if (!origin) {
        setErr('Could not get your GPS location. Please enable location services.')
        return
      }
      setLastOrigin(origin)

      const maps = await loadGoogleMaps({ apiKey: GOOGLE_MAPS_KEY, libraries: ['places'] })

      const map = new maps.Map(mapRef.current, {
        center: origin,
        zoom: 13,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      })

      const directionsService = new maps.DirectionsService()
      const directionsRenderer = new maps.DirectionsRenderer({
        map,
        suppressMarkers: false,
        preserveViewport: false
      })

      const req = {
        origin,
        destination,
        travelMode: maps.TravelMode.DRIVING
      }

      directionsService.route(req, (result, status) => {
        if (status !== 'OK' || !result?.routes?.[0]?.legs?.[0]) {
          setErr(`Could not calculate route (${status}).`)
          return
        }

        directionsRenderer.setDirections(result)

        const leg = result.routes[0].legs[0]
        const meters = leg.distance?.value ?? null
        const seconds = leg.duration?.value ?? null

        const km = meters != null ? Math.round((meters / 1000) * 10) / 10 : null
        const mins = seconds != null ? Math.round(seconds / 60) : null

        setInfo({ km, mins })
      })
    } catch (e) {
      setErr(e?.message || 'Failed to load map route')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Auto-load route when ticket changes (if coords exist)
    if (destination) buildRoute().catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destination?.lat, destination?.lng])

  function openInGoogleMaps() {
    if (!destination) return
    const url = `https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <Paper sx={{ p: 2, borderRadius: 4 }} variant="outlined">
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={2}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" sx={{ fontWeight: 950 }}>
            Route
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.8 }}>
            Live directions from your current GPS to the ticket
          </Typography>
        </Box>

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            variant="outlined"
            startIcon={<MyLocationIcon />}
            onClick={buildRoute}
            disabled={loading}
          >
            Refresh
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={<DirectionsIcon />}
            onClick={openInGoogleMaps}
            disabled={!destination}
          >
            Open
          </Button>
        </Stack>
      </Stack>

      {err && <Alert severity="warning" sx={{ mt: 2 }}>{err}</Alert>}

      <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
        <Chip
          size="small"
          label={navigator.onLine ? 'Online' : 'Offline'}
          color={navigator.onLine ? 'success' : 'warning'}
        />
        <Chip
          size="small"
          variant="outlined"
          label={info.km != null ? `${info.km} km` : 'Distance: -'}
        />
        <Chip
          size="small"
          variant="outlined"
          label={info.mins != null ? `${info.mins} min` : 'ETA: -'}
        />
      </Stack>

      <Box
        sx={{
          mt: 2,
          height: 320,
          borderRadius: 3,
          overflow: 'hidden',
          border: '1px solid rgba(15,23,42,0.08)'
        }}
      >
        <Box ref={mapRef} sx={{ width: '100%', height: '100%' }} />
      </Box>
    </Paper>
  )
}
