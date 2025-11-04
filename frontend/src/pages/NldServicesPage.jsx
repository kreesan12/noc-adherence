// frontend/src/pages/NldServicesPage.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Tabs, Tab, Stack, TextField, MenuItem, Button, Typography, Grid,
  FormControlLabel, Switch, Autocomplete, Chip, Snackbar, Alert,
  Table, TableHead, TableRow, TableCell, TableBody, IconButton, InputAdornment,
  Tooltip, Drawer, Skeleton, Stepper, Step, StepLabel
} from '@mui/material'
import SearchIcon from '@mui/icons-material/Search'
import SaveIcon from '@mui/icons-material/Save'
import RotateLeftIcon from '@mui/icons-material/RotateLeft'
import EditIcon from '@mui/icons-material/Edit'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import api from '../api'
import { updateNldService } from '../api/nldServices'

/* ---------------- config / options ---------------- */
const SERVICE_TYPES = ['Carrier', 'NLD']
const CAPACITIES = ['1G', '2.5G', '10G', '100G', '400G']
const DEPLOYMENTS = ['OTN', 'EVPN']
const ROUTES = ['CPT <> JHB', 'CPT <> DBN', 'JHB <> DBN', 'CPT <> EL', 'CPT <> PLZ', 'CPT <> BFN', 'BFN <> JHB']
const STEPS = ['Service', 'Paths & Tags', 'Sites']

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

/* Required fields (static baseline; Step 2 is made dynamic below) */
const requiredByStep = {
  0: ['customer', 'frg', 'serviceType', 'capacity', 'nldRoute', 'deployment'],
  1: ['priPath', /* secPath conditional */, 'stag', 'ctag'],
  2: ['sideAName', 'sideBName'],
}

/* ---------------- small helpers ---------------- */
const Card = ({ title, subtitle, children, right, sx }) => (
  <Paper variant="outlined" sx={{ p: 2, ...sx }}>
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

export default function NldServicesPage() {
  const [tab, setTab] = useState(0)

  // wizard state
  const [activeStep, setActiveStep] = useState(0)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)   // {severity, message}
  const [touched, setTouched] = useState({}) // for inline errors

  // dropdown sources
  const [nlds, setNlds] = useState([])
  const [nldLoading, setNldLoading] = useState(true)
  const nldGroups = useMemo(() => {
    const s = new Set()
    for (const sp of nlds) s.add(sp?.nldGroup ?? 'Unassigned')
    return Array.from(s).sort()
  }, [nlds])

  // node autocompletes (async)
  const [nodeOptionsA, setNodeOptionsA] = useState([])
  const [nodeOptionsB, setNodeOptionsB] = useState([])

  // list tab
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loadingList, setLoadingList] = useState(false)

  // details/edit drawer
  const [openDrawer, setOpenDrawer] = useState(false)
  const [edit, setEdit] = useState(null) // editable copy of row

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
  useEffect(() => { if (tab === 1) loadList() }, [tab])

  /* -------- validation helpers ----------- */
  const setF = (key, val) => setForm(prev => ({ ...prev, [key]: val }))
  const markTouched = (keys) =>
    setTouched(prev => ({ ...prev, ...Object.fromEntries([].concat(keys).map(k => [k, true])) }))

  const isEmpty = (v) => !String(v ?? '').trim()

  // dynamic requireds per step (secPath only when protected)
  const requiredForStep = (step) => {
    if (step === 1) {
      return ['priPath', ...(form.protection ? ['secPath'] : []), 'stag', 'ctag']
    }
    return requiredByStep[step] || []
  }

  const stepErrors = useMemo(() => {
    const req = requiredForStep(activeStep)
    const e = {}
    req.forEach(k => { if (isEmpty(form[k])) e[k] = 'Required' })
    return e
  }, [form, activeStep])

  const canNextOrSave = Object.keys(stepErrors).length === 0

  const firstMissingStep = () => {
    for (const s of [0, 1, 2]) {
      const miss = (requiredForStep(s) || []).filter((k) => isEmpty(form[k]))
      if (miss.length) return { step: s, keys: miss }
    }
    return null
  }

  const handleNext = () => {
    if (!canNextOrSave) {
      markTouched(Object.keys(stepErrors))
      return
    }
    setActiveStep(s => Math.min(s + 1, STEPS.length - 1))
  }
  const handleBack = () => setActiveStep(s => Math.max(s - 1, 0))
  const handleReset = () => { setForm(initialForm); setTouched({}); setActiveStep(0) }

  /* -------- submit (create) -------- */
  const submit = async () => {
    const fm = firstMissingStep()
    if (fm) {
      setActiveStep(fm.step)
      markTouched(fm.keys)
      setToast({ severity: 'warning', message: 'Please fill the required fields before saving.' })
      return
    }

    setSaving(true)
    try {
      const payload = { ...form, protection: !!form.protection }
      await api.post('/engineering/nld-services', payload)
      setToast({ severity: 'success', message: 'NLD Service saved' })
      handleReset()
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

        {/* ---- PAGE-SCOPED FIX: force full width + visible labels ---- */}
        <Box
          className="nldsvc"
          sx={{
            flex: 1,
            minHeight: 0,
            '& .MuiFormControl-root': { width: '100%' },
            '& .MuiFormControl-root .MuiInputBase-root': { width: '100%' },
            '& .MuiFormControl-root .MuiOutlinedInput-root .MuiSelect-select': {
              width: '100% !important',
            },
            '& .MuiFormControl-root .MuiInputLabel-root': {
              overflow: 'visible',
              whiteSpace: 'nowrap',
              maxWidth: 'none',
            },
          }}
        >
          {/* ====== Capture tab (Stepper) ====== */}
          {tab === 0 && (
            <Box sx={{ overflow: 'auto', pr: 1, pb: 2 }}>
              <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
                <Stepper activeStep={activeStep} alternativeLabel>
                  {STEPS.map(label => (
                    <Step key={label}>
                      <StepLabel>{label}</StepLabel>
                    </Step>
                  ))}
                </Stepper>
              </Paper>

              {/* STEP 1: Service */}
              {activeStep === 0 && (
                <Card title="Service" subtitle="Top-level attributes">
                  {/* Row 1 */}
                  <Grid container spacing={2} sx={{ mb: 0 }}>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label="CUSTOMER" required fullWidth
                        value={form.customer} onChange={e => setF('customer', e.target.value)}
                        onBlur={() => markTouched(['customer'])}
                        error={!!(touched.customer && isEmpty(form.customer))}
                        helperText={touched.customer && isEmpty(form.customer) ? 'Required' : ' '}
                      />
                    </Grid>
                    <Grid item xs={12} md={6}>
                      <TextField
                        label="FRG" required fullWidth
                        value={form.frg} onChange={e => setF('frg', e.target.value)}
                        onBlur={() => markTouched(['frg'])}
                        error={!!(touched.frg && isEmpty(form.frg))}
                        helperText={touched.frg && isEmpty(form.frg) ? 'Required' : ' '}
                      />
                    </Grid>
                  </Grid>

                  {/* Row 2 */}
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={3}>
                      <TextField
                        label="CAPACITY" select fullWidth
                        value={form.capacity} onChange={e => setF('capacity', e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 220 }}
                      >
                        {CAPACITIES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={3}>
                      <TextField
                        label="SERVICE TYPE" select fullWidth
                        value={form.serviceType} onChange={e => setF('serviceType', e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 220 }}
                      >
                        {SERVICE_TYPES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={3}>
                      <TextField
                        label="DEPLOYMENT" select fullWidth
                        value={form.deployment} onChange={e => setF('deployment', e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 220 }}
                      >
                        {DEPLOYMENTS.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>
                    </Grid>

                    <Grid item xs={12} md={3}>
                      <TextField
                        label="NLD ROUTE" select fullWidth
                        value={form.nldRoute} onChange={e => setF('nldRoute', e.target.value)}
                        InputLabelProps={{ shrink: true }}
                        sx={{ minWidth: 220 }}
                      >
                        {ROUTES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>
                    </Grid>
                  </Grid>
                </Card>
              )}

              {/* STEP 2: Paths & Tags (Protection first; secPath conditional) */}
              {activeStep === 1 && (
                <Card
                  title="Paths & Tags"
                  subtitle="Primary/secondary (free text; secondary required only when protection is ON)"
                  right={<Chip label={form.protection ? 'Protected' : 'Unprotected'} size="small" color={form.protection ? 'success' : 'default'} />}
                >
                  {/* Row 1 */}
                  <Grid container spacing={2} sx={{ mb: 2 }}>
                    {/* Protection first */}
                    <Grid item xs={12} md={3} sx={{ display: 'flex', alignItems: 'center' }}>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={!!form.protection}
                            onChange={(_, v) => {
                              setF('protection', v)
                              if (!v) setF('secPath', '')
                            }}
                          />
                        }
                        label="PROTECTION (Yes/No)"
                      />
                    </Grid>

                    <Grid item xs={12} md={4}>
                      <TextField
                        label="PRI PATH (free text)"
                        required
                        fullWidth
                        value={form.priPath}
                        onChange={e => setF('priPath', e.target.value)}
                        onBlur={() => markTouched(['priPath'])}
                        error={!!(touched.priPath && isEmpty(form.priPath))}
                        helperText={touched.priPath && isEmpty(form.priPath) ? 'Required' : ' '}
                        placeholder="e.g., NLD234 (NLD2+NLD3+NLD4)"
                      />
                    </Grid>

                    <Grid item xs={12} md={5}>
                      <TextField
                        label="SEC PATH (free text)"
                        required={!!form.protection}
                        disabled={!form.protection}
                        fullWidth
                        value={form.secPath}
                        onChange={e => setF('secPath', e.target.value)}
                        onBlur={() => markTouched(['secPath'])}
                        error={!!(form.protection && touched.secPath && isEmpty(form.secPath))}
                        helperText={
                          form.protection && touched.secPath && isEmpty(form.secPath)
                            ? 'Required when protection is ON'
                            : ' '
                        }
                        placeholder="e.g., Alternate combined path"
                      />
                    </Grid>
                  </Grid>

                  {/* Row 2 */}
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={3}>
                      <TextField
                        label="STAG"
                        required
                        fullWidth
                        value={form.stag}
                        onChange={e => setF('stag', e.target.value)}
                        onBlur={() => markTouched(['stag'])}
                        error={!!(touched.stag && isEmpty(form.stag))}
                        helperText={touched.stag && isEmpty(form.stag) ? 'Required' : ' '}
                      />
                    </Grid>
                    <Grid item xs={12} md={3}>
                      <TextField
                        label="CTAG"
                        required
                        fullWidth
                        value={form.ctag}
                        onChange={e => setF('ctag', e.target.value)}
                        onBlur={() => markTouched(['ctag'])}
                        error={!!(touched.ctag && isEmpty(form.ctag))}
                        helperText={touched.ctag && isEmpty(form.ctag) ? 'Required' : ' '}
                      />
                    </Grid>
                  </Grid>
                </Card>
              )}

              {/* STEP 3: Sites */}
              {activeStep === 2 && (
                <Stack spacing={2}>
                  {/* Side A */}
                  <Card title="Side A" subtitle="Site details for A-end">
                    <Grid container spacing={2} sx={{ mb: 0 }}>
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
                              onBlur={() => markTouched(['sideAName'])}
                              error={!!(touched.sideAName && isEmpty(form.sideAName))}
                              helperText={touched.sideAName && isEmpty(form.sideAName) ? 'Required' : ' '}
                              sx={{ minWidth: 320 }}
                            />
                          )}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="SIDE A – Handoff"
                          fullWidth
                          value={form.sideAHandoff}
                          onChange={e => setF('sideAHandoff', e.target.value)}
                          sx={{ minWidth: 320 }}
                        />
                      </Grid>
                    </Grid>

                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <TextField label="SIDE A - IC Number" fullWidth value={form.sideAIC} onChange={e => setF('sideAIC', e.target.value)} />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField label="SIDE A - SO Number" fullWidth value={form.sideASO} onChange={e => setF('sideASO', e.target.value)} />
                      </Grid>
                    </Grid>
                  </Card>

                  {/* Side B */}
                  <Card title="Side B" subtitle="Site details for B-end">
                    <Grid container spacing={2} sx={{ mb: 0 }}>
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
                              onBlur={() => markTouched(['sideBName'])}
                              error={!!(touched.sideBName && isEmpty(form.sideBName))}
                              helperText={touched.sideBName && isEmpty(form.sideBName) ? 'Required' : ' '}
                              sx={{ minWidth: 320 }}
                            />
                          )}
                        />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField
                          label="SIDE B – Handoff"
                          fullWidth
                          value={form.sideBHandoff}
                          onChange={e => setF('sideBHandoff', e.target.value)}
                          sx={{ minWidth: 320 }}
                        />
                      </Grid>
                    </Grid>

                    <Grid container spacing={2}>
                      <Grid item xs={12} md={6}>
                        <TextField label="SIDE B - IC Number" fullWidth value={form.sideBIC} onChange={e => setF('sideBIC', e.target.value)} />
                      </Grid>
                      <Grid item xs={12} md={6}>
                        <TextField label="SIDE B - SO Number" fullWidth value={form.sideBSO} onChange={e => setF('sideBSO', e.target.value)} />
                      </Grid>
                    </Grid>
                  </Card>
                </Stack>
              )}

              {/* Wizard controls */}
              <Paper elevation={3} sx={{
                position: 'sticky', bottom: 0, mt: 2, borderRadius: 2, p: 1.5,
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                backdropFilter: 'blur(6px)'
              }}>
                <Typography variant="body2" color={canNextOrSave || activeStep === STEPS.length - 1 ? 'success.main' : 'warning.main'}>
                  {activeStep < STEPS.length - 1
                    ? (canNextOrSave ? 'Looks good. Continue.' : 'Fill required fields.')
                    : (canNextOrSave ? 'Ready to save.' : 'Fill required fields.')}
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Button variant="outlined" startIcon={<RotateLeftIcon/>} onClick={handleReset} disabled={saving}>
                    Clear
                  </Button>
                  {activeStep > 0 && (
                    <Button variant="outlined" startIcon={<ArrowBackIcon/>} onClick={handleBack}>
                      Back
                    </Button>
                  )}
                  {activeStep < STEPS.length - 1 ? (
                    <Button variant="contained" endIcon={<ArrowForwardIcon/>} onClick={handleNext} disabled={!canNextOrSave}>
                      Next
                    </Button>
                  ) : (
                    <Button variant="contained" startIcon={<SaveIcon/>} onClick={submit} disabled={!canNextOrSave || saving}>
                      Save
                    </Button>
                  )}
                </Stack>
              </Paper>
            </Box>
          )}

          {/* ====== Current tab ====== */}
          {tab === 1 && (
            <Box sx={{ overflow: 'auto', pr: 1 }}>
              <Card title="Current NLD Services" subtitle="Search by customer, FRG, route, or node" right={<Chip label={`${total} total`} size="small" />}>
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
                        <TableCell align="center">Edit</TableCell>
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
                            <Tooltip title="Edit">
                              <IconButton size="small" onClick={() => { setEdit({ ...r }); setOpenDrawer(true) }}>
                                <EditIcon fontSize="inherit" />
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
              </Card>

              {/* EDIT drawer */}
              <Drawer anchor="right" open={openDrawer} onClose={() => setOpenDrawer(false)}>
                <Box sx={{ width: 420, p: 2 }}>
                  <Typography variant="h6" sx={{ mb: 1 }}>Edit NLD Service</Typography>

                  {edit ? (
                    <Stack spacing={1.5}>
                      <TextField label="Customer" value={edit.customer || ''} onChange={e => setEdit({ ...edit, customer: e.target.value })} />
                      <TextField label="FRG" value={edit.frg || ''} onChange={e => setEdit({ ...edit, frg: e.target.value })} />

                      <TextField label="Service Type" select value={edit.serviceType || ''} onChange={e => setEdit({ ...edit, serviceType: e.target.value })}>
                        {SERVICE_TYPES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>

                      <TextField label="Capacity" select value={edit.capacity || ''} onChange={e => setEdit({ ...edit, capacity: e.target.value })}>
                        {CAPACITIES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>

                      <TextField label="NLD Route" select value={edit.nldRoute || ''} onChange={e => setEdit({ ...edit, nldRoute: e.target.value })}>
                        {ROUTES.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>

                      <TextField label="Deployment" select value={edit.deployment || ''} onChange={e => setEdit({ ...edit, deployment: e.target.value })}>
                        {DEPLOYMENTS.map(v => <MenuItem key={v} value={v}>{v}</MenuItem>)}
                      </TextField>

                      <FormControlLabel
                        control={<Switch checked={!!edit.protection} onChange={(_, v) => setEdit({ ...edit, protection: v, secPath: v ? (edit.secPath || '') : '' })} />}
                        label="Protection"
                      />

                      <TextField label="Primary Path" value={edit.priPath || ''} onChange={e => setEdit({ ...edit, priPath: e.target.value })} />
                      <TextField
                        label="Secondary Path"
                        value={edit.secPath || ''}
                        onChange={e => setEdit({ ...edit, secPath: e.target.value })}
                        disabled={!edit.protection}
                      />

                      <TextField label="STAG" value={edit.stag || ''} onChange={e => setEdit({ ...edit, stag: e.target.value })} />
                      <TextField label="CTAG" value={edit.ctag || ''} onChange={e => setEdit({ ...edit, ctag: e.target.value })} />

                      <TextField label="Side A (node)" value={edit.sideAName || ''} onChange={e => setEdit({ ...edit, sideAName: e.target.value })} />
                      <TextField label="Side A – Handoff" value={edit.sideAHandoff || ''} onChange={e => setEdit({ ...edit, sideAHandoff: e.target.value })} />
                      <TextField label="Side A – IC" value={edit.sideAIC || ''} onChange={e => setEdit({ ...edit, sideAIC: e.target.value })} />
                      <TextField label="Side A – SO" value={edit.sideASO || ''} onChange={e => setEdit({ ...edit, sideASO: e.target.value })} />

                      <TextField label="Side B (node)" value={edit.sideBName || ''} onChange={e => setEdit({ ...edit, sideBName: e.target.value })} />
                      <TextField label="Side B – Handoff" value={edit.sideBHandoff || ''} onChange={e => setEdit({ ...edit, sideBHandoff: e.target.value })} />
                      <TextField label="Side B – IC" value={edit.sideBIC || ''} onChange={e => setEdit({ ...edit, sideBIC: e.target.value })} />
                      <TextField label="Side B – SO" value={edit.sideBSO || ''} onChange={e => setEdit({ ...edit, sideBSO: e.target.value })} />

                      <Stack direction="row" spacing={1} sx={{ pt: 1 }}>
                        <Button variant="outlined" onClick={() => setOpenDrawer(false)}>Cancel</Button>
                        <Button
                          variant="contained"
                          startIcon={<SaveIcon />}
                          onClick={async () => {
                            try {
                              const payload = { ...edit, protection: !!edit.protection }
                              await updateNldService(edit.id, payload)
                              // reflect changes in table
                              setRows(prev => prev.map(r => (r.id === edit.id ? { ...r, ...payload, updatedAt: new Date().toISOString() } : r)))
                              setToast({ severity: 'success', message: 'Updated.' })
                              setOpenDrawer(false)
                            } catch (e) {
                              const msg = e?.response?.data?.error || e.message || 'Failed to update'
                              setToast({ severity: 'error', message: msg })
                            }
                          }}
                        >
                          Save
                        </Button>
                      </Stack>
                    </Stack>
                  ) : (
                    <Skeleton height={240} />
                  )}
                </Box>
              </Drawer>
            </Box>
          )}
        </Box>
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
