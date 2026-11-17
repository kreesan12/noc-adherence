import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Accordion, AccordionDetails, AccordionSummary, Alert, Autocomplete, Box, Button, Checkbox, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, Drawer, FormControlLabel, IconButton, MenuItem, Paper, Stack, Tab, Tabs, TextField, Tooltip, Typography } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import FileUploadRoundedIcon from '@mui/icons-material/FileUploadRounded'
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import CloseRoundedIcon from '@mui/icons-material/CloseRounded'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import api from '../api'
import { PageShell } from '../components/ui/PageScaffold'
import Topology, { CircuitChain } from '../features/networkInventory/Topology'
import RecordEditor from '../features/networkInventory/RecordEditor'
import { auditScopes, inventoryKinds, values, byId, moduleLadders, buildTopology, intendedPaths, membershipLadders } from '../features/networkInventory/domain'
import '../features/networkInventory/inventory.css'

const base = '/network-inventory'
const scopes = { ladder: 'Ladder Audits', olt: 'OLT Audits', nld: 'NLD Audits', rise: 'RISE Audits' }
const labels = { ladders: 'Ladders', memberships: 'Memberships', sites: 'Sites', devices: 'Devices', backhauls: 'Backhauls', segments: 'Circuit segments', olts: 'OLT attachments', issues: 'Findings' }
const label = r => r?.data.name || r?.data.hostname || r?.data.node || r?.data.code || r?.data.circuitId || r?.id || ''
const errorText = e => e.response?.data?.error || e.message
const localDate = value => value ? new Date(value).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }) : '—'
const endpoint = r => `${base}/records/${r.kind}/${encodeURIComponent(r.id)}`
const fieldLabel = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())

export default function NetworkInventoryPage() {
  const params = useParams(), navigate = useNavigate(), scope = auditScopes.includes(params.scope) ? params.scope : 'ladder'
  const [snapshot, setSnapshot] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState(''), [ladderOverride, setLadderOverride] = useState(''), [sourceId, setSourceId] = useState('')
  const [tableKind, setTableKind] = useState('memberships'), [allRows, setAllRows] = useState(false), [search, setSearch] = useState(''), [findingCode, setFindingCode] = useState(''), [showArchived, setShowArchived] = useState(false), [siteFilter, setSiteFilter] = useState('')
  const [inspected, setInspected] = useState(null), [history, setHistory] = useState([]), [sources, setSources] = useState([]), [detailError, setDetailError] = useState('')
  const [editor, setEditor] = useState(null), [preview, setPreview] = useState(null), [overwriteIds, setOverwriteIds] = useState([]), [importNote, setImportNote] = useState('')
  const [noteAction, setNoteAction] = useState(null), [note, setNote] = useState(''), [noteError, setNoteError] = useState(''), [assignRecord, setAssignRecord] = useState(null)
  const inspectionRequest = useRef(0)
  const refresh = useCallback(async () => {
    setError('')
    try { const { data } = await api.get(base); setSnapshot(data) } catch (e) { setError(errorText(e)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { refresh() }, [refresh])
  const records = useMemo(() => snapshot ? byId(snapshot) : new Map(), [snapshot])
  const choices = useMemo(() => {
    if (!snapshot) return []
    if (scope === 'olt') return values(snapshot, 'olts')
    return [...moduleLadders(snapshot, scope), ...(['nld', 'rise'].includes(scope) ? values(snapshot, 'backhauls').filter(b => b.data.auditScopes?.includes(scope)) : [])]
  }, [snapshot, scope])
  useEffect(() => {
    if (!choices.some(c => c.id === selectedId)) setSelectedId(choices.find(c => c.id === 'ladders:bfnladder1')?.id || choices[0]?.id || '')
    setLadderOverride('')
  }, [scope, choices]) // Keep the selected item when refreshed; reset only if it leaves this section.
  const selected = records.get(selectedId)
  const ladderId = selected?.kind === 'ladders' ? selected.id : ladderOverride || selected?.data.ladderIds?.[0] || null
  const ladder = records.get(ladderId)
  const graph = useMemo(() => snapshot ? buildTopology(snapshot, ladderId, { oltId: scope === 'olt' ? selected?.id : null }) : { members: [], nodes: [], edges: [] }, [snapshot, ladderId, scope, selected?.id])
  useEffect(() => { if (!graph.members.some(m => m.id === sourceId)) setSourceId(graph.members.find(m => ['Master', 'RPL Owner'].includes(m.data.role))?.id || graph.members[0]?.id || '') }, [graph])
  const paths = useMemo(() => intendedPaths(graph, sourceId), [graph, sourceId])
  const currentReview = snapshot?.reviews?.find(r => r.recordId === selected?.id && r.kind === selected?.kind)
  const selectedFindings = useMemo(() => {
    const ids = new Set([selected?.id, selected?.data.siteId, ...graph.nodes.map(n => n.id), ...graph.nodes.map(n => n.record?.data.siteId), ...graph.members.map(m => m.id), ...graph.edges.map(e => e.recordId)])
    for (const s of snapshot ? values(snapshot, 'segments') : []) if (ids.has(s.data.backhaulId)) ids.add(s.id)
    return (snapshot?.issues || []).filter(i => allRows || !selected && scope === 'ladder' || ids.has(i.recordId) || ladderId && i.ladderIds.includes(ladderId))
  }, [snapshot, allRows, selected, ladderId, scope, graph])
  const findingGroups = useMemo(() => [...new Set(selectedFindings.map(i => i.code))].sort(), [selectedFindings])
  const graphDeviceIds = new Set(graph.nodes.map(n => n.id)), graphBackhaulIds = new Set(graph.edges.map(e => e.recordId).filter(Boolean))
  function related(r) {
    if (allRows) return true
    if (!selected) return scope === 'ladder' || r.data.auditScopes?.includes(scope)
    if (r.id === selected.id) return true
    if (r.kind === 'ladders') return r.id === ladderId
    if (r.kind === 'memberships') return r.data.ladderId === ladderId
    if (r.kind === 'sites') return graph.members.some(m => m.data.siteId === r.id) || graph.nodes.some(n => n.record?.data.siteId === r.id)
    if (r.kind === 'devices') return graphDeviceIds.has(r.id) || scope === 'olt' && r.data.hostname === selected.data.hostname
    if (r.kind === 'backhauls') return graphBackhaulIds.has(r.id) || selected.kind === 'backhauls' && r.id === selected.id
    if (r.kind === 'segments') return graphBackhaulIds.has(r.data.backhaulId) || r.data.backhaulId === selected.id
    if (r.kind === 'olts') return r.data.ladderIds?.includes(ladderId)
    return true
  }
  const tableRows = useMemo(() => {
    if (!snapshot) return []
    let rows = tableKind === 'issues' ? selectedFindings : (showArchived ? snapshot.records[tableKind] || [] : values(snapshot, tableKind)).filter(related)
    if (tableKind === 'sites' && siteFilter) rows = rows.filter(r => siteFilter === 'shared' ? membershipLadders(snapshot, r.id).length > 1 : !membershipLadders(snapshot, r.id).length)
    if (tableKind === 'issues' && findingCode) rows = rows.filter(r => r.code === findingCode)
    if (search) rows = rows.filter(r => JSON.stringify(tableKind === 'issues' ? [r.label, r.message, r.code, r.details] : r.data).toLowerCase().includes(search.toLowerCase()))
    return rows
  }, [snapshot, tableKind, allRows, selectedId, ladderId, search, findingCode, showArchived, siteFilter, scope])
  function display(v) {
    if (v === null || v === undefined || v === '') return '—'
    if (Array.isArray(v)) return v.map(x => typeof x === 'string' ? records.has(x) ? label(records.get(x)) : x : JSON.stringify(x)).join(', ')
    if (typeof v === 'boolean') return v ? 'Yes' : 'No'
    return typeof v === 'object' ? JSON.stringify(v) : records.has(v) ? label(records.get(v)) : String(v)
  }
  const col = (key, title, width = 150) => ({ field: key, headerName: title, width, minWidth: 100, valueGetter: (_, r) => display(r.data?.[key]) })
  const tableColumns = tableKind === 'issues' ? [
    { field: 'severity', headerName: 'Level', width: 100, renderCell: p => <Chip size="small" label={p.value} color={p.value === 'error' ? 'error' : p.value === 'review' ? 'warning' : 'default'} /> },
    { field: 'label', headerName: 'Subject', width: 200 }, { field: 'message', headerName: 'Finding', flex: 1, minWidth: 350 },
    { field: 'status', headerName: 'Review', width: 140 }, { field: 'action', headerName: '', width: 130, sortable: false, renderCell: p => snapshot.canEdit && p.row.severity !== 'info' && p.row.status === 'open'
      ? <Button size="small" onClick={e => { e.stopPropagation(); openNote({ type: 'ack', issues: [p.row] }) }}>Acknowledge</Button> : null }
  ] : ({
    ladders: [col('name', 'Ladder', 210), col('transport', 'Transport'), col('auditScopes', 'Audit sections', 200), { field: 'review', headerName: 'Manual review', width: 180, valueGetter: (_, r) => snapshot.reviews.some(x => x.recordId === r.id && x.current) ? 'Up to date' : 'Not up to date' }],
    memberships: [col('node', 'Node', 180), col('ladderId', 'Ladder', 180), col('role', 'Role', 125), col('protection', 'Protection', 110), col('ringName', 'Ring name', 180), col('ringVlan', 'Control VLAN', 110), col('primaryCode', 'Primary backhaul', 145), col('secondaryCode', 'Secondary backhaul', 155), col('ringBlock', 'Secondary block', 130), col('corePri', 'Core_Pri', 210), col('coreSec', 'Core_Sec', 210), col('origin', 'Source', 140)],
    sites: [col('name', 'Physical site', 220), col('irisName', 'Site alias', 180), col('region', 'Region', 100), col('type', 'Type', 120), col('owner', 'Owner'), { field: 'ladders', headerName: 'Ladder memberships', width: 260, valueGetter: (_, r) => membershipLadders(snapshot, r.id).map(id => label(records.get(id))).join(', ') || 'Unassigned' }],
    devices: [col('hostname', 'Device hostname', 270), col('type', 'Type', 110), col('siteId', 'Physical site', 240), col('sourceOnly', 'Missing from Node DB', 180)],
    backhauls: [col('code', 'Backhaul code'), col('deviceA', 'Device A', 250), col('deviceB', 'Device B', 250), col('capacity', 'Capacity', 110), col('ladderIds', 'Ladders', 200), col('linkType', 'Physical composition', 180)],
    segments: [col('backhaulId', 'Backhaul'), col('sequence', 'Order', 100), col('circuitId', 'Provider circuit', 230), col('provider', 'Provider'), col('sideA', 'Starts at', 230), col('sideB', 'Ends at', 230)],
    olts: [col('hostname', 'OLT hostname', 250), col('accessDevice', 'Access switch / router', 250), col('lagCode', 'LAG code'), col('uplink1', 'Uplink 1'), col('uplink2', 'Uplink 2'), col('ladderIds', 'Ladders', 220)]
  }[tableKind] || [])
  async function inspect(record) {
    if (!record) return
    const request = ++inspectionRequest.current
    setInspected(record); setHistory([]); setSources([]); setDetailError('')
    try { const [h, s] = await Promise.all([api.get(`${endpoint(record)}/history`), api.get(`${endpoint(record)}/sources`)]); if (request === inspectionRequest.current) { setHistory(h.data); setSources(s.data) } }
    catch (e) { if (request === inspectionRequest.current) setDetailError(errorText(e)) }
  }
  function inspectNode(node) {
    if (node.membershipIds?.length === 1) setSourceId(node.membershipIds[0])
    const r = records.get(node.id) || records.get(node.membershipIds?.[0]); if (r) inspect(r)
    else { setTableKind('issues'); setSearch(node.label); setAllRows(false) }
  }
  async function saveRecord({ kind, record, data, note }) {
    if (record) await api.patch(endpoint(record), { data, note, expectedVersion: record.version })
    else await api.post(`${base}/records/${kind}`, { data, note })
    await refresh(); setInspected(null)
  }
  async function importFile(event) {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file) return
    setBusy(true); setError('')
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('Maximum workbook size is 10 MB.')
      const bytes = new Uint8Array(await file.arrayBuffer()); let binary = ''
      for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
      const { data } = await api.post(`${base}/imports/preview`, { filename: file.name, workbookBase64: btoa(binary) })
      setPreview(data); setOverwriteIds([]); setImportNote('')
    } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function applyImport() {
    setBusy(true); setError('')
    try { await api.post(`${base}/imports/${preview.id}/apply`, { overwriteIds, note: importNote }); setPreview(null); await refresh() }
    catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  async function download() {
    try { const { data } = await api.get(`${base}/export`, { responseType: 'blob' }); const url = URL.createObjectURL(data); const a = document.createElement('a'); a.href = url; a.download = 'Network_Inventory.xlsx'; a.click(); URL.revokeObjectURL(url) }
    catch (e) { setError(errorText(e)) }
  }
  async function openNote(action) {
    setNote(''); setNoteError(''); setNoteAction(action)
    if (action.type === 'signoff') {
      try { const { data } = await api.get(`${endpoint(action.record)}/review-context`); setNoteAction(a => a?.type === 'signoff' ? { ...a, fingerprint: data.fingerprint } : a) }
      catch (e) { setNoteError(errorText(e)) }
    }
  }
  async function submitNote() {
    if (!note.trim()) { setNoteError('A review/evidence note is required.'); return }
    setBusy(true); setNoteError('')
    try {
      if (noteAction.type === 'signoff') await api.post(`${base}/reviews`, { kind: noteAction.record.kind, recordId: noteAction.record.id, fingerprint: noteAction.fingerprint, note })
      else if (noteAction.type === 'assign') {
        if (!assignRecord) throw Error('Choose a ladder or backhaul.')
        await api.patch(endpoint(assignRecord), { expectedVersion: assignRecord.version, note, data: { ...assignRecord.data, auditScopes: [...new Set([...(assignRecord.data.auditScopes || []), scope])] } })
      } else await api.post(`${base}/issues/acknowledge-batch`, { issues: noteAction.issues.map(i => ({ id: i.id, evidenceHash: i.evidenceHash })), note })
      setNoteAction(null); await refresh()
    } catch (e) { setNoteError(errorText(e)) } finally { setBusy(false) }
  }
  function showSiteFilter(filter) { setTableKind('sites'); setAllRows(true); setSiteFilter(filter); setSearch('') }
  if (loading) return <Box sx={{ p: 5, textAlign: 'center' }}><CircularProgress /><Typography mt={2}>Loading Network Inventory…</Typography></Box>
  if (!snapshot) return <Box p={3}><Alert severity="error">{error || 'Inventory could not be loaded.'}</Alert><Button onClick={() => { setLoading(true); refresh() }}>Retry</Button></Box>
  const segments = selected?.kind === 'backhauls' ? values(snapshot, 'segments').filter(s => s.data.backhaulId === selected.id) : []
  const nodesById = new Map(graph.nodes.map(n => [n.id, n]))
  const openFindings = tableRows.filter(i => i.status === 'open' && i.severity !== 'info')
  const coreReferences = []
  if (inspected?.kind === 'devices') for (const m of values(snapshot, 'memberships')) {
    for (const [role, host] of [['Core_Pri', m.data.corePri], ['Core_Sec', m.data.coreSec]]) {
      if (host === inspected.data.hostname && !coreReferences.some(r => r.m.data.ladderId === m.data.ladderId && r.role === role)) coreReferences.push({ m, role })
    }
  }
  return <Box className="ni-module"><PageShell eyebrow="Network engineering" title="Network Inventory" description="Explore connections. Find gaps. Review the inventory together."
    actions={<Stack direction="row" flexWrap="wrap" gap={1}>
      <Button startIcon={<RefreshRoundedIcon />} onClick={refresh}>Refresh</Button><Button startIcon={<DownloadRoundedIcon />} onClick={download}>Export Excel</Button>
      {snapshot.canEdit && <Button component="label" variant="contained" startIcon={<FileUploadRoundedIcon />} disabled={busy}>Import workbook<input type="file" hidden accept=".xlsx" onChange={importFile} /></Button>}
    </Stack>}>
    {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2,1fr)', lg: 'repeat(6,1fr)' }, gap: 1 }}>
      {[
        [snapshot.summary.ladders, 'Ladders in inventory', () => { setTableKind('ladders'); setAllRows(true) }],
        [snapshot.summary.upToDate, 'Ladders up to date · manual', () => { setTableKind('ladders'); setAllRows(true) }],
        [snapshot.summary.ladders - snapshot.summary.upToDate, 'Ladders not up to date', () => { setTableKind('ladders'); setAllRows(true) }],
        [snapshot.summary.sharedSites, 'Sites in multiple ladders', () => showSiteFilter('shared')],
        [snapshot.summary.unassignedSites, 'Sites without a ladder', () => showSiteFilter('unassigned')],
        [snapshot.summary.openIssues, 'Open data findings', () => { setTableKind('issues'); setAllRows(true); setFindingCode('') }]
      ].map(([count, title, action]) => <Box className="ni-kpi" key={title} role="button" tabIndex={0} onClick={action} onKeyDown={e => e.key === 'Enter' && action()} sx={{ cursor: 'pointer' }}><Box className="ni-kpi-value">{count}</Box><Box className="ni-kpi-label">{title}</Box></Box>)}
    </Box>
    <Paper sx={{ px: 1, borderRadius: 2 }}><Tabs value={scope} onChange={(_, v) => { navigate(`/network-inventory/${v}`); setTableKind(v === 'olt' ? 'olts' : 'memberships'); setSearch(''); setFindingCode(''); setAllRows(false); setSiteFilter('') }} variant="scrollable">
      {auditScopes.map(key => <Tab key={key} value={key} label={scopes[key]} />)}
    </Tabs></Paper>
    <Paper sx={{ p: 2, borderRadius: 2.5 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems={{ md: 'center' }} justifyContent="space-between">
        <Box sx={{ flex: 1, maxWidth: 650 }}><Autocomplete size="small" options={choices} value={selected || null} getOptionLabel={label} isOptionEqualToValue={(a, b) => a.id === b.id}
          onChange={(_, v) => { setSelectedId(v?.id || ''); setLadderOverride(''); setSourceId(''); setAllRows(false) }} renderInput={p => <TextField {...p} label={scope === 'olt' ? 'Select OLT' : 'Select ladder or scoped backhaul'} placeholder="Search inventory…" />} />
          {selected && <Stack direction="row" gap={.7} mt={1} flexWrap="wrap"><Chip size="small" label={currentReview?.current ? 'Up to date · manual review' : currentReview ? 'Review stale after edits' : 'Not up to date'} color={currentReview?.current ? 'success' : 'warning'} variant="outlined" />
            <Chip size="small" label="Device verification: not performed" variant="outlined" />{ladder?.data.transport && <Chip size="small" label={ladder.data.transport} />}</Stack>}
        </Box>
        <Stack direction="row" gap={1} flexWrap="wrap">
          {selected && <Button variant="outlined" onClick={() => inspect(selected)}>Inspect {selected.kind === 'ladders' ? 'ladder' : selected.kind === 'olts' ? 'OLT' : 'backhaul'}</Button>}
          {snapshot.canEdit && selected && <Button startIcon={<CheckCircleOutlineRoundedIcon />} onClick={() => openNote({ type: 'signoff', record: selected })}>Manual sign-off</Button>}
          {snapshot.canEdit && ['nld', 'rise'].includes(scope) && <Button onClick={() => { setAssignRecord(null); openNote({ type: 'assign' }) }}>Assign inventory to {scope.toUpperCase()}</Button>}
        </Stack>
      </Stack>
      {currentReview && <Typography variant="caption" display="block" color="text.secondary" mt={1}>Last manual sign-off: {currentReview.actor} · {localDate(currentReview.reviewedAt)} · {currentReview.note}</Typography>}
      {scope === 'rise' && !choices.length && <Alert severity="info" sx={{ mt: 2 }}>The workbook has no explicit RISE classification. Assign existing ladders/backhauls to this audit section, or add records below. No RISE membership has been guessed.</Alert>}
      {!snapshot.imports.length && <Alert severity="info" sx={{ mt: 2 }}>Import the Network Links workbook to populate the inventory. Every ladder starts not up to date.</Alert>}
      {selected?.kind === 'olts' && <Stack direction="row" gap={1} mt={2} flexWrap="wrap"><Chip label={`Attached to: ${selected.data.accessDevice || 'Unresolved'}`} size="small" /><Chip label={`LAG: ${selected.data.lagCode || 'Unknown'}`} size="small" />
        {selected.data.ladderIds?.length > 1 && <TextField select size="small" label="Ladder view" value={ladderId || ''} onChange={e => setLadderOverride(e.target.value)} sx={{ minWidth: 220 }}>{selected.data.ladderIds.map(id => <MenuItem value={id} key={id}>{label(records.get(id)) || id}</MenuItem>)}</TextField>}</Stack>}
    </Paper>
    {selected?.kind === 'backhauls' && <CircuitChain backhaul={selected} segments={segments} onSelect={inspect} />}
    {selected && <>
      {graph.members.length > 0 && <Paper sx={{ p: 1.6, borderRadius: 2.5 }}><Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems={{ md: 'center' }}>
        <TextField select size="small" label="Traffic starts at" value={sourceId || ''} onChange={e => setSourceId(e.target.value)} sx={{ minWidth: 285 }}>{graph.members.map(m => <MenuItem key={m.id} value={m.id}>{m.data.node} · {m.data.role || 'Role unknown'}{m.data.ringVlan ? ` · VLAN ${m.data.ringVlan}` : ''}</MenuItem>)}</TextField>
        <Box><Typography variant="body2"><strong>Core_Pri</strong> {paths.corePri || 'Unknown'} <Box component="span" sx={{ mx: 1.5, color: '#acb9c7' }}>│</Box><strong>Core_Sec</strong> {paths.coreSec || 'Unknown'}</Typography>
          <Typography variant="caption" color="text.secondary">Normal path follows the recorded primary backhaul. Backup assumes a primary-link failure and secondary-block release.</Typography></Box>
      </Stack>
        <Box className="ni-path"><Typography variant="caption" fontWeight={800} sx={{ mr: 1 }}>PRIMARY</Typography>{paths.primary ? paths.primary.nodes.map((id, i) => <Fragment key={id}>{i > 0 && '→'}<span>{nodesById.get(id)?.label || id}</span></Fragment>) : <Typography variant="caption" color="warning.main">Path unresolved from the recorded connections.</Typography>}</Box>
        <Box className="ni-path ni-backup"><Typography variant="caption" fontWeight={800} sx={{ mr: 1 }}>BACKUP</Typography>{paths.backup ? paths.backup.nodes.map((id, i) => <Fragment key={id}>{i > 0 && '→'}<span>{nodesById.get(id)?.label || id}</span></Fragment>) : <Typography variant="caption" color="warning.main">Backup path unresolved.</Typography>}</Box>
        {paths.warnings?.map(w => <Alert key={w} severity="warning" sx={{ mt: 1 }}>{w}</Alert>)}
      </Paper>}
      <Topology graph={graph} paths={paths} label={label(selected)} selectedId={inspected?.id} onNode={inspectNode} onEdge={e => inspect(records.get(e.recordId) || records.get(e.membershipId))} />
    </>}
    <Box className="ni-table">
      <Tabs value={tableKind} onChange={(_, v) => { setTableKind(v); setSiteFilter(''); setSearch(''); setFindingCode('') }} variant="scrollable" sx={{ px: 1, borderBottom: '1px solid #e3eaf0' }}>{Object.entries(labels).map(([key, value]) => <Tab key={key} value={key} label={value} />)}</Tabs>
      <Stack direction="row" gap={1} sx={{ p: 1.5 }} alignItems="center" flexWrap="wrap">
        <TextField size="small" label="Search table" value={search} onChange={e => setSearch(e.target.value)} sx={{ minWidth: 230 }} />
        <FormControlLabel control={<Checkbox size="small" checked={allRows} onChange={e => setAllRows(e.target.checked)} />} label="All inventory" />
        {tableKind !== 'issues' && <FormControlLabel control={<Checkbox size="small" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />} label="Include archived" />}
        {siteFilter && <Chip label={siteFilter === 'shared' ? 'Shared ladder sites' : 'Unassigned sites'} onDelete={() => setSiteFilter('')} />}
        {tableKind === 'issues' && <TextField select label="Finding group" size="small" value={findingCode} onChange={e => setFindingCode(e.target.value)} sx={{ minWidth: 260 }}><MenuItem value="">All finding groups</MenuItem>{findingGroups.map(code => <MenuItem value={code} key={code}>{fieldLabel(code.toLowerCase().replaceAll('_', ' '))} ({selectedFindings.filter(i => i.code === code).length})</MenuItem>)}</TextField>}
        <Box sx={{ flex: 1 }} /><Chip size="small" label={`${tableRows.length} records`} variant="outlined" />
        {snapshot.canEdit && tableKind !== 'issues' && <Button startIcon={<AddRoundedIcon />} onClick={() => setEditor({ kind: tableKind })}>Add {labels[tableKind].replace(/s$/, '').toLowerCase()}</Button>}
        {snapshot.canEdit && tableKind === 'issues' && findingCode && openFindings.length > 0 && <Button onClick={() => openNote({ type: 'ack', issues: openFindings.slice(0, 100) })}>Acknowledge group ({Math.min(openFindings.length, 100)})</Button>}
      </Stack>
      <Box sx={{ height: 455 }}><DataGrid rows={tableRows} columns={tableColumns} disableRowSelectionOnClick initialState={{ pagination: { paginationModel: { pageSize: 25 } } }} pageSizeOptions={[25, 50, 100]}
        onRowDoubleClick={({ row }) => tableKind === 'issues' ? inspect(records.get(row.recordId)) : inspect(row)}
        onRowClick={({ row }) => tableKind === 'issues' ? inspect(records.get(row.recordId)) : inspect(row)} sx={{ border: 0, '& .MuiDataGrid-row': { cursor: 'pointer' } }} /></Box>
    </Box>
    <Typography variant="caption" color="text.secondary">{snapshot.imports[0] ? `Source: ${snapshot.imports[0].filename} · imported ${localDate(snapshot.imports[0].applied_at)} · revision ${snapshot.revision}. ` : ''}Workbook information remains unverified against devices. Multiple ladder memberships are supported.</Typography>
  </PageShell>
  <Drawer anchor="right" open={!!inspected} onClose={() => setInspected(null)} slotProps={{ paper: { sx: { width: { xs: '100%', sm: 530 }, p: 2.5 } } }}>
    {inspected && <Stack gap={1.5}><Stack direction="row" justifyContent="space-between" gap={1}><Box><Typography variant="overline" color="text.secondary">{labels[inspected.kind]}</Typography><Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{label(inspected)}</Typography></Box><IconButton aria-label="Close inspector" onClick={() => setInspected(null)}><CloseRoundedIcon /></IconButton></Stack>
      <Stack direction="row" gap={1}><Chip size="small" label="Imported / manually maintained inventory" variant="outlined" />{snapshot.canEdit && <Button size="small" startIcon={<EditRoundedIcon />} onClick={() => setEditor({ kind: inspected.kind, record: inspected })}>Edit</Button>}</Stack>
      {detailError && <Alert severity="warning">{detailError}</Alert>}
      {inspected.kind === 'devices' && graph.nodes.find(n => n.id === inspected.id)?.roles?.length > 0 && <Stack direction="row" gap={.7} flexWrap="wrap">{graph.nodes.find(n => n.id === inspected.id).roles.filter(Boolean).map(role => <Chip key={role} size="small" color={role.startsWith('Core_') ? 'primary' : 'default'} label={`${label(ladder)} · ${role}`} />)}</Stack>}
      {inspected.kind === 'devices' && values(snapshot, 'memberships').some(m => [m.data.corePri, m.data.coreSec].includes(inspected.data.hostname)) && <Box>
        <Typography variant="subtitle2" fontWeight={800} mb={1}>Core assignments referenced by ladder rows</Typography>
        {coreReferences.map(({ m, role }) => <Paper variant="outlined" key={`${m.data.ladderId}:${role}`} sx={{ p: 1.2, mb: 1, borderRadius: 2 }}><Typography variant="body2" fontWeight={750}>{label(records.get(m.data.ladderId)) || 'Unassigned'} · {role}</Typography><Typography variant="caption" display="block">Referenced through the ladder’s core-router fields; no separate Core row is required.</Typography><Button size="small" onClick={() => inspect(m)}>View a source membership</Button></Paper>)}
      </Box>}
      {['devices', 'sites'].includes(inspected.kind) && <Box>
        <Typography variant="subtitle2" fontWeight={800} mb={1}>Ladder memberships at this site</Typography>
        {values(snapshot, 'memberships').filter(m => m.data.siteId && m.data.siteId === (inspected.kind === 'sites' ? inspected.id : inspected.data.siteId)).map(m => <Paper variant="outlined" key={m.id} sx={{ p: 1.3, mb: 1, borderRadius: 2 }}>
          <Typography variant="body2" fontWeight={800}>{label(records.get(m.data.ladderId)) || 'Ladder unassigned'} · {m.data.role || 'Role not specified'}</Typography>
          <Typography variant="caption" display="block">{m.data.protection || 'Protection unknown'} · {m.data.ringName || 'Ring name unknown'} · Control VLAN {m.data.ringVlan || 'unknown'}</Typography>
          <Typography variant="caption" display="block">Primary: {m.data.primaryCode || 'unknown'} · Secondary: {m.data.secondaryCode || 'unknown'}{m.data.ringBlock === true ? ' · secondary block marked' : m.data.ringBlock == null ? ' · block state unknown' : ''}</Typography>
          <Typography variant="caption" display="block">Core_Pri: {m.data.corePri || 'unknown'}<br />Core_Sec: {m.data.coreSec || 'unknown'}</Typography>
          <Stack direction="row" gap={1} mt={.7}><Button size="small" onClick={() => inspect(m)}>View membership</Button>{snapshot.canEdit && <Button size="small" onClick={() => setEditor({ kind: 'memberships', record: m })}>Edit ring configuration</Button>}</Stack>
        </Paper>)}
      </Box>}
      {inspected.kind === 'backhauls' && graph.edges.filter(e => e.recordId === inspected.id).flatMap(e => e.memberClaims || []).length > 0 && <Box><Typography variant="subtitle2" fontWeight={800}>Declared use in this ladder</Typography>
        {graph.edges.filter(e => e.recordId === inspected.id).flatMap(e => e.memberClaims || []).map((claim, i) => { const m = records.get(claim.membershipId); return <Typography variant="body2" key={i}>{m?.data.node} · {claim.direction}{claim.direction === 'secondary' && m?.data.ringBlock ? ' · block marked' : ''}</Typography> })}
      </Box>}
      <dl style={{ margin: 0 }}>{Object.entries(inspected.data).filter(([k]) => !['attachmentClaims', 'siteClaims'].includes(k)).map(([key, value]) => <div className="ni-detail-field" key={key}><dt>{fieldLabel(key)}</dt><dd>{display(value)}</dd></div>)}</dl>
      {inspected.kind === 'backhauls' && <CircuitChain backhaul={inspected} segments={values(snapshot, 'segments').filter(s => s.data.backhaulId === inspected.id)} onSelect={inspect} />}
      <Accordion><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography fontWeight={700}>Original source rows ({sources.length})</Typography></AccordionSummary><AccordionDetails>{sources.map((s, i) => <Box key={i} mb={2}><Typography variant="caption">{s.filename} · {s.sheet} row {s.row_number}</Typography><pre className="ni-raw">{JSON.stringify(s.raw_data, null, 2)}</pre></Box>)}{!sources.length && <Typography variant="body2">Manually created record; no workbook source row.</Typography>}</AccordionDetails></Accordion>
      <Accordion><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography fontWeight={700}>Change history ({history.length})</Typography></AccordionSummary><AccordionDetails>{history.map(h => <Box key={h.id} sx={{ pb: 2, mb: 1, borderBottom: '1px solid #e5ebf0' }}><Typography variant="body2" fontWeight={750}>{h.action} · {h.actor}</Typography><Typography variant="caption">{localDate(h.created_at)}</Typography><Typography variant="body2" sx={{ mt: .5 }}>{h.note}</Typography><pre className="ni-raw">{JSON.stringify({ before: h.before_data, after: h.after_data }, null, 2)}</pre></Box>)}</AccordionDetails></Accordion>
    </Stack>}
  </Drawer>
  <RecordEditor open={!!editor} kind={editor?.kind || 'sites'} record={editor?.record} snapshot={snapshot} scope={scope} onClose={() => setEditor(null)} onSave={saveRecord} />
  <Dialog open={!!preview} onClose={busy ? undefined : () => setPreview(null)} fullWidth maxWidth="md"><DialogTitle>Review workbook import</DialogTitle><DialogContent dividers>{preview && <Stack gap={2}>
    <Typography>{preview.filename}</Typography><Alert severity="info">Manual edits and currently signed-off values are preserved unless you explicitly select them below. Records absent from this workbook remain in the inventory.</Alert>
    <Typography variant="body2">{preview.changes.length} additions/updates · {preview.conflicts.length} manual-edit conflicts · {preview.omitted.length} existing records absent from this file · {preview.issues.length} data findings</Typography>
    <Stack direction="row" gap={1} flexWrap="wrap">{Object.entries(preview.counts).map(([k, n]) => <Chip key={k} label={`${labels[k]}: ${n}`} />)}</Stack>
    {preview.conflicts.map(c => <Box key={c.id}><FormControlLabel control={<Checkbox checked={overwriteIds.includes(c.id)} onChange={e => setOverwriteIds(ids => e.target.checked ? [...ids, c.id] : ids.filter(id => id !== c.id))} />} label={`Replace manual edits: ${c.label}`} /><Accordion><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>Compare values</AccordionSummary><AccordionDetails><pre className="ni-raw">{JSON.stringify({ current: c.before, proposed: c.after }, null, 2)}</pre></AccordionDetails></Accordion></Box>)}
    <TextField label="Import / conflict decision note" multiline minRows={2} value={importNote} onChange={e => setImportNote(e.target.value)} required={overwriteIds.length > 0} />
    {preview.normalisations.length > 0 && <Typography variant="caption">{preview.normalisations.length} harmless formatting normalisations proposed; original spelling remains in source evidence.</Typography>}
  </Stack>}</DialogContent><DialogActions><Button onClick={() => setPreview(null)} disabled={busy}>Cancel</Button><Button variant="contained" onClick={applyImport} disabled={busy}>{busy ? 'Applying…' : 'Apply reviewed import'}</Button></DialogActions></Dialog>
  <Dialog open={!!noteAction} onClose={busy ? undefined : () => setNoteAction(null)} fullWidth maxWidth="sm"><DialogTitle>{noteAction?.type === 'signoff' ? 'Manual inventory sign-off' : noteAction?.type === 'assign' ? `Assign to ${scope.toUpperCase()} Audits` : `Acknowledge ${noteAction?.issues?.length || 0} finding(s)`}</DialogTitle>
    <DialogContent dividers><Stack gap={2}><Typography variant="body2" color="text.secondary">{noteAction?.type === 'signoff' ? 'Confirm the inventory has been reviewed. This is separate from device verification. Resolve or acknowledge outstanding findings first; later related edits invalidate this sign-off.' : noteAction?.type === 'assign' ? 'Tag existing inventory for this audit section without moving it out of other sections.' : 'Record why these discrepancies are understood or acceptable. This does not correct the underlying values; changed evidence reopens the finding.'}</Typography>
      {noteError && <Alert severity="error">{noteError}</Alert>}
      {noteAction?.type === 'assign' && <Autocomplete options={[...values(snapshot, 'ladders'), ...values(snapshot, 'backhauls')]} value={assignRecord} getOptionLabel={label} isOptionEqualToValue={(a, b) => a.id === b.id} onChange={(_, r) => setAssignRecord(r)} renderInput={p => <TextField {...p} label="Choose inventory" />} />}
      <TextField required label="Review note / evidence" multiline minRows={3} value={note} onChange={e => setNote(e.target.value)} />
    </Stack></DialogContent><DialogActions><Button onClick={() => setNoteAction(null)} disabled={busy}>Cancel</Button><Button variant="contained" disabled={busy || noteAction?.type === 'signoff' && !noteAction?.fingerprint} onClick={submitNote}>{busy ? 'Saving…' : 'Save review'}</Button></DialogActions>
  </Dialog>
  </Box>
}
