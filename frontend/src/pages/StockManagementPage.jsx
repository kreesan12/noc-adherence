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
  createStockDivisionContact,
  createStockTemplateItem,
  deleteStockTemplateItem,
  exportLowStockWatchlistWorkbook,
  exportRegionalWatchlistWorkbook,
  exportStockTemplateWorkbook,
  fetchStockDashboard,
  fetchStockDailyReport,
  fetchStockDivisionContacts,
  fetchStockRedistributionPlan,
  generateStockRedistributionPlan,
  fetchStockRunRates,
  sendStockDailyReport,
  sendStockRedistributionPlan,
  updateStockDivisionContact,
  updateStockNotWarehouseAction,
  updateStockUnitCost,
  updateStockMatchOverride,
  updateStockRequiredSpares
} from '../api/stockManagement'
import { PageShell } from '../components/ui/PageScaffold'
import { useAuth } from '../context/AuthContext'
import {
  AnalyticsMetricCard as Card,
  AnalyticsSectionCard as SectionCard
} from '../components/ui/AnalyticsPrimitives'

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
  width: 96,
  minWidth: 96,
  maxWidth: 96
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

function confirmedFieldForRequiredKey(key) {
  return `${key}Confirmed`
}

function requirementTone(isConfirmed) {
  return isConfirmed
    ? { bg: '#dcfce7', color: '#166534', label: 'Confirmed' }
    : { bg: '#ffedd5', color: '#c2410c', label: 'Unconfirmed' }
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
    requiredCptConfirmed: item?.requiredConfirmedByRegion?.CPT !== false,
    requiredJhb: String(item?.requiredByRegion?.JHB ?? 0),
    requiredJhbConfirmed: item?.requiredConfirmedByRegion?.JHB !== false,
    requiredDbn: String(item?.requiredByRegion?.DBN ?? 0),
    requiredDbnConfirmed: item?.requiredConfirmedByRegion?.DBN !== false,
    requiredPel: String(item?.requiredByRegion?.PEL ?? 0),
    requiredPelConfirmed: item?.requiredConfirmedByRegion?.PEL !== false,
    requiredBfn: String(item?.requiredByRegion?.BFN ?? 0),
    requiredBfnConfirmed: item?.requiredConfirmedByRegion?.BFN !== false,
    requiredGeo: String(item?.requiredByRegion?.GEO ?? 0),
    requiredGeoConfirmed: item?.requiredConfirmedByRegion?.GEO !== false,
    requiredPol: String(item?.requiredByRegion?.POL ?? 0),
    requiredPolConfirmed: item?.requiredConfirmedByRegion?.POL !== false,
    requiredNel: String(item?.requiredByRegion?.NEL ?? 0),
    requiredNelConfirmed: item?.requiredConfirmedByRegion?.NEL !== false
  }
}

function createTemplateFormState() {
  return {
    sectionName: '',
    subSectionName: '',
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
  const { user } = useAuth()
  const canDeleteStockItems = ['admin', 'engineering'].includes(String(user?.role || '').toLowerCase())
  const [loading, setLoading] = useState(true)
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
  const [editingCost, setEditingCost] = useState(false)
  const [savingCost, setSavingCost] = useState(false)
  const [costDraft, setCostDraft] = useState('')
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
  const [redistributionPlan, setRedistributionPlan] = useState(null)
  const [redistributionLoading, setRedistributionLoading] = useState(false)
  const [dailyReport, setDailyReport] = useState(null)
  const [dailyReportLoading, setDailyReportLoading] = useState(false)
  const [dailyReportDetail, setDailyReportDetail] = useState(null)
  const [sendingDailyReport, setSendingDailyReport] = useState(false)
  const [divisionContacts, setDivisionContacts] = useState([])
  const [contactsLoading, setContactsLoading] = useState(false)
  const [contactForm, setContactForm] = useState({ division: '', fullName: '', email: '', role: 'DIVISION_HEAD', receivesRedistribution: false })

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

  const loadRedistribution = async () => {
    setRedistributionLoading(true)
    try {
      const next = await fetchStockRedistributionPlan()
      setRedistributionPlan(next)
      return next
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to load redistribution plan' })
      throw err
    } finally {
      setRedistributionLoading(false)
    }
  }

  const loadDailyReport = async () => {
    setDailyReportLoading(true)
    try {
      const next = await fetchStockDailyReport()
      setDailyReport(next)
      return next
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to load daily report' })
      throw err
    } finally {
      setDailyReportLoading(false)
    }
  }

  const loadContacts = async () => {
    setContactsLoading(true)
    try {
      const next = await fetchStockDivisionContacts()
      setDivisionContacts(next)
      return next
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'General stock admin access is required to manage contacts' })
      throw err
    } finally {
      setContactsLoading(false)
    }
  }

  useEffect(() => {
    loadData({ showLoading: true }).catch(console.error)
  }, [])

  useEffect(() => {
    if (tab === 4 && !dailyReport && !dailyReportLoading) loadDailyReport().catch(() => {})
    if (tab === 5 && !redistributionPlan && !redistributionLoading) loadRedistribution().catch(() => {})
    if (tab === 6 && !divisionContacts.length && !contactsLoading) loadContacts().catch(() => {})
  }, [tab])

  useEffect(() => {
    if (!selectedItem) {
      setEditingMinimums(false)
      setMinimumForm(buildRequiredSpareForm(null))
      return
    }

    setMinimumForm(buildRequiredSpareForm(selectedItem))
    setCostDraft(String(selectedItem.unitCost ?? 0))
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
    if (stockFilter === 'unconfirmed' && !row.hasUnconfirmedRequirements) return false
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
          next[group.division] = index < 1
        }
      })
      return next
    })
  }, [divisionGroups])

  useEffect(() => {
    if (!divisionFilter) return
    setDivisionExpansion((current) => ({ ...current, [divisionFilter]: true }))
  }, [divisionFilter])

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

  const generateRedistribution = async () => {
    setRedistributionLoading(true)
    try {
      const next = await generateStockRedistributionPlan()
      setRedistributionPlan(next)
      setToast({ severity: 'success', message: `Redistribution plan created with ${fmtCount(next?.recommendations?.length)} movement lines` })
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to generate redistribution plan' })
    } finally {
      setRedistributionLoading(false)
    }
  }

  const sendRedistribution = async () => {
    if (!redistributionPlan?.id) return
    setRedistributionLoading(true)
    try {
      const result = await sendStockRedistributionPlan(redistributionPlan.id)
      await loadRedistribution()
      setToast({ severity: 'success', message: result.sent ? `${fmtCount(result.sent)} new redistribution lines emailed` : result.message || 'No new movement to send' })
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to send redistribution plan' })
    } finally {
      setRedistributionLoading(false)
    }
  }

  const sendDailyReports = async () => {
    setSendingDailyReport(true)
    try {
      const result = await sendStockDailyReport()
      setToast({ severity: 'success', message: `Daily reports sent for ${fmtCount(result.sent?.length)} divisions` })
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to send daily reports' })
    } finally {
      setSendingDailyReport(false)
    }
  }

  const saveDivisionContact = async () => {
    try {
      await createStockDivisionContact(contactForm)
      setContactForm({ division: '', fullName: '', email: '', role: 'DIVISION_HEAD', receivesRedistribution: false })
      await loadContacts()
      setToast({ severity: 'success', message: 'Stock-management contact saved' })
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to save stock contact' })
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

  const saveUnitCost = async () => {
    if (!selectedItem) return
    setSavingCost(true)
    try {
      const updated = await updateStockUnitCost(selectedItem.id, Number(costDraft || 0))
      const next = await loadData({ showLoading: false })
      setSelectedItem(next?.items?.find((row) => row.id === updated.id) || updated)
      setEditingCost(false)
      setToast({ severity: 'success', message: `Unit cost updated for ${selectedItem.itemDescription}` })
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to update unit cost' })
    } finally {
      setSavingCost(false)
    }
  }

  const deleteSelectedStockItem = async () => {
    if (!selectedItem || !window.confirm(`Delete ${selectedItem.itemDescription}? This removes its minimum-stock configuration, not the source stock-history records.`)) return
    try {
      await deleteStockTemplateItem(selectedItem.id)
      setSelectedItem(null)
      await loadData({ showLoading: false })
      setToast({ severity: 'success', message: 'Stock item deleted' })
    } catch (err) {
      setToast({ severity: 'error', message: err?.response?.data?.error || err?.message || 'Failed to delete stock item' })
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
      setTab(0)
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

  const stockShellStats = [
    {
      label: 'Template Items',
      value: fmtCount(summary.templateItemCount),
      helper: 'Master rows being monitored',
      accent: '#0f766e'
    },
    {
      label: 'Low Stock',
      value: fmtCount(summary.lowStockCount),
      helper: 'Items below required spares',
      accent: '#dc2626'
    },
    {
      label: 'Coverage',
      value: fmtPct(summary.matchCoveragePct),
      helper: 'Matched against the daily stock file',
      accent: '#7c3aed'
    },
    {
      label: 'Latest Import',
      value: latestImport?.reportDate ? dayjs(latestImport.reportDate).format('DD MMM HH:mm') : 'No import',
      helper: `${fmtCount(latestImport?.statusRowCount || 0)} stock rows in the latest load`,
      accent: '#1d4ed8'
    }
  ]

  return (
    <PageShell
      eyebrow="Stock Management"
      title="Assurance And Engineering Stock Control"
      description="The template remains the master source, the daily stock report feeds the live counts, and warehouse stock stays separated from field-held stock so the gap logic stays operationally clean."
      accent="#0f766e"
      shellSx={tab === 0 ? {
        height: 'calc(100dvh - 24px)',
        minHeight: 0,
        overflow: 'hidden',
        gridTemplateRows: 'auto minmax(0, 1fr)'
      } : {}}
    >
      <Stack
        spacing={0.78}
        sx={{
          height: tab === 0 ? '100%' : 'auto',
          minHeight: 0,
          overflow: tab === 0 ? 'hidden' : 'visible',
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
        <Paper elevation={0} sx={{ p: 0.5, border: '1px solid #cbded7', borderRadius: 3, overflow: 'hidden', bgcolor: 'rgba(255,255,255,0.88)', boxShadow: '0 8px 20px rgba(15, 23, 42, 0.05)' }}>
          <Tabs
            value={tab}
            onChange={(_, value) => setTab(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 40,
              px: 0.4,
              gap: 0.3,
              '& .MuiTab-root': {
                minHeight: 34,
                textTransform: 'none',
                fontWeight: 800,
                fontSize: 11.8,
                px: 1.25,
                minWidth: 0
              },
              '& .Mui-selected': {
                color: '#ffffff !important',
                bgcolor: '#0f766e',
                borderRadius: 2,
                boxShadow: '0 3px 8px rgba(15, 118, 110, 0.22)'
              },
              '& .MuiTabs-indicator': {
                display: 'none'
              }
            }}
          >
            <Tab label="Master Stock" />
            <Tab label="Run Rates" />
            <Tab label="Match Review" />
            <Tab label="Add Template Item" />
            <Tab label="Daily Report" />
            <Tab label="Redistribution" />
            <Tab label="Stock Admin" />
          </Tabs>
        </Paper>

        {tab === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 0.72,
              borderRadius: 2.45,
              border: '1px solid #dce7e2',
              background: 'linear-gradient(180deg, #fbfffe 0%, #f5faf8 100%)'
            }}
          >
            <Stack direction={{ xs: 'column', lg: 'row' }} spacing={0.6} useFlexGap flexWrap="wrap" sx={{ width: '100%' }}>
              <TextField size="small" label="Search Stock" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description, code, division, matched item..." sx={{ minWidth: 360, flex: { lg: '1 1 440px' }, maxWidth: { lg: 620 } }} InputProps={{ startAdornment: <SearchRoundedIcon sx={{ mr: 0.75, fontSize: 18, color: 'text.secondary' }} /> }} />
              <TextField size="small" select label="Stock Status" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} sx={{ minWidth: 118 }}>
                <MenuItem value="">All</MenuItem><MenuItem value="low">Below Minimum</MenuItem><MenuItem value="healthy">Above Minimum</MenuItem><MenuItem value="zero">Zero Available</MenuItem><MenuItem value="unconfirmed">Unconfirmed Minimums</MenuItem>
              </TextField>
              <TextField size="small" select label="Match Quality" value={matchFilter} onChange={(e) => setMatchFilter(e.target.value)} sx={{ minWidth: 118 }}>
                <MenuItem value="">All</MenuItem><MenuItem value="matched">Matched</MenuItem><MenuItem value="review">Needs Review</MenuItem><MenuItem value="unmatched">Unmatched</MenuItem>
              </TextField>
              <Button size="small" variant="outlined" startIcon={<FileDownloadOutlinedIcon />} onClick={doExport} disabled={exporting} sx={{ minHeight: 30, ml: { lg: 'auto' }, borderRadius: 2.2, textTransform: 'none', fontWeight: 800, px: 0.95 }}>
                {exporting ? 'Exporting...' : 'Export Master Workbook'}
              </Button>
            </Stack>
          </Paper>
        ) : null}

      {tab === -1 ? (
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
                          <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap" sx={{ mt: 0.2 }}>
                            <Typography variant="caption" sx={{ opacity: 0.72 }}>{row.stockCode || 'No stock code'}</Typography>
                            {row.hasUnconfirmedRequirements ? (
                              <Chip
                                size="small"
                                label={`Unconfirmed ${row.unconfirmedRegions?.join(', ')}`}
                                sx={{ height: 19, bgcolor: '#fff7ed', color: '#c2410c', '& .MuiChip-label': { px: 0.7, fontSize: 10.1, fontWeight: 800 } }}
                              />
                            ) : null}
                          </Stack>
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
                                  {entry.requiredConfirmed === false ? (
                                    <Chip size="small" label="Unconfirmed min" sx={{ height: 20, bgcolor: '#ffedd5', color: '#c2410c', '& .MuiChip-label': { px: 0.7, fontSize: 10.4, fontWeight: 800 } }} />
                                  ) : null}
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

      {tab === 0 ? (
        <SectionCard
          title="Business Units"
          subtitle="Open a business unit to review its own minimum commitments against the shared regional stock pool."
          action={divisionFilter ? (
            <Button size="small" variant="outlined" onClick={() => setDivisionFilter('')} sx={{ textTransform: 'none', fontWeight: 800 }}>
              Show all business units
            </Button>
          ) : null}
        >
          <Box
            sx={{
              display: 'grid',
              gap: 0.8,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' }
            }}
          >
            {(data?.divisionSummary || []).map((businessUnit) => (
              <Paper
                key={businessUnit.division}
                variant="outlined"
                sx={{ p: 1, borderRadius: 2.25, display: 'grid', gap: 0.65, borderColor: divisionFilter === businessUnit.division ? '#0f766e' : '#dce7e2', bgcolor: divisionFilter === businessUnit.division ? 'rgba(15, 118, 110, 0.05)' : 'transparent' }}
              >
                <Stack direction="row" justifyContent="space-between" spacing={0.6} alignItems="flex-start">
                  <Typography variant="subtitle2" sx={{ fontWeight: 900 }}>{businessUnit.division}</Typography>
                  <Chip size="small" label={`${fmtCount(businessUnit.itemCount)} items`} sx={{ fontWeight: 700 }} />
                </Stack>
                <Stack direction="row" spacing={0.45} useFlexGap flexWrap="wrap">
                  <Chip size="small" label={`Minimum ${fmtCount(businessUnit.requiredTotal)}`} sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }} />
                  <Chip size="small" label={`${fmtCount(businessUnit.lowStockCount)} shared-pool gaps`} color={businessUnit.lowStockCount ? 'error' : 'success'} sx={{ fontWeight: 700 }} />
                  <Chip size="small" label={`${fmtCount(businessUnit.unconfirmedRequirementCount)} unconfirmed`} color={businessUnit.unconfirmedRequirementCount ? 'warning' : 'default'} sx={{ fontWeight: 700 }} />
                </Stack>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Business-unit minimum exposure: {fmtMoney(businessUnit.gapCostTotal)}
                </Typography>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setSearch('')
                    setStockFilter('')
                    setMatchFilter('')
                    setDivisionFilter(businessUnit.division)
                    setDivisionExpansion((current) => ({ ...current, [businessUnit.division]: true }))
                    setTab(0)
                  }}
                  sx={{ justifySelf: 'start', textTransform: 'none', fontWeight: 800 }}
                >
                  Filter business unit stock
                </Button>
              </Paper>
            ))}
          </Box>
        </SectionCard>
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

      {tab === 0 ? (
        <SectionCard
          title="Master Stock Table"
          subtitle="Grouped by division. Warehouse-usable stock is separated from Not WH stock, with derived unit cost and gap cost included."
          action={<Chip size="small" label={`${fmtCount(filteredItemRows.length)} visible items`} sx={{ fontWeight: 700 }} />}
          rootSx={{ minHeight: 0, flex: 1, display: 'flex', flexDirection: 'column' }}
          bodySx={{ p: 1.05, minHeight: 0, flex: 1, overflow: 'hidden', display: 'flex' }}
        >
          <Stack spacing={0.55} sx={{ width: '100%', minHeight: 0, flex: 1, overflow: 'hidden' }}>
            {divisionGroups.map((group) => (
              <Accordion
                key={group.division}
                disableGutters
                expanded={Boolean(divisionExpansion[group.division])}
                onChange={(_, expanded) => {
                  setDivisionExpansion((current) => {
                    if (!expanded) return { ...current, [group.division]: false }
                    return Object.fromEntries(divisionGroups.map((entry) => [entry.division, entry.division === group.division]))
                  })
                }}
                sx={{
                  borderRadius: '14px !important',
                  border: '1px solid #e2e8f0',
                  boxShadow: 'none',
                  minWidth: 0,
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
                  <TableContainer
                    sx={{
                      width: '100%',
                      maxWidth: '100%',
                      minWidth: 0,
                      // Keep scrolling inside the master table, never on the page.
                      height: 'min(48dvh, calc(100dvh - 500px))',
                      maxHeight: 'min(48dvh, calc(100dvh - 500px))',
                      overflowX: 'scroll',
                      overflowY: 'auto',
                      overscrollBehavior: 'contain',
                      scrollbarGutter: 'stable both-edges',
                      scrollbarWidth: 'auto',
                      '&::-webkit-scrollbar': { width: 14, height: 14 },
                      '&::-webkit-scrollbar-thumb': {
                        bgcolor: '#94a3b8',
                        borderRadius: 8,
                        border: '3px solid #f8fafc'
                      },
                      '&::-webkit-scrollbar-track': { bgcolor: '#e2e8f0' }
                    }}
                  >
                    <Table
                      size="small"
                      stickyHeader
                      sx={{
                        minWidth: 2050,
                        tableLayout: 'fixed',
                        '& .MuiTableCell-root': {
                          py: 0.34,
                          px: 0.45,
                          fontSize: 10.6,
                          whiteSpace: 'nowrap',
                          verticalAlign: 'middle'
                        },
                        '& .MuiTableHead-root .MuiTableCell-root': {
                          fontSize: 9.8,
                          lineHeight: 1.05,
                          fontWeight: 800,
                          whiteSpace: 'normal',
                          bgcolor: '#ffffff !important',
                          backgroundColor: '#ffffff !important',
                          borderBottom: '1px solid #cbd5e1',
                          zIndex: 3
                        }
                      }}
                    >
                      <TableHead>
                        <TableRow>
                          <TableCell sx={MASTER_SECTION_CELL_SX}>Stock Section</TableCell>
                          <TableCell sx={MASTER_SECTION_CELL_SX}>Sub Section</TableCell>
                          <TableCell sx={MASTER_ITEM_CELL_SX}>Stock Item</TableCell>
                          <TableCell sx={MASTER_SECTION_CELL_SX}>Stock Code</TableCell>
                          <TableCell sx={MASTER_SECTION_CELL_SX}>Business Unit</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Total Req.</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Total Avail.</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>WH Avail.</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Not WH</TableCell>
                          <TableCell align="center" sx={MASTER_METRIC_CELL_SX}>Order Placed</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Order Qty</TableCell>
                          <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>Total Gap</TableCell>
                          <TableCell align="right" sx={MASTER_MONEY_CELL_SX}>Unit Cost</TableCell>
                          <TableCell align="right" sx={MASTER_MONEY_CELL_SX}>Total Cost</TableCell>
                          {STOCK_REGIONS.map((region) => <TableCell key={region} align="center" sx={MASTER_REGION_CELL_SX}>{region} Av / Min / Gap</TableCell>)}
                          <TableCell align="center" sx={MASTER_SECTION_CELL_SX}>Redistribution Required</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {group.rows.map((row) => {
                          const tone = statusTone(row)
                          const redistributionRequired = Number(row.shortage || 0) > 0 && STOCK_REGIONS.some((region) => {
                            const position = row.regionalPosition?.[region]
                            return Number(position?.available || 0) > Number(position?.aggregateMinimum || 0)
                          })
                          return (
                            <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedItem(row)}>
                              <TableCell title={row.sectionName || 'General'} sx={{ ...MASTER_SECTION_CELL_SX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.sectionName || 'General'}</TableCell>
                              <TableCell title={row.subSectionName || '-'} sx={{ ...MASTER_SECTION_CELL_SX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.subSectionName || '-'}</TableCell>
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
                                <Stack direction="row" spacing={0.35} useFlexGap flexWrap="wrap" sx={{ mt: 0.2 }}>
                                  {row.hasUnconfirmedRequirements ? (
                                    <Chip
                                      size="small"
                                      label={`Unconfirmed ${row.unconfirmedRegions?.join(', ')}`}
                                      sx={{ height: 18, bgcolor: '#fff7ed', color: '#c2410c', '& .MuiChip-label': { px: 0.55, fontSize: 9.6, fontWeight: 800 } }}
                                    />
                                  ) : null}
                                </Stack>
                              </TableCell>
                              <TableCell sx={MASTER_SECTION_CELL_SX}>
                                <Typography variant="caption" sx={{ display: 'block', fontWeight: 700 }}>{row.stockCode || 'No stock code'}</Typography>
                                <Chip
                                  size="small"
                                  label={row.matchStatus}
                                  color={matchTone(row)}
                                  sx={{ fontWeight: 700, height: 20, '& .MuiChip-label': { px: 0.65, fontSize: 9.9 } }}
                                />
                              </TableCell>
                              <TableCell title={row.division || 'Unassigned'} sx={{ ...MASTER_SECTION_CELL_SX, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.division || 'Unassigned'}</TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>{fmtCount(row.requiredTotal)}</TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>
                                <Typography component="span" sx={{ fontWeight: 800, color: tone.color }}>
                                  {fmtCount(row.allAvailableTotal)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>
                                <Typography component="span" sx={{ fontWeight: 800, color: tone.color }}>
                                  {fmtCount(row.availableTotal)}
                                </Typography>
                              </TableCell>
                              <TableCell align="right" sx={MASTER_METRIC_CELL_SX}>{fmtCount(row.notInWarehouses)}</TableCell>
                              <TableCell align="center" sx={MASTER_METRIC_CELL_SX}>{Number(row.orderedStock || 0) > 0 ? 'Yes' : 'No'}</TableCell>
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
                              {STOCK_REGIONS.map((region) => {
                                const position = row.regionalPosition?.[region] || {}
                                const hasGap = Number(position.gap || 0) > 0
                                return <TableCell key={region} align="center" sx={{ ...MASTER_REGION_CELL_SX, bgcolor: hasGap ? '#fff7ed' : 'transparent' }}>
                                  <Typography variant="caption" sx={{ display: 'block', fontWeight: 800 }}>Av {fmtCount(position.available)}</Typography>
                                  <Typography variant="caption" sx={{ display: 'block' }}>Min {fmtCount(position.minimum)}</Typography>
                                  <Typography variant="caption" sx={{ display: 'block', color: hasGap ? '#b91c1c' : '#166534', fontWeight: 800 }}>Gap {fmtCount(position.gap)}</Typography>
                                </TableCell>
                              })}
                              <TableCell align="center" sx={MASTER_SECTION_CELL_SX}><Chip size="small" color={redistributionRequired ? 'warning' : 'default'} label={redistributionRequired ? 'Yes' : 'No'} /></TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </AccordionDetails>
              </Accordion>
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

      {tab === 3 ? (
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
                label="Sub Section"
                value={createForm.subSectionName}
                onChange={(event) => updateCreateFormField('subSectionName', event.target.value)}
              />
              <TextField
                size="small"
                label="Business Unit / Division"
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

      {tab === -1 ? (
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

      {tab === 4 ? (
        <Stack spacing={0.8}>
          <SectionCard
            title="Daily division report"
            subtitle="Review exactly what each division head will receive. Sending stays manual until the contact list is confirmed."
            action={(
              <Stack direction="row" spacing={0.6}>
                <Button size="small" variant="outlined" onClick={() => loadDailyReport().catch(() => {})} disabled={dailyReportLoading}>Refresh</Button>
                <Button size="small" variant="contained" onClick={sendDailyReports} disabled={sendingDailyReport || dailyReportLoading}>
                  {sendingDailyReport ? 'Sending...' : 'Send all division reports'}
                </Button>
              </Stack>
            )}
          >
            {dailyReportLoading && !dailyReport ? <CircularProgress size={22} /> : (
              <Stack spacing={0.75}>
                {(dailyReport?.reports || []).map((report) => (
                  <Paper key={report.division} variant="outlined" sx={{ p: 1, borderRadius: 2 }}>
                    <Stack spacing={0.55}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" useFlexGap flexWrap="wrap">
                        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>{report.division}</Typography>
                        <Typography variant="caption">To: {report.recipients.join(', ') || 'No division head configured'}</Typography>
                      </Stack>
                      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
                        <Chip size="small" clickable color="error" label={`${fmtCount(report.belowMinimum.length)} below minimum`} onClick={() => setDailyReportDetail({ division: report.division, title: 'Below minimum', type: 'stock', rows: report.belowMinimum })} />
                        <Chip size="small" clickable color="warning" label={`${fmtCount(report.unconfirmed.length)} unconfirmed`} onClick={() => setDailyReportDetail({ division: report.division, title: 'Minimums requiring confirmation', type: 'stock', rows: report.unconfirmed })} />
                        <Chip size="small" clickable label={`${fmtCount(report.zeroStock.length)} at zero`} onClick={() => setDailyReportDetail({ division: report.division, title: 'Stock at zero', type: 'stock', rows: report.zeroStock })} />
                        <Chip size="small" clickable color="info" label={`${fmtCount(report.redistribution.length)} new redistribution lines`} onClick={() => setDailyReportDetail({ division: report.division, title: 'Redistribution to review', type: 'redistribution', rows: report.redistribution })} />
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
          </SectionCard>
        </Stack>
      ) : null}

      <Dialog open={Boolean(dailyReportDetail)} onClose={() => setDailyReportDetail(null)} fullWidth maxWidth="md">
        <DialogTitle>{dailyReportDetail ? `${dailyReportDetail.division} | ${dailyReportDetail.title}` : 'Daily report detail'}</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.1 }}>
            Select an item to open its full business-unit minimum and shared-stock detail.
          </Typography>
          {dailyReportDetail?.rows?.length ? (
            <TableContainer sx={{ maxHeight: '60vh' }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  {dailyReportDetail.type === 'redistribution' ? (
                    <TableRow><TableCell>Item</TableCell><TableCell>From</TableCell><TableCell>To</TableCell><TableCell align="right">New quantity</TableCell></TableRow>
                  ) : (
                    <TableRow><TableCell>Item</TableCell><TableCell>Stock Code</TableCell><TableCell align="right">Business-unit minimum</TableCell><TableCell align="right">Shared WH available</TableCell><TableCell align="right">Shared gap</TableCell></TableRow>
                  )}
                </TableHead>
                <TableBody>
                  {dailyReportDetail.rows.map((row) => {
                    const stockRow = dailyReportDetail.type === 'redistribution'
                      ? (data?.items || []).find((item) => item.rowType === 'ITEM' && item.poolKey === row.poolKey)
                      : row
                    return dailyReportDetail.type === 'redistribution' ? (
                      <TableRow key={row.id || `${row.poolKey}-${row.fromRegion}-${row.toRegion}`} hover sx={{ cursor: stockRow ? 'pointer' : 'default' }} onClick={() => stockRow && setSelectedItem(stockRow)}>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>{row.itemDescription}</Typography><Typography variant="caption">{row.stockCode || 'No stock code'}</Typography></TableCell><TableCell>{row.fromRegion}</TableCell><TableCell>{row.toRegion}</TableCell><TableCell align="right">{fmtCount(row.deltaQty)}</TableCell>
                      </TableRow>
                    ) : (
                      <TableRow key={row.id} hover sx={{ cursor: 'pointer' }} onClick={() => setSelectedItem(row)}>
                        <TableCell><Typography variant="body2" sx={{ fontWeight: 700 }}>{row.itemDescription}</Typography><Typography variant="caption">{row.division}</Typography></TableCell><TableCell>{row.stockCode || 'No stock code'}</TableCell><TableCell align="right">{fmtCount(row.requiredTotal)}</TableCell><TableCell align="right">{fmtCount(row.availableTotal)}</TableCell><TableCell align="right">{fmtCount(row.shortage)}</TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          ) : <Alert severity="success">No items are currently in this section.</Alert>}
        </DialogContent>
      </Dialog>

      {tab === 5 ? (
        <SectionCard
          title="Redistribution required"
          subtitle="Shared regional stock is compared with confirmed minimums. The daily plan only marks additional quantities since the previous plan as new."
          action={(
            <Stack direction="row" spacing={0.6}>
              <Button size="small" variant="outlined" onClick={() => loadRedistribution().catch(() => {})} disabled={redistributionLoading}>Refresh</Button>
              <Button size="small" variant="contained" onClick={generateRedistribution} disabled={redistributionLoading}>Generate plan</Button>
              <Button size="small" variant="contained" color="warning" onClick={sendRedistribution} disabled={redistributionLoading || !(redistributionPlan?.recommendations || []).some((row) => Number(row.deltaQty || 0) > 0 && row.status === 'DRAFT')}>Send new movements</Button>
            </Stack>
          )}
        >
          {!redistributionPlan ? <Alert severity="info">Generate the first redistribution plan once the minimum-stock import and current stock feed are ready.</Alert> : (
            <TableContainer sx={{ maxHeight: '62vh' }}><Table size="small" stickyHeader><TableHead><TableRow>
              <TableCell>From</TableCell><TableCell>To</TableCell><TableCell>Stock Code</TableCell><TableCell>Item</TableCell><TableCell align="right">Plan Qty</TableCell><TableCell align="right">New Qty</TableCell><TableCell>Status</TableCell>
            </TableRow></TableHead><TableBody>
              {(redistributionPlan.recommendations || []).map((row) => <TableRow key={row.id}><TableCell>{row.fromRegion}</TableCell><TableCell>{row.toRegion}</TableCell><TableCell>{row.stockCode || 'N/A'}</TableCell><TableCell>{row.itemDescription}</TableCell><TableCell align="right">{fmtCount(row.recommendedQty)}</TableCell><TableCell align="right"><Chip size="small" color={row.deltaQty ? 'warning' : 'default'} label={fmtCount(row.deltaQty)} /></TableCell><TableCell>{row.status}</TableCell></TableRow>)}
            </TableBody></Table></TableContainer>
          )}
        </SectionCard>
      ) : null}

      {tab === 6 ? (
        <Stack spacing={0.8}>
          <SectionCard title="Stock management administration" subtitle="General stock admins manage division heads, division admins and redistribution recipients here. Division admins can only change stock in their assigned business unit.">
            <Box sx={{ display: 'grid', gap: 0.65, gridTemplateColumns: { xs: '1fr', md: '1.2fr 1.2fr 1.5fr 1fr auto' } }}>
              <TextField size="small" select label="Business Unit" value={contactForm.division} onChange={(event) => setContactForm((state) => ({ ...state, division: event.target.value }))}><MenuItem value="">Choose</MenuItem>{divisions.map((division) => <MenuItem key={division} value={division}>{division}</MenuItem>)}</TextField>
              <TextField size="small" label="Full name" value={contactForm.fullName} onChange={(event) => setContactForm((state) => ({ ...state, fullName: event.target.value }))} />
              <TextField size="small" label="Email" value={contactForm.email} onChange={(event) => setContactForm((state) => ({ ...state, email: event.target.value }))} />
              <TextField size="small" select label="Access" value={contactForm.role} onChange={(event) => setContactForm((state) => ({ ...state, role: event.target.value }))}><MenuItem value="DIVISION_HEAD">Division head</MenuItem><MenuItem value="DIVISION_ADMIN">Division admin</MenuItem></TextField>
              <Button variant="contained" onClick={saveDivisionContact}>Add user</Button>
            </Box>
          </SectionCard>
          <SectionCard title="Configured stock users" action={<Button size="small" onClick={() => loadContacts().catch(() => {})} disabled={contactsLoading}>Refresh</Button>}>
            <TableContainer><Table size="small"><TableHead><TableRow><TableCell>Business Unit</TableCell><TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Role</TableCell><TableCell>Active</TableCell><TableCell>Redistribution recipient</TableCell></TableRow></TableHead><TableBody>
              {divisionContacts.map((contact) => <TableRow key={contact.id}><TableCell>{contact.division}</TableCell><TableCell>{contact.fullName || '-'}</TableCell><TableCell>{contact.email}</TableCell><TableCell>{contact.role === 'DIVISION_ADMIN' ? 'Division admin' : 'Division head'}</TableCell><TableCell>{contact.isActive ? 'Yes' : 'No'}</TableCell><TableCell>{contact.receivesRedistribution ? 'Yes' : 'No'}</TableCell></TableRow>)}
            </TableBody></Table></TableContainer>
          </SectionCard>
        </Stack>
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
              <Stack direction="row" spacing={0.6}>
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
                  {editingMinimums ? 'Close minimums' : 'Edit business-unit minimums'}
                </Button>
                <Button size="small" variant={editingCost ? 'contained' : 'outlined'} onClick={() => setEditingCost((current) => !current)} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: 2.8 }}>
                  {editingCost ? 'Close cost' : 'Edit cost'}
                </Button>
                {canDeleteStockItems ? (
                  <Button size="small" color="error" variant="outlined" onClick={deleteSelectedStockItem} sx={{ textTransform: 'none', fontWeight: 800, borderRadius: 2.8 }}>Delete item</Button>
                ) : null}
              </Stack>
            ) : null}
          </Stack>
        </DialogTitle>
        <DialogContent dividers>
          {selectedItem ? (
            <Stack spacing={1.1}>
              <Stack direction="row" spacing={0.7} useFlexGap flexWrap="wrap">
                <Chip label={selectedItem.stockCode || 'No stock code'} />
                <Chip label={`Business unit: ${selectedItem.division || 'Unassigned'}`} color="primary" />
                <Chip label={selectedItem.matchStatus} color={matchTone(selectedItem)} />
                <Chip label={`This BU minimum ${fmtCount(selectedItem.requiredTotal)}`} sx={{ fontWeight: 800, bgcolor: '#eff6ff', color: '#1d4ed8' }} />
                <Chip label={`All BU minimum ${fmtCount(selectedItem.aggregateRequiredTotal)}`} sx={{ fontWeight: 800 }} />
                <Chip
                  label={selectedItem.requirementStatus || 'Confirmed'}
                  sx={{
                    fontWeight: 800,
                    bgcolor: selectedItem.hasUnconfirmedRequirements ? '#fff7ed' : '#dcfce7',
                    color: selectedItem.hasUnconfirmedRequirements ? '#c2410c' : '#166534'
                  }}
                />
                <Chip label={`Shared WH available ${fmtCount(selectedItem.availableTotal)}`} />
                <Chip label={`Not WH ${fmtCount(selectedItem.notInWarehouses)}`} />
                <Chip label={`Ordered ${fmtCount(selectedItem.orderedStock)}`} />
                <Chip label={`Shared pool gap ${fmtCount(selectedItem.shortage)}`} color={selectedItem.shortage > 0 ? 'error' : 'success'} />
                <Chip label={`Unit cost ${fmtMoney(selectedItem.unitCost)}`} />
                <Chip label={`Gap cost ${fmtMoney(selectedItem.gapCost)}`} />
              </Stack>
              {editingCost ? (
                <Stack direction="row" spacing={0.7} alignItems="center">
                  <TextField size="small" label="Unit cost (ZAR)" value={costDraft} onChange={(event) => setCostDraft(event.target.value)} inputProps={{ inputMode: 'decimal' }} sx={{ maxWidth: 180 }} />
                  <Button size="small" variant="contained" onClick={saveUnitCost} disabled={savingCost}>{savingCost ? 'Saving...' : 'Save cost'}</Button>
                </Stack>
              ) : null}
              <Paper variant="outlined" sx={{ p: 1.1, borderRadius: 2.5 }}>
                <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                      Business-unit minimums by region
                    </Typography>
                    <Typography variant="body2" sx={{ opacity: 0.74 }}>
                      This business unit owns these minimums. Physical stock is shared across every business unit using this stock code, so the shared pool total and gap are shown alongside each regional minimum.
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={`This BU total ${fmtCount(selectedItem.requiredTotal)}`}
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
                        bgcolor: selectedItem.requiredConfirmedByRegion?.[region] === false ? 'rgba(249, 115, 22, 0.08)' : 'rgba(15, 118, 110, 0.03)',
                        borderColor: selectedItem.requiredConfirmedByRegion?.[region] === false ? '#fdba74' : undefined
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" spacing={0.6} alignItems="flex-start">
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="caption" sx={{ display: 'block', opacity: 0.68 }}>
                            {region}
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', fontWeight: 800 }}>This BU min {fmtCount(selectedItem.requiredByRegion?.[region] || 0)}</Typography>
                          <Typography variant="caption" sx={{ display: 'block' }}>All BU min {fmtCount(selectedItem.regionalPosition?.[region]?.aggregateMinimum || 0)}</Typography>
                          <Typography variant="caption" sx={{ display: 'block', color: '#0f766e', fontWeight: 800 }}>Shared WH {fmtCount(selectedItem.regionalPosition?.[region]?.available || 0)}</Typography>
                          <Typography variant="caption" sx={{ display: 'block', color: Number(selectedItem.regionalPosition?.[region]?.gap || 0) > 0 ? '#b91c1c' : '#166534', fontWeight: 800 }}>Shared gap {fmtCount(selectedItem.regionalPosition?.[region]?.gap || 0)}</Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={requirementTone(selectedItem.requiredConfirmedByRegion?.[region] !== false).label}
                          sx={{
                            height: 20,
                            bgcolor: requirementTone(selectedItem.requiredConfirmedByRegion?.[region] !== false).bg,
                            color: requirementTone(selectedItem.requiredConfirmedByRegion?.[region] !== false).color,
                            '& .MuiChip-label': { px: 0.65, fontSize: 10.1, fontWeight: 800 }
                          }}
                        />
                      </Stack>
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
                      {REQUIRED_SPARE_FIELDS.map(({ key, region }) => {
                        const confirmedKey = confirmedFieldForRequiredKey(key)
                        return (
                          <Paper key={key} variant="outlined" sx={{ p: 0.8, borderRadius: 2 }}>
                            <Stack spacing={0.45}>
                              <TextField
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
                              <FormControlLabel
                                sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 11.1 } }}
                                control={(
                                  <Checkbox
                                    size="small"
                                    checked={Boolean(minimumForm[confirmedKey])}
                                    onChange={(event) => {
                                      setMinimumForm((current) => ({
                                        ...current,
                                        [confirmedKey]: event.target.checked
                                      }))
                                    }}
                                  />
                                )}
                                label="Confirmed"
                              />
                            </Stack>
                          </Paper>
                        )
                      })}
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
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>Shared physical stock by site</Typography>
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>These quantities are held once for the shared stock pool; they are not duplicated per business unit.</Typography>
              </Box>
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
    </PageShell>
  )
}
