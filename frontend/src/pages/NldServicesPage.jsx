// frontend/src/pages/NldServicesPage.jsx
import { Fragment, useEffect, useMemo, useState } from 'react'
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
const SERVICE_TYPES = ['Carrier path specific', 'NLD']
const CAPACITIES = ['1G', '2.5G', '10G', '100G', '400G']
const DEPLOYMENTS = ['OTN', 'EVPN']
const ROUTES = ['CPT <> JHB', 'CPT <> DBN', 'JHB <> DBN', 'CPT <> EL', 'CPT <> PLZ', 'CPT <> BFN', 'BFN <> JHB']
const STEPS = ['Service', 'Paths & Tags', 'Sites']

const initialForm = {
  customer: '',
  frg: '',
  serviceType: '',
  capacity: '',
  nldRoute: '',
  deployment: '',
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

const initialColumnFilters = {
  customer: '',
  frg: '',
  serviceType: '',
  capacity: '',
  nldRoute: '',
  deployment: '',
  priPath: '',
  sideAName: '',
  sideBName: '',
  createdAt: '',
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

const fmtDbm = (value) => {
  if (value == null || value === '' || Number.isNaN(Number(value))) return 'N/A'
  return `${Number(value).toFixed(1)} dBm`
}

const fmtDateTime = (value) => {
  if (!value) return 'N/A'
  return new Date(value).toLocaleString()
}

const priorityChipColor = (value) => {
  const v = String(value || '').toLowerCase()
  if (v === 'high') return 'error'
  if (v === 'normal') return 'warning'
  return 'default'
}

const statusChipColor = (value) => {
  const v = String(value || '').toUpperCase()
  if (v === 'OPEN') return 'success'
  return 'default'
}

export default function NldServicesPage() {
  const [tab, setTab] = useState(0)

  // wizard state
  const [activeStep, setActiveStep] = useState(0)
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState(null)   // {severity, message}
  const [touched, setTouched] = useState({}) // for inline errors

  // node autocompletes (async)
  const [nodeOptionsA, setNodeOptionsA] = useState([])
  const [nodeOptionsB, setNodeOptionsB] = useState([])

  // list tab
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loadingList, setLoadingList] = useState(false)
  const [columnFilters, setColumnFilters] = useState(initialColumnFilters)
  const [expandedCustomers, setExpandedCustomers] = useState({})

  // blank RX monitor
  const [blankRxSearch, setBlankRxSearch] = useState('')
  const [blankRxRows, setBlankRxRows] = useState([])
  const [blankRxTotal, setBlankRxTotal] = useState(0)
  const [blankRxLoading, setBlankRxLoading] = useState(false)

  // ticket staging
  const [ticketSearch, setTicketSearch] = useState('')
  const [ticketPriority, setTicketPriority] = useState('')
  const [ticketStatus, setTicketStatus] = useState('')
  const [ticketRows, setTicketRows] = useState([])
  const [ticketTotal, setTicketTotal] = useState(0)
  const [ticketLoading, setTicketLoading] = useState(false)
  const [ticketSyncing, setTicketSyncing] = useState(false)
  const [ticketDrawer, setTicketDrawer] = useState(null)

  // details/edit drawer
  const [openDrawer, setOpenDrawer] = useState(false)
  const [edit, setEdit] = useState(null) // editable copy of row

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
      setAppliedSearch(search)
    } catch (e) { console.error(e) } finally { setLoadingList(false) }
  }
  useEffect(() => { if (tab === 0) loadList() }, [tab])

  const loadBlankRx = async () => {
    setBlankRxLoading(true)
    try {
      const r = await api.get('/engineering/blank-rx-issues', {
        params: { q: blankRxSearch, take: 200 }
      })
      setBlankRxRows(r.data?.items ?? [])
      setBlankRxTotal(r.data?.total ?? 0)
    } catch (e) {
      console.error(e)
      setToast({ severity: 'error', message: e?.response?.data?.error || 'Failed to load blank RX issues' })
    } finally {
      setBlankRxLoading(false)
    }
  }

  const loadTickets = async () => {
    setTicketLoading(true)
    try {
      const r = await api.get('/engineering/staged-zendesk-tickets', {
        params: {
          q: ticketSearch,
          priority: ticketPriority,
          status: ticketStatus,
          take: 200
        }
      })
      setTicketRows(r.data?.items ?? [])
      setTicketTotal(r.data?.total ?? 0)
    } catch (e) {
      console.error(e)
      setToast({ severity: 'error', message: e?.response?.data?.error || 'Failed to load staged tickets' })
    } finally {
      setTicketLoading(false)
    }
  }

  const syncTickets = async (quiet = false) => {
    setTicketSyncing(true)
    try {
      const r = await api.post('/engineering/staged-zendesk-tickets/sync')
      await loadTickets()
      if (!quiet) {
        const s = r.data || {}
        setToast({
          severity: 'success',
          message: `Ticket staging synced: ${s.created || 0} created, ${s.escalated || 0} escalated, ${s.updated || 0} updated`
        })
      }
    } catch (e) {
      console.error(e)
      setToast({ severity: 'error', message: e?.response?.data?.error || 'Failed to sync staged tickets' })
    } finally {
      setTicketSyncing(false)
    }
  }

  useEffect(() => {
    if (tab === 2) loadBlankRx()
    if (tab === 3) loadTickets()
  }, [tab])

  const setColumnFilter = (key, value) => {
    setColumnFilters(prev => ({ ...prev, [key]: value }))
  }

  const clearColumnFilters = () => setColumnFilters(initialColumnFilters)

  const filteredRows = useMemo(() => {
    const activeFilters = Object.entries(columnFilters)
      .filter(([, value]) => String(value ?? '').trim())

    if (!activeFilters.length) return rows

    return rows.filter((row) => {
      return activeFilters.every(([key, value]) => {
        const needle = String(value ?? '').trim().toLowerCase()
        const haystack = key === 'createdAt'
          ? new Date(row.createdAt).toLocaleString()
          : row[key]

        return String(haystack ?? '').toLowerCase().includes(needle)
      })
    })
  }, [rows, columnFilters])

  const customerGroups = useMemo(() => {
    const groups = new Map()

    filteredRows.forEach((row) => {
      const customer = row.customer || 'Unknown customer'
      if (!groups.has(customer)) groups.set(customer, [])
      groups.get(customer).push(row)
    })

    return Array.from(groups.entries()).map(([customer, items]) => ({ customer, items }))
  }, [filteredRows])

  const forceExpandGroups = Boolean(appliedSearch.trim()) || Object.values(columnFilters).some(v => String(v ?? '').trim())

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
    <Box
      sx={{
        display: 'flex',
        height: { xs: '100dvh', md: 'calc(100dvh - 48px)' },
        minHeight: 0,
        overflow: 'hidden'
      }}
    >
      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <Paper elevation={0} sx={{ mb: 1, p: 0 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)}>
            <Tab label={`Current (${total})`} />
            <Tab label="Capture New" />
            <Tab label={`Blank RX (${blankRxTotal})`} />
            <Tab label={`Ticket Staging (${ticketTotal})`} />
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
          {tab === 1 && (
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
          {tab === 0 && (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
              <Card
                title="Current NLD Services"
                subtitle="Search by customer, FRG, route, node, or Pri path"
                right={<Chip label={`${filteredRows.length}${filteredRows.length !== total ? ` / ${total}` : ''} total`} size="small" />}
                sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                  sx={{ mb: 1, flexShrink: 0 }}
                >
                  <TextField
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') loadList()
                    }}
                    placeholder="Search customer, FRG, route, node, or Pri..."
                    size="small"
                    InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
                    sx={{ width: { xs: '100%', sm: 380 }, maxWidth: '100%' }}
                  />
                  <Button variant="outlined" onClick={loadList} disabled={loadingList}>Refresh</Button>
                </Stack>

                <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <Table
                    size="small"
                    stickyHeader
                    sx={{
                      '& .MuiTableCell-root': {
                        py: 0.75,
                        px: 1,
                        whiteSpace: 'nowrap'
                      }
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Customer</TableCell>
                        <TableCell>FRG</TableCell>
                        <TableCell>Service</TableCell>
                        <TableCell>Capacity</TableCell>
                        <TableCell>Route</TableCell>
                        <TableCell>Deploy</TableCell>
                        <TableCell>Pri</TableCell>
                        <TableCell>Side A</TableCell>
                        <TableCell>Side B</TableCell>
                        <TableCell>Created</TableCell>
                        <TableCell align="center">Edit</TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.customer} onChange={e => setColumnFilter('customer', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.frg} onChange={e => setColumnFilter('frg', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.serviceType} onChange={e => setColumnFilter('serviceType', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.capacity} onChange={e => setColumnFilter('capacity', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.nldRoute} onChange={e => setColumnFilter('nldRoute', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.deployment} onChange={e => setColumnFilter('deployment', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.priPath} onChange={e => setColumnFilter('priPath', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.sideAName} onChange={e => setColumnFilter('sideAName', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.sideBName} onChange={e => setColumnFilter('sideBName', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell>
                          <TextField size="small" variant="standard" value={columnFilters.createdAt} onChange={e => setColumnFilter('createdAt', e.target.value)} placeholder="Filter" />
                        </TableCell>
                        <TableCell align="center">
                          <Button size="small" onClick={clearColumnFilters}>Clear</Button>
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {customerGroups.map(({ customer, items }) => {
                        const expanded = forceExpandGroups || !!expandedCustomers[customer]

                        return (
                          <Fragment key={customer}>
                            <TableRow hover sx={{ bgcolor: 'action.hover' }}>
                              <TableCell colSpan={11} sx={{ py: 1 }}>
                                <Stack direction="row" alignItems="center" spacing={1}>
                                  <IconButton
                                    size="small"
                                    onClick={() => setExpandedCustomers(prev => ({ ...prev, [customer]: !prev[customer] }))}
                                    disabled={forceExpandGroups}
                                  >
                                    {expanded ? '-' : '+'}
                                  </IconButton>
                                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                    {customer}
                                  </Typography>
                                  <Chip size="small" label={`${items.length} service${items.length === 1 ? '' : 's'}`} />
                                </Stack>
                              </TableCell>
                            </TableRow>

                            {expanded && items.map(r => (
                              <TableRow key={r.id} hover>
                                <TableCell>{r.customer}</TableCell>
                                <TableCell>{r.frg}</TableCell>
                                <TableCell>{r.serviceType}</TableCell>
                                <TableCell>{r.capacity}</TableCell>
                                <TableCell>{r.nldRoute}</TableCell>
                                <TableCell>{r.deployment}</TableCell>
                                <TableCell>{r.priPath || '-'}</TableCell>
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
                          </Fragment>
                        )
                      })}
                      {!customerGroups.length && (
                        <TableRow>
                          <TableCell colSpan={11} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                            {loadingList ? 'Loading...' : 'No results'}
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

          {/* ====== Blank RX tab ====== */}
          {tab === 2 && (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
              <Card
                title="Blank RX Monitor"
                subtitle="Daily ingested rows where RX was blank, including unresolved rows that still need circuit cleanup."
                right={<Chip label={`${blankRxRows.length}${blankRxRows.length !== blankRxTotal ? ` / ${blankRxTotal}` : ''} rows`} size="small" />}
                sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
              >
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                  sx={{ mb: 1, flexShrink: 0 }}
                >
                  <TextField
                    value={blankRxSearch}
                    onChange={e => setBlankRxSearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') loadBlankRx()
                    }}
                    placeholder="Search circuit, NLD group, parsed code, router, or mnemonic..."
                    size="small"
                    InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
                    sx={{ width: { xs: '100%', sm: 460 }, maxWidth: '100%' }}
                  />
                  <Button variant="outlined" onClick={loadBlankRx} disabled={blankRxLoading}>
                    {blankRxLoading ? 'Loading...' : 'Refresh'}
                  </Button>
                </Stack>

                <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <Table
                    size="small"
                    stickyHeader
                    sx={{
                      '& .MuiTableCell-root': {
                        py: 0.75,
                        px: 1,
                        whiteSpace: 'nowrap',
                        verticalAlign: 'top'
                      }
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Sample Time</TableCell>
                        <TableCell>Circuit ID</TableCell>
                        <TableCell>NLD Group</TableCell>
                        <TableCell>Path</TableCell>
                        <TableCell>Side</TableCell>
                        <TableCell>Parsed Code</TableCell>
                        <TableCell>Raw RX</TableCell>
                        <TableCell>Router</TableCell>
                        <TableCell>Mnemonic</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {blankRxRows.map((row) => (
                        <TableRow key={row.id} hover>
                          <TableCell>{fmtDateTime(row.sampleTime)}</TableCell>
                          <TableCell>{row.circuit?.circuitId || row.parsedCode || 'Unresolved'}</TableCell>
                          <TableCell>{row.circuit?.nldGroup || 'Unresolved'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'normal', minWidth: 240 }}>
                            {row.circuit ? `${row.circuit.nodeA} -> ${row.circuit.nodeB}` : 'Awaiting circuit match'}
                          </TableCell>
                          <TableCell>{row.side || 'UNKNOWN'}</TableCell>
                          <TableCell>{row.parsedCode || 'N/A'}</TableCell>
                          <TableCell>{row.rawRx == null || row.rawRx === '' ? 'Blank' : row.rawRx}</TableCell>
                          <TableCell sx={{ whiteSpace: 'normal', minWidth: 200 }}>{row.routerName || 'N/A'}</TableCell>
                          <TableCell sx={{ whiteSpace: 'normal', minWidth: 260 }}>{row.mnemonic || 'N/A'}</TableCell>
                        </TableRow>
                      ))}
                      {!blankRxRows.length && (
                        <TableRow>
                          <TableCell colSpan={9} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                            {blankRxLoading ? 'Loading...' : 'No blank RX issues found'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Paper>
              </Card>
            </Box>
          )}

          {/* ====== Ticket staging tab ====== */}
          {tab === 3 && (
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
              <Card
                title="Zendesk Ticket Staging"
                subtitle="Preview drift-based ticket payloads before we wire in the real Zendesk API."
                right={
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip label={`${ticketRows.length}${ticketRows.length !== ticketTotal ? ` / ${ticketTotal}` : ''} tickets`} size="small" />
                    <Button variant="contained" size="small" onClick={() => syncTickets(false)} disabled={ticketSyncing}>
                      {ticketSyncing ? 'Syncing...' : 'Sync Now'}
                    </Button>
                  </Stack>
                }
                sx={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}
              >
                <Stack
                  direction={{ xs: 'column', lg: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', lg: 'center' }}
                  sx={{ mb: 1, flexShrink: 0 }}
                >
                  <TextField
                    value={ticketSearch}
                    onChange={e => setTicketSearch(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') loadTickets()
                    }}
                    placeholder="Search reference, circuit, NLD group, subject, or nodes..."
                    size="small"
                    InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment> }}
                    sx={{ width: { xs: '100%', lg: 420 }, maxWidth: '100%' }}
                  />
                  <TextField
                    select
                    size="small"
                    label="Priority"
                    value={ticketPriority}
                    onChange={e => setTicketPriority(e.target.value)}
                    sx={{ width: { xs: '100%', sm: 160 } }}
                  >
                    <MenuItem value="">All priorities</MenuItem>
                    <MenuItem value="normal">Normal</MenuItem>
                    <MenuItem value="high">High</MenuItem>
                  </TextField>
                  <TextField
                    select
                    size="small"
                    label="Status"
                    value={ticketStatus}
                    onChange={e => setTicketStatus(e.target.value)}
                    sx={{ width: { xs: '100%', sm: 160 } }}
                  >
                    <MenuItem value="">All statuses</MenuItem>
                    <MenuItem value="OPEN">OPEN</MenuItem>
                  </TextField>
                  <Button variant="outlined" onClick={loadTickets} disabled={ticketLoading || ticketSyncing}>
                    {ticketLoading ? 'Loading...' : 'Refresh'}
                  </Button>
                </Stack>

                <Paper variant="outlined" sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                  <Table
                    size="small"
                    stickyHeader
                    sx={{
                      '& .MuiTableCell-root': {
                        py: 0.75,
                        px: 1,
                        whiteSpace: 'nowrap',
                        verticalAlign: 'top'
                      }
                    }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Reference</TableCell>
                        <TableCell>Circuit ID</TableCell>
                        <TableCell>NLD Group</TableCell>
                        <TableCell>Side</TableCell>
                        <TableCell>Priority</TableCell>
                        <TableCell>Status</TableCell>
                        <TableCell>Delta</TableCell>
                        <TableCell>Initial</TableCell>
                        <TableCell>Latest</TableCell>
                        <TableCell>Created</TableCell>
                        <TableCell>Updated</TableCell>
                        <TableCell>Tags</TableCell>
                        <TableCell align="center">View</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ticketRows.map((row) => (
                        <TableRow key={row.id} hover>
                          <TableCell>{row.reference}</TableCell>
                          <TableCell>{row.circuit?.circuitId || 'Unknown'}</TableCell>
                          <TableCell>{row.circuit?.nldGroup || 'Unassigned'}</TableCell>
                          <TableCell>{row.breachSide || 'N/A'}</TableCell>
                          <TableCell>
                            <Chip size="small" color={priorityChipColor(row.priority)} label={String(row.priority || 'unknown').toUpperCase()} />
                          </TableCell>
                          <TableCell>
                            <Chip size="small" color={statusChipColor(row.status)} label={String(row.status || 'unknown').toUpperCase()} />
                          </TableCell>
                          <TableCell>{row.deltaLightLevel == null ? 'N/A' : `${Number(row.deltaLightLevel).toFixed(1)} dBm worse`}</TableCell>
                          <TableCell>{fmtDbm(row.initialLightLevel)}</TableCell>
                          <TableCell>{fmtDbm(row.latestLightLevel)}</TableCell>
                          <TableCell>{fmtDateTime(row.dateCreated)}</TableCell>
                          <TableCell>{fmtDateTime(row.updatedAt)}</TableCell>
                          <TableCell sx={{ whiteSpace: 'normal', minWidth: 180 }}>
                            <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                              {(row.tags || []).length
                                ? row.tags.map((tag) => <Chip key={tag} size="small" variant="outlined" label={tag} />)
                                : <Typography variant="caption" color="text.secondary">No tags</Typography>}
                            </Stack>
                          </TableCell>
                          <TableCell align="center">
                            <Button size="small" onClick={() => setTicketDrawer(row)}>
                              View
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                      {!ticketRows.length && (
                        <TableRow>
                          <TableCell colSpan={13} align="center" sx={{ py: 4, color: 'text.secondary' }}>
                            {ticketLoading || ticketSyncing ? 'Loading...' : 'No staged tickets found'}
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </Paper>
              </Card>
            </Box>
          )}
        </Box>
      </Box>

      <Drawer anchor="right" open={!!ticketDrawer} onClose={() => setTicketDrawer(null)}>
        <Box sx={{ width: { xs: 360, sm: 520 }, p: 2 }}>
          <Typography variant="h6" sx={{ mb: 0.5 }}>Staged Ticket Detail</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Review the payload and comment history before real Zendesk API creation.
          </Typography>

          {ticketDrawer ? (
            <Stack spacing={2}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
                    <Chip label={ticketDrawer.reference} size="small" />
                    <Chip size="small" color={priorityChipColor(ticketDrawer.priority)} label={String(ticketDrawer.priority || 'unknown').toUpperCase()} />
                    <Chip size="small" color={statusChipColor(ticketDrawer.status)} label={String(ticketDrawer.status || 'unknown').toUpperCase()} />
                    <Chip size="small" variant="outlined" label={`Group: ${ticketDrawer.groupName || 'NOC Tier3'}`} />
                    <Chip size="small" variant="outlined" label={`Type: ${ticketDrawer.ticketType || 'task'}`} />
                  </Stack>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {ticketDrawer.subject}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Circuit:</strong> {ticketDrawer.circuit?.circuitId || 'Unknown'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>NLD Group:</strong> {ticketDrawer.circuit?.nldGroup || 'Unassigned'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Path:</strong> {ticketDrawer.circuit ? `${ticketDrawer.circuit.nodeA} -> ${ticketDrawer.circuit.nodeB}` : 'N/A'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Breached side:</strong> {ticketDrawer.breachSide || 'N/A'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Initial light level:</strong> {fmtDbm(ticketDrawer.initialLightLevel)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Latest light level:</strong> {fmtDbm(ticketDrawer.latestLightLevel)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Delta light level:</strong> {ticketDrawer.deltaLightLevel == null ? 'N/A' : `${Number(ticketDrawer.deltaLightLevel).toFixed(1)} dBm worse`}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Date created:</strong> {fmtDateTime(ticketDrawer.dateCreated)}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Last evaluated:</strong> {fmtDateTime(ticketDrawer.lastEvaluatedAt)}
                  </Typography>
                  <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                    {(ticketDrawer.tags || []).map((tag) => (
                      <Chip key={tag} size="small" variant="outlined" label={tag} />
                    ))}
                  </Stack>
                </Stack>
              </Paper>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 700 }}>
                  Latest Public Comment
                </Typography>
                <Paper variant="outlined" sx={{ p: 1.5, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 13 }}>
                  {ticketDrawer.latestCommentBody || 'No comment body saved yet.'}
                </Paper>
              </Box>

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75, fontWeight: 700 }}>
                  Comment History
                </Typography>
                <Stack spacing={1}>
                  {(ticketDrawer.comments || []).length ? ticketDrawer.comments.map((comment) => (
                    <Paper key={comment.id} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap" sx={{ mb: 0.75 }}>
                        <Chip size="small" label={comment.eventKind || 'comment'} />
                        <Chip size="small" variant="outlined" label={comment.isPublic ? 'Public' : 'Private'} />
                        <Typography variant="caption" color="text.secondary">
                          {fmtDateTime(comment.createdAt)}
                        </Typography>
                      </Stack>
                      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                        {comment.body}
                      </Typography>
                    </Paper>
                  )) : (
                    <Paper variant="outlined" sx={{ p: 1.5 }}>
                      <Typography variant="body2" color="text.secondary">
                        No comments stored yet.
                      </Typography>
                    </Paper>
                  )}
                </Stack>
              </Box>
            </Stack>
          ) : (
            <Skeleton height={320} />
          )}
        </Box>
      </Drawer>

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

