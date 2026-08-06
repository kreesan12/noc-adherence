import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded'
import PlaylistAddCheckRoundedIcon from '@mui/icons-material/PlaylistAddCheckRounded'
import dayjs from 'dayjs'
import api from '../api'
import { supervisorApproveOvertime, updateOvertimeEntry } from '../api/overtime'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

export default function OvertimeSupervisorPage() {
  const [period, setPeriod] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadCurrentPeriod() {
    setError('')
    const response = await api.get('/overtime/period/current')
    setPeriod(response.data)
  }

  async function loadEntries(periodId) {
    setLoading(true)
    setError('')
    try {
      const response = await api.get(`/overtime/period/${periodId}/supervisor`)
      setRows(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      const message =
        err?.response?.status === 403
          ? '403 Forbidden. Your login role is not allowed to access supervisor overtime endpoints.'
          : err?.response?.data?.error || err?.message || 'Failed to load overtime entries'
      setError(message)
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  async function generateFixed() {
    if (!period) return
    setLoading(true)
    setError('')
    setNotice('')
    try {
      await api.post(`/overtime/period/${period.id}/generate-fixed`)
      await loadEntries(period.id)
      setNotice('Fixed overtime lines generated successfully')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to generate fixed overtime')
    } finally {
      setLoading(false)
    }
  }

  async function approve(id) {
    if (!period) return
    setError('')
    setNotice('')
    try {
      await supervisorApproveOvertime(id)
      await loadEntries(period.id)
      setNotice('Entry approved and sent forward')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to approve entry')
    }
  }

  async function editRow(newRow, oldRow) {
    if (!period) return oldRow

    setError('')
    try {
      await updateOvertimeEntry(newRow.id, {
        totalHours: Number(newRow.totalHours),
        rate: Number(newRow.rate),
        reason: newRow.reason ?? null,
        notes: newRow.notes ?? null,
        editReason: 'Supervisor adjustment'
      })
      setNotice('Entry updated')
      return newRow
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save edits')
      return oldRow
    }
  }

  useEffect(() => {
    loadCurrentPeriod().catch((err) => {
      setError(err?.response?.data?.error || err?.message || 'Failed to load current period')
    })
  }, [])

  useEffect(() => {
    if (period?.id) loadEntries(period.id)
  }, [period?.id])

  const columns = useMemo(
    () => [
      {
        field: 'agentName',
        headerName: 'Agent',
        flex: 1,
        minWidth: 180,
        valueGetter: (_value, row) => row?.agent?.fullName || 'Unknown'
      },
      {
        field: 'supervisorName',
        headerName: 'Supervisor',
        flex: 1,
        minWidth: 170,
        valueGetter: (_value, row) => row?.supervisor?.fullName || 'Unassigned'
      },
      {
        field: 'source',
        headerName: 'Source',
        width: 120,
        renderCell: (params) => <Chip size="small" label={params.value} />
      },
      { field: 'status', headerName: 'Status', width: 180 },
      {
        field: 'workDate',
        headerName: 'Date',
        width: 120,
        valueGetter: (_value, row) => (row?.workDate ? dayjs(row.workDate).format('YYYY-MM-DD') : '')
      },
      {
        field: 'day',
        headerName: 'Day',
        width: 90,
        valueGetter: (_value, row) => (row?.workDate ? dayjs(row.workDate).format('ddd') : '')
      },
      {
        field: 'startAt',
        headerName: 'Start',
        width: 100,
        valueGetter: (_value, row) => (row?.startAt ? dayjs(row.startAt).format('HH:mm') : '')
      },
      {
        field: 'endAt',
        headerName: 'End',
        width: 100,
        valueGetter: (_value, row) => (row?.endAt ? dayjs(row.endAt).format('HH:mm') : '')
      },
      { field: 'totalHours', headerName: 'Hours', width: 100, editable: true, type: 'number' },
      { field: 'rate', headerName: 'Rate', width: 90, editable: true, type: 'number' },
      { field: 'reason', headerName: 'Reason', flex: 1, minWidth: 160, editable: true },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 150,
        sortable: false,
        renderCell: (params) => (
          <Button
            size="small"
            variant="outlined"
            onClick={() => approve(params.row.id)}
            disabled={params.row.status !== 'SUBMITTED'}
          >
            Approve
          </Button>
        )
      }
    ],
    []
  )

  const totals = useMemo(() => {
    const byPerson = new Map()

    for (const row of rows || []) {
      const name = row?.agent?.fullName || 'Unknown'
      const current = byPerson.get(name) || { hours: 0, payUnits: 0, fixed: 0, manual: 0 }
      const hours = Number(row?.totalHours || 0)
      const rate = Number(row?.rate || 0)

      current.hours += hours
      current.payUnits += hours * rate
      if (row?.source === 'FIXED') current.fixed += 1
      if (row?.source === 'MANUAL') current.manual += 1

      byPerson.set(name, current)
    }

    return [...byPerson.entries()]
  }, [rows])

  const summary = useMemo(() => {
    const submitted = rows.filter((row) => row.status === 'SUBMITTED').length
    const totalHours = rows.reduce((sum, row) => sum + Number(row.totalHours || 0), 0)
    const manual = rows.filter((row) => row.source === 'MANUAL').length
    const fixed = rows.filter((row) => row.source === 'FIXED').length

    return {
      submitted,
      totalHours: totalHours.toFixed(1),
      manual,
      fixed
    }
  }, [rows])

  return (
    <PageShell
      eyebrow="Staffing and Scheduling"
      title="Overtime Supervisor Review"
      description="Generate the fixed lines, fine-tune entries that need adjustments, and pass the approved set forward to managers with a clean queue."
      accent="#d97706"
      actions={
        <Stack direction="row" spacing={0.7} flexWrap="wrap">
          <Button
            variant="outlined"
            startIcon={<AutorenewRoundedIcon />}
            onClick={() => period?.id && loadEntries(period.id)}
            disabled={!period || loading}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<PlaylistAddCheckRoundedIcon />}
            onClick={generateFixed}
            disabled={!period || loading}
          >
            Generate Fixed
          </Button>
        </Stack>
      }
      stats={[
        {
          label: 'Awaiting Approval',
          value: summary.submitted,
          helper: 'Rows still in submitted state',
          accent: '#d97706'
        },
        {
          label: 'Hours Loaded',
          value: summary.totalHours,
          helper: 'Current queue overtime hours',
          accent: '#2563eb'
        },
        {
          label: 'Manual Lines',
          value: summary.manual,
          helper: 'Captured manually by staff',
          accent: '#7c3aed'
        },
        {
          label: 'Fixed Lines',
          value: summary.fixed,
          helper: 'Generated from standard rules',
          accent: '#0f766e'
        }
      ]}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

      <SectionCard
        title="Supervisor Queue"
        subtitle="Inline edits keep the queue moving quickly. Any change is still visible to the manager downstream."
        accent="#d97706"
        noPadding
      >
        <Box sx={{ p: 1 }}>
          <FilterStrip>
            <Chip
              label={period ? `Period ${period.label}` : 'No active period'}
              color="warning"
              variant="outlined"
            />
            {period ? (
              <Chip
                label={`${dayjs(period.startDate).format('YYYY-MM-DD')} to ${dayjs(period.endDate).format('YYYY-MM-DD')}`}
              />
            ) : null}
            <Chip label={`${rows.length} entries`} />
          </FilterStrip>
        </Box>

        <Box sx={{ px: 0.6, pb: 0.6 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            getRowId={(row) => row.id}
            processRowUpdate={editRow}
            onProcessRowUpdateError={console.error}
            autoHeight
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 25, page: 0 } }
            }}
          />
        </Box>
      </SectionCard>

      <SectionCard
        title="Totals by Person"
        subtitle="Quick rollup of hours, pay units, and source mix before you send the period onward."
        accent="#d97706"
      >
        <Stack spacing={0.5}>
          {totals.length ? (
            totals.map(([name, value]) => (
              <Typography key={name} variant="body2">
                {name}: {value.hours.toFixed(2)} hours, {value.payUnits.toFixed(2)} pay units, {value.fixed} fixed lines, {value.manual} manual lines
              </Typography>
            ))
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              No overtime rows loaded for the current period.
            </Typography>
          )}
        </Stack>
      </SectionCard>
    </PageShell>
  )
}
