import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
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
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import AddCircleOutlineRoundedIcon from '@mui/icons-material/AddCircleOutlineRounded'
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
  applyStockReviewActions,
  createStockTemplateItem,
  exportLowStockWatchlistWorkbook,
  exportRegionalWatchlistWorkbook,
  exportStockTemplateWorkbook,
  fetchStockDashboard,
  fetchStockRunRates,
  refreshStockDashboard,
  updateStockNotWarehouseAction,
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

const STOCK_REGIONS = REQUIRED_SPARE_FIELDS.map((field) => field.region)
const REGION_WATCHLIST_PREVIEW_COUNT = 5

const NOT_WH_STATUS_OPTIONS = [
  { value: 'PENDING_REVIEW', label: 'Pending review' },
  { value: 'TESTING_IN_PROGRESS', label: 'Testing in progress' },
  { value: 'USABLE_PUT_BACK', label: 'Usable - put back in stock' },
  { value: 'RETURN_TO_SUPPLIER', label: 'Return to supplier' },
  { value: 'HOLD', label: 'Hold' },
  { value: 'SCRAP', label: 'Scrap' }
]

const MASTER_ITEM_CELL_SX = {
  width: 248,
  minWidth: 248,
  maxWidth: 248,
  whiteSpace: 'normal'
}

const MASTER_SECTION_CELL_SX = {
  width: 112,
  minWidth: 112,
  maxWidth: 112,
  whiteSpace: 'normal'
}

const MASTER_MATCH_CELL_SX = {
  width: 80,
  minWidth: 80,
  maxWidth: 80
}

const MASTER_METRIC_CELL_SX = {
  width: 64,
  minWidth: 64,
  maxWidth: 64
}

const MASTER_MONEY_CELL_SX = {
  width: 84,
  minWidth: 84,
  maxWidth: 84
}

const MASTER_REGION_CELL_SX = {
  width: 38,
  minWidth: 38,
  maxWidth: 38
}

function fmtCount(value) {
  if (value == null || Number.isNaN(Number(value))) return '0'
  return new Intl.NumberFormat().format(Number(value))
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) return '0.00%'
  return `${Number(value).toFixed(2)}%`
}

function fmtMoney(value) {
  if (value == null || Number.isNaN(Number(value))) return 'R0.00'
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value))
}

function fmtDecimal(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return Number(0).toFixed(digits)
  return Number(value).toFixed(digits)
}

function fmtMonthLabel(value) {
  if (!value) return 'N/A'
  const d = dayjs(`${value}-01`)
  return d.isValid() ? d.format('MMM YYYY') : String(value)
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
        p: 0.9,
        borderRadius: 2.6,
        border: '1px solid #e2e8f0',
        borderTop: `3px solid ${tone}`,
        background: `radial-gradient(circle at top right, ${alphaHex(tone, '18')} 0%, transparent 34%), linear-gradient(180deg, ${alphaHex(tone, '08')} 0%, #ffffff 52%, #ffffff 100%)`,
        boxShadow: '0 14px 28px rgba(15, 23, 42, 0.05)'
      }}
    >
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 0.4 }}>
        <Box
          sx={{
            width: 24,
            height: 24,
            borderRadius: 1.8,
            bgcolor: alphaHex(tone, '14'),
            color: tone,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {icon}
        </Box>
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.7, opacity: 0.78, fontSize: 10.4 }}>
          {title}
        </Typography>
      </Stack>
      <Typography variant="h5" sx={{ fontWeight: 900, lineHeight: 1.02, fontSize: 18.2 }}>
        {value}
      </Typography>
      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.32, fontSize: 11.1, opacity: 0.72, lineHeight: 1.25 }}>
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
        borderRadius: 2.8,
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
          px: 1,
          py: 0.78,
          borderBottom: '1px solid #edf2f7',
          background: 'linear-gradient(135deg, rgba(15,118,110,0.10) 0%, rgba(255,255,255,0.92) 54%, rgba(241,245,249,0.9) 100%)'
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, fontSize: 15 }}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" sx={{ fontSize: 11.4, opacity: 0.72, lineHeight: 1.25 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
      </Stack>
      <Box sx={{ p: 0.9 }}>{children}</Box>
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

function createTemplateFormState() {
  return {
    sectionName: '',
    itemDescription: '',
    stockCode: '',
    unitPriceZar: '',
    unitPriceUsd: '',
    division: '',
    requiredCpt: '0',
    requiredJhb: '0',
    requiredDbn: '0',
    requiredPel: '0',
    requiredBfn: '0',
    requiredGeo: '0',
    requiredPol: '0',
    requiredNel: '0'
  }
}

function buildNotWhDrafts(rows = []) {
  return Object.fromEntries(
    rows.map((row) => [row.key, { status: row.status || 'PENDING_REVIEW', notes: row.notes || '' }])
  )
}

function normalizeCompare(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
}

export default function StockManagementPage() {
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportingLowStock, setExportingLowStock] = useState(false)
  const [exportingRegional, setExportingRegional] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [runRateData, setRunRateData] = useState(null)
  const [runRateLoading, setRunRateLoading] = useState(false)
  const [runRateError, setRunRateError] = useState('')
  const [runRateMonth, setRunRateMonth] = useState('')
  const [runRateRegionFilter, setRunRateRegionFilter] = useState('')
  const [runRateSearch, setRunRateSearch] = useState('')
  const [tab, setTab] = useState(0)
  const [search, setSearch] = useState('')
  const [divisionFilter, setDivisionFilter] = useState('')
  const [stockFilter, setStockFilter] = useState('')
  const [matchFilter, setMatchFilter] = useState('')
  const [selectedItem, setSelectedItem] = useState(null)
  const [reviewItem, setReviewItem] = useState(null)
  const [savingOverride, setSavingOverride] = useState(false)
  const [applyingReviewChanges, setApplyingReviewChanges] = useState(false)
  const [editingMinimums, setEditingMinimums] = useState(false)
  const [savingMinimums, setSavingMinimums] = useState(false)
  const [minimumForm, setMinimumForm] = useState(buildRequiredSpareForm(null))
  const [reviewSelections, setReviewSelections] = useState({})
  const [deleteReviewItem, setDeleteReviewItem] = useState(false)
  const [regionWatchlistExpanded, setRegionWatchlistExpanded] = useState({})
  const [createForm, setCreateForm] = useState(createTemplateFormState())
  const [creatingTemplateItem, setCreatingTemplateItem] = useState(false)
  const [divisionExpansion, setDivisionExpansion] = useState({})
  const [notWhDrafts, setNotWhDrafts] = useState({})
  const [savingNotWhKey, setSavingNotWhKey] = useState('')
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

  useEffect(() => {
    setReviewSelections({})
    setDeleteReviewItem(false)
  }, [reviewItem])

  useEffect(() => {
    const notWhRows = data?.notWarehouseItems || []
    setNotWhDrafts(buildNotWhDrafts(notWhRows))
  }, [data?.notWarehouseItems])

  const divisions = useMemo(() => {
    const list = (data?.divisionSummary || []).map((row) => row.division).filter(Boolean)
    return Array.from(new Set(list))
  }, [data])

  const searchTerm = useMemo(() => String(search || '').trim().toLowerCase(), [search])

  const matchesItemFilters = (row) => {
    if (row.rowType !== 'ITEM') return false
    if (divisionFilter && row.division !== divisionFilter) return false
    if (stockFilter === 'low' && !row.belowMinimum) return false
    if (stockFilter === 'healthy' && row.belowMinimum) return false
    if (stockFilter === 'zero' && Number(row.availableTotal || 0) !== 0) return false
    if (matchFilter === 'matched' && row.matchMethod === 'unmatched') return false
    if (matchFilter === 'review' && !row.isLowConfidence) return false
    if (matchFilter === 'unmatched' && row.matchMethod !== 'unmatched') return false
    if (!searchTerm) return true
    return [
      row.itemDescription,
      row.stockCode,
      row.sectionName,
      row.division,
      row.matchedItemNo,
      row.matchedItemDescription
    ].some((value) => String(value || '').toLowerCase().includes(searchTerm))
  }

  const filteredItemRows = useMemo(() => {
    return (data?.items || []).filter((row) => matchesItemFilters(row))
  }, [data, divisionFilter, stockFilter, matchFilter, searchTerm])

  const divisionGroups = useMemo(() => {
    const map = new Map()
    filteredItemRows.forEach((row) => {
      const key = row.division || 'Unassigned'
      const current = map.get(key) || {
        division: key,
        rows: [],
        lowStockCount: 0,
        gapCostTotal: 0
      }
      current.rows.push(row)
      if (row.belowMinimum) current.lowStockCount += 1
      current.gapCostTotal += Number(row.gapCost || 0)
      map.set(key, current)
    })
    return [...map.values()]
      .map((group) => ({
        ...group,
        rows: group.rows.sort((left, right) => {
          if ((left.sectionName || '') !== (right.sectionName || '')) {
            return String(left.sectionName || '').localeCompare(String(right.sectionName || ''))
          }
          return Number(left.rowOrder || 0) - Number(right.rowOrder || 0)
        })
      }))
      .sort((left, right) => left.division.localeCompare(right.division))
  }, [filteredItemRows])

  const reviewRows = useMemo(() => {
    return (data?.matchReviewItems || []).filter((row) => {
      if (divisionFilter && row.division !== divisionFilter) return false
      if (!searchTerm) return true
      return [
        row.itemDescription,
        row.stockCode,
        row.division,
        row.matchedItemNo,
        row.matchedItemDescription
      ].some((value) => String(value || '').toLowerCase().includes(searchTerm))
    })
  }, [data, divisionFilter, searchTerm])

  const sectionOptions = useMemo(() => Array.from(new Set((data?.sectionOptions || []).filter(Boolean))), [data])

  const notWarehouseRows = useMemo(() => {
    return (data?.notWarehouseItems || []).filter((row) => {
      if (divisionFilter && row.division !== divisionFilter) return false
      if (!searchTerm) return true
      return [
        row.itemDescription,
        row.stockCode,
        row.division,
        row.siteId,
        row.region,
        row.status,
        row.notes
      ].some((value) => String(value || '').toLowerCase().includes(searchTerm))
    })
  }, [data, divisionFilter, searchTerm])

  const createDuplicateHints = useMemo(() => {
    const code = normalizeCompare(createForm.stockCode)
    const description = normalizeCompare(createForm.itemDescription)
    if (!code && !description) return []
    return (data?.items || [])
      .filter((row) => row.rowType === 'ITEM')
      .filter((row) => {
        const sameCode = code && normalizeCompare(row.stockCode) === code
        const sameDescription = description && normalizeCompare(row.itemDescription) === description
        return sameCode || sameDescription
      })
      .slice(0, 5)
  }, [data, createForm.stockCode, createForm.itemDescription])

  useEffect(() => {
    setDivisionExpansion((current) => {
      const next = { ...current }
      divisionGroups.forEach((group, index) => {
        if (typeof next[group.division] !== 'boolean') {
          next[group.division] = index < 4
        }
      })
      return next
    })
  }, [divisionGroups])

  useEffect(() => {
    if (runRateData?.defaultMonth && (!runRateMonth || !runRateData.monthOptions?.includes(runRateMonth))) {
      setRunRateMonth(runRateData.defaultMonth)
    }
  }, [runRateData, runRateMonth])

  const loadRunRates = async () => {
    setRunRateLoading(true)
    setRunRateError('')
    try {
      const next = await fetchStockRunRates()
      setRunRateData(next)
      return next
    } catch (err) {
      console.error(err)
      setRunRateError(err?.response?.data?.error || err?.message || 'Failed to load stock run rates')
      throw err
    } finally {
      setRunRateLoading(false)
    }
  }

  useEffect(() => {
    if (tab === 1 && !runRateData && !runRateLoading) {
      loadRunRates().catch(console.error)
    }
  }, [tab, runRateData, runRateLoading])

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      const result = await refreshStockDashboard()
      await loadData({ showLoading: false })
      setRunRateData(null)
      if (tab === 1) {
        await loadRunRates()
      }
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

  const doExportLowStock = async () => {
    setExportingLowStock(true)
    try {
      const blob = await exportLowStockWatchlistWorkbook()
      downloadBlob(blob, `stock-low-stock-${dayjs().format('YYYY-MM-DD')}.xlsx`)
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Low stock export failed'
      })
    } finally {
      setExportingLowStock(false)
    }
  }

  const doExportRegionalWatchlist = async () => {
    setExportingRegional(true)
    try {
      const blob = await exportRegionalWatchlistWorkbook()
      downloadBlob(blob, `stock-regional-watchlist-${dayjs().format('YYYY-MM-DD')}.xlsx`)
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Regional watchlist export failed'
      })
    } finally {
      setExportingRegional(false)
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

  const saveNewTemplateItem = async () => {
    setCreatingTemplateItem(true)
    try {
      const result = await createStockTemplateItem(createForm)
      setData(result.dataset)
      setCreateForm(createTemplateFormState())
      setTab(2)
      setToast({
        severity: 'success',
        message: `${createForm.itemDescription} added to the master template`
      })
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to create template item'
      })
    } finally {
      setCreatingTemplateItem(false)
    }
  }

  const updateCreateFormField = (key, value) => {
    setCreateForm((current) => ({
      ...current,
      [key]: value
    }))
  }

  const updateNotWhDraft = (rowKey, key, value) => {
    setNotWhDrafts((current) => ({
      ...current,
      [rowKey]: {
        status: current[rowKey]?.status || 'PENDING_REVIEW',
        notes: current[rowKey]?.notes || '',
        [key]: value
      }
    }))
  }

  const saveNotWarehouseRow = async (row) => {
    const draft = notWhDrafts[row.key] || { status: row.status || 'PENDING_REVIEW', notes: row.notes || '' }
    setSavingNotWhKey(row.key)
    try {
      const next = await updateStockNotWarehouseAction({
        templateItemId: row.templateItemId,
        siteId: row.siteId,
        status: draft.status,
        notes: draft.notes
      })
      setData(next)
      setToast({
        severity: 'success',
        message: `${row.itemDescription} at ${row.siteId} updated`
      })
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to update Not WH action'
      })
    } finally {
      setSavingNotWhKey('')
    }
  }

  const selectedReviewCandidates = useMemo(() => {
    if (!reviewItem) return []
    return (reviewItem.candidateMatches || []).filter((candidate) => reviewSelections[candidate.itemNo])
  }, [reviewItem, reviewSelections])

  const toggleReviewCandidate = (candidate) => {
    if (!candidate?.itemNo) return
    setReviewSelections((current) => ({
      ...current,
      [candidate.itemNo]: !current[candidate.itemNo]
    }))
  }

  const saveReviewChanges = async () => {
    if (!reviewItem) return
    if (!deleteReviewItem && !selectedReviewCandidates.length) {
      setToast({
        severity: 'warning',
        message: 'Select at least one close match or choose to delete the template item'
      })
      return
    }

    setApplyingReviewChanges(true)
    try {
      const result = await applyStockReviewActions(reviewItem.id, {
        deleteOriginal: deleteReviewItem,
        additions: selectedReviewCandidates.map((candidate) => ({
          itemNo: candidate.itemNo,
          itemDescription: candidate.itemDescription
        }))
      })

      setData(result.dataset)

      if (selectedItem?.id === reviewItem.id && deleteReviewItem) {
        setSelectedItem(null)
      } else if (selectedItem?.id) {
        const refreshedSelected = result.dataset?.items?.find((row) => row.id === selectedItem.id)
        if (refreshedSelected) {
          setSelectedItem(refreshedSelected)
        }
      }

      const messages = []
      if (deleteReviewItem) messages.push('template item removed')
      if (selectedReviewCandidates.length) {
        messages.push(`${selectedReviewCandidates.length} close ${selectedReviewCandidates.length === 1 ? 'match' : 'matches'} added`)
      }

      setReviewItem(null)
      setToast({
        severity: 'success',
        message: `${reviewItem.itemDescription}: ${messages.join(' and ')}`
      })
    } catch (err) {
      console.error(err)
      setToast({
        severity: 'error',
        message: err?.response?.data?.error || err?.message || 'Failed to apply stock review changes'
      })
    } finally {
      setApplyingReviewChanges(false)
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
  const regionWatchlist = data?.regionWatchlist || []
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
  const selectedRunRateMonth = runRateMonth || runRateData?.defaultMonth || ''
  const runRateSearchTerm = String(runRateSearch || '').trim().toLowerCase()
  const selectedRunRateMonthSummary = (runRateData?.monthSummary || []).find((row) => row.yearMonth === selectedRunRateMonth) || null
  const runRateMonthChart = (runRateData?.monthSummary || []).map((row) => ({
    month: row.yearMonth,
    usage: Number(row.usageQty || 0),
    projected: Number(row.projectedUsage || 0),
    restock: Number(row.restockQty || 0)
  }))
  const runRateRegionChart = (selectedRunRateMonthSummary?.regionBreakdown || []).map((row) => ({
    region: row.region,
    usage: Number(row.usageQty || 0),
    restock: Number(row.restockQty || 0)
  }))
  const runRateRowsForMonth = (runRateData?.rows || []).filter((row) => {
    if (selectedRunRateMonth && row.yearMonth !== selectedRunRateMonth) return false
    if (divisionFilter && row.division !== divisionFilter) return false
    if (runRateRegionFilter && row.region !== runRateRegionFilter) return false
    if (!runRateSearchTerm) return true
    return [
      row.itemDescription,
      row.stockCode,
      row.sectionName,
      row.division,
      row.matchedItemNo
    ].some((value) => String(value || '').toLowerCase().includes(runRateSearchTerm))
  })

  return (
    <Stack
      spacing={0.78}
      sx={{
        '& .MuiTableCell-root': {
          py: 0.5,
          px: 0.72,
          fontSize: 11.5
        },
        '& .MuiChip-root': {
          height: 22
        },
        '& .MuiChip-label': {
          fontSize: 10.9
        },
        '& .MuiInputBase-root': {
          fontSize: 12
        },
        '& .MuiInputLabel-root': {
          fontSize: 11.5
        },
        '& .MuiButton-root': {
          fontSize: 11.7
        }
      }}
    >
      <Paper
        elevation={0}
        sx={{
          p: 0.9,
          borderRadius: 2.7,
          border: '1px solid #d6e4de',
          color: '#fff',
          background: 'linear-gradient(135deg, #0f766e 0%, #155e63 44%, #102a43 100%)',
          boxShadow: '0 18px 36px rgba(15, 23, 42, 0.12)'
        }}
      >
        <Stack direction={{ xs: 'column', xl: 'row' }} justifyContent="space-between" spacing={0.9}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="overline" sx={{ letterSpacing: 1, opacity: 0.72 }}>
              Stock Management
            </Typography>
            <Typography variant="h4" sx={{ fontWeight: 900, lineHeight: 1.02, fontSize: 27.5 }}>
              Assurance And Engineering Stock Control
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.2, maxWidth: 820, opacity: 0.82, fontSize: 11.6, lineHeight: 1.25 }}>
              The template stays as the master source, the daily stock report feeds the live counts, and warehouse stock is separated from field-held stock for cleaner operational control.
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap" alignItems="flex-start">
            <Chip size="small" label={`Coverage ${fmtPct(summary.matchCoveragePct)}`} sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#fff', fontWeight: 700 }} />
            <Chip size="small" label={`Low stock ${fmtCount(summary.lowStockCount)}`} sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#fff', fontWeight: 700 }} />
            <Chip size="small" label={`Latest ${latestImport?.reportDate ? fmtDateTime(latestImport.reportDate) : 'No import yet'}`} sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#fff', fontWeight: 700 }} />
          </Stack>
        </Stack>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: 0.72,
          borderRadius: 2.45,
          border: '1px solid #dce7e2',
          background: 'linear-gradient(180deg, #fbfffe 0%, #f5faf8 100%)'
        }}
      >
        <Stack spacing={0.65}>
          {Number(summary.requiredTotal || 0) === 0 ? (
            <Alert severity="warning" sx={{ borderRadius: 2.5 }}>
              Minimum spares are still zero across the imported template. Open an item in Stock Master and use `Edit minimum spares` to set the baseline.
            </Alert>
          ) : null}
          <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.6} useFlexGap flexWrap="wrap">
            <TextField
              size="small"
              label="Search Stock"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Description, code, division, matched item..."
              sx={{ minWidth: 200 }}
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
              sx={{ minWidth: 122 }}
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
              sx={{ minWidth: 118 }}
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
              sx={{ minWidth: 118 }}
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
              sx={{ minHeight: 30, borderRadius: 2.2, textTransform: 'none', fontWeight: 800, px: 0.95 }}
            >
              {refreshing ? 'Refreshing...' : 'Run Daily Refresh'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<FileDownloadOutlinedIcon />}
              onClick={doExport}
              disabled={exporting}
              sx={{ minHeight: 30, borderRadius: 2.2, textTransform: 'none', fontWeight: 800, px: 0.95 }}
            >
              {exporting ? 'Exporting...' : 'Export Master Workbook'}
            </Button>
          </Stack>
          <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap">
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
          minHeight: 34,
          '& .MuiTab-root': {
            minHeight: 34,
            textTransform: 'none',
            fontWeight: 700,
            fontSize: 12.1,
            px: 1.1,
            minWidth: 0
          }
        }}
      >
        <Tab label="Overview" />
        <Tab label="Run Rates" />
        <Tab label="Master Stock" />
        <Tab label="Match Review" />
        <Tab label="Add Template Item" />
        <Tab label="Not WH Workflow" />
      </Tabs>

      {tab === 0 ? (
        <Stack spacing={0.82}>
          <Box
            sx={{
              display: 'grid',
              gap: 0.72,
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
            <Card title="WH Available vs Required" value={`${fmtCount(summary.availableTotal)} / ${fmtCount(summary.requiredTotal)}`} subtext="Usable warehouse stock against required spares" tone="#0f172a" icon={<WarehouseOutlinedIcon sx={{ fontSize: 16 }} />} />
          </Box>

          <Box
            sx={{
              display: 'grid',
              gap: 0.8,
              gridTemplateColumns: {
                xs: '1fr',
                xl: '1.2fr 0.8fr'
              }
            }}
          >
            <SectionCard title="Regional Stock Position" subtitle="Available stock versus required spares, with warehouse and field holdings considered separately.">
              <ResponsiveContainer width="100%" height={220}>
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

            <SectionCard
              title="Low Stock Watchlist"
              subtitle="Highest usable-stock gaps against required spares, with derived cost exposure."
              action={(
                <Stack direction="row" spacing={0.5} alignItems="center">
                  <Chip size="small" label={`${fmtCount(data?.lowStockItems?.length || 0)} items`} sx={{ fontWeight: 700 }} />
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<FileDownloadOutlinedIcon />}
                    onClick={doExportLowStock}
                    disabled={exportingLowStock}
                    sx={{ minHeight: 28, px: 0.75, textTransform: 'none', fontWeight: 800, borderRadius: 1.8 }}
                  >
                    {exportingLowStock ? 'Exporting...' : 'Export'}
                  </Button>
                </Stack>
              )}
            >
              <TableContainer sx={{ maxHeight: 215, overflowY: 'auto' }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Item</TableCell>
                      <TableCell align="right">Required</TableCell>
                      <TableCell align="right">WH Available</TableCell>
                      <TableCell align="right">Gap</TableCell>
                      <TableCell align="right">Unit Cost</TableCell>
                      <TableCell align="right">Gap Cost</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {(data?.lowStockItems || []).map((row) => (
                      <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedItem(row)}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.itemDescription}</Typography>
                          <Typography variant="caption" sx={{ opacity: 0.72 }}>{row.stockCode || 'No stock code'}</Typography>
                        </TableCell>
                        <TableCell align="right">{fmtCount(row.requiredTotal)}</TableCell>
                        <TableCell align="right">{fmtCount(row.availableTotal)}</TableCell>
                        <TableCell align="right">{fmtCount(row.shortage)}</TableCell>
                        <TableCell align="right">{fmtMoney(row.unitCost)}</TableCell>
                        <TableCell align="right">{fmtMoney(row.gapCost)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </SectionCard>
          </Box>

          <SectionCard
            title="Regional Watchlist"
            subtitle="Top warehouse-usable shortages by region. Not WH stock stays visible for context but remains excluded from the gap logic."
            action={(
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip size="small" label={`${fmtCount(regionWatchlist.length)} active regions`} sx={{ fontWeight: 700 }} />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<FileDownloadOutlinedIcon />}
                  onClick={doExportRegionalWatchlist}
                  disabled={exportingRegional}
                  sx={{ minHeight: 28, px: 0.75, textTransform: 'none', fontWeight: 800, borderRadius: 1.8 }}
                >
                  {exportingRegional ? 'Exporting...' : 'Export'}
                </Button>
              </Stack>
            )}
          >
            {regionWatchlist.length ? (
              <Box
                sx={{
                  display: 'grid',
                  gap: 0.72,
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(2, minmax(0, 1fr))',
                    xl: 'repeat(4, minmax(0, 1fr))'
                  }
                }}
              >
                {regionWatchlist.map((region) => {
                  const isExpanded = Boolean(regionWatchlistExpanded[region.region])
                  const hasMore = region.rows.length > REGION_WATCHLIST_PREVIEW_COUNT
                  const visibleRows = isExpanded ? region.rows : region.rows.slice(0, REGION_WATCHLIST_PREVIEW_COUNT)

                  return (
                    <Paper
                      key={region.region}
                      variant="outlined"
                      sx={{
                        p: 0.78,
                        borderRadius: 2.2,
                        borderColor: '#d8e6df',
                        background: 'linear-gradient(180deg, rgba(248,250,252,0.9) 0%, rgba(255,255,255,1) 100%)'
                      }}
                    >
                      <Stack spacing={0.55}>
                        <Stack direction="row" justifyContent="space-between" spacing={0.6} alignItems="flex-start">
                          <Box sx={{ minWidth: 0 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 900, fontSize: 13 }}>
                              {region.region}
                            </Typography>
                            <Typography variant="caption" sx={{ fontSize: 10.5, opacity: 0.72 }}>
                              {fmtCount(region.affectedItems)} items below regional minimum
                              {hasMore ? ` • showing ${isExpanded ? 'all' : `top ${REGION_WATCHLIST_PREVIEW_COUNT}`}` : ''}
                            </Typography>
                          </Box>
                          <Stack spacing={0.35} alignItems="flex-end">
                            <Chip size="small" label={`Gap ${fmtCount(region.totalGap)}`} sx={{ fontWeight: 800, bgcolor: '#fee2e2', color: '#b91c1c', height: 22 }} />
                            <Chip size="small" label={fmtMoney(region.totalGapCost)} sx={{ fontWeight: 800, bgcolor: '#eff6ff', color: '#1d4ed8', height: 22 }} />
                          </Stack>
                        </Stack>

                        <Stack spacing={0.42}>
                          {visibleRows.map((entry) => (
                            <Paper
                              key={`${region.region}-${entry.row.id}`}
                              variant="outlined"
                              onClick={() => {
                                const fullItem = (data?.items || []).find((row) => row.id === entry.row.id)
                                setSelectedItem(fullItem || entry.row)
                              }}
                              sx={{
                                p: 0.6,
                                borderRadius: 1.8,
                                cursor: 'pointer',
                                borderColor: '#e2e8f0',
                                transition: 'all 0.15s ease',
                                '&:hover': {
                                  borderColor: '#0f766e',
                                  boxShadow: '0 10px 20px rgba(15, 118, 110, 0.08)',
                                  transform: 'translateY(-1px)'
                                }
                              }}
                            >
                              <Stack spacing={0.3}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 800,
                                    fontSize: 11.1,
                                    lineHeight: 1.18,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                  }}
                                >
                                  {entry.row.itemDescription}
                                </Typography>
                                <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                                  <Chip size="small" label={`Req ${fmtCount(entry.required)}`} sx={{ height: 20, '& .MuiChip-label': { px: 0.7, fontSize: 10.4 } }} />
                                  <Chip size="small" label={`WH ${fmtCount(entry.warehouseAvailable)}`} sx={{ height: 20, bgcolor: '#dcfce7', color: '#166534', '& .MuiChip-label': { px: 0.7, fontSize: 10.4 } }} />
                                  <Chip size="small" label={`Not WH ${fmtCount(entry.notWh)}`} sx={{ height: 20, bgcolor: '#fff7ed', color: '#c2410c', '& .MuiChip-label': { px: 0.7, fontSize: 10.4 } }} />
                                  <Chip size="small" label={`Gap ${fmtCount(entry.gap)}`} sx={{ height: 20, bgcolor: '#fee2e2', color: '#b91c1c', '& .MuiChip-label': { px: 0.7, fontSize: 10.4, fontWeight: 800 } }} />
                                </Stack>
                              </Stack>
                            </Paper>
                          ))}
                        </Stack>

                        {hasMore ? (
                          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={0.75}>
                            <Typography variant="caption" sx={{ fontSize: 10.5, opacity: 0.72 }}>
                              {isExpanded
                                ? `Showing all ${fmtCount(region.rows.length)} items`
                                : `${fmtCount(region.rows.length - REGION_WATCHLIST_PREVIEW_COUNT)} more items hidden`}
                            </Typography>
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => {
                                setRegionWatchlistExpanded((current) => ({
                                  ...current,
                                  [region.region]: !isExpanded
                                }))
                              }}
                              sx={{
                                minWidth: 0,
                                px: 0.55,
                                py: 0.15,
                                fontSize: 10.8,
                                fontWeight: 800,
                                textTransform: 'none',
                                borderRadius: 1.6
                              }}
                            >
                              {isExpanded ? 'Show less' : `Show all ${fmtCount(region.rows.length)}`}
                            </Button>
                          </Stack>
                        ) : null}
                      </Stack>
                    </Paper>
                  )
                })}
              </Box>
            ) : (
              <Alert severity="success" sx={{ borderRadius: 2.2 }}>
                No regional shortages are currently open against the configured minimum spares.
              </Alert>
            )}
          </SectionCard>

          <Box
            sx={{
              display: 'grid',
              gap: 0.8,
              gridTemplateColumns: {
                xs: '1fr',
                xl: '0.9fr 1.1fr'
              }
            }}
          >
            <SectionCard title="Division Pressure" subtitle="Divisions carrying the highest low-stock count right now.">
              <ResponsiveContainer width="100%" height={215}>
                <BarChart data={divisionChart} layout="vertical" margin={{ left: 24, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="division" width={92} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="low" fill="#f59e0b" radius={[0, 4, 4, 0]} name="Low Stock Items" />
                </BarChart>
              </ResponsiveContainer>
            </SectionCard>

            <SectionCard title="Import Control" subtitle="Latest import health and a short run history.">
              <Stack spacing={0.72}>
                <Paper variant="outlined" sx={{ p: 0.82 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Latest Stock Report</Typography>
                  <Typography variant="body2" sx={{ mt: 0.35, fontSize: 11.3 }}>Report date: {fmtDateTime(latestImport?.reportDate)}</Typography>
                  <Typography variant="body2" sx={{ fontSize: 11.3 }}>Imported: {fmtDateTime(latestImport?.createdAt)}</Typography>
                  <Typography variant="body2" sx={{ fontSize: 11.3 }}>Source file: {latestImport?.sourceFilename || 'N/A'}</Typography>
                </Paper>
                <Paper variant="outlined" sx={{ p: 0.82 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.4 }}>Recent Import History</Typography>
                  <Stack spacing={0.35}>
                    {(data?.importHistory || []).slice(0, 5).map((row) => (
                      <Stack key={row.id} direction="row" justifyContent="space-between" spacing={1}>
                        <Typography variant="caption" sx={{ fontSize: 10.6 }}>{fmtDateTime(row.reportDate || row.createdAt)}</Typography>
                        <Typography variant="caption" sx={{ fontSize: 10.6 }}>{fmtCount(row.statusRowCount)} rows</Typography>
                      </Stack>
                    ))}
                  </Stack>
                </Paper>
              </Stack>
            </SectionCard>
          </Box>
        </Stack>
      ) : null}

      {tab === 1 ? (
        runRateLoading && !runRateData ? (
          <Paper elevation={0} sx={{ p: 3, border: '1px solid #e2e8f0', borderRadius: 2.6 }}>
            <Stack direction="row" spacing={1.2} alignItems="center">
              <CircularProgress size={22} />
              <Typography>Loading stock run rates...</Typography>
            </Stack>
          </Paper>
        ) : runRateError && !runRateData ? (
          <Alert severity="error" sx={{ borderRadius: 2.4 }}>{runRateError}</Alert>
        ) : (
          <Stack spacing={0.82}>
            <Alert severity={runRateData?.hasEnoughHistory ? 'info' : 'warning'} sx={{ borderRadius: 2.4 }}>
              Hack run rates count day-to-day drops in warehouse-usable stock from the daily stock status imports.
              {runRateData?.hasEnoughHistory
                ? ' Restocks are shown separately so we can see movement without pretending this is a perfect consumption model.'
                : ' We only have a starting baseline right now, so usage will become meaningful after more daily imports land.'}
            </Alert>

            <Box
              sx={{
                display: 'grid',
                gap: 0.72,
                gridTemplateColumns: {
                  xs: '1fr',
                  sm: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(4, minmax(0, 1fr))'
                }
              }}
            >
              <Card title="Months Tracked" value={fmtCount(runRateData?.summary?.monthsTracked || 0)} subtext="Distinct months with stock snapshot history" tone="#0f766e" icon={<Inventory2OutlinedIcon sx={{ fontSize: 16 }} />} />
              <Card title="Snapshots" value={fmtCount(runRateData?.summary?.snapshotsTracked || 0)} subtext="Daily stock report imports captured for movement tracking" tone="#1d4ed8" icon={<ChecklistOutlinedIcon sx={{ fontSize: 16 }} />} />
              <Card title="Current Month Use" value={fmtDecimal(runRateData?.summary?.currentMonthUsage || 0)} subtext="Warehouse-usable stock drops counted this month" tone="#dc2626" icon={<WarningAmberRoundedIcon sx={{ fontSize: 16 }} />} />
              <Card title="Projected Use" value={fmtDecimal(runRateData?.summary?.currentMonthProjectedUsage || 0)} subtext="Simple month projection from the captured daily movement so far" tone="#7c3aed" icon={<RouteOutlinedIcon sx={{ fontSize: 16 }} />} />
            </Box>

            <SectionCard
              title="Run Rate Filters"
              subtitle="Use month, region, and item search to inspect the movement pattern from the imported daily stock sheets."
              action={(
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => loadRunRates().catch(console.error)}
                  disabled={runRateLoading}
                  sx={{ minHeight: 28, px: 0.75, textTransform: 'none', fontWeight: 800, borderRadius: 1.8 }}
                >
                  {runRateLoading ? 'Refreshing...' : 'Reload'}
                </Button>
              )}
            >
              <Box
                sx={{
                  display: 'grid',
                  gap: 0.65,
                  gridTemplateColumns: {
                    xs: '1fr',
                    md: 'repeat(3, minmax(0, 1fr))'
                  }
                }}
              >
                <TextField
                  size="small"
                  select
                  label="Month"
                  value={selectedRunRateMonth}
                  onChange={(event) => setRunRateMonth(event.target.value)}
                >
                  {(runRateData?.monthOptions || []).map((value) => (
                    <MenuItem key={value} value={value}>{fmtMonthLabel(value)}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  select
                  label="Region"
                  value={runRateRegionFilter}
                  onChange={(event) => setRunRateRegionFilter(event.target.value)}
                >
                  <MenuItem value="">All Regions</MenuItem>
                  {STOCK_REGIONS.map((region) => (
                    <MenuItem key={region} value={region}>{region}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  label="Search Item"
                  value={runRateSearch}
                  onChange={(event) => setRunRateSearch(event.target.value)}
                  placeholder="Description, stock code, division..."
                  InputProps={{
                    startAdornment: <SearchRoundedIcon sx={{ mr: 0.75, fontSize: 18, color: 'text.secondary' }} />
                  }}
                />
              </Box>
            </SectionCard>

            {(runRateData?.monthOptions || []).length ? (
              <>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 0.8,
                    gridTemplateColumns: {
                      xs: '1fr',
                      xl: '1.05fr 0.95fr'
                    }
                  }}
                >
                  <SectionCard title="Monthly Usage Trend" subtitle="Warehouse-usable decreases are treated as stock usage, while increases show as replenishment or rebalancing.">
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={runRateMonthChart} margin={{ left: 0, right: 12, top: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <Tooltip />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="usage" fill="#dc2626" radius={[4, 4, 0, 0]} name="Usage" />
                        <Bar dataKey="restock" fill="#0f766e" radius={[4, 4, 0, 0]} name="Restock" />
                      </BarChart>
                    </ResponsiveContainer>
                  </SectionCard>

                  <SectionCard title={`Regional Usage For ${fmtMonthLabel(selectedRunRateMonth)}`} subtitle="Movement split by region for the selected month.">
                    {(runRateRegionChart || []).length ? (
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart data={runRateRegionChart} layout="vertical" margin={{ left: 12, right: 12, top: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                          <XAxis type="number" tick={{ fontSize: 11 }} />
                          <YAxis type="category" dataKey="region" width={54} tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Bar dataKey="usage" fill="#dc2626" radius={[0, 4, 4, 0]} name="Usage" />
                          <Bar dataKey="restock" fill="#0f766e" radius={[0, 4, 4, 0]} name="Restock" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <Alert severity="info" sx={{ borderRadius: 2.2 }}>
                        No regional movement is available for the selected month yet.
                      </Alert>
                    )}
                  </SectionCard>
                </Box>

                <SectionCard
                  title="Run Rate Detail"
                  subtitle="Month-level item and region movement from the daily stock snapshots. Usage reflects warehouse stock drops only."
                  action={<Chip size="small" label={`${fmtCount(runRateRowsForMonth.length)} rows`} sx={{ fontWeight: 700 }} />}
                >
                  {selectedRunRateMonthSummary ? (
                    <Stack spacing={0.7}>
                      <Stack direction="row" spacing={0.55} useFlexGap flexWrap="wrap">
                        <Chip size="small" label={`${fmtMonthLabel(selectedRunRateMonthSummary.yearMonth)}`} sx={{ fontWeight: 700 }} />
                        <Chip size="small" label={`Usage ${fmtDecimal(selectedRunRateMonthSummary.usageQty)}`} sx={{ fontWeight: 700, bgcolor: '#fee2e2', color: '#b91c1c' }} />
                        <Chip size="small" label={`Restock ${fmtDecimal(selectedRunRateMonthSummary.restockQty)}`} sx={{ fontWeight: 700, bgcolor: '#dcfce7', color: '#166534' }} />
                        <Chip size="small" label={`Projected ${fmtDecimal(selectedRunRateMonthSummary.projectedUsage)}`} sx={{ fontWeight: 700, bgcolor: '#eff6ff', color: '#1d4ed8' }} />
                      </Stack>
                      <TableContainer sx={{ maxHeight: '54vh' }}>
                        <Table size="small" stickyHeader>
                          <TableHead>
                            <TableRow>
                              <TableCell>Item</TableCell>
                              <TableCell>Region</TableCell>
                              <TableCell>Division</TableCell>
                              <TableCell align="right">Start WH</TableCell>
                              <TableCell align="right">End WH</TableCell>
                              <TableCell align="right">Usage</TableCell>
                              <TableCell align="right">Restock</TableCell>
                              <TableCell align="right">Net</TableCell>
                              <TableCell align="right">Avg / Day</TableCell>
                              <TableCell align="right">Required</TableCell>
                              <TableCell align="right">Ord.</TableCell>
                              <TableCell align="right">Snapshots</TableCell>
                              <TableCell>Last Snapshot</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {runRateRowsForMonth.map((row) => (
                              <TableRow key={`${row.templateItemId}-${row.region}-${row.yearMonth}`} hover>
                                <TableCell sx={{ minWidth: 240 }}>
                                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{row.itemDescription}</Typography>
                                  <Typography variant="caption" sx={{ opacity: 0.72 }}>{row.stockCode || row.matchedItemNo || 'No stock code'}</Typography>
                                </TableCell>
                                <TableCell>{row.region}</TableCell>
                                <TableCell>{row.division || 'Unassigned'}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.startingWarehouse, 0)}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.endingWarehouse, 0)}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.usageQty)}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.restockQty)}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.netChange)}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.avgDailyUsage)}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.required, 0)}</TableCell>
                                <TableCell align="right">{fmtDecimal(row.latestOrderedStock, 0)}</TableCell>
                                <TableCell align="right">{fmtCount(row.snapshotCount)}</TableCell>
                                <TableCell>{fmtDateTime(row.lastSnapshotDate)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </Stack>
                  ) : (
                    <Alert severity="info" sx={{ borderRadius: 2.2 }}>
                      No run rate summary is available for the selected month yet.
                    </Alert>
                  )}
                </SectionCard>
              </>
            ) : (
              <Alert severity="info" sx={{ borderRadius: 2.4 }}>
                No stock snapshot history is available yet. The daily stock imports will start building the run rate view from this point forward.
              </Alert>
            )}
          </Stack>
        )
      ) : null}

      {tab === 2 ? (
        <SectionCard
          title="Master Stock Table"
          subtitle="Grouped by division. Warehouse-usable stock is separated from Not WH stock, with derived unit cost and gap cost included."
          action={<Chip size="small" label={`${fmtCount(filteredItemRows.length)} visible items`} sx={{ fontWeight: 700 }} />}
        >
          <Stack spacing={0.55}>
            {divisionGroups.map((group) => (
              <Accordion
                key={group.division}
                disableGutters
                expanded={Boolean(divisionExpansion[group.division])}
                onChange={(_, expanded) => {
                  setDivisionExpansion((current) => ({
                    ...current,
                    [group.division]: expanded
                  }))
                }}
                sx={{
                  borderRadius: '14px !important',
                  border: '1px solid #e2e8f0',
                  boxShadow: 'none',
                  overflow: 'hidden',
                  '&:before': { display: 'none' }
                }}
              >
                <AccordionSummary
                  expandIcon={<ExpandMoreRoundedIcon />}
                  sx={{
                    minHeight: 40,
                    px: 0.9,
                    py: 0.1,
                    bgcolor: '#f8fafc',
                    '& .MuiAccordionSummary-content': { my: 0.35 }
                  }}
                >
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.55} alignItems={{ xs: 'flex-start', md: 'center' }} useFlexGap flexWrap="wrap">
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, fontSize: 13.2 }}>
                      {group.division}
                    </Typography>
                    <Chip size="small" label={`${fmtCount(group.rows.length)} items`} sx={{ fontWeight: 700, height: 22, '& .MuiChip-label': { px: 0.9, fontSize: 11.2 } }} />
                    <Chip size="small" label={`${fmtCount(group.lowStockCount)} low`} sx={{ fontWeight: 700, height: 22, bgcolor: '#fee2e2', color: '#b91c1c', '& .MuiChip-label': { px: 0.9, fontSize: 11.2 } }} />
                    <Chip size="small" label={`Gap ${fmtMoney(group.gapCostTotal)}`} sx={{ fontWeight: 700, height: 22, bgcolor: '#eff6ff', color: '#1d4ed8', '& .MuiChip-label': { px: 0.9, fontSize: 11.2 } }} />
                  </Stack>
                </AccordionSummary>
                <AccordionDetails sx={{ p: 0 }}>
                  <Box sx={{ overflowX: 'auto' }}>
                    <Table
                      size="small"
                      sx={{
                        minWidth: 1254,
                        tableLayout: 'fixed',
                        '& .MuiTableCell-root': {
                          py: 0.34,
                          px: 0.45,
                          fontSize: 10.6,
                          whiteSpace: 'nowrap'
                        },
                        '& .MuiTableHead-root .MuiTableCell-root': {
                          fontSize: 10.2,
                          fontWeight: 800
                        }
                      }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell sx={MASTER_ITEM_CELL_SX}>Item</TableCell>
                          <TableCell sx={MASTER_SECTION_CELL_SX}>Section</TableCell>
                          <TableCell sx={MASTER_MATCH_CELL_SX}>Match</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Required</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>WH Avail</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Not WH</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Ord.</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Gap</TableCell>
                          <TableCell align="right" sx={MASTER_MONEY_CELL_SX}>Unit Cost</TableCell>
                          <TableCell align="right" sx={MASTER_MONEY_CELL_SX}>Gap Cost</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>CPT</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>JHB</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>DBN</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>PEL</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>BFN</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>GEO</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>POL</TableCell>
                          <TableCell align="right" sx={MASTER_REGION_CELL_SX}>NEL</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {group.rows.map((row) => {
                          const tone = statusTone(row)
                          return (
                            <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedItem(row)}>
                              <TableCell sx={MASTER_ITEM_CELL_SX}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 700,
                                    fontSize: 10.8,
                                    lineHeight: 1.12,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                    whiteSpace: 'normal',
                                    wordBreak: 'break-word'
                                  }}
                                >
                                  {row.itemDescription}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    opacity: 0.72,
                                    fontSize: 9.7,
                                    lineHeight: 1.06,
                                    display: 'block',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis'
                                  }}
                                >
                                  {row.stockCode || 'No stock code'}
                                </Typography>
                              </TableCell>
                              <TableCell sx={MASTER_SECTION_CELL_SX}>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontSize: 10.1,
                                    lineHeight: 1.1,
                                    whiteSpace: 'normal',
                                    wordBreak: 'break-word',
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden'
                                  }}
                                >
                                  {row.sectionName || 'General'}
                                </Typography>
                              </TableCell>
                              <TableCell sx={MASTER_MATCH_CELL_SX}>
                                <Chip
                                  size="small"
                                  label={row.matchStatus}
                                  color={matchTone(row)}
                                  sx={{ fontWeight: 700, height: 20, '& .MuiChip-label': { px: 0.65, fontSize: 9.9 } }}
                                />
                              </TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>{fmtCount(row.requiredTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>
                                <Typography component="span" sx={{ fontWeight: 800, color: tone.color }}>
                                  {fmtCount(row.availableTotal)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>{fmtCount(row.notInWarehouses)}</TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>{fmtCount(row.orderedStock)}</TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>
                                <Typography
                                  component="span"
                                  sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    minWidth: 38,
                                    px: 0.55,
                                    py: 0.1,
                                    borderRadius: 999,
                                    fontWeight: 900,
                                    fontSize: 10.2,
                                    color: row.shortage > 0 ? '#b91c1c' : '#166534',
                                    bgcolor: row.shortage > 0 ? '#fee2e2' : '#dcfce7'
                                  }}
                                >
                                  {fmtCount(row.shortage)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right" sx={MASTER_MONEY_CELL_SX}>{fmtMoney(row.unitCost)}</TableCell>
                              <TableCell align="right" sx={MASTER_MONEY_CELL_SX}>{fmtMoney(row.gapCost)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.cptTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.jhbTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.dbnTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.pelTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.bfnTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.geoTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.polTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_REGION_CELL_SX}>{fmtCount(row.nelTotal)}</TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </Box>
                </AccordionDetails>
              </Accordion>
            ))}
          </Stack>
        </SectionCard>
      ) : null}

      {tab === 3 ? (
        <SectionCard
          title="Match Review"
          subtitle="Review low-confidence and unmatched items, then lock in an override so the daily refresh stays stable."
          action={<Chip size="small" label={`${fmtCount(reviewRows.length)} items`} sx={{ fontWeight: 700 }} />}
        >
          <TableContainer sx={{ maxHeight: '66vh' }}>
            <Table
              size="small"
              stickyHeader
              sx={{
                '& .MuiTableCell-root': {
                  py: 0.45,
                  px: 0.6,
                  fontSize: 11.2
                }
              }}
            >
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
                            sx={{ maxWidth: 220, height: 21, '& .MuiChip-label': { fontSize: 10.5 } }}
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
                        sx={{ textTransform: 'none', fontWeight: 700, minHeight: 28, px: 0.9 }}
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

      {tab === 4 ? (
        <SectionCard
          title="Add Template Item"
          subtitle="Create a new master-template stock row with duplicate checking before save. New items join the live stock matching immediately after creation."
          action={<Chip size="small" label={`${fmtCount(sectionOptions.length)} known sections`} sx={{ fontWeight: 700 }} />}
        >
          <Stack spacing={0.8}>
            {createDuplicateHints.length ? (
              <Alert severity="warning" sx={{ borderRadius: 2.4 }}>
                A possible duplicate already exists. Review the matches below before saving a new template item.
              </Alert>
            ) : null}
            <Box
              sx={{
                display: 'grid',
                gap: 0.7,
                gridTemplateColumns: {
                  xs: '1fr',
                  md: 'repeat(2, minmax(0, 1fr))',
                  xl: 'repeat(5, minmax(0, 1fr))'
                }
              }}
            >
              <TextField
                size="small"
                label="Template Section"
                value={createForm.sectionName}
                onChange={(event) => updateCreateFormField('sectionName', event.target.value)}
                placeholder="Use an existing section name if possible"
              />
              <TextField
                size="small"
                label="Division"
                value={createForm.division}
                onChange={(event) => updateCreateFormField('division', event.target.value)}
                placeholder="Assurance / Engineering ..."
              />
              <TextField
                size="small"
                label="Item Description"
                value={createForm.itemDescription}
                onChange={(event) => updateCreateFormField('itemDescription', event.target.value)}
                required
              />
              <TextField
                size="small"
                label="Stock Code"
                value={createForm.stockCode}
                onChange={(event) => updateCreateFormField('stockCode', event.target.value)}
              />
              <TextField
                size="small"
                label="Unit Price ZAR"
                value={createForm.unitPriceZar}
                onChange={(event) => updateCreateFormField('unitPriceZar', event.target.value)}
              />
              <TextField
                size="small"
                label="Unit Price USD"
                value={createForm.unitPriceUsd}
                onChange={(event) => updateCreateFormField('unitPriceUsd', event.target.value)}
              />
              {REQUIRED_SPARE_FIELDS.map((field) => (
                <TextField
                  key={field.key}
                  size="small"
                  label={`Required ${field.region}`}
                  value={createForm[field.key]}
                  onChange={(event) => updateCreateFormField(field.key, event.target.value)}
                />
              ))}
            </Box>

            {sectionOptions.length ? (
              <Typography variant="caption" sx={{ opacity: 0.72, fontSize: 10.6 }}>
                Existing sections: {sectionOptions.slice(0, 10).join(' | ')}
              </Typography>
            ) : null}

            {createDuplicateHints.length ? (
              <Paper variant="outlined" sx={{ p: 0.82, borderRadius: 2.2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.45, fontSize: 13 }}>
                  Possible duplicates
                </Typography>
                <Stack spacing={0.35}>
                  {createDuplicateHints.map((row) => (
                    <Stack key={row.id} direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={0.7}>
                      <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 11.4 }}>{row.itemDescription}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.74, fontSize: 10.5 }}>
                        {row.stockCode || 'No stock code'} | {row.division || 'Unassigned'}
                      </Typography>
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            ) : null}

            <Stack direction="row" spacing={0.6} justifyContent="flex-end" useFlexGap flexWrap="wrap">
              <Button
                size="small"
                variant="outlined"
                onClick={() => setCreateForm(createTemplateFormState())}
                sx={{ textTransform: 'none', fontWeight: 800, minHeight: 29, px: 0.9 }}
              >
                Reset
              </Button>
              <Button
                size="small"
                variant="contained"
                startIcon={<AddCircleOutlineRoundedIcon />}
                onClick={saveNewTemplateItem}
                disabled={creatingTemplateItem || !createForm.itemDescription.trim() || !createForm.division.trim() || createDuplicateHints.length > 0}
                sx={{ textTransform: 'none', fontWeight: 800, borderRadius: 2.2, minHeight: 29, px: 0.95 }}
              >
                {creatingTemplateItem ? 'Saving...' : 'Create Template Item'}
              </Button>
            </Stack>
          </Stack>
        </SectionCard>
      ) : null}

      {tab === 5 ? (
        <SectionCard
          title="Not WH Workflow"
          subtitle="Track field-held stock separately from usable warehouse stock. Save the next action per site line so testing and supplier-return workflows stay visible between daily refreshes."
          action={<Chip size="small" label={`${fmtCount(notWarehouseRows.length)} lines`} sx={{ fontWeight: 700 }} />}
        >
          {notWarehouseRows.length ? (
            <TableContainer sx={{ maxHeight: '70vh' }}>
              <Table
                size="small"
                stickyHeader
                sx={{
                  minWidth: 1180,
                  '& .MuiTableCell-root': {
                    py: 0.42,
                    px: 0.58,
                    fontSize: 11.1
                  }
                }}
              >
                <TableHead>
                  <TableRow>
                    <TableCell>Item</TableCell>
                    <TableCell>Division</TableCell>
                    <TableCell>Site</TableCell>
                    <TableCell>Region</TableCell>
                    <TableCell align="right">Qty</TableCell>
                    <TableCell align="right">Unit Cost</TableCell>
                    <TableCell align="right">Value</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Notes</TableCell>
                    <TableCell>Updated</TableCell>
                    <TableCell align="right">Action</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {notWarehouseRows.map((row) => {
                    const draft = notWhDrafts[row.key] || { status: row.status, notes: row.notes }
                    return (
                      <TableRow key={row.key} hover>
                        <TableCell sx={{ minWidth: 210, maxWidth: 210 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700, fontSize: 11.4 }}>{row.itemDescription}</Typography>
                          <Typography variant="caption" sx={{ opacity: 0.72, fontSize: 10.5 }}>{row.stockCode || 'No stock code'}</Typography>
                        </TableCell>
                        <TableCell>{row.division || 'Unassigned'}</TableCell>
                        <TableCell>{row.siteId}</TableCell>
                        <TableCell>{row.region}</TableCell>
                        <TableCell align="right">{fmtCount(row.qtyAvailable)}</TableCell>
                        <TableCell align="right">{fmtMoney(row.unitCost)}</TableCell>
                        <TableCell align="right">{fmtMoney(row.totalValue)}</TableCell>
                        <TableCell sx={{ minWidth: 180 }}>
                          <TextField
                            size="small"
                            select
                            value={draft.status}
                            onChange={(event) => updateNotWhDraft(row.key, 'status', event.target.value)}
                            fullWidth
                          >
                            {NOT_WH_STATUS_OPTIONS.map((option) => (
                              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                            ))}
                          </TextField>
                        </TableCell>
                        <TableCell sx={{ minWidth: 220 }}>
                          <TextField
                            size="small"
                            value={draft.notes}
                            onChange={(event) => updateNotWhDraft(row.key, 'notes', event.target.value)}
                            placeholder="Testing notes / supplier return / next step"
                            fullWidth
                          />
                        </TableCell>
                        <TableCell sx={{ minWidth: 138 }}>
                          <Typography variant="caption" sx={{ display: 'block', fontSize: 10.4 }}>
                            {row.updatedAt ? fmtDateTime(row.updatedAt) : 'Not saved yet'}
                          </Typography>
                          <Typography variant="caption" sx={{ opacity: 0.7, fontSize: 10.2 }}>
                            {row.updatedBy || ''}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            variant="contained"
                            onClick={() => saveNotWarehouseRow(row)}
                            disabled={savingNotWhKey === row.key}
                            sx={{ textTransform: 'none', fontWeight: 800, borderRadius: 2, minHeight: 28, px: 0.85 }}
                          >
                            {savingNotWhKey === row.key ? 'Saving...' : 'Save'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          ) : (
            <Alert severity="info" sx={{ borderRadius: 2.4 }}>
              No current Not WH stock lines are visible for the selected filters.
            </Alert>
          )}
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
                <Chip label={`WH Available ${fmtCount(selectedItem.availableTotal)}`} />
                <Chip label={`Not WH ${fmtCount(selectedItem.notInWarehouses)}`} />
                <Chip label={`Ordered ${fmtCount(selectedItem.orderedStock)}`} />
                <Chip label={`Gap ${fmtCount(selectedItem.shortage)}`} />
                <Chip label={`Unit cost ${fmtMoney(selectedItem.unitCost)}`} />
                <Chip label={`Gap cost ${fmtMoney(selectedItem.gapCost)}`} />
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
              <Alert severity="info">
                Add one or more close matches as new template rows. If you replace the item with exactly one close match, the current minimum spares move across automatically. If you add multiple rows, new rows start with zero minimum spares so we do not double count.
              </Alert>
              <Stack spacing={0.8}>
                {(reviewItem.candidateMatches || []).map((candidate) => (
                  <Paper key={`${reviewItem.id}-${candidate.itemNo}`} variant="outlined" sx={{ p: 1 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" spacing={1}>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.8} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                          <Checkbox
                            size="small"
                            checked={Boolean(reviewSelections[candidate.itemNo])}
                            onChange={() => toggleReviewCandidate(candidate)}
                            sx={{ p: 0.2 }}
                          />
                          <Typography variant="body2" sx={{ fontWeight: 800 }}>{candidate.itemNo}</Typography>
                          {reviewItem.matchedItemNo === candidate.itemNo ? (
                            <Chip size="small" color="success" label="Current match" sx={{ fontWeight: 700 }} />
                          ) : null}
                        </Stack>
                        <Typography variant="body2" sx={{ opacity: 0.78 }}>{candidate.itemDescription}</Typography>
                        <Typography variant="caption" sx={{ opacity: 0.72 }}>Score {Number(candidate.score || 0).toFixed(2)}</Typography>
                      </Box>
                      <Stack direction="row" spacing={0.8} sx={{ alignSelf: 'flex-start' }}>
                        <Button
                          size="small"
                          variant={reviewSelections[candidate.itemNo] ? 'contained' : 'outlined'}
                          color={reviewSelections[candidate.itemNo] ? 'success' : 'inherit'}
                          onClick={() => toggleReviewCandidate(candidate)}
                          disabled={applyingReviewChanges || savingOverride}
                          sx={{ textTransform: 'none', fontWeight: 800 }}
                        >
                          {reviewSelections[candidate.itemNo] ? 'Selected' : 'Add to Template'}
                        </Button>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => applySuggestion(reviewItem, candidate)}
                          disabled={savingOverride || applyingReviewChanges}
                          sx={{ textTransform: 'none', fontWeight: 800 }}
                        >
                          Use This Match
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
              <Paper variant="outlined" sx={{ p: 1.15, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                <Stack spacing={0.8}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Template actions
                    </Typography>
                    <Chip
                      size="small"
                      label={`${selectedReviewCandidates.length} selected`}
                      color={selectedReviewCandidates.length ? 'primary' : 'default'}
                      sx={{ fontWeight: 700 }}
                    />
                  </Stack>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={deleteReviewItem}
                        onChange={(event) => setDeleteReviewItem(event.target.checked)}
                        disabled={applyingReviewChanges || savingOverride}
                      />
                    }
                    label="Delete this template item completely when saving"
                    sx={{ m: 0 }}
                  />
                  <Typography variant="caption" sx={{ opacity: 0.74 }}>
                    This will rebuild the template order, rerun stock matching, and refresh the live stock totals straight after save.
                  </Typography>
                  <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ pt: 0.4, flexWrap: 'wrap' }}>
                    <Button
                      size="small"
                      variant="contained"
                      color="warning"
                      onClick={saveReviewChanges}
                      disabled={applyingReviewChanges || savingOverride || (!deleteReviewItem && !selectedReviewCandidates.length)}
                      sx={{ textTransform: 'none', fontWeight: 800 }}
                    >
                      {applyingReviewChanges ? 'Saving...' : deleteReviewItem ? 'Delete Original + Add Replacements' : 'Save Review Changes'}
                    </Button>
                  </Stack>
                </Stack>
              </Paper>
              <Divider />
              <Button
                size="small"
                variant="outlined"
                color="warning"
                onClick={() => clearSuggestion(reviewItem)}
                disabled={savingOverride || applyingReviewChanges}
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
