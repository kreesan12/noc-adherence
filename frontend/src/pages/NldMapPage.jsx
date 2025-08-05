//frontend/src/pages/NldMapPage.jsx
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from 'react-leaflet'
import { Box, Typography, Paper, List, ListItemButton, ListItemText } from '@mui/material'
import { useMemo, useRef } from 'react'
import nlds from '../data/nlds'

// colour per NLD group
const palette = ['#1976d2','#009688','#ef6c00','#8e24aa',
                 '#d81b60','#43a047','#f9a825','#5c6bc0']
const colourFor = nld => palette[(parseInt(nld.replace(/\D/g,''),10)-1) % palette.length]

export default function NldMapPage () {
  const mapRef = useRef()

  // group spans by NLD
  const groups = useMemo(() => nlds.reduce((m,s)=>(m[s.nld]=[...(m[s.nld]||[]),s],m),{}),[])

  const fitSpan = span => {
    const L = mapRef.current
    if (!L) return
    const bounds = [
      [span.nodeA.lat, span.nodeA.lon],
      [span.nodeB.lat, span.nodeB.lon]
    ]
    L.fitBounds(bounds, { padding:[40,40] })
  }

  return (
    <Box sx={{ display:'flex', height:'calc(100vh - 64px)' }}>
      {/* side list */}
      <Paper elevation={1} sx={{ width:300, overflow:'auto' }}>
        <Typography variant="h6" sx={{ p:2 }}>NLD circuits</Typography>
        <List dense>
          {Object.entries(groups).map(([nld,list])=>(
            <Box key={nld}>
              <Typography sx={{ pl:2, fontWeight:600, color:colourFor(nld) }}>
                {nld} ({list.length})
              </Typography>
              {list.map(s=>(
                <ListItemButton key={s.circuitId} onClick={()=>fitSpan(s)}>
                  <ListItemText
                    primary={s.circuitId}
                    secondary={`${s.nodeA.name}  ↔  ${s.nodeB.name}`}
                  />
                </ListItemButton>
              ))}
            </Box>
          ))}
        </List>
      </Paper>

      {/* map */}
      <MapContainer
        center={[-29.0, 24.0]} zoom={6} minZoom={5}
        style={{ flex:1 }}
        whenCreated={m=>{ mapRef.current = m }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap"
        />

        {nlds.map(s=>(
          <Polyline key={s.circuitId}
            positions={[[s.nodeA.lat,s.nodeA.lon],[s.nodeB.lat,s.nodeB.lon]]}
            pathOptions={{ color: colourFor(s.nld), weight:4 }}
          />
        ))}

        {nlds.flatMap(s=>[s.nodeA,s.nodeB]).map(n=>(
          <CircleMarker
            key={n.name}
            center={[n.lat,n.lon]}
            radius={4}
            pathOptions={{ color:'#333', weight:1, fillColor:'#fff', fillOpacity:1 }}
          >
            <Tooltip permanent direction="top" offset={[0,-8]}>{n.name}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </Box>
  )
}
