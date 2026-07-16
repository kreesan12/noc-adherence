import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'

function SlaProgressCell({ value, fmtPct }) {
  const pct = Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : 0
  const color =
    pct >= 99.5 ? 'success.main' :
      pct >= 98.5 ? 'warning.main' :
        'error.main'

  return (
    <Box sx={{ width: '100%' }}>
      <Typography variant="body2" fontWeight={700} sx={{ mb: 0.35 }}>
        {fmtPct(value)}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          height: 7,
          borderRadius: 999,
          backgroundColor: '#e5e7eb',
          '& .MuiLinearProgress-bar': {
            backgroundColor: color
          }
        }}
      />
    </Box>
  )
}

export default function SlaBreachesTab({
  loading,
  error,
  breachData,
  breachPagination,
  setBreachPagination,
  breachSearch,
  setBreachSearch,
  breachThreshold,
  setBreachThreshold,
  fmtCount,
  fmtPct,
  fmtHours,
  pctChipColor,
  openLinkDetails
}) {
  const monthColumns = (breachData.months || []).map((month) => ({
    field: `breach_${month.replace('-', '_')}`,
    headerName: month,
    width: 98,
    align: 'center',
    headerAlign: 'center',
    sortable: false,
    valueGetter: (_, row) => row?.monthValues?.[month] ?? null,
    renderCell: (params) => {
      const value = params.value ?? params.row?.monthValues?.[month] ?? null
      return (
        <Chip
          size="small"
          color={pctChipColor(value)}
          label={fmtPct(value)}
          sx={{ fontWeight: 600 }}
        />
      )
    }
  }))

  const columns = [
    {
      field: 'frogfootlinklabel',
      headerName: 'FRG Link',
      width: 190,
      renderCell: (params) => (
        <Button
          size="small"
          variant="text"
          startIcon={<VisibilityOutlinedIcon />}
          onClick={() => openLinkDetails(params.row.frogfootlinklabel)}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          {params.row.frogfootlinklabel}
        </Button>
      )
    },
    { field: 'isp', headerName: 'ISP', width: 145 },
    { field: 'productType', headerName: 'Product', width: 160 },
    { field: 'serviceType', headerName: 'Service', width: 140 },
    {
      field: 'avgUptimePct',
      headerName: 'Range Avg SLA',
      width: 150,
      renderCell: (params) => <SlaProgressCell value={params.row.avgUptimePct} fmtPct={fmtPct} />
    },
    {
      field: 'currentMonthUptimePct',
      headerName: 'Current Month',
      width: 104,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => (
        <Chip
          size="small"
          color={pctChipColor(params.row.currentMonthUptimePct)}
          label={fmtPct(params.row.currentMonthUptimePct)}
          sx={{ fontWeight: 600 }}
        />
      )
    },
    {
      field: 'worstUptimePct',
      headerName: 'Worst Month',
      width: 104,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => (
        <Chip
          size="small"
          color={pctChipColor(params.row.worstUptimePct)}
          label={fmtPct(params.row.worstUptimePct)}
          sx={{ fontWeight: 600 }}
        />
      )
    },
    {
      field: 'belowThresholdMonths',
      headerName: '< Threshold',
      width: 98,
      align: 'center',
      headerAlign: 'center'
    },
    {
      field: 'impactedMonths',
      headerName: 'Impacted',
      width: 88,
      align: 'center',
      headerAlign: 'center'
    },
    {
      field: 'totalDowntimeHours',
      headerName: 'Downtime',
      width: 96,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => fmtHours(params.row.totalDowntimeHours)
    },
    {
      field: 'ticketCount',
      headerName: 'Tickets',
      width: 82,
      align: 'center',
      headerAlign: 'center'
    },
    {
      field: 'serviceImpactingTickets',
      headerName: 'Svc Ticks',
      width: 88,
      align: 'center',
      headerAlign: 'center'
    },
    {
      field: 'outageCount',
      headerName: 'Outages',
      width: 82,
      align: 'center',
      headerAlign: 'center'
    },
    ...monthColumns
  ]

  const rows = (breachData.links || []).map((row) => ({ id: row.frogfootlinklabel, ...row }))
  const summary = {
    total: breachData.totalCount || 0,
    uniqueIsps: new Set((breachData.links || []).map((row) => row.isp)).size,
    worstLink: (breachData.links || [])[0]?.frogfootlinklabel || '',
    worstSla: (breachData.links || [])[0]?.avgUptimePct ?? null
  }

  return (
    <Stack spacing={1.5}>
      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb', minWidth: 0, overflow: 'hidden' }}>
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} alignItems={{ xs: 'stretch', lg: 'center' }} useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
          <TextField
            size="small"
            label="Search FRG / ISP"
            value={breachSearch}
            onChange={(e) => setBreachSearch(e.target.value)}
            sx={{ minWidth: 220 }}
          />
          <TextField
            size="small"
            label="SLA Threshold"
            type="number"
            value={breachThreshold}
            onChange={(e) => setBreachThreshold(e.target.value)}
            inputProps={{ step: '0.1' }}
            sx={{ width: 140 }}
          />
          <Chip size="small" label={`Breaches ${fmtCount(summary.total)}`} color={summary.total ? 'error' : 'success'} />
          <Chip size="small" label={`ISPs Affected ${fmtCount(summary.uniqueIsps)}`} />
          <Chip size="small" label={`Worst Link ${summary.worstLink || '-'}`} />
          <Chip size="small" label={`Worst SLA ${fmtPct(summary.worstSla)}`} color={pctChipColor(summary.worstSla)} />
        </Stack>
      </Paper>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper elevation={0} sx={{ border: '1px solid #e5e7eb', minWidth: 0, overflow: 'hidden' }}>
        <Box sx={{ width: '100%', overflowX: 'auto' }}>
          <DataGrid
            rows={rows}
            columns={columns}
            autoHeight
            density="compact"
            paginationMode="server"
            rowCount={breachData.totalCount || rows.length}
            loading={loading}
            pageSizeOptions={[50, 100, 200]}
            paginationModel={breachPagination}
            onPaginationModelChange={setBreachPagination}
            slots={{ toolbar: GridToolbar }}
            slotProps={{
              toolbar: { showQuickFilter: false }
            }}
            sx={{ border: 0, minWidth: 1240, fontSize: 12.5 }}
          />
        </Box>
      </Paper>
    </Stack>
  )
}
