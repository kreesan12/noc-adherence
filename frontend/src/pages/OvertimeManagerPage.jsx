import { useEffect, useMemo, useState } from 'react'
import { Alert, Box, Button, Chip, Stack } from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded'
import dayjs from '../lib/dayjs.js'
import api from '../api'
import { exportOvertimePeriod, managerApproveOvertime } from '../api/overtime'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

export default function OvertimeManagerPage() {
  const [period, setPeriod] = useState(null)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  async function loadCurrentPeriod() {
    const response = await api.get('/overtime/period/current')
    setPeriod(response.data)
  }

  async function loadQueue(periodId) {
    setLoading(true)
    setError('')
    try {
      const response = await api.get(`/overtime/period/${periodId}/manager`)
      setRows(Array.isArray(response.data) ? response.data : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load manager approval queue')
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  async function approve(id) {
    if (!period) return

    setBusy(true)
    setError('')
    setNotice('')
    try {
      await managerApproveOvertime(id)
      await loadQueue(period.id)
      setNotice('Overtime entry approved')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to approve overtime entry')
    } finally {
      setBusy(false)
    }
  }

  async function downloadExport() {
    if (!period) return

    setBusy(true)
    setError('')
    try {
      const response = await exportOvertimePeriod(period.id)
      const file = new Blob([response.data], {
        type: response.headers?.['content-type'] || 'application/zip'
      })
      const url = window.URL.createObjectURL(file)
      const link = document.createElement('a')
      link.href = url
      link.download = `overtime-period-${period.id}.zip`
      link.click()
      window.URL.revokeObjectURL(url)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to export approved templates')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    loadCurrentPeriod().catch((err) => {
      setError(err?.response?.data?.error || err?.message || 'Failed to load current overtime period')
    })
  }, [])

  useEffect(() => {
    if (period?.id) loadQueue(period.id)
  }, [period?.id])

  const summary = useMemo(() => {
    const pending = rows.filter((row) => row.status === 'SUPERVISOR_APPROVED').length
    const totalHours = rows.reduce((sum, row) => sum + Number(row.totalHours || 0), 0)
    const edited = rows.filter((row) => row.editedRequiresManager).length
    const people = new Set(rows.map((row) => row.agent?.fullName || row.agent?.id || row.id)).size

    return {
      pending,
      totalHours: totalHours.toFixed(1),
      edited,
      people
    }
  }, [rows])

  const columns = [
    {
      field: 'agent',
      headerName: 'Agent',
      flex: 1,
      minWidth: 180,
      valueGetter: (_value, row) => row.agent?.fullName || ''
    },
    { field: 'source', headerName: 'Source', width: 120 },
    {
      field: 'workDate',
      headerName: 'Date',
      width: 120,
      valueGetter: (_value, row) => dayjs(row.workDate).format('YYYY-MM-DD')
    },
    {
      field: 'startAt',
      headerName: 'Start',
      width: 100,
      valueGetter: (_value, row) => dayjs(row.startAt).format('HH:mm')
    },
    {
      field: 'endAt',
      headerName: 'End',
      width: 100,
      valueGetter: (_value, row) => dayjs(row.endAt).format('HH:mm')
    },
    { field: 'totalHours', headerName: 'Hours', width: 100 },
    { field: 'rate', headerName: 'Rate', width: 90 },
    {
      field: 'editedRequiresManager',
      headerName: 'Edited',
      width: 110,
      valueGetter: (_value, row) => (row.editedRequiresManager ? 'Yes' : 'No')
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 150,
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button size="small" variant="outlined" onClick={() => approve(params.row.id)} disabled={busy}>
          Approve
        </Button>
      )
    }
  ]

  return (
    <PageShell
      eyebrow="Staffing and Scheduling"
      title="Overtime Manager Approval"
      description="Approve final overtime lines, export the approved pack, and keep a quick eye on entries that were changed after supervisor review."
      accent="#0f766e"
      actions={
        <Stack direction="row" spacing={0.7} flexWrap="wrap">
          <Button
            variant="outlined"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => period?.id && loadQueue(period.id)}
            disabled={!period || loading || busy}
          >
            Refresh
          </Button>
          <Button
            variant="contained"
            startIcon={<FileDownloadRoundedIcon />}
            onClick={downloadExport}
            disabled={!period || busy}
          >
            Export Approved
          </Button>
        </Stack>
      }
      stats={[
        {
          label: 'Pending Review',
          value: summary.pending,
          helper: 'Supervisor approved and waiting for manager decision',
          accent: '#0f766e'
        },
        {
          label: 'Hours in Queue',
          value: summary.totalHours,
          helper: 'Combined overtime hours loaded in current period',
          accent: '#2563eb'
        },
        {
          label: 'Edited Lines',
          value: summary.edited,
          helper: 'Entries changed after first pass',
          accent: '#d97706'
        },
        {
          label: 'People Impacted',
          value: summary.people,
          helper: 'Unique agents in current queue',
          accent: '#7c3aed'
        }
      ]}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

      <SectionCard
        title="Current Period Queue"
        subtitle="Use the queue for final approvals and export the signed-off templates once the period is ready."
        accent="#0f766e"
        noPadding
      >
        <Box sx={{ p: 1 }}>
          <FilterStrip>
            <Chip
              icon={<TaskAltRoundedIcon />}
              label={period ? `Period ${period.label}` : 'No active period'}
              color="primary"
              variant="outlined"
            />
            {period ? (
              <Chip
                label={`${dayjs(period.startDate).format('YYYY-MM-DD')} to ${dayjs(period.endDate).format('YYYY-MM-DD')}`}
              />
            ) : null}
            <Chip label={`${rows.length} rows`} />
          </FilterStrip>
        </Box>

        <Box sx={{ px: 0.6, pb: 0.6 }}>
          <DataGrid
            rows={rows}
            columns={columns}
            loading={loading}
            getRowId={(row) => row.id}
            autoHeight
            disableRowSelectionOnClick
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 25, page: 0 } }
            }}
          />
        </Box>
      </SectionCard>
    </PageShell>
  )
}
