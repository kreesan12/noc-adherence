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

function alphaHex(color, alpha) {
  return `${color}${alpha}`
}

function StatCard({ label, value, tone = '#0f172a', subtext }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.2,
        borderRadius: 2.5,
        border: '1px solid #e5e7eb',
        borderTop: `4px solid ${tone}`,
        bgcolor: '#fff',
        background: `linear-gradient(180deg, ${alphaHex(tone, '10')} 0%, #ffffff 44%, #ffffff 100%)`,
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)'
      }}
    >
      <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.72 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.35, fontWeight: 900, lineHeight: 1 }}>
        {value}
      </Typography>
      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.65, fontSize: 12.5, opacity: 0.72 }}>
          {subtext}
        </Typography>
      ) : null}
    </Paper>
  )
}

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
          borderRadius: 3,
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
      <Paper
        elevation={0}
        sx={{
          p: 1.25,
          border: '1px solid #e5e7eb',
          borderRadius: 3,
          minWidth: 0,
          overflow: 'hidden',
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
          background: 'linear-gradient(180deg, #fff7f7 0%, #ffffff 100%)'
        }}
      >
        <Stack spacing={1.1}>
          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', lg: 'center' }}
            justifyContent="space-between"
            sx={{ minWidth: 0 }}
          >
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="overline" sx={{ letterSpacing: 0.9, color: '#dc2626' }}>
                Breach Monitor
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.74 }}>
                Focus the dataset on links breaching the SLA threshold across the selected range.
              </Typography>
            </Box>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
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
            </Stack>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                xl: 'repeat(4, minmax(0, 1fr))'
              }
            }}
          >
            <StatCard label="Breaching Links" value={fmtCount(summary.total)} tone="#dc2626" subtext="Rows matching the threshold in the selected range." />
            <StatCard label="ISPs Affected" value={fmtCount(summary.uniqueIsps)} tone="#1d4ed8" subtext="Distinct ISPs represented in the breach set." />
            <StatCard label="Worst Link" value={summary.worstLink || '-'} tone="#0f172a" subtext="Current highest-risk FRG at the top of the list." />
            <StatCard label="Worst SLA" value={fmtPct(summary.worstSla)} tone="#f59e0b" subtext="Lowest range-average SLA in the current breach list." />
          </Box>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap">
            <Chip size="small" label={`Threshold ${breachThreshold || '99.5'}%`} sx={{ fontWeight: 700, bgcolor: '#fee2e2', color: '#991b1b' }} />
            <Chip size="small" label={`Months ${fmtCount((breachData.months || []).length)}`} sx={{ fontWeight: 700 }} />
            <Chip size="small" label={`Loaded ${fmtCount(rows.length)} rows on page`} sx={{ fontWeight: 700 }} />
          </Stack>
        </Stack>
      </Paper>

      {error ? <Alert severity="error">{error}</Alert> : null}

      <Paper elevation={0} sx={{ border: '1px solid #e5e7eb', borderRadius: 3, minWidth: 0, overflow: 'hidden', boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)' }}>
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
            sx={{
              border: 0,
              minWidth: 1240,
              fontSize: 12.5,
              '& .MuiDataGrid-columnHeaders': {
                bgcolor: '#f8fafc',
                borderBottom: '1px solid #e5e7eb'
              },
              '& .MuiDataGrid-columnHeaderTitle': {
                fontWeight: 800,
                fontSize: 12.25
              },
              '& .MuiDataGrid-row:hover': {
                bgcolor: '#f8fafc'
              },
              '& .MuiDataGrid-toolbarContainer': {
                p: 1,
                borderBottom: '1px solid #eef2f7',
                bgcolor: '#fcfcfd'
              }
            }}
          />
        </Box>
      </Paper>
    </Stack>
  )
}
