// frontend/src/pages/NldServicesPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Tabs, Tab, Stack, TextField, MenuItem, Button, Typography, Grid,
  FormControlLabel, Switch, Autocomplete, Chip, Divider, Snackbar, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, InputAdornment,
  Tooltip, Drawer, List, ListItem, ListItemText, Skeleton
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import SaveIcon from '@mui/icons-material/Save'
import RotateLeftIcon from '@mui/icons-material/RotateLeft'
import VisibilityIcon from '@mui/icons-material/Visibility'
import api from '../api'

/* ---------------- config / options ---------------- */
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

const requiredFields = ['customer','frg','serviceType','capacity','nldRoute','deployment','sideAName','sideBName']

/* ---------------- small helpers ---------------- */
const SectionCard = ({ title, subtitle, children, right }) => (
  <Paper variant="outlined" sx={{ p: 2 }}>
    <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 1 }}>
      <Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{title}</Typography>
        {subtitle && <Typography variant="body2" color="text.secondary">{subtitle}</Typography>}
      </Box>
      {right}
    </Stack>
    {children}
  </Paper>
)

const FieldHint = ({ children }) => (
  <Typography variant="caption" color="text.secondary">{children}</Typography>
)

/* =======================================================
   PAGE
   ======================================================= */
export default function NldServicesPage() {
  const [tab, setTab] = useState(0)

  // form
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null) // {severity, message}
  const [touched, setTouched] = useState({}) // show errors after interaction

  // dropdown sources
  const [nlds, setNlds] = useState([])     // from /nlds.json (for pri/sec path)
  const [nldLoading, setNldLoading] = useState(true)
  const nldGroups = useMemo(() => {
    const s = new Set()
    for (const sp of nlds) s.add(sp?.nldGroup ?? 'Unassigned')
    return Array.from(s).sort()
  }, [nlds])

  // node autocompletes
  const [nodeOptionsA, setNodeOptionsA] = useState([])
  const [nodeOptionsB, setNodeOptionsB] = useState([])

  // list tab
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loadingList, setLoadingList] = useState(false)

  // details drawer
  const [openDrawer, setOpenDrawer] = useState(false)
  const [drawerRow, setDrawerRow] = useState(null)

  /* -------- load NLDs once -------- */
  useEffect(() => {
    setNldLoading(true)
    api.get('/nlds.json')
      .then(r => setNlds(r.data ?? []))
      .catch(console.error)
      .finally(() => setNldLoading(false))
  }, [])

  /* -------- node search ---------- */
  const searchNodes = async (q, setter) => {
    try {
      if (!q || q.length < 2) { setter([]); return }
      const r = await api.get('/nodes.json', { params: { q, take: 30 } })
      setter(r.data ?? [])
    } catch (e) { console.error(e) }
  }

  /* -------- list tab loader ------ */
  const loadList = async () => {
    setLoadingList(true)
    try {
      const r = await api.get('/engineering/nld-services', { params: { q: search, take: 100 } })
      setRows(r.data?.items ?? [])
      setTotal(r.data?.total ?? 0)
    } catch (e) { console.error(e) } finally { setLoadingList(false) }
  }
  useEffect(() => { if (tab === 1) loadList() }, [tab]) // load when switching to "Current"

  /* -------- validation ----------- */
  const errors = useMemo(() => {
    const e = {}
    for (const k of requiredFields) if (!String(form[k] ?? '').trim()) e[k] = 'Required'
    return e
  }, [form])

  const isValid = useMemo(() => Object.keys(errors).length === 0, [errors])

  const setF = (key, val) => setForm(prev => ({ ...prev, [key]: val }))
  const markTouched = (key) => setTouched(prev => ({ ...prev, [key]: true }))

  const submit = async () => {
    setTouched(Object.fromEntries(requiredFields.map(k => [k, true])))
    if (!isValid) return
    setSaving(true)
    try {
      const payload = { ...form, protection: !!form.protection }
      await api.post('/engineering/nld-services', payload)
      setToast({ severity: 'success', message: 'NLD Service saved' })
      setForm(initialForm)
      setTouched({})
    } catch (e) {
      const msg = e?.response?.data?.error || e.message || 'Failed to save'
      setToast({ severity: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }

  /* =================== RENDER =================== */
  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
      <Box sx={{ flex: 1, m: 2, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Paper elevation={0} sx={{ mb: 1, p: 0 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label="Capture New" />
            <Tab label={`Current (${total})`} />
          </Tabs>
        </Paper>

        {/* ====== Capture tab ====== */}
        {tab === 0 && (
          <Box sx={{ overflow: 'auto', pr: 1, pb: 8 /* space for sticky bar */ }}>
            {/* Intro */}
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
              Template for capturing NLD services
            </Typography>

            {/* Service Details */}
            <SectionCard title="Service Details" subtitle="Top-level service attributes">
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="CUSTOMER" required fullWidth
                    value={form.customer}
                    onChange={e => setF('customer', e.target.value)}
                    onBlur={() => markTouched('customer')}
                    error={touched.customer && !!errors.customer}
                    helperText={touched.customer && errors.customer}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="FRG" required fullWidth
                    value={form.frg}
                    onChange={e => setF('frg', e.target.value)}
                    onBlur={() => markTouched('frg')}
                    error={touched.frg && !!errors.frg}
                    helperText={touched.frg && errors.frg}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="CAPACITY" select fullWidth
                    value={form.capacity}
                    onChange={e => setF('capacity', e.target.value)}
                  >
                    {CAPACITIES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </TextField>
                  <FieldHint>Interface capacity (e.g., 10G)</FieldHint>
                </Grid>

                <Grid item xs={12} md={4}>
                  <TextField
                    label="SERVICE TYPE" select fullWidth
                    value={form.serviceType}
                    onChange={e => setF('serviceType', e.target.value)}
                  >
                    {SERVICE_TYPES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="DEPLOYMENT" select fullWidth
                    value={form.deployment}
                    onChange={e => setF('deployment', e.target.value)}
                  >
                    {DEPLOYMENTS.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="NLD ROUTE" select fullWidth
                    value={form.nldRoute}
                    onChange={e => setF('nldRoute', e.target.value)}
                  >
                    {ROUTES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </TextField>
                </Grid>
              </Grid>
            </SectionCard>

            {/* Paths & Tags */}
            <SectionCard
              title="Paths & Tags"
              subtitle="Primary/secondary NLD groups and service tags"
              right={nldLoading ? <Skeleton width={80} /> : <Chip label={`${nldGroups.length} NLD groups`} size="small" />}
              sx={{ mt: 2 }}
            >
              <Grid container spacing={2}>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="PRI PATH (NLD Group)" select fullWidth
                    value={form.priPath} onChange={e => setF('priPath', e.target.value)}
                  >
                    <MenuItem value="">—</MenuItem>
                    {nldGroups.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={4}>
                  <TextField
                    label="SEC PATH (NLD Group)" select fullWidth
                    value={form.secPath} onChange={e => setF('secPath', e.target.value)}
                  >
                    <MenuItem value="">—</MenuItem>
                    {nldGroups.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                  </TextField>
                </Grid>
                <Grid item xs={12} md={4} sx={{ display: 'flex', alignItems: 'center' }}>
                  <FormControlLabel
                    control={<Switch checked={!!form.protection} onChange={(_, v) => setF('protection', v)} />}
                    label="PROTECTION (Yes/No)"
                  />
                </Grid>

                <Grid item xs={12} md={3}>
                  <TextField label="STAG" fullWidth value={form.stag} onChange={e => setF('stag', e.target.value)} />
                </Grid>
                <Grid item xs={12} md={3}>
                  <TextField label="CTAG" fullWidth value={form.ctag} onChange={e => setF('ctag', e.target.value)} />
                </Grid>
              </Grid>
            </SectionCard>

            {/* Side A */}
            <SectionCard title="Side A" subtitle="Site details for A-end" sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    freeSolo
                    options={nodeOptionsA}
                    onInputChange={(_, v) => searchNodes(v, setNodeOptionsA)}
                    getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.name}${o.code ? ` (${o.code})` : ''}`)}
                    onChange={(_, v) => setF('sideAName', typeof v === 'string' ? v : v?.name || '')}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="SIDE A (node)" required
                        value={form.sideAName}
                        onChange={e => setF('sideAName', e.target.value)}
                        onBlur={() => markTouched('sideAName')}
                        error={touched.sideAName && !!errors.sideAName}
                        helperText={touched.sideAName && errors.sideAName}
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="SIDE A – Handoff" fullWidth value={form.sideAHandoff} onChange={e => setF('sideAHandoff', e.target.value)} />
                  <FieldHint>Switch/port or optical handoff details</FieldHint>
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="SIDE A - IC Number" fullWidth value={form.sideAIC} onChange={e => setF('sideAIC', e.target.value)} />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="SIDE A - SO Number" fullWidth value={form.sideASO} onChange={e => setF('sideASO', e.target.value)} />
                </Grid>
              </Grid>
            </SectionCard>

            {/* Side B */}
            <SectionCard title="Side B" subtitle="Site details for B-end" sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Autocomplete
                    freeSolo
                    options={nodeOptionsB}
                    onInputChange={(_, v) => searchNodes(v, setNodeOptionsB)}
                    getOptionLabel={(o) => (typeof o === 'string' ? o : `${o.name}${o.code ? ` (${o.code})` : ''}`)}
                    onChange={(_, v) => setF('sideBName', typeof v === 'string' ? v : v?.name || '')}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="SIDE B (node)" required
                        value={form.sideBName}
                        onChange={e => setF('sideBName', e.target.value)}
                        onBlur={() => markTouched('sideBName')}
                        error={touched.sideBName && !!errors.sideBName}
                        helperText={touched.sideBName && errors.sideBName}
                      />
                    )}
                  />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="SIDE B – Handoff" fullWidth value={form.sideBHandoff} onChange={e => setF('sideBHandoff', e.target.value)} />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="SIDE B - IC Number" fullWidth value={form.sideBIC} onChange={e => setF('sideBIC', e.target.value)} />
                </Grid>
                <Grid item xs={12} md={6}>
                  <TextField label="SIDE B - SO Number" fullWidth value={form.sideBSO} onChange={e => setF('sideBSO', e.target.value)} />
                </Grid>
              </Grid>
            </SectionCard>

            {/* Sticky actions */}
            <Paper elevation={3} sx={{
              position: 'sticky', bottom: 0, mt: 2, borderRadius: 2, p: 1.5,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              backdropFilter: 'blur(6px)'
            }}>
              <Typography variant="body2" color={isValid ? 'success.main' : 'warning.main'}>
                {isValid ? 'All required fields complete.' : 'Fill all required fields marked *'}
              </Typography>
              <Stack direction="row" spacing={1}>
                <Button variant="contained" startIcon={<SaveIcon/>} onClick={submit} disabled={!isValid || saving}>
                  Save
                </Button>
                <Button variant="outlined" startIcon={<RotateLeftIcon/>} onClick={() => { setForm(initialForm); setTouched({}) }} disabled={saving}>
                  Clear
                </Button>
              </Stack>
            </Paper>
          </Box>
        )}

        {/* ====== Current tab ====== */}
        {tab === 1 && (
          <Box sx={{ overflow: 'auto', pr: 1 }}>
            <SectionCard
              title="Current NLD Services"
              subtitle="Search by customer, FRG, route, or node"
              right={<Chip label={`${total} total`} size="small" />}
            >
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <TextField
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search…"
                  size="small"
                  InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
                  sx={{ width: 360, maxWidth: '100%' }}
                />
                <Button variant="outlined" onClick={loadList} disabled={loadingList}>Refresh</Button>
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
                      <TableCell align="center">View</TableCell>
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
                        <TableCell align="center">
                          <Tooltip title="Open details">
                            <IconButton size="small" onClick={() => { setDrawerRow(r); setOpenDrawer(true) }}>
                              <VisibilityIcon fontSize="inherit" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!rows.length && (
                      <TableRow>
                        <TableCell colSpan={13} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                          {loadingList ? 'Loading…' : 'No results'}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </Paper>
            </SectionCard>

            {/* details drawer */}
            <Drawer anchor="right" open={openDrawer} onClose={() => setOpenDrawer(false)}>
              <Box sx={{ width: 380, p: 2 }}>
                <Typography variant="h6" sx={{ mb: 1 }}>Service Details</Typography>
                {drawerRow ? (
                  <List dense>
                    {[
                      ['Customer', drawerRow.customer],
                      ['FRG', drawerRow.frg],
                      ['Service Type', drawerRow.serviceType],
                      ['Capacity', drawerRow.capacity],
                      ['NLD Route', drawerRow.nldRoute],
                      ['Deployment', drawerRow.deployment],
                      ['Protection', drawerRow.protection ? 'Yes' : 'No'],
                      ['Pri Path', drawerRow.priPath || '—'],
                      ['Sec Path', drawerRow.secPath || '—'],
                      ['STAG', drawerRow.stag || '—'],
                      ['CTAG', drawerRow.ctag || '—'],
                      ['Side A', drawerRow.sideAName],
                      ['Side A – Handoff', drawerRow.sideAHandoff || '—'],
                      ['A – IC', drawerRow.sideAIC || '—'],
                      ['A – SO', drawerRow.sideASO || '—'],
                      ['Side B', drawerRow.sideBName],
                      ['Side B – Handoff', drawerRow.sideBHandoff || '—'],
                      ['B – IC', drawerRow.sideBIC || '—'],
                      ['B – SO', drawerRow.sideBSO || '—'],
                      ['Created', new Date(drawerRow.createdAt).toLocaleString()],
                    ].map(([k, v]) => (
                      <ListItem key={k} disableGutters sx={{ py: 0.5 }}>
                        <ListItemText
                          primary={<Typography sx={{ fontWeight: 600 }}>{k}</Typography>}
                          secondary={String(v)}
                        />
                      </ListItem>
                    ))}
                  </List>
                ) : (
                  <Typography color="text.secondary">No item selected.</Typography>
                )}
              </Box>
            </Drawer>
          </Box>
        )}
      </Box>

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
