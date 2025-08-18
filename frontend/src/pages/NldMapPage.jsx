// frontend/src/pages/NldMapPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer, TileLayer, CircleMarker, Polyline, Tooltip,
} from 'react-leaflet';
import {
  Box, Paper, Typography, List, ListItemButton,
  ListItemText, Chip,
} from '@mui/material';
import api from '../api';

export default function NldMapPage() {
  /* --------------- state + refs ---------------- */
  const [nlds, setNlds] = useState([]);
  const mapRef = useRef(null);

  /* --------------- fetch once ------------------ */
  useEffect(() => {
    api.get('/nlds.json').then(r => setNlds(r.data)).catch(console.error);
  }, []);

  /* --------------- helpers --------------------- */
  const palette = [
    '#1976d2', '#009688', '#ef6c00', '#8e24aa',
    '#d81b60', '#43a047', '#f9a825', '#5c6bc0',
  ];

  // null-safe color function
  const colour = (nldLike) => {
    const str = String(nldLike ?? 'Unassigned');
    const digits = str.replace(/\D/g, '');
    const num = parseInt(digits, 10);

    if (Number.isFinite(num) && num > 0) {
      return palette[(num - 1) % palette.length];
    }
    // fallback: hash text into a palette index so "Unassigned" etc. stay stable
    let hash = 0;
    for (let i = 0; i < str.length; i += 1) hash = ((hash << 5) - hash) + str.charCodeAt(i);
    const idx = Math.abs(hash) % palette.length;
    return palette[idx];
  };

  const validLatLon = (node) => {
    const lat = Number(node?.lat);
    const lon = Number(node?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon);
  };

  const hasBothEnds = (span) => validLatLon(span?.nodeA) && validLatLon(span?.nodeB);

  const groups = useMemo(
    () => nlds.reduce((m, s) => {
      const key = s?.nldGroup ?? 'Unassigned';
      (m[key] ??= []).push(s);
      return m;
    }, {}),
    [nlds],
  );

  const safeSpans = useMemo(
    () => nlds.filter(hasBothEnds),
    [nlds],
  );

  const fit = (span) => {
    if (!hasBothEnds(span)) return;
    mapRef.current?.fitBounds(
      [
        [Number(span.nodeA.lat), Number(span.nodeA.lon)],
        [Number(span.nodeB.lat), Number(span.nodeB.lon)],
      ],
      { padding: [40, 40] },
    );
  };

  /* --------------- render ---------------------- */
  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
      {/* ---------- side list ---------- */}
      <Paper elevation={1} sx={{ width: 310, overflow: 'auto' }}>
        <Typography variant="h6" sx={{ p: 2 }}>NLD circuits</Typography>

        <List dense>
          {Object.entries(groups).map(([nld, list]) => (
            <Box key={nld}>
              <Typography sx={{ pl: 2, fontWeight: 600, color: colour(nld) }}>
                {nld}
                {' '}
                <Chip label={list.length} size="small" />
              </Typography>

              {list.map(s => (
                <ListItemButton key={s.circuitId} onClick={() => fit(s)}>
                  <ListItemText
                    primary={s.circuitId ?? '(no circuit id)'}
                    secondary={`${s?.nodeA?.name ?? 'Unknown'} ↔ ${s?.nodeB?.name ?? 'Unknown'}`}
                  />
                </ListItemButton>
              ))}
            </Box>
          ))}
        </List>
      </Paper>

      {/* ---------- map ---------- */}
      <MapContainer
        center={[-29, 24]} zoom={6} minZoom={5} style={{ flex: 1 }}
        whenCreated={(m) => { mapRef.current = m; }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="© OpenStreetMap contributors"
        />

        {/* lines */}
        {safeSpans.map(s => (
          <Polyline
            key={s.circuitId}
            positions={[
              [Number(s.nodeA.lat), Number(s.nodeA.lon)],
              [Number(s.nodeB.lat), Number(s.nodeB.lon)],
            ]}
            pathOptions={{ color: colour(s?.nldGroup), weight: 4 }}
          />
        ))}

        {/* markers */}
        {safeSpans.flatMap(s => ([
          { ...s.nodeA, circuitId: s.circuitId },
          { ...s.nodeB, circuitId: s.circuitId },
        ])).map(n => (
          <CircleMarker
            key={`${n?.name ?? 'Unknown'}-${n?.circuitId ?? 'na'}`}
            center={[Number(n.lat), Number(n.lon)]}
            radius={4}
            pathOptions={{
              color: '#333', weight: 1, fillColor: '#fff', fillOpacity: 1,
            }}
          >
            <Tooltip permanent direction="top" offset={[0, -8]}>
              <a
                href={`/noc-adherence/#/engineering/nlds?circuit=${encodeURIComponent(n?.circuitId ?? '')}`}
                style={{
                  textDecoration: 'none', color: 'inherit', fontWeight: 600,
                }}
              >
                {n?.name ?? 'Unknown'}
              </a>
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </Box>
  );
}
