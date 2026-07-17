// frontend/src/pages/CircuitEditorPage.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Stack, Button, Typography, Snackbar, Alert, Tooltip,
  Accordion, AccordionSummary, AccordionDetails, Chip
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { DataGrid } from '@mui/x-data-grid'
import api from '../api'

const toNumberOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}
const within = (n, min, max) => n >= min && n <= max

const validateRow = (row, circuitIndex) => {
  const errors = {}
  if (!row.circuitId?.trim()) errors.circuitId = 'Circuit ID is required'
  if (!row.nodeA?.trim())     errors.nodeA     = 'Node A name is required'
  if (!row.nodeB?.trim())     errors.nodeB     = 'Node B name is required'

  if (row.circuitId) {
    const clash = circuitIndex
      .filter(x => x.id !== row.id)
      .some(x => (x.circuitId ?? '').toLowerCase() === row.circuitId.toLowerCase())
    if (clash) errors.circuitId = 'Circuit ID must be unique'
  }

  const coordChecks = [
    ['nodeALat', -90, 90, 'Node A lat must be between -90 and 90'],
    ['nodeALon', -180, 180, 'Node A lon must be between -180 and 180'],
    ['nodeBLat', -90, 90, 'Node B lat must be between -90 and 90'],
    ['nodeBLon', -180, 180, 'Node B lon must be between -180 and 180'],
  ]
  for (const [field, min, max, msg] of coordChecks) {
    const v = row[field]
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (!Number.isFinite(n) || !within(n, min, max)) errors[field] = msg
  }

  for (const f of ['currentRxSiteA', 'currentRxSiteB']) {
    const v = row[f]
    if (v === null || v === undefined || v === '') continue
    if (!Number.isFinite(Number(v))) errors[f] = 'Must be a number'
  }
  return errors
}

export default function CircuitEditorPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [snack, setSnack] = useState({ open: false, severity: 'success', msg: '' })
  const tempIdRef = useRef(-1)

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('engineering/circuits')
      const data = Array.isArray(res.data) ? res.data : []
      setRows(data)
    } catch (e) {
      console.error(e)
      setSnack({ open: true, severity: 'error', msg: 'Failed to load circuits' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchRows() }, [fetchRows])

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

  const handleAdd = () => {
    const id = tempIdRef.current--
    setRows(prev => ([
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
        _isNew: true,
      },
      ...prev,
    ]))
  }

  // build a PATCH payload containing only fields that changed (and allowed on the server)
  const diffPayload = (oldRow, newRow) => {
    const allowed = new Set([
      'nldGroup',
      'nodeALat', 'nodeALon', 'nodeBLat', 'nodeBLon',
      'currentRxSiteA', 'currentRxSiteB',
      'circuitId', 'nodeA', 'nodeB', 'techType'
    ])
    const payload = {}
    for (const k of Object.keys(newRow)) {
      if (!allowed.has(k)) continue
      const ov = oldRow[k]
      const nv = newRow[k]
      // treat '' and null as equal for optional numeric fields
      const norm = (v) => (v === '' ? null : v)
      if (JSON.stringify(norm(ov)) !== JSON.stringify(norm(nv))) {
        payload[k] = nv
      }
    }
    return payload
  }

  const processRowUpdate = async (newRow, oldRow) => {
    // normalize numeric fields before validation
    const normalized = {
      ...newRow,
      currentRxSiteA: toNumberOrNull(newRow.currentRxSiteA),
      currentRxSiteB: toNumberOrNull(newRow.currentRxSiteB),
      nodeALat: toNumberOrNull(newRow.nodeALat),
      nodeALon: toNumberOrNull(newRow.nodeALon),
      nodeBLat: toNumberOrNull(newRow.nodeBLat),
      nodeBLon: toNumberOrNull(newRow.nodeBLon),
    }

    const errors = validateRow(normalized, circuitIndex)
    if (Object.keys(errors).length) {
      throw new Error(Object.values(errors)[0])
    }

    try {
      // CREATE
      if (normalized._isNew || normalized.id < 0) {
        const payload = { ...normalized }
        delete payload._isNew
        const res = await api.post('engineering/circuits', payload)
        const created = res.data
        setRows(prev => [created, ...prev.filter(r => r.id !== normalized.id)])
        setSnack({ open: true, severity: 'success', msg: `Created ${created.circuitId}` })
        return created
      }

      // UPDATE (PATCH only changed fields)
      const payload = diffPayload(oldRow, normalized)
      if (Object.keys(payload).length === 0) {
        return normalized // nothing to send
      }
      const res = await api.patch(`engineering/circuit/${normalized.id}`, payload)
      const updated = res.data
      setRows(prev => prev.map(r => (r.id === updated.id ? { ...r, ...updated } : r)))
      setSnack({ open: true, severity: 'success', msg: `Updated ${updated.circuitId}` })
      return { ...normalized, ...updated }
    } catch (e) {
      console.error(e)
      const msg = e?.response?.data?.error || e?.message || 'Save failed'
      throw new Error(msg)
    }
  }

  const handleProcessError = (err) => {
    setSnack({ open: true, severity: 'error', msg: err?.message || 'Validation/Save error' })
  }

  const columns = [
    { field: 'circuitId', headerName: 'Circuit ID', minWidth: 200, flex: 1, editable: true },
    { field: 'nodeA', headerName: 'Node A', minWidth: 160, flex: 0.8, editable: true },
    { field: 'nodeB', headerName: 'Node B', minWidth: 160, flex: 0.8, editable: true },
    { field: 'techType', headerName: 'Tech Type', minWidth: 130, flex: 0.6, editable: true },
    { field: 'nldGroup', headerName: 'NLD Group', minWidth: 120, flex: 0.5, editable: true },
    { field: 'nodeALat', headerName: 'Node A Lat', type: 'number', minWidth: 130, editable: true, valueParser: toNumberOrNull },
    { field: 'nodeALon', headerName: 'Node A Lon', type: 'number', minWidth: 130, editable: true, valueParser: toNumberOrNull },
    { field: 'nodeBLat', headerName: 'Node B Lat', type: 'number', minWidth: 130, editable: true, valueParser: toNumberOrNull },
    { field: 'nodeBLon', headerName: 'Node B Lon', type: 'number', minWidth: 130, editable: true, valueParser: toNumberOrNull },
  ]

  return (
    <Box sx={{ p: 1.5, height: 'calc(100vh - 56px)', overflow: 'auto' }}>
      <Typography variant="h6" sx={{ mb: 0.75, fontWeight: 800 }}>Circuit Data Cleanup</Typography>
      <Typography variant="body2" sx={{ mb: 1.25, color: 'text.secondary' }}>
        Edit circuit names, IDs, grouping, and coordinates. Circuits are grouped by NLD for easier review.
      </Typography>

      <Paper sx={{ p: 1.25, mb: 1.25 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <Tooltip title="Add a new circuit row">
            <Button variant="contained" onClick={handleAdd}>Add Circuit</Button>
          </Tooltip>
          <Typography variant="body2" color="text.secondary">
            {rows.length} circuits across {groupedRows.length} NLD group{groupedRows.length === 1 ? '' : 's'}
          </Typography>
        </Stack>
      </Paper>

      {!groupedRows.length && loading && (
        <Paper sx={{ p: 1.75, mb: 1.25 }}>
          <Typography color="text.secondary">Loading circuits...</Typography>
        </Paper>
      )}

      {!groupedRows.length && !loading && (
        <Paper sx={{ p: 1.75 }}>
          <Typography color="text.secondary">No circuits found.</Typography>
        </Paper>
      )}

      {groupedRows.map(({ group, items }) => (
        <Accordion key={group} defaultExpanded disableGutters sx={{ mb: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{group}</Typography>
              <Chip size="small" label={items.length} />
            </Stack>
          </AccordionSummary>
          <AccordionDetails sx={{ pt: 0 }}>
            <Paper variant="outlined" sx={{ p: 0.75 }}>
              <DataGrid
                rows={items}
                columns={columns}
                autoHeight
                loading={loading}
                disableRowSelectionOnClick
                processRowUpdate={processRowUpdate}
                onProcessRowUpdateError={handleProcessError}
                editMode="row"
                experimentalFeatures={{ newEditingApi: true }}
                initialState={{
                  pagination: { paginationModel: { pageSize: 10, page: 0 } },
                }}
                pageSizeOptions={[10, 25, 50]}
              />
            </Paper>
          </AccordionDetails>
        </Accordion>
      ))}

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.msg}
        </Alert>
      </Snackbar>
    </Box>
  )
}
