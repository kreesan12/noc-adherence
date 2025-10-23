// frontend/src/pages/NldServicesPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Tabs, Tab, Stack, TextField, MenuItem, Button, Typography,
  Grid, FormControlLabel, Switch, Autocomplete, Chip, Divider, Snackbar, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, InputAdornment
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import api from '../api'

// ------------ helpers ------------
const SERVICE_TYPES = ['Carrier', 'NLD']
const CAPACITIES = ['1G', '2.5G', '10G', '100G', '400G']
const DEPLOYMENTS = ['OTN', 'EVPN']
const ROUTES = ['CPT <> JHB', 'CPT <> DBN', 'JHB <> DBN', 'CPT <> EL'] // extend as needed

const initialForm = {
  customer: '',
  frg: '',
  serviceType: 'NLD',
  capacity: '10G',
  nldRoute: 'CPT <> JHB',
  deployment: 'OTN',
  protection: true,
  priPath: '',
  secPath: '',
  stag: '',
  ctag: '',
  sideAName: '',
  sideAIC: '',
  sideASO: '',
  sideAHandoff: '',
  sideBName: '',
  sideBIC: '',
  sideBSO: '',
  sideBHandoff: '',
}

export default function NldServicesPage() {
  const [tab, setTab] = useState(0)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null) // {severity, message}

  // dropdown sources
  const [nlds, setNlds] = useState([])           // from /nlds.json (for pri/sec path)
  const [nodeOptionsA, setNodeOptionsA] = useState([])
  const [nodeOptionsB, setNodeOptionsB] = useState([])

  // list tab
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loadingList, setLoadingList] = useState(false)

  // fetch nlds once
  useEffect(() => {
    api.get('/nlds.json').then(r => setNlds(r.data ?? [])).catch(console.error)
  }, [])

  const nldGroups = useMemo(() => {
    const s = new Set()
    for (const sp of nlds) s.add(sp?.nldGroup ?? 'Unassigned')
    return Array.from(s).sort()
  }, [nlds])

  // ---- Node autocompletes (search as you type) ----
  const searchNodes = async (q, setter) => {
    try {
      const r = await api.get('/nodes.json', { params: { q, take: 30 } })
      setter(r.data ?? [])
    } catch (e) { console.error(e) }
  }

  // ---- List tab loader ----
  const loadList = async () => {
    setLoadingList(true)
    try {
      const r = await api.get('/engineering/nld-services', { params: { q: search, take: 100 } })
      setRows(r.data?.items ?? [])
      setTotal(r.data?.total ?? 0)
    } catch (e) { console.error(e) } finally { setLoadingList(false) }
  }
  useEffect(() => { if (tab === 1) loadList() }, [tab]) // load when switching to "Current"

  // ---- handlers ----
  const setF = (key, val) => setForm(prev => ({ ...prev, [key]: val }))

  const submit = async () => {
    setSaving(true)
    try {
      const payload = { ...form }
      // minimal required validation here; backend will validate too
      const required = ['customer','frg','serviceType','capacity','nldRoute','deployment','sideAName','sideBName']
      for (const k of required) if (!String(payload[k] ?? '').trim()) {
        setToast({ severity: 'error', message: `Missing required field: ${k}` })
        setSaving(false); return
      }
      payload.protection = !!payload.protection
      await api.post('/engineering/nld-services', payload)
      setToast({ severity: 'success', message: 'NLD Service saved' })
      setForm(initialForm)
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Failed to save'
      setToast({ severity: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
      <Paper elevation={1} sx={{ flex: 1, m: 2, p: 2, overflow: 'auto' }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Capture New" />
          <Tab label={`Current (${total})`} />
        </Tabs>

        {/* ----------- Capture tab ----------- */}
        {tab === 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
              Template for capturing NLD services
            </Typography>

            <Grid container spacing={2}>
              {/* Row 1 */}
              <Grid item xs={12} sm={4}>
                <TextField label="CUSTOMER" value={form.customer} onChange={e => setF('customer', e.target.value)} fullWidth required />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="FRG" value={form.frg} onChange={e => setF('frg', e.target.value)} fullWidth required />
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="CAPACITY" value={form.capacity} onChange={e => setF('capacity', e.target.value)} select fullWidth>
                  {CAPACITIES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Grid>

              {/* Row 2 */}
              <Grid item xs={12} sm={4}>
                <TextField label="SERVICE TYPE" value={form.serviceType} onChange={e => setF('serviceType', e.target.value)} select fullWidth>
                  {SERVICE_TYPES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="DEPLOYMENT" value={form.deployment} onChange={e => setF('deployment', e.target.value)} select fullWidth>
                  {DEPLOYMENTS.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="NLD ROUTE" value={form.nldRoute} onChange={e => setF('nldRoute', e.target.value)} select fullWidth>
                  {ROUTES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Grid>

              {/* Row 3 */}
              <Grid item xs={12} sm={4}>
                <TextField label="PRI PATH (NLD Group)" value={form.priPath} onChange={e => setF('priPath', e.target.value)} select fullWidth>
                  <MenuItem value="">—</MenuItem>
                  {nldGroups.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <TextField label="SEC PATH (NLD Group)" value={form.secPath} onChange={e => setF('secPath', e.target.value)} select fullWidth>
                  <MenuItem value="">—</MenuItem>
                  {nldGroups.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                </TextField>
              </Grid>
              <Grid item xs={12} sm={4}>
                <FormControlLabel
                  control={<Switch checked={!!form.protection} onChange={(_, v) => setF('protection', v)} />}
                  label="PROTECTION (Yes/No)"
                />
              </Grid>

              {/* Row 4 */}
              <Grid item xs={12} sm={3}>
                <TextField label="STAG" value={form.stag} onChange={e => setF('stag', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={3}>
                <TextField label="CTAG" value={form.ctag} onChange={e => setF('ctag', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={3}>
                {/* Spacer to align UI nicely */}
              </Grid>

              {/* Side A */}
              <Grid item xs={12}><Divider textAlign="left">Side A</Divider></Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  freeSolo
                  options={nodeOptionsA}
                  onInputChange={(_, v) => searchNodes(v, setNodeOptionsA)}
                  getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.name}${o.code ? ` (${o.code})` : ''}`)}
                  onChange={(_, v) => setF('sideAName', typeof v === 'string' ? v : v?.name || '')}
                  renderInput={(params) => (
                    <TextField {...params} label="SIDE A (node)" value={form.sideAName}
                      onChange={e => setF('sideAName', e.target.value)} required />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="SIDE A – Handoff" value={form.sideAHandoff} onChange={e => setF('sideAHandoff', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="SIDE A - IC Number" value={form.sideAIC} onChange={e => setF('sideAIC', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="SIDE A - SO Number" value={form.sideASO} onChange={e => setF('sideASO', e.target.value)} fullWidth />
              </Grid>

              {/* Side B */}
              <Grid item xs={12}><Divider textAlign="left">Side B</Divider></Grid>
              <Grid item xs={12} sm={6}>
                <Autocomplete
                  freeSolo
                  options={nodeOptionsB}
                  onInputChange={(_, v) => searchNodes(v, setNodeOptionsB)}
                  getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.name}${o.code ? ` (${o.code})` : ''}`)}
                  onChange={(_, v) => setF('sideBName', typeof v === 'string' ? v : v?.name || '')}
                  renderInput={(params) => (
                    <TextField {...params} label="SIDE B (node)" value={form.sideBName}
                      onChange={e => setF('sideBName', e.target.value)} required />
                  )}
                />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="SIDE B – Handoff" value={form.sideBHandoff} onChange={e => setF('sideBHandoff', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="SIDE B - IC Number" value={form.sideBIC} onChange={e => setF('sideBIC', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="SIDE B - SO Number" value={form.sideBSO} onChange={e => setF('sideBSO', e.target.value)} fullWidth />
              </Grid>

              {/* Actions */}
              <Grid item xs={12}>
                <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                  <Button variant="contained" onClick={submit} disabled={saving}>Save</Button>
                  <Button variant="outlined" onClick={() => setForm(initialForm)} disabled={saving}>Clear</Button>
                </Stack>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* ----------- Current tab ----------- */}
        {tab === 1 && (
          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <TextField
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search customer / FRG / route / node…"
                size="small"
                InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
              />
              <Button variant="outlined" onClick={loadList} disabled={loadingList}>Refresh</Button>
              <Chip label={`${total} total`} />
            </Stack>

            <Paper variant="outlined" sx={{ overflow: 'auto' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Customer</TableCell>
                    <TableCell>FRG</TableCell>
                    <TableCell>Service</TableCell>
                    <TableCell>Capacity</TableCell>
                    <TableCell>Route</TableCell>
                    <TableCell>Deploy</TableCell>
                    <TableCell>Prot</TableCell>
                    <TableCell>Pri</TableCell>
                    <TableCell>Sec</TableCell>
                    <TableCell>Side A</TableCell>
                    <TableCell>Side B</TableCell>
                    <TableCell>Created</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map(r => (
                    <TableRow key={r.id} hover>
                      <TableCell>{r.customer}</TableCell>
                      <TableCell>{r.frg}</TableCell>
                      <TableCell>{r.serviceType}</TableCell>
                      <TableCell>{r.capacity}</TableCell>
                      <TableCell>{r.nldRoute}</TableCell>
                      <TableCell>{r.deployment}</TableCell>
                      <TableCell>{r.protection ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{r.priPath || '—'}</TableCell>
                      <TableCell>{r.secPath || '—'}</TableCell>
                      <TableCell>{r.sideAName}</TableCell>
                      <TableCell>{r.sideBName}</TableCell>
                      <TableCell>{new Date(r.createdAt).toLocaleString()}</TableCell>
                    </TableRow>
                  ))}
                  {!rows.length && (
                    <TableRow><TableCell colSpan={12} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                      {loadingList ? 'Loading…' : 'No results'}
                    </TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </Paper>
          </Box>
        )}
      </Paper>

      {/* toasts */}
      <Snackbar
        open={!!toast}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setToast(null)} severity={toast?.severity || 'info'} variant="filled">
          {toast?.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
