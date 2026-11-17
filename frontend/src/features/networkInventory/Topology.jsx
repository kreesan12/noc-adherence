import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, Chip, IconButton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded'
import ZoomOutRoundedIcon from '@mui/icons-material/ZoomOutRounded'
import RestartAltRoundedIcon from '@mui/icons-material/RestartAltRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'

const C = { primary: '#0f8877', backup: '#6752ba', blocked: '#c37018', base: '#9babbc', gap: '#c54848', core: '#233b61' }
const compact = label => label?.replace(/\.frogfoot\.net$/, '') || 'Unknown endpoint'
function layoutGraph(graph, paths, layout) {
  const orderedIds = [...(paths?.primary?.nodes || []).toReversed(), ...(paths?.backup?.nodes || []).toReversed(), ...graph.nodes.map(n => n.id)]
  const ordered = [...new Set(orderedIds)].map(id => graph.nodes.find(n => n.id === id)).filter(Boolean)
  const positions = new Map()
  if (layout === 'ladder' && paths?.primary) {
    const pri = paths.primary.nodes.toReversed(), sec = paths.backup?.nodes.toReversed() || []
    pri.forEach((id, i) => positions.set(id, { x: 320, y: 95 + i * 92 }))
    sec.forEach((id, i) => { if (!positions.has(id)) positions.set(id, { x: 865, y: 95 + i * 92 }) })
    ordered.filter(n => !positions.has(n.id)).forEach((n, i) => positions.set(n.id, { x: 865, y: 240 + i * 100 }))
  } else {
    const count = Math.max(ordered.length, 1), radiusY = count > 14 ? 300 : 242
    ordered.forEach((n, i) => {
      const angle = -Math.PI / 2 + (i / count) * Math.PI * 2
      positions.set(n.id, { x: 600 + Math.cos(angle) * 430, y: 350 + Math.sin(angle) * radiusY })
    })
  }
  return positions
}
export default function Topology({ graph, paths, selectedId, onNode, onEdge, label }) {
  const [layout, setLayout] = useState('ring'), [scale, setScale] = useState(1), [offset, setOffset] = useState({ x: 0, y: 0 })
  const [flowView, setFlowView] = useState('normal')
  useEffect(() => { setFlowView('normal') }, [label, paths?.sourceId])
  const drag = useRef(null), svg = useRef(null)
  const positions = useMemo(() => layoutGraph(graph, paths, layout), [graph, paths, layout])
  const height = Math.max(690, ...[...positions.values()].map(p => p.y + 100))
  const primary = new Set(paths?.primary?.edges || []), backup = new Set(paths?.backup?.edges || [])
  const groups = new Map()
  for (const e of graph.edges) { const key = [e.from, e.to].sort().join('|'); const list = groups.get(key) || []; list.push(e.id); groups.set(key, list) }
  function exportDiagram() {
    const clone = svg.current.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', '1200'); clone.setAttribute('height', String(height))
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
    const link = document.createElement('a'); link.href = url; link.download = `${label || 'network'}-topology.svg`; link.click(); URL.revokeObjectURL(url)
  }
  const arrow = (path, edge) => {
    if (!path) return false
    const index = path.edges.indexOf(edge.id)
    return index >= 0 && path.nodes[index] !== edge.from
  }
  return <Box className="ni-topology">
    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1} sx={{ px: 2, py: 1.2, borderBottom: '1px solid #e7edf2' }}>
      <Box><Typography fontWeight={800}>Network topology</Typography><Typography variant="caption" color="text.secondary">Select a device or backhaul to inspect it. Drag the canvas to pan.</Typography></Box>
      <Stack direction="row" alignItems="center" gap={.4} flexWrap="wrap" sx={{ maxWidth: '100%' }}>
        <ToggleButtonGroup size="small" exclusive value={flowView} onChange={(_, v) => v && setFlowView(v)} aria-label="Intended traffic scenario"><ToggleButton value="normal">Normal</ToggleButton><ToggleButton value="backup" disabled={!paths?.backup || !paths?.primary?.edges?.length}>Backup scenario</ToggleButton></ToggleButtonGroup>
        <ToggleButtonGroup size="small" exclusive value={layout} onChange={(_, v) => v && setLayout(v)} aria-label="Topology layout"><ToggleButton value="ring">Ring</ToggleButton><ToggleButton value="ladder">Ladder</ToggleButton></ToggleButtonGroup>
        <Tooltip title="Zoom out"><IconButton aria-label="Zoom out" onClick={() => setScale(s => Math.max(.5, s - .15))}><ZoomOutRoundedIcon /></IconButton></Tooltip>
        <Tooltip title="Zoom in"><IconButton aria-label="Zoom in" onClick={() => setScale(s => Math.min(2.5, s + .15))}><ZoomInRoundedIcon /></IconButton></Tooltip>
        <Tooltip title="Reset view"><IconButton aria-label="Reset diagram view" onClick={() => { setScale(1); setOffset({ x: 0, y: 0 }) }}><RestartAltRoundedIcon /></IconButton></Tooltip>
        <Tooltip title="Download SVG"><IconButton aria-label="Download diagram" onClick={exportDiagram}><DownloadRoundedIcon /></IconButton></Tooltip>
      </Stack>
    </Stack>
    <svg ref={svg} className="ni-svg" viewBox={`0 0 1200 ${height}`} role="group" aria-label={`${label} inventory ring diagram`}
      onPointerDown={e => { if (e.target === svg.current || e.target.dataset.canvas) { drag.current = { x: e.clientX, y: e.clientY, offset }; e.currentTarget.setPointerCapture(e.pointerId) } }}
      onPointerMove={e => { if (drag.current) { const ratio = 1200 / e.currentTarget.getBoundingClientRect().width; setOffset({ x: drag.current.offset.x + (e.clientX - drag.current.x) * ratio, y: drag.current.offset.y + (e.clientY - drag.current.y) * ratio }) } }}
      onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>
      <defs>
        <pattern id="ni-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".9" fill="#dce5ee" /></pattern>
        {['primary', 'backup'].map(k => <marker key={k} id={`ni-arrow-${k}`} markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" fill={C[k]} /></marker>)}
      </defs>
      <rect width="1200" height={height} fill="#f8fafc" data-canvas="true" /><rect width="1200" height={height} fill="url(#ni-grid)" data-canvas="true" />
      <text x="24" y="30" fontFamily="system-ui,sans-serif" fontSize="11" fill="#68798d">{flowView === 'backup' ? 'BACKUP SCENARIO · PRIMARY OUTGOING LINK UNAVAILABLE · SECONDARY BLOCK RELEASED · NOT LIVE' : 'IMPORTED INVENTORY · INTENDED ROUTING · NOT LIVE TRAFFIC'}</text>
      <g transform={`translate(${offset.x + 600 * (1 - scale)},${offset.y + height / 2 * (1 - scale)}) scale(${scale})`}>
        {graph.edges.map(e => {
          const a = positions.get(e.from), b = positions.get(e.to); if (!a || !b) return null
          const siblings = groups.get([e.from, e.to].sort().join('|')), index = siblings.indexOf(e.id)
          const bend = siblings.length > 1 ? (index - (siblings.length - 1) / 2) * 100 : 0
          const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy) || 1
          const cx = (a.x + b.x) / 2 - dy / distance * bend, cy = (a.y + b.y) / 2 + dx / distance * bend
          const d = `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, lx = (a.x + 2 * cx + b.x) / 4, ly = (a.y + 2 * cy + b.y) / 4
          const isPrimary = primary.has(e.id), isBackup = backup.has(e.id), warn = e.unresolved || e.conflict || e.claim
          const released = e.blocked && flowView === 'backup', failed = flowView === 'backup' && paths?.primary?.edges[0] === e.id
          const active = flowView === 'backup' ? isBackup : isPrimary
          const colour = failed ? C.gap : e.blocked && !released ? C.blocked : warn ? C.gap : active ? flowView === 'backup' ? C.backup : C.primary : C.base
          // Short central arrows show direction without implying a live packet animation.
          const reversed = arrow(flowView === 'backup' ? paths?.backup : paths?.primary, e)
          const mid = .5, direction = reversed ? -1 : 1
          const px = lx + dx / distance * 24 * direction, py = ly + dy / distance * 24 * direction
          const symbol = failed ? 'PRIMARY FAILED (SCENARIO)' : released ? `BLOCK RELEASED${e.capacity ? ` · ${e.capacity}` : ''}` : e.blocked ? `SECONDARY BLOCK${e.capacity ? ` · ${e.capacity}` : ''}` : e.claim ? 'LADDER CLAIM' : e.conflict ? 'CONFLICT' : e.capacity || ''
          return <g key={e.id} role="button" tabIndex="0" aria-label={`Inspect backhaul ${e.code}`} onClick={() => onEdge(e)} onKeyDown={event => event.key === 'Enter' && onEdge(e)} style={{ cursor: 'pointer' }}>
            <title>{`${e.code} · ${e.source}${e.capacity ? ` · ${e.capacity}` : ''}${e.blocked ? ' · Blocked on the master secondary backhaul in normal operation' : ''}`}</title>
            <path d={d} fill="none" stroke="transparent" strokeWidth="20" />
            <path d={d} fill="none" stroke={colour} strokeWidth={selectedId === e.recordId ? 5 : active || e.blocked ? 3.2 : 2}
              strokeDasharray={failed || e.blocked && !released ? '8 5' : warn ? '3 5' : undefined} />
            {active && (!e.blocked || released) && !failed && <path d={`M ${lx - dx / distance * 26 * direction} ${ly - dy / distance * 26 * direction} L ${px} ${py}`}
              stroke={flowView === 'backup' ? C.backup : C.primary} strokeWidth="2.5" markerEnd={`url(#ni-arrow-${flowView === 'backup' ? 'backup' : 'primary'})`} />}
            <rect x={lx - 66} y={ly - 50} width="132" height="36" rx="9" fill="white" stroke={warn ? '#efc3c3' : e.blocked ? '#edcf9d' : '#dce5ed'} />
            <text x={lx} y={ly - 34} textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="12" fontWeight="750" fill={colour}>{e.code || 'No code'}</text>
            <text x={lx} y={ly - 20} textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="8.7" letterSpacing=".5" fill="#63748b">{symbol}</text>
          </g>
        })}
        {graph.nodes.map(n => {
          const p = positions.get(n.id); if (!p) return null
          const core = n.roles.some(r => r?.startsWith('Core_')), master = n.roles.some(r => ['Master', 'RPL Owner'].includes(r)), selected = selectedId === n.id
          const role = core ? n.roles.filter(r => r?.startsWith('Core_')).join(' / ') : n.roles.filter(Boolean).join(' / ') || n.record?.data.type || 'Unassigned role'
          const fill = n.unresolved ? '#fff3f3' : core ? C.core : '#fff', border = n.unresolved ? '#d26060' : master ? '#c99a38' : selected ? C.primary : '#cddbe7'
          return <g key={n.id} transform={`translate(${p.x - 99},${p.y - 35})`} role="button" tabIndex="0" aria-label={`Inspect ${n.label}`}
            onClick={() => onNode(n)} onKeyDown={e => e.key === 'Enter' && onNode(n)} style={{ cursor: 'pointer' }}>
            <title>{`${n.label}${n.siteName ? ` · ${n.siteName}` : ''} · ${role}${n.unresolved ? ` · ${n.reason}` : ''}`}</title>
            <rect x="0" y="3" width="198" height="72" rx="12" fill="#1d3551" opacity=".05" />
            <rect width="198" height="72" rx="12" fill={fill} stroke={border} strokeWidth={selected || master ? 2.5 : 1.2} strokeDasharray={n.unresolved ? '5 3' : undefined} />
            <circle cx="15" cy="18" r="4" fill={n.unresolved ? '#c54848' : master ? '#c99a38' : core ? '#5dd8b4' : '#8c9fb2'} />
            <text x="27" y="22" fontFamily="system-ui,sans-serif" fontSize="10.6" fontWeight="750" fill={core ? '#fff' : '#21334d'}>{compact(n.label).length > 27 ? compact(n.label).slice(0, 26) + '…' : compact(n.label)}</text>
            <text x="14" y="42" fontFamily="system-ui,sans-serif" fontSize="9.5" fill={core ? '#bbcce2' : '#68798b'}>{role.length > 34 ? role.slice(0, 33) + '…' : role}</text>
            <text x="14" y="59" fontFamily="system-ui,sans-serif" fontSize="8.9" fill={core ? '#94b1d2' : '#8a98a7'}>{n.unresolved ? 'Needs an inventory match' : n.siteName || 'Site not assigned'}</text>
          </g>
        })}
      </g>
      {!graph.nodes.length && <text x="600" y="330" textAnchor="middle" fontFamily="system-ui,sans-serif" fontSize="16" fill="#68798d">No connections recorded for this selection.</text>}
    </svg>
    <Stack direction="row" gap={2} flexWrap="wrap" sx={{ px: 2, py: 1, borderTop: '1px solid #e7edf2' }}>
      {[['Primary path', C.primary], ['Backup scenario', C.backup], ['Secondary block', C.blocked], ['Gap / source claim', C.gap]].map(([name, colour]) => <Stack key={name} direction="row" gap={.7} alignItems="center"><Box sx={{ width: 19, height: 3, bgcolor: colour }} /><Typography variant="caption" color="text.secondary">{name}</Typography></Stack>)}
    </Stack>
  </Box>
}

export function CircuitChain({ backhaul, segments, onSelect }) {
  const rows = [...segments].sort((a, b) => a.data.sequence - b.data.sequence)
  return <Box className="ni-chain"><Typography fontWeight={800} mb={.4}>Physical circuit chain · {backhaul.data.code}</Typography>
    <Typography variant="caption" color="text.secondary">Ordered provider segments beneath this backhaul. Repeated circuit IDs remain separate segment occurrences.</Typography>
    <Box className="ni-chain-track">{rows.map((s, i) => <Box key={s.id} className="ni-segment-wrap">
      {i > 0 && <Box className="ni-chain-join">{rows[i - 1].data.sideB?.replace(/\W/g, '').toLowerCase() === s.data.sideA?.replace(/\W/g, '').toLowerCase() ? '→' : <Chip size="small" color="warning" label="Endpoint gap" />}</Box>}
      <Button className="ni-segment" onClick={() => onSelect(s)}><Box><Typography variant="caption">SEGMENT {s.data.sequence} · {s.data.provider || 'Provider missing'}</Typography><Typography fontWeight={800}>{s.data.circuitId || 'Circuit ID missing'}</Typography><Typography variant="caption">{s.data.sideA || '?'} → {s.data.sideB || '?'}</Typography></Box></Button>
    </Box>)}</Box>
    {!rows.length && <Typography variant="body2" mt={2}>No component circuits recorded. Add circuit segments to complete this chain.</Typography>}
  </Box>
}
