import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Drawer,
  InputAdornment,
  Snackbar,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import KeyboardDoubleArrowDownRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowDownRounded'
import KeyboardDoubleArrowUpRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowUpRounded'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import RouteRoundedIcon from '@mui/icons-material/RouteRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import ExploreRoundedIcon from '@mui/icons-material/ExploreRounded'
import SettingsEthernetRoundedIcon from '@mui/icons-material/SettingsEthernetRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import { DataGrid, GridActionsCellItem } from '@mui/x-data-grid'
import api from '../api'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

const toNumberOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

const within = (n, min, max) => n >= min && n <= max

const isFiniteCoordinate = (value) => Number.isFinite(Number(value))

const formatCoordinate = (value) => {
  if (!isFiniteCoordinate(value)) return 'Not set'
  return Number(value).toFixed(6)
}

const validateRow = (row, circuitIndex) => {
  const errors = {}
  if (!row.circuitId?.trim()) errors.circuitId = 'Circuit ID is required'
  if (!row.nodeA?.trim()) errors.nodeA = 'Node A name is required'
  if (!row.nodeB?.trim()) errors.nodeB = 'Node B name is required'

  if (row.circuitId) {
    const clash = circuitIndex
      .filter((item) => item.id !== row.id)
      .some((item) => (item.circuitId ?? '').toLowerCase() === row.circuitId.toLowerCase())
    if (clash) errors.circuitId = 'Circuit ID must be unique'
  }

  const coordChecks = [
    ['nodeALat', -90, 90, 'Node A lat must be between -90 and 90'],
    ['nodeALon', -180, 180, 'Node A lon must be between -180 and 180'],
    ['nodeBLat', -90, 90, 'Node B lat must be between -90 and 90'],
    ['nodeBLon', -180, 180, 'Node B lon must be between -180 and 180']
  ]

  coordChecks.forEach(([field, min, max, message]) => {
    const value = row[field]
    if (value === null || value === undefined || value === '') return
    const numberValue = Number(value)
    if (!Number.isFinite(numberValue) || !within(numberValue, min, max)) errors[field] = message
  })

  ;['currentRxSiteA', 'currentRxSiteB'].forEach((field) => {
    const value = row[field]
    if (value === null || value === undefined || value === '') return
    if (!Number.isFinite(Number(value))) errors[field] = 'Must be a number'
  })

  return errors
}

function matchesSearch(row, term) {
  if (!term) return true
  const haystacks = [
    row.circuitId, row.nodeA, row.nodeB, row.techType, row.nldGroup,
    row.irisGraphAId, row.irisGraphBId,
    row.irisGraphALabel, row.irisGraphBLabel,
    row.irisGraphADevice, row.irisGraphBDevice
  ]
  return haystacks.some((value) => String(value ?? '').toLowerCase().includes(term))
}

const irisMappingFields = [
  'irisGraphAId', 'irisGraphALabel', 'irisGraphADevice',
  'irisGraphBId', 'irisGraphBLabel', 'irisGraphBDevice'
]

const blankIrisMapping = {
  irisGraphAId: '',
  irisGraphALabel: '',
  irisGraphADevice: '',
  irisGraphBId: '',
  irisGraphBLabel: '',
  irisGraphBDevice: ''
}

const normaliseIrisMapping = (mapping) => Object.fromEntries(
  irisMappingFields.map((field) => [field, String(mapping[field] ?? '').trim() || null])
)

export default function CircuitEditorPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState({})
  const [snack, setSnack] = useState({ open: false, severity: 'success', msg: '' })
  const [mappingDrawer, setMappingDrawer] = useState({ open: false, row: null, values: blankIrisMapping })
  const tempIdRef = useRef(-1)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('engineering/circuits')
      const data = Array.isArray(res.data) ? res.data : []
      setRows(data)
    } catch (error) {
      console.error(error)
      setSnack({ open: true, severity: 'error', msg: 'Failed to load circuits' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchRows()
  }, [fetchRows])

  const circuitIndex = useMemo(
    () => rows.map(({ id, circuitId }) => ({ id, circuitId: circuitId ?? '' })),
    [rows]
  )

  const groupedRows = useMemo(() => {
    const groups = new Map()

    rows.forEach((row) => {
      const key = String(row.nldGroup || '').trim() || 'Unassigned'
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    })

    return Array.from(groups.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, items]) => ({
        group,
        items: [...items].sort((a, b) => String(a.circuitId || '').localeCompare(String(b.circuitId || '')))
      }))
  }, [rows])

  const searchTerm = search.trim().toLowerCase()

  const visibleGroups = useMemo(() => {
    return groupedRows
      .map(({ group, items }) => ({
        group,
        items: items.filter((row) => matchesSearch(row, searchTerm))
      }))
      .filter(({ items }) => items.length)
  }, [groupedRows, searchTerm])

  useEffect(() => {
    setExpandedGroups((prev) => {
      const next = { ...prev }
      let changed = false
      groupedRows.forEach(({ group }) => {
        if (!(group in next)) {
          next[group] = true
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [groupedRows])

  const handleAdd = () => {
    const id = tempIdRef.current--
    setRows((prev) => ([
      {
        id,
        circuitId: '',
        nodeA: '',
        nodeB: '',
        techType: '',
        nldGroup: '',
        currentRxSiteA: null,
        currentRxSiteB: null,
        nodeALat: null,
        nodeALon: null,
        nodeBLat: null,
        nodeBLon: null,
        ...blankIrisMapping,
        _isNew: true
      },
      ...prev
    ]))
    setSnack({ open: true, severity: 'info', msg: 'New draft row added at the top of the list' })
  }

  const diffPayload = (oldRow, newRow) => {
    const allowed = new Set([
      'nldGroup',
      'nodeALat', 'nodeALon', 'nodeBLat', 'nodeBLon',
      'currentRxSiteA', 'currentRxSiteB',
      'circuitId', 'nodeA', 'nodeB', 'techType',
      ...irisMappingFields
    ])
    const payload = {}
    Object.keys(newRow).forEach((key) => {
      if (!allowed.has(key)) return
      const oldValue = oldRow[key]
      const newValue = newRow[key]
      const normalize = (value) => (value === '' ? null : value)
      if (JSON.stringify(normalize(oldValue)) !== JSON.stringify(normalize(newValue))) {
        payload[key] = newValue
      }
    })
    return payload
  }

  const processRowUpdate = async (newRow, oldRow) => {
    const normalized = {
      ...newRow,
      currentRxSiteA: toNumberOrNull(newRow.currentRxSiteA),
      currentRxSiteB: toNumberOrNull(newRow.currentRxSiteB),
      nodeALat: toNumberOrNull(newRow.nodeALat),
      nodeALon: toNumberOrNull(newRow.nodeALon),
      nodeBLat: toNumberOrNull(newRow.nodeBLat),
      nodeBLon: toNumberOrNull(newRow.nodeBLon)
    }

    const errors = validateRow(normalized, circuitIndex)
    if (Object.keys(errors).length) throw new Error(Object.values(errors)[0])

    try {
      if (normalized._isNew || normalized.id < 0) {
        const payload = { ...normalized }
        delete payload._isNew
        const res = await api.post('engineering/circuits', payload)
        const created = res.data
        setRows((prev) => [created, ...prev.filter((row) => row.id !== normalized.id)])
        setSnack({ open: true, severity: 'success', msg: `Created ${created.circuitId}` })
        return created
      }

      const payload = diffPayload(oldRow, normalized)
      if (Object.keys(payload).length === 0) return normalized

      const res = await api.patch(`engineering/circuit/${normalized.id}`, payload)
      const updated = res.data
      setRows((prev) => prev.map((row) => (row.id === updated.id ? { ...row, ...updated } : row)))
      setSnack({ open: true, severity: 'success', msg: `Updated ${updated.circuitId}` })
      return { ...normalized, ...updated }
    } catch (error) {
      console.error(error)
      const message = error?.response?.data?.error || error?.message || 'Save failed'
      throw new Error(message)
    }
  }

  const handleProcessError = (error) => {
    setSnack({ open: true, severity: 'error', msg: error?.message || 'Validation or save error' })
  }

  const openMappingDrawer = (row) => {
    setMappingDrawer({
      open: true,
      row,
      values: Object.fromEntries(irisMappingFields.map((field) => [field, row[field] ?? '']))
    })
  }

  const closeMappingDrawer = () => {
    setMappingDrawer({ open: false, row: null, values: blankIrisMapping })
  }

  const updateMappingValue = (field, value) => {
    setMappingDrawer((state) => ({ ...state, values: { ...state.values, [field]: value } }))
  }

  const saveMapping = async () => {
    const row = mappingDrawer.row
    if (!row) return

    const mapping = normaliseIrisMapping(mappingDrawer.values)
    try {
      if (row._isNew || row.id < 0) {
        setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, ...mapping } : item)))
        setSnack({ open: true, severity: 'success', msg: 'IRIS mapping added to the new circuit draft' })
      } else {
        const { data: updated } = await api.patch(`engineering/circuit/${row.id}`, mapping)
        setRows((prev) => prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)))
        setSnack({ open: true, severity: 'success', msg: `Updated IRIS mapping for ${updated.circuitId}` })
      }
      closeMappingDrawer()
    } catch (error) {
      console.error(error)
      setSnack({
        open: true,
        severity: 'error',
        msg: error?.response?.data?.error || 'Could not save the IRIS mapping'
      })
    }
  }

  const columns = [
    { field: 'circuitId', headerName: 'Circuit ID', minWidth: 200, flex: 1, editable: true },
    {
      field: 'nodeA',
      headerName: 'Node A + coordinates',
      minWidth: 235,
      flex: 0.9,
      editable: true,
      renderCell: (params) => (
        <Box sx={{ minWidth: 0, py: 0.45, lineHeight: 1.18 }}>
          <Typography variant="body2" noWrap fontWeight={700}>{params.value || 'Not set'}</Typography>
          <Typography variant="caption" noWrap color="text.secondary">
            Lat {formatCoordinate(params.row.nodeALat)} · Lon {formatCoordinate(params.row.nodeALon)}
          </Typography>
        </Box>
      )
    },
    {
      field: 'nodeB',
      headerName: 'Node B + coordinates',
      minWidth: 235,
      flex: 0.9,
      editable: true,
      renderCell: (params) => (
        <Box sx={{ minWidth: 0, py: 0.45, lineHeight: 1.18 }}>
          <Typography variant="body2" noWrap fontWeight={700}>{params.value || 'Not set'}</Typography>
          <Typography variant="caption" noWrap color="text.secondary">
            Lat {formatCoordinate(params.row.nodeBLat)} · Lon {formatCoordinate(params.row.nodeBLon)}
          </Typography>
        </Box>
      )
    },
    { field: 'techType', headerName: 'Tech Type', minWidth: 125, flex: 0.55, editable: true },
    { field: 'nldGroup', headerName: 'NLD Group', minWidth: 118, flex: 0.5, editable: true },
    { field: 'nodeALat', headerName: 'Node A Lat', type: 'number', minWidth: 128, editable: true, valueParser: toNumberOrNull },
    { field: 'nodeALon', headerName: 'Node A Lon', type: 'number', minWidth: 128, editable: true, valueParser: toNumberOrNull },
    { field: 'nodeBLat', headerName: 'Node B Lat', type: 'number', minWidth: 128, editable: true, valueParser: toNumberOrNull },
    { field: 'nodeBLon', headerName: 'Node B Lon', type: 'number', minWidth: 128, editable: true, valueParser: toNumberOrNull },
    {
      field: 'irisMapping',
      type: 'actions',
      headerName: 'IRIS Mapping',
      minWidth: 128,
      getActions: ({ row }) => [
        <GridActionsCellItem
          key="iris-mapping"
          icon={<SettingsEthernetRoundedIcon />}
          label="Edit IRIS graph mapping"
          onClick={() => openMappingDrawer(row)}
          showInMenu={false}
        />
      ]
    }
  ]

  const metrics = useMemo(() => {
    const mapped = rows.filter((row) => (
      isFiniteCoordinate(row.nodeALat) &&
      isFiniteCoordinate(row.nodeALon) &&
      isFiniteCoordinate(row.nodeBLat) &&
      isFiniteCoordinate(row.nodeBLon)
    )).length
    const drafts = rows.filter((row) => row._isNew || row.id < 0).length
    const unassigned = groupedRows.find((entry) => entry.group === 'Unassigned')?.items.length ?? 0

    return [
      { label: 'Circuits', value: rows.length, helper: 'Total editable records', accent: '#0f766e' },
      { label: 'Groups', value: groupedRows.length, helper: `${visibleGroups.length} visible under current filter`, accent: '#2563eb' },
      { label: 'Mapped', value: mapped, helper: 'Circuits with both end coordinates', accent: '#ea580c' },
      { label: 'Unassigned', value: unassigned, helper: drafts ? `${drafts} draft rows waiting` : 'No draft rows right now', accent: '#7c3aed' }
    ]
  }, [groupedRows, rows, visibleGroups])

  const toggleGroup = (group) => {
    setExpandedGroups((prev) => ({ ...prev, [group]: !(prev[group] ?? true) }))
  }

  const setAllExpanded = (expanded) => {
    const next = {}
    groupedRows.forEach(({ group }) => {
      next[group] = expanded
    })
    setExpandedGroups(next)
  }

  return (
    <PageShell
      eyebrow="Engineering"
      title="Circuit Data Cleanup"
      description="Maintain circuit labels, grouping, coordinates, and IRIS graph mappings from one focused admin surface."
      accent="#2563eb"
      actions={(
        <FilterStrip>
          <TextField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search circuit, node, tech, or NLD group"
            sx={{ minWidth: { xs: '100%', md: 280 } }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchRoundedIcon sx={{ color: 'text.secondary' }} fontSize="small" />
                </InputAdornment>
              )
            }}
          />
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={handleAdd}>
            Add Circuit
          </Button>
          <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={fetchRows}>
            Refresh
          </Button>
          <Button variant="text" startIcon={<KeyboardDoubleArrowDownRoundedIcon />} onClick={() => setAllExpanded(true)}>
            Expand All
          </Button>
          <Button variant="text" startIcon={<KeyboardDoubleArrowUpRoundedIcon />} onClick={() => setAllExpanded(false)}>
            Collapse All
          </Button>
        </FilterStrip>
      )}
      stats={metrics}
    >
      <SectionCard
        title="Grouped Circuit Inventory"
        subtitle="Circuits are split by NLD group. Edit inline and save by completing the row edit. Search narrows the visible groups without touching the source data."
        accent="#2563eb"
      >
        <Stack spacing={1}>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} alignItems={{ xs: 'flex-start', md: 'center' }}>
            <Chip icon={<RouteRoundedIcon />} label={`${visibleGroups.reduce((sum, group) => sum + group.items.length, 0)} visible circuits`} />
            <Chip icon={<HubRoundedIcon />} label={`${visibleGroups.length} visible groups`} variant="outlined" />
            <Chip icon={<ExploreRoundedIcon />} label={searchTerm ? `Filtered by "${search}"` : 'No active search filter'} variant="outlined" />
          </Stack>

          {!visibleGroups.length && loading ? (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 1.5 }}>
              Loading circuits...
            </Typography>
          ) : null}

          {!visibleGroups.length && !loading ? (
            <Alert severity="info">No circuits matched the current search.</Alert>
          ) : null}

          {visibleGroups.map(({ group, items }) => {
            const expanded = expandedGroups[group] ?? true
            return (
              <Accordion key={group} expanded={expanded} onChange={() => toggleGroup(group)} disableGutters sx={{ borderRadius: 2, overflow: 'hidden' }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                      {group}
                    </Typography>
                    <Chip size="small" label={items.length} />
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      {items.filter((row) => isFiniteCoordinate(row.nodeALat) && isFiniteCoordinate(row.nodeALon) && isFiniteCoordinate(row.nodeBLat) && isFiniteCoordinate(row.nodeBLon)).length} mapped
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0.25, px: 0.8, pb: 0.8 }}>
                  <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
                    <DataGrid
                      rows={items}
                      columns={columns}
                      autoHeight
                      loading={loading}
                      disableRowSelectionOnClick
                      processRowUpdate={processRowUpdate}
                      onProcessRowUpdateError={handleProcessError}
                      editMode="row"
                      initialState={{
                        pagination: { paginationModel: { pageSize: 12, page: 0 } }
                      }}
                      pageSizeOptions={[12, 24, 50]}
                      rowHeight={48}
                      sx={{
                        border: 0,
                        '& .MuiDataGrid-columnHeaders': { borderRadius: 0 },
                        '& .MuiDataGrid-cell': { alignItems: 'center' }
                      }}
                    />
                  </Box>
                </AccordionDetails>
              </Accordion>
            )
          })}
        </Stack>
      </SectionCard>

      <Drawer
        anchor="right"
        open={mappingDrawer.open}
        onClose={closeMappingDrawer}
        PaperProps={{ sx: { width: { xs: '100%', sm: 620 } } }}
      >
        <Stack spacing={2.25} sx={{ p: { xs: 2, sm: 3 }, height: '100%', overflowY: 'auto' }}>
          <Box>
            <Typography variant="overline" color="primary" fontWeight={800}>
              IRIS DAILY INGEST
            </Typography>
            <Typography variant="h6" fontWeight={800}>
              IRIS graph mapping
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {mappingDrawer.row?._isNew
                ? 'These details will be saved when the new circuit is created.'
                : `Maintain the saved IRIS source details for ${mappingDrawer.row?.circuitId || 'this circuit'}.`}
            </Typography>
          </Box>

          <Alert severity="info">
            The 05:00 SAST IRIS ingest uses the graph IDs. Labels and devices are retained to make each side easy to verify and audit.
          </Alert>

          <Box>
            <Typography variant="subtitle1" fontWeight={800} mb={1}>Side A</Typography>
            <Stack spacing={1.5}>
              <TextField
                label="IRIS graph ID"
                value={mappingDrawer.values.irisGraphAId}
                onChange={(event) => updateMappingValue('irisGraphAId', event.target.value)}
                placeholder="e.g. 1192507488005239"
                fullWidth
              />
              <TextField
                label="IRIS graph label / mnemonic"
                value={mappingDrawer.values.irisGraphALabel}
                onChange={(event) => updateMappingValue('irisGraphALabel', event.target.value)}
                fullWidth
                multiline
                minRows={2}
              />
              <TextField
                label="IRIS device"
                value={mappingDrawer.values.irisGraphADevice}
                onChange={(event) => updateMappingValue('irisGraphADevice', event.target.value)}
                fullWidth
              />
            </Stack>
          </Box>

          <Divider />

          <Box>
            <Typography variant="subtitle1" fontWeight={800} mb={1}>Side B</Typography>
            <Stack spacing={1.5}>
              <TextField
                label="IRIS graph ID"
                value={mappingDrawer.values.irisGraphBId}
                onChange={(event) => updateMappingValue('irisGraphBId', event.target.value)}
                placeholder="e.g. 1192508448005239"
                fullWidth
              />
              <TextField
                label="IRIS graph label / mnemonic"
                value={mappingDrawer.values.irisGraphBLabel}
                onChange={(event) => updateMappingValue('irisGraphBLabel', event.target.value)}
                fullWidth
                multiline
                minRows={2}
              />
              <TextField
                label="IRIS device"
                value={mappingDrawer.values.irisGraphBDevice}
                onChange={(event) => updateMappingValue('irisGraphBDevice', event.target.value)}
                fullWidth
              />
            </Stack>
          </Box>

          <Box sx={{ flexGrow: 1 }} />
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button onClick={closeMappingDrawer}>Cancel</Button>
            <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={saveMapping}>
              Save IRIS Mapping
            </Button>
          </Stack>
        </Stack>
      </Drawer>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack((state) => ({ ...state, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack((state) => ({ ...state, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </PageShell>
  )
}
