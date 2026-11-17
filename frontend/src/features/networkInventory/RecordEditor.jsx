import { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Grid, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { auditScopes, values } from './domain'

export const fieldSpecs = {
  sites: [['name', 'Site name'], ['irisName', 'IRIS / site alias'], ['owner', 'Owner'], ['region', 'Region'], ['province', 'Province'], ['type', 'Site type'], ['coordinates', 'Coordinates'], ['aliases', 'Other aliases', 'list']],
  devices: [['hostname', 'Device hostname'], ['type', 'Device type', ['switch', 'router', 'olt', 'adva']], ['siteId', 'Physical site', 'sites'], ['notes', 'Notes']],
  ladders: [['name', 'Ladder name'], ['transport', 'Transport', ['EVPN', 'VPLS', 'Unknown']], ['auditScopes', 'Audit sections', 'scopes'], ['notes', 'Notes']],
  memberships: [['node', 'Node / site label'], ['siteId', 'Physical site', 'sites'], ['ladderId', 'Ladder', 'ladders'], ['protection', 'Protection', ['EAPS', 'ERPS', '']],
    ['role', 'Ring role', ['Master', 'Transit', 'Stub', 'RPL Owner', 'Core', '']], ['ringName', 'Ring name'], ['ringVlan', 'Control VLAN', 'number'],
    ['primaryCode', 'Primary backhaul code'], ['primaryA', 'Primary endpoint A'], ['primaryB', 'Primary endpoint B'],
    ['secondaryCode', 'Secondary backhaul code'], ['secondaryA', 'Secondary endpoint A'], ['secondaryB', 'Secondary endpoint B'],
    ['ringBlock', 'Ring block on secondary backhaul', 'boolean'], ['corePri', 'Core_Pri hostname'], ['coreSec', 'Core_Sec hostname'], ['master', 'Master / RPL Owner hostname']],
  backhauls: [['code', 'Backhaul circuit code'], ['region', 'Region'], ['ladderIds', 'Ladders', 'ladders-multiple'], ['siteA', 'Endpoint A site label'], ['deviceA', 'Endpoint A hostname'], ['interfaceA', 'Interface A (if known)'],
    ['siteB', 'Endpoint B site label'], ['deviceB', 'Endpoint B hostname'], ['interfaceB', 'Interface B (if known)'], ['linkType', 'Link type', ['Single-circuit', 'Multi-circuit']], ['capacity', 'Capacity (e.g. 40G)'], ['auditScopes', 'Audit sections', 'scopes'], ['notes', 'Notes']],
  segments: [['backhaulId', 'Parent backhaul', 'backhauls'], ['sequence', 'Sequence in chain', 'number'], ['circuitId', 'Provider circuit ID'], ['provider', 'Provider'], ['sideA', 'Segment starts at'], ['sideB', 'Segment ends at']],
  olts: [['hostname', 'OLT hostname'], ['accessDevice', 'Attached switch / router hostname'], ['siteId', 'Site', 'sites'], ['ladderIds', 'Ladders', 'ladders-multiple'],
    ['lagCode', 'LAG code'], ['uplink1', 'Uplink code 1'], ['uplink2', 'Uplink code 2'], ['linkType', 'Link type'], ['corePri', 'Core_Pri hostname'], ['coreSec', 'Core_Sec hostname'], ['primaryCode', 'Primary backhaul'], ['secondaryCode', 'Secondary backhaul'], ['notes', 'Notes']]
}
const titleFor = kind => ({ sites: 'site', devices: 'device', ladders: 'ladder', memberships: 'ladder membership', backhauls: 'backhaul', segments: 'circuit segment', olts: 'OLT attachment' }[kind])
const rowName = row => row.data.name || row.data.hostname || row.data.code || row.data.node || row.data.circuitId
export default function RecordEditor({ record, kind, snapshot, scope, open, onClose, onSave }) {
  const [data, setData] = useState({}), [note, setNote] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setData(record ? structuredClone(record.data) : { auditScopes: kind === 'ladders' ? [...new Set(['ladder', scope].filter(s => s !== 'olt'))] : scope === 'nld' || scope === 'rise' ? [scope] : [], sequence: kind === 'segments' ? 1 : undefined }); setNote(''); setError('') } }, [open, record, kind, scope])
  function field([key, label, type]) {
    const value = data[key]
    if (type === 'boolean') return <TextField select fullWidth size="small" key={key} label={label} value={value == null ? 'unknown' : value ? 'yes' : 'no'} onChange={e => setData(d => ({ ...d, [key]: e.target.value === 'unknown' ? null : e.target.value === 'yes' }))}>
      <MenuItem value="unknown">Not specified</MenuItem><MenuItem value="yes">Yes</MenuItem><MenuItem value="no">No</MenuItem></TextField>
    const relational = ['sites', 'ladders', 'backhauls', 'ladders-multiple'].includes(type), multi = type === 'scopes' || type === 'ladders-multiple'
    const options = type === 'scopes' ? auditScopes.map(id => ({ id, label: id.toUpperCase() })) : relational ? values(snapshot, type.replace('-multiple', '')).map(r => ({ id: r.id, label: rowName(r) })) : Array.isArray(type) ? type.map(id => ({ id, label: id || 'Not specified' })) : null
    if (options && !multi && value && !options.some(o => o.id === value)) options.push({ id: value, label: `${value} (not in current inventory)` })
    return <TextField key={key} fullWidth size="small" label={label} select={!!options}
      type={type === 'number' ? 'number' : 'text'} value={multi ? value || [] : type === 'list' ? (value || []).join('; ') : value ?? ''}
      slotProps={multi ? { select: { multiple: true, renderValue: selected => selected.map(id => options.find(o => o.id === id)?.label || id).join(', ') } } : undefined}
      helperText={type === 'list' ? 'Separate aliases with semicolons.' : key === 'protection' ? 'VPLS protection will be added later.' : undefined}
      onChange={e => setData(d => ({ ...d, [key]: type === 'number' ? e.target.value === '' ? null : Number(e.target.value) : type === 'list' ? e.target.value.split(';').map(s => s.trim()).filter(Boolean) : e.target.value }))}>
      {options && [!multi && <MenuItem value="" key="empty">Not specified</MenuItem>, ...options.filter(o => o.id !== '').map(o => <MenuItem key={o.id} value={o.id}>{o.label}</MenuItem>)]}
    </TextField>
  }
  async function save() {
    if (!note.trim()) { setError('Add a note explaining this correction.'); return }
    setBusy(true); setError('')
    try { await onSave({ kind, record, data, note }); onClose() } catch (e) { setError(e.response?.data?.error || e.message) } finally { setBusy(false) }
  }
  return <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
    <DialogTitle>{record ? 'Edit' : 'Add'} {titleFor(kind)}</DialogTitle>
    <DialogContent dividers>
      <Stack gap={2}>
        <Typography variant="body2" color="text.secondary">This updates the inventory only. Imported source rows and the change history are retained. Related manual sign-offs become stale when their data changes.</Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <BoxGrid>{(fieldSpecs[kind] || []).map(spec => <div key={spec[0]}>{field(spec)}</div>)}</BoxGrid>
        {record && <FormControlLabel control={<Checkbox checked={!!data.archived} onChange={e => setData(d => ({ ...d, archived: e.target.checked }))} />} label="Archive this record (retained in history; can be restored)" />}
        <TextField multiline minRows={2} fullWidth required label="Change note / supporting evidence" value={note} onChange={e => setNote(e.target.value)} />
      </Stack>
    </DialogContent>
    <DialogActions><Button onClick={onClose} disabled={busy}>Cancel</Button><Button variant="contained" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save inventory change'}</Button></DialogActions>
  </Dialog>
}
function BoxGrid({ children }) { return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))', gap: 16, paddingTop: 5 }}>{children}</div> }
