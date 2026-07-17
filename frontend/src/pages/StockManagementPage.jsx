import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material'
import Inventory2OutlinedIcon from '@mui/icons-material/Inventory2Outlined'
import SyncRoundedIcon from '@mui/icons-material/SyncRounded'
import FileDownloadOutlinedIcon from '@mui/icons-material/FileDownloadOutlined'
import WarehouseOutlinedIcon from '@mui/icons-material/WarehouseOutlined'
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded'
import ChecklistOutlinedIcon from '@mui/icons-material/ChecklistOutlined'
import RouteOutlinedIcon from '@mui/icons-material/RouteOutlined'
import SearchRoundedIcon from '@mui/icons-material/SearchRounded'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  exportStockTemplateWorkbook,
  fetchStockDashboard,
  refreshStockDashboard,
  updateStockMatchOverride,
  updateStockRequiredSpares
} from '../api/stockManagement'

const REQUIRED_SPARE_FIELDS = [
  { key: 'requiredCpt', region: 'CPT' },
  { key: 'requiredJhb', region: 'JHB' },
  { key: 'requiredDbn', region: 'DBN' },
  { key: 'requiredPel', region: 'PEL' },
  { key: 'requiredBfn', region: 'BFN' },
  { key: 'requiredGeo', region: 'GEO' },
  { key: 'requiredPol', region: 'POL' },
  { key: 'requiredNel', region: 'NEL' }
]

function fmtCount(value) {
  if (value == null || Number.isNaN(Number(value))) return '0'
  return new Intl.NumberFormat().format(Number(value))
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '0.00%'
  return `${Number(value).toFixed(2)}%`
}

function fmtDateTime(value) {
  if (!value) return 'N/A'
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(value)
}

function alphaHex(color, alpha) {
  return `${color}${alpha}`
}

function statusTone(item) {
  if (!item) return { color: '#64748b', bg: '#f8fafc' }
  if (item.matchMethod === 'unmatched') return { color: '#b45309', bg: '#fef3c7' }
  if (item.belowMinimum) return { color: '#b91c1c', bg: '#fee2e2' }
  if (item.isLowConfidence) return { color: '#c2410c', bg: '#ffedd5' }
  return { color: '#166534', bg: '#dcfce7' }
}

function matchTone(item) {
  if (!item) return 'default'
  if (item.matchMethod === 'unmatched') return 'warning'
  if (item.isLowConfidence) return 'warning'
  return 'success'
}

function Card({ title, value, subtext, tone = '#0f172a', icon = null }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.1,
        borderRadius: 3,
        border: '1px solid #e2e8f0',
        borderTop: `4px solid ${tone}`,
        background: `radial-gradient(circle at top right, ${alphaHex(tone, '18')} 0%, transparent 34%), linear-gradient(180deg, ${alphaHex(tone, '08')} 0%, #ffffff 52%, #ffffff 100%)`,
        boxShadow: '0 14px 28px rgba(15, 23, 42, 0.05)'
      }}
    >
      <Stack direction="row" spacing={0.9} alignItems="center" sx={{ mb: 0.55 }}>
        <Box
          sx={{
            width: 28,
            height: 28,
            borderRadius: 2,
            bgcolor: alphaHex(tone, '14'),
            color: tone,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {icon}
        </Box>
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.8, opacity: 0.78 }}>
          {title}
        </Typography>
      </Stack>
      <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.05, fontSize: 22 }}>
        {value}
      </Typography>
      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.45, fontSize: 12.2, opacity: 0.72 }}>
          {subtext}
        </Typography>
      ) : null}
    </Paper>
  )
}

function SectionCard({ title, subtitle, action, children }) {
  return (
    <Paper
      elevation={0}
      sx={{
        borderRadius: 3.2,
        border: '1px solid #e2e8f0',
        overflow: 'hidden',
        boxShadow: '0 14px 30px rgba(15, 23, 42, 0.05)'
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems="flex-start"
        spacing={1}
        sx={{
          px: 1.25,
          py: 1,
          borderBottom: '1px solid #edf2f7',
          background: 'linear-gradient(135deg, rgba(15,118,110,0.10) 0%, rgba(255,255,255,0.92) 54%, rgba(241,245,249,0.9) 100%)'
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" sx={{ fontSize: 12.4, opacity: 0.72 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
      </Stack>
      <Box sx={{ p: 1.15 }}>{children}</Box>
    </Paper>
  )
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function buildRequiredSpareForm(item) {
  return {
    requiredCpt: String(item?.requiredByRegion?.CPT ?? 0),
    requiredJhb: String(item?.requiredByRegion?.JHB ?? 0),
    requiredDbn: String(item?.requiredByRegion?.DBN ?? 0),
    requiredPel: String(item?.requiredByRegion?.PEL ?? 0),
    requiredBfn: String(item?.requiredByRegion?.BFN ?? 0),
    requiredGeo: String(item?.requiredByRegion?.GEO ?? 0),
    requiredPol: String(item?.requiredByRegion?.POL ?? 0),
    requiredNel: String(item?.requiredByRegion?.NEL ?? 0)
  }
}

export default function StockManagementPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [tab, setTab] = useState(0)
  const [search, setSearch] = useState('')
  const [divisionFilter, setDivisionFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [matchFilter, setMatchFilter] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [reviewItem, setReviewItem] = useState(null)
  const [savingOverride, setSavingOverride] = useState(false)
  const [editingMinimums, setEditingMinimums] = useState(false)
  const [savingMinimums, setSavingMinimums] = useState(false)
  const [minimumForm, setMinimumForm] = useState(buildRequiredSpareForm(null))
  const [toast, setToast] = useState(null)

  const loadData = async ({ showLoading = true } = {}) => {
    if (showLoading) setLoading(true)
    setError('')
    try {
      const next = await fetchStockDashboard()
      setData(next)
      return next
    } catch (err) {
      console.error(err)
      setError(err?.response?.data?.error || err?.message || 'Failed to load stock dashboard')
      throw err
    } finally {
      if (showLoading) setLoading(false)
    }
  }

  useEffect(() => {
    loadData({ showLoading: true }).catch(console.error)
  }, [])

  useEffect(() => {
    if (!selectedItem) {
      setEditingMinimums(false)
      setMinimumForm(buildRequiredSpareForm(null))
      return
    }

    setMinimumForm(buildRequiredSpareForm(selectedItem))
  }, [selectedItem])

  const divisions = useMemo(() => {
    const list = (data?.divisionSummary || []).map((row) => row.division).filter(Boolean)
    return Array.from(new Set(list))
  }, [data])

  const filteredGroups = useMemo(() => {
    if (!data?.items?.length) return []
    const q = String(search || '').trim().toLowerCase()
    const groups = []
    let currentGroup = null

    const matchesFilters = (row) => {
      if (row.rowType !== 'ITEM') return false
      if (divisionFilter && row.division !== divisionFilter) return false
      if (stockFilter === 'low' && !row.belowMinimum) return false
      if (stockFilter === 'healthy' && row.belowMinimum) return false
      if (stockFilter === 'zero' && Number(row.availableTotal || 0) !== 0) return false
      if (matchFilter === 'matched' && row.matchMethod === 'unmatched') return false
      if (matchFilter === 'review' && !row.isLowConfidence) return false
      if (matchFilter === 'unmatched' && row.matchMethod !== 'unmatched') return false
      if (!q) return true
      return [
        row.itemDescription,
        row.stockCode,
        row.division,
        row.matchedItemNo,
        row.matchedItemDescription
      ].some((value) => String(value || '').toLowerCase().includes(q))
    }

    for (const row of data.items) {
      if (row.rowType === 'SECTION') {
        currentGroup = { title: row.itemDescription || row.sectionName || 'Stock Section', rows: [] }
        groups.push(currentGroup)
        continue
      }
      if (!currentGroup) {
        currentGroup = { title: 'Stock Items', rows: [] }
        groups.push(currentGroup)
      }
      if (matchesFilters(row)) {
        currentGroup.rows.push(row)
      }
    }

    return groups.filter((group) => group.rows.length > 0)
  }, [data, search, divisionFilter, stockFilter, matchFilter])

  const reviewRows = useMemo(() => {
    const q = String(search || '').trim().toLowerCase()
    return (data?.matchReviewItems || []).filter((row) => {
      if (!q) return true
      return [
        row.itemDescription,
        row.stockCode,
        row.matchedItemNo,
        row.matchedItemDescription
      ].some((value) => String(value || '').toLowerCase().includes(q))
    })
  }, [data, search])

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      const result = await refreshStockDashboard()
      await loadData({ showLoading: false })
      setToast({
        severity: 'success',
        message: `Stock refresh complete: ${fmtCount(result.statusRowCount)} rows processed`
      })
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Stock refresh failed'
      })
    } finally {
      setRefreshing(false)
    }
  }

  const doExport = async () => {
    setExporting(true)
    try {
      const blob = await exportStockTemplateWorkbook()
      downloadBlob(blob, `stock-master-${dayjs().format('YYYY-MM-DD')}.xlsx`)
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Workbook export failed'
      })
    } finally {
      setExporting(false)
    }
  }

  const applySuggestion = async (item, suggestion) => {
    if (!item || !suggestion) return
    setSavingOverride(true)
    try {
      await updateStockMatchOverride(item.id, {
        matchedItemNo: suggestion.itemNo,
        matchedDescription: suggestion.itemDescription
      })
      await loadData({ showLoading: false })
      setReviewItem(null)
      setToast({
        severity: 'success',
        message: `Match override saved for ${item.itemDescription}`
      })
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to save match override'
      })
    } finally {
      setSavingOverride(false)
    }
  }

  const saveMinimumSpareEdits = async () => {
    if (!selectedItem) return
    setSavingMinimums(true)
    try {
      await updateStockRequiredSpares(selectedItem.id, minimumForm)
      const next = await loadData({ showLoading: false })
      const refreshedItem = next?.items?.find((row) => row.id === selectedItem.id) || selectedItem
      setSelectedItem(refreshedItem)
      setEditingMinimums(false)
      setMinimumForm(buildRequiredSpareForm(refreshedItem))
      setToast({
        severity: 'success',
        message: `Minimum spares updated for ${selectedItem.itemDescription}`
      })
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to update minimum spares'
      })
    } finally {
      setSavingMinimums(false)
    }
  }

  const clearSuggestion = async (item) => {
    if (!item) return
    setSavingOverride(true)
    try {
      await updateStockMatchOverride(item.id, { clear: true })
      await loadData()
      setReviewItem(null)
      setToast({
        severity: 'success',
        message: `Match override cleared for ${item.itemDescription}`
      })
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to clear match override'
      })
    } finally {
      setSavingOverride(false)
    }
  }

  if (loading) {
    return (
      <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0', borderRadius: 3 }}>
        <Stack direction="row" spacing={1.2} alignItems="center">
          <CircularProgress size={22} />
          <Typography>Loading stock management dashboard...</Typography>
        </Stack>
      </Paper>
    )
  }

  if (error) {
    return <Alert severity="error">{error}</Alert>
  }

  const summary = data?.summary || {}
  const latestImport = data?.latestImport || null
  const regionChart = (data?.regionSummary || []).map((row) => ({
    region: row.region,
    required: row.requiredTotal,
    available: row.availableTotal,
    warehouse: row.warehouseTotal,
    field: row.fieldTotal
  }))
  const divisionChart = (data?.divisionSummary || []).slice(0, 8).map((row) => ({
    division: row.division,
    low: row.lowStockCount,
    available: row.availableTotal,
    required: row.requiredTotal
  }))

  return (
    <Stack spacing={1.2}>
      <Paper
        elevation={0}
        sx={{
          p: 1.4,
          borderRadius: 3.6,
          border: '1px solid #d6e4de',
          color: '#fff',
          background: 'linear-gradient(135deg, #0f766e 0%, #155e63 44%, #102a43 100%)',
          boxShadow: '0 18px 36px rgba(15, 23, 42, 0.12)'
        }}
      >
        <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" spacing={1.2}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ letterSpacing: 1, opacity: 0.72 }}>
              Stock Management
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.02 }}>
              Assurance And Engineering Stock Control
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.55, maxWidth: 880, opacity: 0.82 }}>
              The template stays as the master source, the daily stock report feeds the live counts, and warehouse stock is separated from field-held stock for cleaner operational control.
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap" alignItems="flex-start">
            <Chip size="small" label={`Coverage ${fmtPct(summary.matchCoveragePct)}`} sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#fff', fontWeight: 700 }} />
            <Chip size="small" label={`Low stock ${fmtCount(summary.lowStockCount)}`} sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#fff', fontWeight: 700 }} />
            <Chip size="small" label={`Latest ${latestImport?.reportDate ? fmtDateTime(latestImport.reportDate) : 'No import yet'}`} sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#fff', fontWeight: 700 }} />
          </Stack>
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: 1,
          borderRadius: 3,
          border: '1px solid #dce7e2',
          background: 'linear-gradient(180deg, #fbfffe 0%, #f5faf8 100%)'
        }}
      >
        <Stack spacing={0.8}>
          {Number(summary.requiredTotal || 0) === 0 ? (
            <Alert severity="warning" sx={{ borderRadius: 2.5 }}>
              Minimum spares are still zero across the imported template. Open an item in Stock Master and use `Edit minimum spares` to set the baseline.
            </Alert>
          ) : null}
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap">
            <TextField
              size="small"
              label="Search Stock"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Description, code, division, matched item..."
              sx={{ minWidth: 260 }}
              InputProps={{
                startAdornment: <SearchRoundedIcon sx={{ mr: 0.75, fontSize: 18, color: 'text.secondary' }} />
              }}
            />
            <TextField
              size="small"
              select
              label="Division"
              value={divisionFilter}
              onChange={(e) => setDivisionFilter(e.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All Divisions</MenuItem>
              {divisions.map((division) => (
                <MenuItem key={division} value={division}>{division}</MenuItem>
              ))}
            </TextField>
            <TextField
              size="small"
              select
              label="Stock Status"
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value)}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="low">Below Minimum</MenuItem>
              <MenuItem value="healthy">Healthy</MenuItem>
              <MenuItem value="zero">Zero Available</MenuItem>
            </TextField>
            <TextField
              size="small"
              select
              label="Match Quality"
              value={matchFilter}
              onChange={(e) => setMatchFilter(e.target.value)}
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="">All</MenuItem>
              <MenuItem value="matched">Matched</MenuItem>
              <MenuItem value="review">Needs Review</MenuItem>
              <MenuItem value="unmatched">Unmatched</MenuItem>
            </TextField>
            <Button
              size="small"
              variant="contained"
              startIcon={<SyncRoundedIcon />}
              onClick={doRefresh}
              disabled={refreshing}
              sx={{ minHeight: 38, borderRadius: 2.8, textTransform: 'none', fontWeight: 800 }}
            >
              {refreshing ? 'Refreshing...' : 'Run Daily Refresh'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={doExport}
              disabled={exporting}
              sx={{ minHeight: 38, borderRadius: 2.8, textTransform: 'none', fontWeight: 800 }}
            >
              {exporting ? 'Exporting...' : 'Export Master Workbook'}
            </Button>
          </Stack>
          <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
            <Chip size="small" label={`Rows in stock report ${fmtCount(latestImport?.statusRowCount || 0)}`} sx={{ fontWeight: 700 }} />
            <Chip size="small" label={`Matched items ${fmtCount(summary.matchedItemCount)}`} sx={{ fontWeight: 700, bgcolor: '#dcfce7', color: '#166534' }} />
            <Chip size="small" label={`Review items ${fmtCount(summary.lowConfidenceCount + summary.unresolvedItemCount)}`} sx={{ fontWeight: 700, bgcolor: '#ffedd5', color: '#c2410c' }} />
            <Chip size="small" label={`Unknown-site qty ${fmtCount(summary.unknownSiteQtyTotal)}`} sx={{ fontWeight: 700, bgcolor: '#fef3c7', color: '#92400e' }} />
          </Stack>
        </Stack>
      </Paper>

      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        sx={{
          minHeight: 44,
          '& .MuiTab-root': {
            minHeight: 44,
            textTransform: 'none',
            fontWeight: 700
          }
        }}
      >
        <Tab label="Overview" />
        <Tab label="Master Stock" />
        <Tab label="Match Review" />
      </Tabs>

      {tab === 0 ? (
        <Stack spacing={1.1}>
          <Box
            sx={{
              display: 'grid',
              gap: 0.95,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(3, minmax(0, 1fr))',
                xl: 'repeat(6, minmax(0, 1fr))'
              }
            }}
          >
            <Card title="Template Items" value={fmtCount(summary.templateItemCount)} subtext="Master stock rows being monitored" tone="#0f766e" icon={<Inventory2OutlinedIcon sx={{ fontSize: 16 }} />} />
            <Card title="Low Stock" value={fmtCount(summary.lowStockCount)} subtext="Items currently below their required spares" tone="#dc2626" icon={<WarningAmberRoundedIcon sx={{ fontSize: 16 }} />} />
            <Card title="Ordered Stock" value={fmtCount(summary.orderedStockTotal)} subtext="Outstanding quantities still on order" tone="#1d4ed8" icon={<ChecklistOutlinedIcon sx={{ fontSize: 16 }} />} />
            <Card title="Not In Warehouse" value={fmtCount(summary.notInWarehouseTotal)} subtext="Stock sitting at non-warehouse locations" tone="#c2410c" icon={<RouteOutlinedIcon sx={{ fontSize: 16 }} />} />
            <Card title="Match Coverage" value={fmtPct(summary.matchCoveragePct)} subtext="Template items successfully linked to the stock report" tone="#7c3aed" icon={<CheckCircleOutlineRoundedIcon sx={{ fontSize: 16 }} />} />
            <Card title="Available vs Required" value={`${fmtCount(summary.availableTotal)} / ${fmtCount(summary.requiredTotal)}`} subtext="Overall available stock against required spares" tone="#0f172a" icon={<WarehouseOutlinedIcon sx={{ fontSize: 16 }} />} />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: '1fr',
                xl: '1.2fr 0.8fr'
              }
            }}
          >
            <SectionCard title="Regional Stock Position" subtitle="Available stock versus required spares, with warehouse and field holdings considered separately.">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={regionChart} margin={{ left: 0, right: 16, top: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="region" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="required" fill="#0f172a" radius={[4, 4, 0, 0]} name="Required" />
                  <Bar dataKey="available" fill="#0f766e" radius={[4, 4, 0, 0]} name="Available" />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard title="Import Control" subtitle="Latest import health and a short run history.">
              <Stack spacing={1}>
                <Paper variant="outlined" sx={{ p: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Latest Stock Report</Typography>
                  <Typography variant="body2" sx={{ mt: 0.45 }}>Report date: {fmtDateTime(latestImport?.reportDate)}</Typography>
                  <Typography variant="body2">Imported: {fmtDateTime(latestImport?.createdAt)}</Typography>
                  <Typography variant="body2">Source file: {latestImport?.sourceFilename || 'N/A'}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.55 }}>Recent Import History</Typography>
                  <Stack spacing={0.5}>
                    {(data?.importHistory || []).slice(0, 5).map((row) => (
                      <Stack key={row.id} direction="row" justifyContent="space-between" spacing={1}>
                        <Typography variant="caption">{fmtDateTime(row.reportDate || row.createdAt)}</Typography>
                        <Typography variant="caption">{fmtCount(row.statusRowCount)} rows</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>
              </Stack>
            </SectionCard>
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: '1fr',
                xl: '0.9fr 1.1fr'
              }
            }}
          >
            <SectionCard title="Division Pressure" subtitle="Divisions carrying the highest low-stock count right now.">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={divisionChart} layout="vertical" margin={{ left: 24, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="division" width={92} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="low" fill="#f59e0b" radius={[0, 4, 4, 0]} name="Low Stock Items" />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard title="Low Stock Watchlist" subtitle="Highest gaps between required spares and currently available stock.">
              <TableContainer sx={{ maxHeight: 250 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Required</TableCell>
                      <TableCell align="right">Available</TableCell>
                      <TableCell align="right">Gap</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data?.lowStockItems || []).slice(0, 10).map((row) => (
                      <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedItem(row)}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.itemDescription}</Typography>
                          <Typography variant="caption" sx={{ opacity: 0.72 }}>{row.stockCode || 'No stock code'}</Typography>
                        </TableCell>
                        <TableCell align="right">{fmtCount(row.requiredTotal)}</TableCell>
                        <TableCell align="right">{fmtCount(row.availableTotal)}</TableCell>
                        <TableCell align="right">{fmtCount(row.shortage)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </SectionCard>
          </Box>
        </Stack>
      ) : null}

      {tab === 1 ? (
        <SectionCard
          title="Master Stock Table"
          subtitle="Grouped by template section, with live stock totals, match quality, and warehouse separation."
          action={<Chip size="small" label={`${fmtCount(filteredGroups.reduce((sum, group) => sum + group.rows.length, 0))} visible items`} sx={{ fontWeight: 700 }} />}
        >
          <Stack spacing={1}>
            {filteredGroups.map((group) => (
              <Paper key={group.title} variant="outlined" sx={{ borderRadius: 2.6, overflow: 'hidden' }}>
                <Box sx={{ px: 1.1, py: 0.85, bgcolor: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{group.title}</Typography>
                </Box>
                <Box sx={{ overflowX: 'auto' }}>
                  <Table size="small" sx={{ minWidth: 1160 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Item</TableCell>
                        <TableCell>Division</TableCell>
                        <TableCell>Match</TableCell>
                        <TableCell align="right">Required</TableCell>
                        <TableCell align="right">Available</TableCell>
                        <TableCell align="right">Not In WH</TableCell>
                        <TableCell align="right">Ordered</TableCell>
                        <TableCell align="right">Gap</TableCell>
                        <TableCell align="right">CPT</TableCell>
                        <TableCell align="right">JHB</TableCell>
                        <TableCell align="right">DBN</TableCell>
                        <TableCell align="right">PEL</TableCell>
                        <TableCell align="right">BFN</TableCell>
                        <TableCell align="right">GEO</TableCell>
                        <TableCell align="right">POL</TableCell>
                        <TableCell align="right">NEL</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {group.rows.map((row) => {
                        const tone = statusTone(row)
                        return (
                          <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedItem(row)}>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.itemDescription}</Typography>
                              <Typography variant="caption" sx={{ opacity: 0.72 }}>{row.stockCode || 'No stock code'}</Typography>
                            </TableCell>
                            <TableCell>{row.division || 'Unassigned'}</TableCell>
                            <TableCell>
                              <Chip
                                size="small"
                                label={row.matchStatus}
                                color={matchTone(row)}
                                sx={{ fontWeight: 700 }}
                              />
                            </TableCell>
                            <TableCell align="right">{fmtCount(row.requiredTotal)}</TableCell>
                            <TableCell align="right">
                              <Typography component="span" sx={{ fontWeight: 800, color: tone.color }}>
                                {fmtCount(row.availableTotal)}
                              </Typography>
                            </TableCell>
                            <TableCell align="right">{fmtCount(row.notInWarehouses)}</TableCell>
                            <TableCell align="right">{fmtCount(row.orderedStock)}</TableCell>
                            <TableCell align="right">{fmtCount(row.shortage)}</TableCell>
                            <TableCell align="right">{fmtCount(row.cptTotal)}</TableCell>
                            <TableCell align="right">{fmtCount(row.jhbTotal)}</TableCell>
                            <TableCell align="right">{fmtCount(row.dbnTotal)}</TableCell>
                            <TableCell align="right">{fmtCount(row.pelTotal)}</TableCell>
                            <TableCell align="right">{fmtCount(row.bfnTotal)}</TableCell>
                            <TableCell align="right">{fmtCount(row.geoTotal)}</TableCell>
                            <TableCell align="right">{fmtCount(row.polTotal)}</TableCell>
                            <TableCell align="right">{fmtCount(row.nelTotal)}</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </Box>
              </Paper>
            ))}
          </Stack>
        </SectionCard>
      ) : null}

      {tab === 2 ? (
        <SectionCard
          title="Match Review"
          subtitle="Review low-confidence and unmatched items, then lock in an override so the daily refresh stays stable."
          action={<Chip size="small" label={`${fmtCount(reviewRows.length)} items`} sx={{ fontWeight: 700 }} />}
        >
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Template Item</TableCell>
                  <TableCell>Current Match</TableCell>
                  <TableCell align="right">Confidence</TableCell>
                  <TableCell>Suggestions</TableCell>
                  <TableCell align="right">Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reviewRows.map((row) => (
                  <TableRow key={row.id} hover>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.itemDescription}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.72 }}>{row.stockCode || 'No stock code'}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">{row.matchedItemNo || 'No active match'}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.72 }}>{row.matchedItemDescription || row.matchMethod}</Typography>
                    </TableCell>
                    <TableCell align="right">{row.matchMethod === 'unmatched' ? '0.00' : Number(row.matchScore || 0).toFixed(2)}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                        {(row.candidateMatches || []).slice(0, 2).map((candidate) => (
                          <Chip
                            key={`${row.id}-${candidate.itemNo}`}
                            size="small"
                            label={`${candidate.itemNo} (${Number(candidate.score || 0).toFixed(2)})`}
                            sx={{ maxWidth: 260 }}
                          />
                        ))}
                      </Stack>
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<EditOutlinedIcon />}
                        onClick={() => setReviewItem(row)}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        Review
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </SectionCard>
      ) : null}

      <Dialog
        open={Boolean(selectedItem)}
        onClose={() => setSelectedItem(null)}
        fullWidth
        maxWidth="lg"
      >
        <DialogTitle sx={{ pr: 2 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              {selectedItem?.itemDescription || 'Stock item details'}
            </Typography>
            {selectedItem?.rowType === 'ITEM' ? (
              <Button
                size="small"
                variant={editingMinimums ? 'contained' : 'outlined'}
                startIcon={<EditOutlinedIcon />}
                onClick={() => {
                  setMinimumForm(buildRequiredSpareForm(selectedItem))
                  setEditingMinimums((current) => !current)
                }}
                sx={{ textTransform: 'none', fontWeight: 800, borderRadius: 2.8 }}
              >
                {editingMinimums ? 'Close editor' : 'Edit minimum spares'}
              </Button>
            ) : null}
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {selectedItem ? (
            <Stack spacing={1.1}>
              <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
                <Chip label={selectedItem.stockCode || 'No stock code'} />
                <Chip label={selectedItem.division || 'Unassigned'} />
                <Chip label={selectedItem.matchStatus} color={matchTone(selectedItem)} />
                <Chip label={`Required ${fmtCount(selectedItem.requiredTotal)}`} />
                <Chip label={`Available ${fmtCount(selectedItem.availableTotal)}`} />
                <Chip label={`Ordered ${fmtCount(selectedItem.orderedStock)}`} />
                <Chip label={`Gap ${fmtCount(selectedItem.shortage)}`} />
              </Stack>
              <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 2.5 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Minimum Spares Baseline
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.74 }}>
                      These values drive shortage monitoring and are preserved when the imported template still carries zeros.
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={`Total required ${fmtCount(selectedItem.requiredTotal)}`}
                    sx={{ fontWeight: 800 }}
                  />
                </Stack>
                <Box
                  sx={{
                    mt: 1,
                    display: 'grid',
                    gap: 0.8,
                    gridTemplateColumns: {
                      xs: 'repeat(2, minmax(0, 1fr))',
                      sm: 'repeat(4, minmax(0, 1fr))'
                    }
                  }}
                >
                  {REQUIRED_SPARE_FIELDS.map(({ key, region }) => (
                    <Paper
                      key={key}
                      variant="outlined"
                      sx={{
                        px: 1,
                        py: 0.9,
                        borderRadius: 2,
                        bgcolor: 'rgba(15, 118, 110, 0.03)'
                      }}
                    >
                      <Typography variant="caption" sx={{ display: 'block', opacity: 0.68 }}>
                        {region}
                      </Typography>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                        {fmtCount(selectedItem.requiredByRegion?.[region] || 0)}
                      </Typography>
                    </Paper>
                  ))}
                </Box>
                {editingMinimums ? (
                  <Stack spacing={1} sx={{ mt: 1.2 }}>
                    <Box
                      sx={{
                        display: 'grid',
                        gap: 0.9,
                        gridTemplateColumns: {
                          xs: 'repeat(2, minmax(0, 1fr))',
                          md: 'repeat(4, minmax(0, 1fr))'
                        }
                      }}
                    >
                      {REQUIRED_SPARE_FIELDS.map(({ key, region }) => (
                        <TextField
                          key={key}
                          size="small"
                          label={`${region} min`}
                          value={minimumForm[key]}
                          onChange={(event) => {
                            const nextValue = event.target.value
                            if (/^\d*$/.test(nextValue)) {
                              setMinimumForm((current) => ({
                                ...current,
                                [key]: nextValue
                              }))
                            }
                          }}
                          inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                        />
                      ))}
                    </Box>
                    <Stack direction="row" spacing={1} justifyContent="flex-end">
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          setMinimumForm(buildRequiredSpareForm(selectedItem))
                          setEditingMinimums(false)
                        }}
                        disabled={savingMinimums}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={saveMinimumSpareEdits}
                        disabled={savingMinimums}
                        sx={{ textTransform: 'none', fontWeight: 800, borderRadius: 2.5 }}
                      >
                        {savingMinimums ? 'Saving...' : 'Save minimum spares'}
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </Paper>
              <Divider />
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" sx={{ minWidth: 760 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Site</TableCell>
                      <TableCell>Region</TableCell>
                      <TableCell>Warehouse Bucket</TableCell>
                      <TableCell align="right">Qty Available</TableCell>
                      <TableCell align="right">Qty On Order</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(selectedItem.siteBreakdown || []).map((row) => (
                      <TableRow key={`${row.siteId}-${row.region}-${row.warehouseField || 'field'}`}>
                        <TableCell>{row.siteId}</TableCell>
                        <TableCell>{row.region}</TableCell>
                        <TableCell>{row.warehouseField || 'Not in warehouse'}</TableCell>
                        <TableCell align="right">{fmtCount(row.qtyAvailable)}</TableCell>
                        <TableCell align="right">{fmtCount(row.qtyOnOrder)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(reviewItem)} onClose={() => setReviewItem(null)} fullWidth maxWidth="md">
        <DialogTitle>Review Match: {reviewItem?.itemDescription || ''}</DialogTitle>
        <DialogContent dividers>
          {reviewItem ? (
            <Stack spacing={1.1}>
              <Alert severity={reviewItem.matchMethod === 'unmatched' ? 'warning' : 'info'}>
                Current match: {reviewItem.matchedItemNo || 'No active match'} | Confidence {reviewItem.matchMethod === 'unmatched' ? '0.00' : Number(reviewItem.matchScore || 0).toFixed(2)}
              </Alert>
              <Stack spacing={0.8}>
                {(reviewItem.candidateMatches || []).map((candidate) => (
                  <Paper key={`${reviewItem.id}-${candidate.itemNo}`} variant="outlined" sx={{ p: 1 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 800 }}>{candidate.itemNo}</Typography>
                        <Typography variant="body2" sx={{ opacity: 0.78 }}>{candidate.itemDescription}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.72 }}>Score {Number(candidate.score || 0).toFixed(2)}</Typography>
                      </Box>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => applySuggestion(reviewItem, candidate)}
                        disabled={savingOverride}
                        sx={{ textTransform: 'none', fontWeight: 800, alignSelf: 'flex-start' }}
                      >
                        Use This Match
                      </Button>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
              <Divider />
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={() => clearSuggestion(reviewItem)}
                disabled={savingOverride}
                sx={{ textTransform: 'none', fontWeight: 800, alignSelf: 'flex-start' }}
              >
                Clear Manual Override
              </Button>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>

      {toast ? (
        <Alert severity={toast.severity} onClose={() => setToast(null)}>
          {toast.message}
        </Alert>
      ) : null}
    </Stack>
  )
}
