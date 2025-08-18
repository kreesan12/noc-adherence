// frontend/src/pages/CircuitEditorPage.jsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Stack, Button, Typography, Snackbar, Alert, Tooltip
} from '@mui/material'
import { DataGrid, GridToolbarContainer, GridToolbarExport } from '@mui/x-data-grid'
import api from '../api'

/**
 * Assumptions (adjust if your API differs):
 *  GET    /circuits           -> [{ id, circuitId, nodeA, nodeB, techType, nldGroup, currentRxSiteA, currentRxSiteB, nodeALat, nodeALon, nodeBLat, nodeBLon }]
 *  POST   /circuits           -> body = row without id; returns created row (with id)
 *  PUT    /circuits/:id       -> body = full updated row; returns updated row
 *  (Optional) DELETE /circuits/:id
 *
 * If your backend uses snake_case, map at the request boundary (see toApi / fromApi).
 */

/* ---------- utils ---------- */
const toNumberOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : NaN
}

const within = (n, min, max) => n >= min && n <= max

const validateRow = (row, existingCircuitIds) => {
  const errors = {}

  // Required text
  if (!row.circuitId?.trim()) errors.circuitId = 'Circuit ID is required'
  if (!row.nodeA?.trim())     errors.nodeA     = 'Node A name is required'
  if (!row.nodeB?.trim())     errors.nodeB     = 'Node B name is required'

  // Uniqueness (ignore this row’s own ID)
  if (row.circuitId) {
    const clash = existingCircuitIds
      .filter(x => x.id !== row.id)
      .some(x => x.circuitId.toLowerCase() === row.circuitId.toLowerCase())
    if (clash) errors.circuitId = 'Circuit ID must be unique'
  }

  // Coordinates (nullable, but if present must be valid)
  const checks = [
    ['nodeALat', -90, 90, 'Node A lat must be between -90 and 90'],
    ['nodeALon', -180, 180, 'Node A lon must be between -180 and 180'],
    ['nodeBLat', -90, 90, 'Node B lat must be between -90 and 90'],
    ['nodeBLon', -180, 180, 'Node B lon must be between -180 and 180'],
  ]
  for (const [field, min, max, msg] of checks) {
    const v = row[field]
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (!Number.isFinite(n) || !within(n, min, max)) errors[field] = msg
  }

  // Numbers (currentRx are optional numbers)
  for (const f of ['currentRxSiteA', 'currentRxSiteB']) {
    const v = row[f]
    if (v === null || v === undefined || v === '') continue
    if (!Number.isFinite(Number(v))) errors[f] = 'Must be a number'
  }

  return errors
}

// Map API <-> UI (camel <-> snake if needed). Adjust to match your backend.
const fromApi = (r) => ({
  id: r.id,
  circuitId: r.circuit_id ?? r.circuitId,
  nodeA: r.node_a ?? r.nodeA,
  nodeB: r.node_b ?? r.nodeB,
  techType: r.tech_type ?? r.techType ?? '',
  nldGroup: r.nld_group ?? r.nldGroup ?? '',
  currentRxSiteA: r.current_rx_site_a ?? r.currentRxSiteA ?? null,
  currentRxSiteB: r.current_rx_site_b ?? r.currentRxSiteB ?? null,
  nodeALat: r.node_a_lat ?? r.nodeALat ?? null,
  nodeALon: r.node_a_lon ?? r.nodeALon ?? null,
  nodeBLat: r.node_b_lat ?? r.nodeBLat ?? null,
  nodeBLon: r.node_b_lon ?? r.nodeBLon ?? null,
})

const toApi = (r) => ({
  id: r.id,
  circuit_id: r.circuitId,
  node_a: r.nodeA,
  node_b: r.nodeB,
  tech_type: r.techType ?? '',
  nld_group: r.nldGroup ?? '',
  current_rx_site_a: r.currentRxSiteA ?? null,
  current_rx_site_b: r.currentRxSiteB ?? null,
  node_a_lat: r.nodeALat ?? null,
  node_a_lon: r.nodeALon ?? null,
  node_b_lat: r.nodeBLat ?? null,
  node_b_lon: r.nodeBLon ?? null,
})

/* ---------- toolbar ---------- */
function CircuitsToolbar({ onAdd }) {
  return (
    <GridToolbarContainer>
      <Stack direction="row" spacing={1} sx={{ p: 1 }}>
        <Tooltip title="Add a new circuit row">
          <Button variant="contained" onClick={onAdd}>Add Circuit</Button>
        </Tooltip>
        <GridToolbarExport />
      </Stack>
    </GridToolbarContainer>
  )
}

/* ---------- page ---------- */
export default function CircuitEditorPage() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [snack, setSnack] = useState({ open: false, severity: 'success', msg: '' })
  const tempIdRef = useRef(-1) // for unsaved rows

  const fetchRows = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('engineering/circuits')
      const data = Array.isArray(res.data) ? res.data.map(fromApi) : []
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

  /* ----- add row ----- */
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
        _isNew: true,
      },
      ...prev,
    ]))
  }

  /* ----- processRowUpdate: validate + save to API ----- */
  const processRowUpdate = async (newRow, oldRow) => {
    // Coerce numeric text inputs before validation
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
      // Throwing returns control to the grid and keeps edit mode
      const msg = Object.values(errors)[0]
      throw new Error(msg)
    }

    // Save
    try {
      if (normalized._isNew || normalized.id < 0) {
        const res = await api.post('engineering/circuits', toApi(normalized))
        const created = fromApi(res.data)
        setSnack({ open: true, severity: 'success', msg: `Created ${created.circuitId}` })
        return created
      }
      // Update existing
      const res = await api.put(`engineering/circuits/${normalized.id}`, toApi(normalized))
      const updated = fromApi(res.data)
      setSnack({ open: true, severity: 'success', msg: `Updated ${updated.circuitId}` })
      return updated
    } catch (e) {
      console.error(e)
      throw new Error(e?.response?.data?.error || 'Save failed')
    }
  }

  const handleProcessError = (err) => {
    setSnack({ open: true, severity: 'error', msg: err?.message || 'Validation/Save error' })
  }

  const columns = [
    {
      field: 'circuitId',
      headerName: 'Circuit ID',
      minWidth: 200,
      flex: 1,
      editable: true,
    },
    {
      field: 'nodeA',
      headerName: 'Node A',
      minWidth: 160,
      flex: 0.8,
      editable: true,
    },
    {
      field: 'nodeB',
      headerName: 'Node B',
      minWidth: 160,
      flex: 0.8,
      editable: true,
    },
    {
      field: 'techType',
      headerName: 'Tech Type',
      minWidth: 130,
      flex: 0.6,
      editable: true,
    },
    {
      field: 'nldGroup',
      headerName: 'NLD Group',
      minWidth: 120,
      flex: 0.5,
      editable: true,
    },
    {
      field: 'currentRxSiteA',
      headerName: 'Rx A (dBm)',
      type: 'number',
      minWidth: 120,
      editable: true,
      valueParser: toNumberOrNull,
    },
    {
      field: 'currentRxSiteB',
      headerName: 'Rx B (dBm)',
      type: 'number',
      minWidth: 120,
      editable: true,
      valueParser: toNumberOrNull,
    },
    {
      field: 'nodeALat',
      headerName: 'Node A Lat',
      type: 'number',
      minWidth: 130,
      editable: true,
      valueParser: toNumberOrNull,
    },
    {
      field: 'nodeALon',
      headerName: 'Node A Lon',
      type: 'number',
      minWidth: 130,
      editable: true,
      valueParser: toNumberOrNull,
    },
    {
      field: 'nodeBLat',
      headerName: 'Node B Lat',
      type: 'number',
      minWidth: 130,
      editable: true,
      valueParser: toNumberOrNull,
    },
    {
      field: 'nodeBLon',
      headerName: 'Node B Lon',
      type: 'number',
      minWidth: 130,
      editable: true,
      valueParser: toNumberOrNull,
    },
  ]

  return (
    <Box sx={{ p: 2, height: 'calc(100vh - 64px)' }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Circuit Data Cleanup
      </Typography>
      <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary' }}>
        Edit circuit names/IDs and add coordinates. New rows can be added. Values are validated on save.
      </Typography>

      <Paper sx={{ height: '100%', p: 1 }}>
        <DataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          disableRowSelectionOnClick
          processRowUpdate={processRowUpdate}
          onProcessRowUpdateError={handleProcessError}
          editMode="row"
          experimentalFeatures={{ newEditingApi: true }}
          slots={{ toolbar: CircuitsToolbar }}
          slotProps={{ toolbar: { onAdd: handleAdd } }}
          initialState={{
            pagination: { paginationModel: { pageSize: 25, page: 0 } },
            columns: { columnVisibilityModel: {} },
          }}
          pageSizeOptions={[10, 25, 50, 100]}
        />
      </Paper>

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
