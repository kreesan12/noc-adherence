import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Tab,
  Tabs,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  MenuItem,
  Typography
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import api from '../api'
import SlaOverviewTab from '../components/sla/SlaOverviewTab'
import SlaBreachesTab from '../components/sla/SlaBreachesTab'
import SlaOutagesTab from '../components/sla/SlaOutagesTab'
import SlaTicketsTab from '../components/sla/SlaTicketsTab'
import { downloadWorkbook } from '../utils/slaExport'

const DEFAULT_ISP_PAGE_SIZE = 50
const DEFAULT_BREACH_PAGE_SIZE = 100
const DOWNTIME_CATEGORY = 'service impacting'
const SLA_TARGET = 99.5

function fmtPct(v) {
  if (v == null || Number.isNaN(Number(v))) return '-'
  return `${Number(v).toFixed(2)}%`
}

function fmtHours(v) {
  if (v == null || Number.isNaN(Number(v))) return '0.00h'
  return `${Number(v).toFixed(2)}h`
}

function fmtCount(v) {
  if (v == null || Number.isNaN(Number(v))) return '0'
  return new Intl.NumberFormat().format(Number(v))
}

function pctChipColor(v) {
  if (v == null || Number.isNaN(Number(v))) return 'default'
  if (v >= 99.5) return 'success'
  if (v >= 98.5) return 'warning'
  return 'error'
}

function fmtTs(v) {
  if (!v) return '-'
  const d = dayjs(v)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(v)
}

function alphaHex(color, alpha) {
  return `${color}${alpha}`
}

function ExplorerStatCard({ label, value, subtext, tone = '#0f172a' }) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.15,
        borderRadius: 2.5,
        border: '1px solid #e5e7eb',
        borderTop: `4px solid ${tone}`,
        background: `linear-gradient(180deg, ${alphaHex(tone, '10')} 0%, #ffffff 48%, #ffffff 100%)`,
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)'
      }}
    >
      <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.72 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.35, fontWeight: 900, lineHeight: 1.05, overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.55, fontSize: 12.5, opacity: 0.72 }}>
          {subtext}
        </Typography>
      ) : null}
    </Paper>
  )
}

function defaultRange() {
  const toMonth = dayjs().subtract(1, 'month')
  const to = toMonth.format('YYYY-MM')
  const from = toMonth.subtract(2, 'month').format('YYYY-MM')
  return { from, to }
}

function recentMonthRange(monthCount) {
  const safeCount = Math.max(1, Number(monthCount) || 1)
  const toMonth = dayjs().subtract(1, 'month')
  return {
    from: toMonth.subtract(safeCount - 1, 'month').format('YYYY-MM'),
    to: toMonth.format('YYYY-MM')
  }
}

function ytdRange() {
  const toMonth = dayjs().subtract(1, 'month')
  return {
    from: `${toMonth.year()}-01`,
    to: toMonth.format('YYYY-MM')
  }
}

function safeFilePart(value) {
  return String(value || 'all').replace(/[^a-z0-9_-]+/gi, '-')
}

function toDateSafe(v) {
  if (!v) return null
  const d = dayjs(v)
  return d.isValid() ? d.toDate() : null
}

function normalizeInterval(startV, stopV) {
  const start = toDateSafe(startV)
  if (!start) return null
  const stop = toDateSafe(stopV) || start
  if (stop <= start) {
    return { start, end: new Date(start.getTime() + 1000) }
  }
  return { start, end: stop }
}

function dayIndexInMonth(ts, monthStart, monthDays) {
  const d = toDateSafe(ts)
  if (!d) return -1
  const idx = dayjs(d).diff(monthStart, 'day')
  if (!Number.isInteger(idx) || idx < 0 || idx >= monthDays) return -1
  return idx
}

function buildMonthlyTimelineData(monthDetail) {
  const ym = String(monthDetail?.yearMonth || '').trim()
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) return null

  const monthStart = dayjs(`${ym}-01`).startOf('day')
  const monthEnd = monthStart.add(1, 'month')
  const monthDays = monthStart.daysInMonth()

  const days = Array.from({ length: monthDays }, (_, i) => {
    const d = monthStart.add(i, 'day')
    return {
      day: i + 1,
      label: d.format('DD MMM'),
      isDown: false,
      downEvents: [],
      otherTickets: []
    }
  })

  const monthStartDt = monthStart.toDate()
  const monthEndDt = monthEnd.toDate()

  function clipInterval(startV, stopV) {
    const interval = normalizeInterval(startV, stopV)
    if (!interval) return null
    const start = new Date(Math.max(interval.start.getTime(), monthStartDt.getTime()))
    const end = new Date(Math.min(interval.end.getTime(), monthEndDt.getTime()))
    if (end <= start) return null
    return { start, end }
  }

  function addDownEventToDays(interval, event) {
    if (!interval) return
    let cursor = dayjs(interval.start).startOf('day')
    while (cursor.isBefore(interval.end)) {
      const idx = cursor.diff(monthStart, 'day')
      if (idx >= 0 && idx < monthDays) {
        days[idx].isDown = true
        if (!days[idx].downEvents.some((e) => e.key === event.key)) {
          days[idx].downEvents.push(event)
        }
      }
      cursor = cursor.add(1, 'day')
    }
  }

  for (const o of (monthDetail?.outages || [])) {
    const interval = clipInterval(o.impact_start, o.impact_stop || o.impact_start)
    const event = {
      key: `outage:${o.outage_ref || ''}`,
      type: 'Outage',
      id: o.outage_ref || 'Unknown',
      start: fmtTs(o.impact_start),
      stop: fmtTs(o.impact_stop),
      detail: o.impact_type || o.outagetitle || ''
    }
    addDownEventToDays(interval, event)
  }

  for (const t of (monthDetail?.tickets || [])) {
    const category = String(t.category || '').trim()
    const isDowntimeTicket = category.toLowerCase() === DOWNTIME_CATEGORY
    const event = {
      key: `ticket:${t.ticket_id || ''}`,
      type: 'Ticket',
      id: t.ticket_id || 'Unknown',
      start: fmtTs(t.created_date),
      stop: fmtTs(t.impact_stop_time),
      detail: category || 'Uncategorized'
    }

    if (isDowntimeTicket) {
      const interval = clipInterval(t.created_date, t.impact_stop_time || t.created_date)
      addDownEventToDays(interval, event)
    } else {
      const idx = dayIndexInMonth(t.created_date || t.impact_stop_time, monthStart, monthDays)
      if (idx >= 0 && !days[idx].otherTickets.some((x) => x.key === event.key)) {
        days[idx].otherTickets.push(event)
      }
    }
  }

  return { days }
}

function DetailField({ label, value }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.66 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
        {value || '-'}
      </Typography>
    </Box>
  )
}

export default function SlaReportingPage() {
  const [activeTab, setActiveTab] = useState('overview')
  const [range, setRange] = useState(defaultRange)
  const [ispSearch, setIspSearch] = useState('')
  const [frgSearch, setFrgSearch] = useState('')
  const [ispSort, setIspSort] = useState('risk')
  const [explorerMode, setExplorerMode] = useState('all')
  const [productGroupFilter, setProductGroupFilter] = useState('')
  const [productTypeFilter, setProductTypeFilter] = useState('')
  const [serviceTypeFilter, setServiceTypeFilter] = useState('')
  const [exportingCurrent, setExportingCurrent] = useState(false)
  const [exportingDetail, setExportingDetail] = useState(false)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState('')
  const [overviewTrendLoading, setOverviewTrendLoading] = useState(false)
  const [overviewTrendError, setOverviewTrendError] = useState('')
  const [overviewFocusLoading, setOverviewFocusLoading] = useState(false)
  const [overviewFocusError, setOverviewFocusError] = useState('')
  const [, setOverviewOpsLoading] = useState(false)
  const [overviewOpsError, setOverviewOpsError] = useState('')
  const [overview, setOverview] = useState({
    months: [],
    productGroups: [],
    productTypes: [],
    serviceTypes: [],
    cards: {},
    monthTrend: [],
    worstIsps: [],
    productPerformance: [],
    productMonthTrend: [],
    servicePerformance: [],
    from: null,
    to: null
  })
  const [breachLoading, setBreachLoading] = useState(false)
  const [breachError, setBreachError] = useState('')
  const [breachData, setBreachData] = useState({
    months: [],
    links: [],
    totalCount: 0,
    page: 0,
    pageSize: DEFAULT_BREACH_PAGE_SIZE,
    threshold: 99.5,
    from: null,
    to: null
  })
  const [breachSearch, setBreachSearch] = useState('')
  const [breachThreshold, setBreachThreshold] = useState('99.5')
  const [breachPagination, setBreachPagination] = useState({
    page: 0,
    pageSize: DEFAULT_BREACH_PAGE_SIZE
  })
  const [outageLoading, setOutageLoading] = useState(false)
  const [outageError, setOutageError] = useState('')
  const [outageData, setOutageData] = useState({
    months: [],
    byMonth: [],
    byImpactType: [],
    byCauseClass: [],
    byRegion: [],
    byPartyAtFault: [],
    topOutages: []
  })
  const [ticketLoading, setTicketLoading] = useState(false)
  const [ticketError, setTicketError] = useState('')
  const [ticketData, setTicketData] = useState({
    months: [],
    byMonth: [],
    byCategory: [],
    bySeverity: [],
    byPartyAtFault: [],
    topTickets: []
  })
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState({ months: [], isps: [], productGroups: [], productTypes: [], serviceTypes: [], from: null, to: null })
  const [linksByIsp, setLinksByIsp] = useState({})
  const [linksMetaByIsp, setLinksMetaByIsp] = useState({})
  const [expandedIsp, setExpandedIsp] = useState('')

  const [openLink, setOpenLink] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState('')
  const [selectedOutage, setSelectedOutage] = useState(null)
  const [selectedTicket, setSelectedTicket] = useState(null)

  function clearFilters() {
    setRange(defaultRange())
    setIspSearch('')
    setFrgSearch('')
    setIspSort('risk')
    setExplorerMode('all')
    setProductGroupFilter('')
    setProductTypeFilter('')
    setServiceTypeFilter('')
    setBreachSearch('')
    setBreachThreshold(`${SLA_TARGET}`)
    setBreachPagination({
      page: 0,
      pageSize: DEFAULT_BREACH_PAGE_SIZE
    })
    setExpandedIsp('')
  }

  function openBreachesTab() {
    setActiveTab('breaches')
  }

  function focusIsp(ispName) {
    if (!ispName) return
    setIspSearch(String(ispName))
    setActiveTab('explorer')
  }

  function focusProductType(productType) {
    if (!productType) return
    setProductTypeFilter(String(productType))
  }

  function focusProductGroup(productGroup) {
    if (!productGroup) return
    setProductGroupFilter(String(productGroup))
  }

  function focusServiceType(serviceType) {
    if (!serviceType) return
    setServiceTypeFilter(String(serviceType))
  }

  function getOverviewParams() {
    return {
      from: range.from,
      to: range.to,
      productGroup: productGroupFilter,
      productType: productTypeFilter,
      serviceType: serviceTypeFilter
    }
  }

  async function loadSummary() {
    setLoading(true)
    try {
      const res = await api.get('/sla-reporting/summary', {
        params: {
          from: range.from,
          to: range.to,
          productGroup: productGroupFilter,
          productType: productTypeFilter,
          serviceType: serviceTypeFilter
        }
      })
      setData(res.data || { months: [], isps: [], productGroups: [], productTypes: [], serviceTypes: [] })
      setLinksByIsp({})
      setLinksMetaByIsp({})
      setExpandedIsp('')
    } finally {
      setLoading(false)
    }
  }

  async function loadOverview() {
    setOverviewLoading(true)
    setOverviewError('')
    setOverviewTrendError('')
    setOverviewFocusError('')
    setOverviewOpsError('')
    setOverview((state) => ({
      ...state,
      monthTrend: [],
      worstIsps: [],
      productPerformance: [],
      productMonthTrend: [],
      servicePerformance: [],
      cards: {
        ...(state.cards || {}),
        ticketCount: null,
        serviceImpactingTickets: null,
        outageCount: null
      }
    }))
    try {
      const params = getOverviewParams()
      const res = await api.get('/sla-reporting/overview', { params })
      setOverview((state) => ({
        ...state,
        ...(res.data || {
          months: [],
          productGroups: [],
          productTypes: [],
          serviceTypes: [],
          cards: {},
          monthTrend: [],
          worstIsps: [],
          productPerformance: [],
          productMonthTrend: [],
          servicePerformance: []
        })
      }))
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load overview'
      setOverviewError(String(msg))
    } finally {
      setOverviewLoading(false)
    }
  }

  async function loadOverviewOptions(providedParams = null) {
    try {
      const params = providedParams || getOverviewParams()
      const res = await api.get('/sla-reporting/overview/options', {
        params: {
          from: params.from,
          to: params.to
        }
      })
      setOverview((state) => ({
        ...state,
        productGroups: res.data?.productGroups || [],
        productTypes: res.data?.productTypes || [],
        serviceTypes: res.data?.serviceTypes || []
      }))
    } catch (err) {
      console.warn('Failed to load SLA overview filter options', err)
    }
  }

  async function loadOverviewTrend(providedParams = null) {
    setOverviewTrendLoading(true)
    setOverviewTrendError('')
    try {
      const res = await api.get('/sla-reporting/overview/trend', {
        params: providedParams || getOverviewParams()
      })
      setOverview((state) => ({
        ...state,
        monthTrend: res.data?.monthTrend || []
      }))
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Trend section failed to load'
      setOverviewTrendError(String(msg))
    } finally {
      setOverviewTrendLoading(false)
    }
  }

  async function loadOverviewOps(providedParams = null) {
    setOverviewOpsLoading(true)
    setOverviewOpsError('')
    try {
      const res = await api.get('/sla-reporting/overview/ops', {
        params: providedParams || getOverviewParams()
      })
      setOverview((state) => ({
        ...state,
        cards: {
          ...(state.cards || {}),
          ...(res.data?.cards || {})
        }
      }))
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Operational counters failed to load'
      setOverviewOpsError(String(msg))
    } finally {
      setOverviewOpsLoading(false)
    }
  }

  async function loadOverviewFocus(providedParams = null) {
    setOverviewFocusLoading(true)
    setOverviewFocusError('')
    const params = providedParams || getOverviewParams()
    const [ispsResult, groupsResult] = await Promise.allSettled([
      api.get('/sla-reporting/overview/isps', { params }),
      api.get('/sla-reporting/overview/groups', { params })
    ])

    let failedCount = 0

    if (ispsResult.status === 'fulfilled') {
      setOverview((state) => ({
        ...state,
        worstIsps: ispsResult.value?.data?.worstIsps || []
      }))
    } else {
      failedCount += 1
    }

    if (groupsResult.status === 'fulfilled') {
      setOverview((state) => ({
        ...state,
        productPerformance: groupsResult.value?.data?.productPerformance || [],
        servicePerformance: groupsResult.value?.data?.servicePerformance || []
      }))
    } else {
      failedCount += 1
    }

    if (failedCount > 0) {
      setOverviewFocusError('Some overview insight sections are still loading slowly or failed to load.')
    }

    setOverviewFocusLoading(false)
  }

  async function loadBreaches() {
    setBreachLoading(true)
    setBreachError('')
    try {
      const res = await api.get('/sla-reporting/breaches', {
        params: {
          from: range.from,
          to: range.to,
          productGroup: productGroupFilter,
          productType: productTypeFilter,
          serviceType: serviceTypeFilter,
          threshold: breachThreshold,
          search: breachSearch,
          page: breachPagination.page,
          pageSize: breachPagination.pageSize
        }
      })
      setBreachData(res.data || {
        months: [],
        links: [],
        totalCount: 0,
        page: 0,
        pageSize: DEFAULT_BREACH_PAGE_SIZE,
        threshold: 99.5
      })
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load breaches'
      setBreachError(String(msg))
    } finally {
      setBreachLoading(false)
    }
  }

  async function loadOutageAnalytics() {
    setOutageLoading(true)
    setOutageError('')
    try {
      const res = await api.get('/sla-reporting/outages/analytics', {
        params: {
          from: range.from,
          to: range.to,
          productGroup: productGroupFilter,
          productType: productTypeFilter,
          serviceType: serviceTypeFilter
        }
      })
      setOutageData(res.data || {
        months: [],
        byMonth: [],
        byImpactType: [],
        byCauseClass: [],
        byRegion: [],
        byPartyAtFault: [],
        topOutages: []
      })
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load outage analytics'
      setOutageError(String(msg))
    } finally {
      setOutageLoading(false)
    }
  }

  async function loadTicketAnalytics() {
    setTicketLoading(true)
    setTicketError('')
    try {
      const res = await api.get('/sla-reporting/tickets/analytics', {
        params: {
          from: range.from,
          to: range.to,
          productGroup: productGroupFilter,
          productType: productTypeFilter,
          serviceType: serviceTypeFilter
        }
      })
      setTicketData(res.data || {
        months: [],
        byMonth: [],
        byCategory: [],
        bySeverity: [],
        byPartyAtFault: [],
        topTickets: []
      })
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load ticket analytics'
      setTicketError(String(msg))
    } finally {
      setTicketLoading(false)
    }
  }

  function refreshCurrentTab() {
    if (activeTab === 'overview') loadOverview().catch(console.error)
    if (activeTab === 'breaches') loadBreaches().catch(console.error)
    if (activeTab === 'outages') loadOutageAnalytics().catch(console.error)
    if (activeTab === 'tickets') loadTicketAnalytics().catch(console.error)
    if (activeTab === 'explorer') loadSummary().catch(console.error)
  }

  function getIspMeta(ispName) {
    return linksMetaByIsp[ispName] || {
      loading: false,
      loaded: false,
      error: '',
      page: 0,
      pageSize: DEFAULT_ISP_PAGE_SIZE,
      totalCount: 0
    }
  }

  async function loadIspLinks(ispName, page = 0, pageSize = DEFAULT_ISP_PAGE_SIZE) {
    if (!ispName) return
    setLinksMetaByIsp((s) => ({
      ...s,
      [ispName]: {
        ...(s[ispName] || {
          loading: false,
          loaded: false,
          error: '',
          page: 0,
          pageSize: DEFAULT_ISP_PAGE_SIZE,
          totalCount: 0
        }),
        loading: true,
        error: '',
        page,
        pageSize
      }
    }))
    try {
      const res = await api.get(`/sla-reporting/isp/${encodeURIComponent(ispName)}/links`, {
        params: {
          from: range.from,
          to: range.to,
          page,
          pageSize,
          frgSearch,
          productGroup: productGroupFilter,
          productType: productTypeFilter,
          serviceType: serviceTypeFilter
        }
      })
      const payload = res.data || {}
      const links = payload.links || []
      setLinksByIsp((s) => ({ ...s, [ispName]: links }))
      setLinksMetaByIsp((s) => ({
        ...s,
        [ispName]: {
          loading: false,
          loaded: true,
          error: '',
          page: Number(payload.page ?? page),
          pageSize: Number(payload.pageSize ?? pageSize),
          totalCount: Number(payload.totalCount ?? links.length)
        }
      }))
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load links'
      setLinksMetaByIsp((s) => ({
        ...s,
        [ispName]: {
          ...(s[ispName] || {
            loading: false,
            loaded: false,
            error: '',
            page: 0,
            pageSize: DEFAULT_ISP_PAGE_SIZE,
            totalCount: 0
          }),
          loading: false,
          loaded: false,
          error: String(msg),
          page,
          pageSize
        }
      }))
    }
  }

  async function openLinkDetails(link) {
    setOpenLink(link)
    setDetail(null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const res = await api.get(`/sla-reporting/link/${encodeURIComponent(link)}/details`, {
        params: {
          from: range.from,
          to: range.to
        }
      })
      setDetail(res.data)
    } catch (err) {
      const msg = err?.response?.data?.error || err?.message || 'Failed to load FRG details'
      setDetailError(String(msg))
    } finally {
      setDetailLoading(false)
    }
  }

  function openOutageDetails(outage) {
    setSelectedOutage(outage || null)
  }

  function openTicketDetails(ticket) {
    setSelectedTicket(ticket || null)
  }

  async function exportCurrentView() {
    const filterRows = [
      { Filter: 'From', Value: range.from || '-' },
      { Filter: 'To', Value: range.to || '-' },
      { Filter: 'Product Group', Value: productGroupFilter || 'All' },
      { Filter: 'Product Type', Value: productTypeFilter || 'All' },
      { Filter: 'Service Type', Value: serviceTypeFilter || 'All' },
      { Filter: 'Explorer ISP Search', Value: ispSearch || '-' },
      { Filter: 'Explorer FRG Search', Value: frgSearch || '-' }
    ]

    const fileSuffix = `${safeFilePart(activeTab)}-${safeFilePart(range.from)}-to-${safeFilePart(range.to)}.xlsx`
    const sheets = [{ name: 'Filters', rows: filterRows }]

    if (activeTab === 'overview') {
      sheets.push(
        {
          name: 'Overview Cards',
          rows: [
            { Metric: 'Average SLA', Value: fmtPct(overview.cards?.avgUptimePct) },
            { Metric: 'Breaching Links', Value: fmtCount(overview.cards?.breachLinks) },
            { Metric: 'Impacted Links', Value: fmtCount(overview.cards?.impactedLinks) },
            { Metric: 'Total Downtime', Value: fmtHours(overview.cards?.totalDowntimeHours) },
            { Metric: 'Tickets', Value: fmtCount(overview.cards?.ticketCount) },
            { Metric: 'Outages', Value: fmtCount(overview.cards?.outageCount) }
          ]
        },
        { name: 'Monthly Trend', rows: overview.monthTrend || [] },
        { name: 'Worst ISPs', rows: overview.worstIsps || [] },
        { name: 'Product Performance', rows: overview.productPerformance || [] },
        { name: 'Service Performance', rows: overview.servicePerformance || [] }
      )
    }

    if (activeTab === 'breaches') {
      sheets.push({
        name: 'Breaches',
        rows: (breachData.links || []).map((row) => ({
          ISP: row.isp,
          'FRG Link': row.frogfootlinklabel,
          Product: row.productType,
          Service: row.serviceType,
          'Range Avg SLA': row.avgUptimePct,
          'Current Month SLA': row.currentMonthUptimePct,
          'Worst Month SLA': row.worstUptimePct,
          'Below Threshold Months': row.belowThresholdMonths,
          'Impacted Months': row.impactedMonths,
          'Downtime Hours': row.totalDowntimeHours,
          Tickets: row.ticketCount,
          'Service Impacting Tickets': row.serviceImpactingTickets,
          Outages: row.outageCount,
          ...(row.monthValues || {})
        }))
      })
    }

    if (activeTab === 'outages') {
      sheets.push(
        { name: 'By Month', rows: outageData.byMonth || [] },
        { name: 'Impact Type', rows: outageData.byImpactType || [] },
        { name: 'Cause Class', rows: outageData.byCauseClass || [] },
        { name: 'Regions', rows: outageData.byRegion || [] },
        { name: 'Party At Fault', rows: outageData.byPartyAtFault || [] },
        { name: 'Top Outages', rows: outageData.topOutages || [] }
      )
    }

    if (activeTab === 'tickets') {
      sheets.push(
        { name: 'By Month', rows: ticketData.byMonth || [] },
        { name: 'Categories', rows: ticketData.byCategory || [] },
        { name: 'Severity', rows: ticketData.bySeverity || [] },
        { name: 'Party At Fault', rows: ticketData.byPartyAtFault || [] },
        { name: 'Top Tickets', rows: ticketData.topTickets || [] }
      )
    }

    if (activeTab === 'explorer') {
      const loadedLinks = Object.entries(linksByIsp).flatMap(([ispName, links]) =>
        (links || []).map((row) => ({
          ISP: ispName,
          'FRG Link': row.frogfootlinklabel,
          'Avg SLA': row.avgUptimePct,
          'Worst SLA': row.worstUptimePct,
          'Impacted Months': row.impactedMonths,
          'Downtime Hours': row.totalDowntimeHours,
          ...(row.monthValues || {})
        }))
      )

      sheets.push(
        { name: 'ISP Summary', rows: visibleIsps || [] },
        { name: 'Loaded Links', rows: loadedLinks }
      )
    }

    setExportingCurrent(true)
    try {
      await downloadWorkbook(`sla-${fileSuffix}`, sheets)
    } finally {
      setExportingCurrent(false)
    }
  }

  async function exportOpenLinkDetails() {
    if (!detail?.details?.length || !openLink) return

    const sheets = [
      {
        name: 'Monthly Summary',
        rows: detail.details.map((month) => ({
          'Year Month': month.yearMonth,
          'SLA %': month.sla?.uptimePct,
          'Downtime Hours': month.sla?.downtimeHours,
          'Active Hours': month.sla?.activeHours,
          Tickets: month.tickets?.length || 0,
          Outages: month.outages?.length || 0,
          'Linked Tickets': month.overlap?.linkedTickets || 0,
          'Overlap Tickets': month.overlap?.overlapTickets || 0,
          'Overlap Pairs': month.overlap?.overlapPairs || 0
        }))
      }
    ]

    ;(detail.details || []).forEach((month) => {
      sheets.push(
        { name: `${month.yearMonth} Tickets`, rows: month.tickets || [] },
        { name: `${month.yearMonth} Outages`, rows: month.outages || [] }
      )
    })

    setExportingDetail(true)
    try {
      await downloadWorkbook(
        `sla-link-${safeFilePart(openLink)}-${safeFilePart(detail.from)}-to-${safeFilePart(detail.to)}.xlsx`,
        sheets
      )
    } finally {
      setExportingDetail(false)
    }
  }

  useEffect(() => {
    if (activeTab !== 'overview' && overview.months?.length) return
    loadOverview().catch(console.error)
  }, [activeTab, range.from, range.to, productGroupFilter, productTypeFilter, serviceTypeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'breaches') loadBreaches().catch(console.error)
  }, [
    activeTab,
    range.from,
    range.to,
    productGroupFilter,
    productTypeFilter,
    serviceTypeFilter,
    breachThreshold,
    breachSearch,
    breachPagination.page,
    breachPagination.pageSize
  ]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'outages') loadOutageAnalytics().catch(console.error)
  }, [activeTab, range.from, range.to, productGroupFilter, productTypeFilter, serviceTypeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'tickets') loadTicketAnalytics().catch(console.error)
  }, [activeTab, range.from, range.to, productGroupFilter, productTypeFilter, serviceTypeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'explorer') loadSummary().catch(console.error)
  }, [activeTab, range.from, range.to, productGroupFilter, productTypeFilter, serviceTypeFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLinksByIsp({})
    setLinksMetaByIsp({})
    setExpandedIsp('')
  }, [frgSearch, productGroupFilter, productTypeFilter, serviceTypeFilter, range.from, range.to])

  useEffect(() => {
    setBreachPagination((state) => ({ ...state, page: 0 }))
  }, [breachSearch, breachThreshold])

  const visibleIsps = useMemo(() => {
    const q = ispSearch.trim().toLowerCase()
    let rows = [...(data.isps || [])]

    if (q) {
      rows = rows.filter((isp) => String(isp.isp || '').toLowerCase().includes(q))
    }

    if (explorerMode === 'impacted') {
      rows = rows.filter((isp) => Number(isp.impactedLinks || 0) > 0)
    }

    if (explorerMode === 'breach') {
      rows = rows.filter((isp) => Number(isp.avgUptimePct || 100) < SLA_TARGET)
    }

    rows.sort((a, b) => {
      if (ispSort === 'alphabetical') {
        return String(a.isp || '').localeCompare(String(b.isp || ''))
      }

      if (ispSort === 'downtime') {
        return Number(b.totalDowntimeHours || 0) - Number(a.totalDowntimeHours || 0)
      }

      if (Number(a.avgUptimePct || 100) !== Number(b.avgUptimePct || 100)) {
        return Number(a.avgUptimePct || 100) - Number(b.avgUptimePct || 100)
      }

      return Number(b.totalDowntimeHours || 0) - Number(a.totalDowntimeHours || 0)
    })

    return rows
  }, [data.isps, explorerMode, ispSearch, ispSort])

  const explorerSummary = useMemo(() => ({
    visible: visibleIsps.length,
    impacted: visibleIsps.filter((isp) => Number(isp.impactedLinks || 0) > 0).length,
    breaching: visibleIsps.filter((isp) => Number(isp.avgUptimePct || 100) < SLA_TARGET).length
  }), [visibleIsps])

  const explorerWorstIsp = useMemo(() => {
    if (!visibleIsps.length) return null
    return [...visibleIsps].sort((a, b) => {
      if (Number(a.avgUptimePct || 100) !== Number(b.avgUptimePct || 100)) {
        return Number(a.avgUptimePct || 100) - Number(b.avgUptimePct || 100)
      }
      return Number(b.totalDowntimeHours || 0) - Number(a.totalDowntimeHours || 0)
    })[0]
  }, [visibleIsps])

  const explorerModeLabel = explorerMode === 'impacted'
    ? 'Impacted only'
    : explorerMode === 'breach'
      ? 'Breaching only'
      : 'All ISPs'

  const explorerSortLabel = ispSort === 'downtime'
    ? 'Most downtime'
    : ispSort === 'alphabetical'
      ? 'A-Z'
      : 'Highest risk'

  const currentTabLoading = (
    activeTab === 'overview'
      ? overviewLoading
      : activeTab === 'breaches'
        ? breachLoading
        : activeTab === 'outages'
          ? outageLoading
          : activeTab === 'tickets'
            ? ticketLoading
            : loading
  )

  const activeFilterCount = [
    productGroupFilter,
    productTypeFilter,
    serviceTypeFilter,
    ispSearch,
    frgSearch
  ].filter(Boolean).length

  const overviewInsights = useMemo(() => {
    const worstIsp = overview.worstIsps?.[0] || null
    const hottestProduct = [...(overview.productPerformance || [])]
      .sort((a, b) => Number(b.impactedLinks || 0) - Number(a.impactedLinks || 0))[0] || null
    const trend = overview.monthTrend || []
    const last = trend[trend.length - 1] || null
    const prev = trend[trend.length - 2] || null
    const delta = last && prev
      ? Number(last.avgUptimePct || 0) - Number(prev.avgUptimePct || 0)
      : null
    const minorOutages = Number(overview.cards?.minorOutageCount || 0)
    const majorOutages = Number(overview.cards?.majorOutageCount || 0)

    return {
      watchlist: worstIsp ? {
        badge: worstIsp.isp,
        message: `${worstIsp.isp} is currently the weakest performer at ${fmtPct(worstIsp.avgUptimePct)} average SLA, peaking at ${fmtCount(worstIsp.breachLinks)} breaching links in a month across the selected range.`,
        actionLabel: 'Open In Explorer',
        onAction: () => focusIsp(worstIsp.isp)
      } : {
        badge: 'Stable',
        message: 'No watchlist ISP stands out in the selected range yet.',
        actionLabel: ''
      },
      product: hottestProduct ? {
        badge: hottestProduct.label,
        message: `${hottestProduct.label} carries the heaviest impact concentration, peaking at ${fmtCount(hottestProduct.impactedLinks)} impacted links against a monthly base of ${fmtCount(hottestProduct.linkCount)}.`,
        actionLabel: 'Filter Group',
        onAction: () => focusProductGroup(hottestProduct.label)
      } : {
        badge: 'No Data',
        message: 'No product concentration insight is available for this range.',
        actionLabel: ''
      },
      incident: {
        badge: `${fmtCount(majorOutages)} major`,
        message: `Minor incidents: ${fmtCount(minorOutages)}. Major outages: ${fmtCount(majorOutages)}. Outages are now counted as unique outage refs, not affected-link rows.`,
        actionLabel: ''
      },
      trend: last ? {
        badge: last.yearMonth,
        tone: delta != null && delta < 0 ? '#dc2626' : '#0f766e',
        message: delta == null
          ? `Latest month in range is ${last.yearMonth} at ${fmtPct(last.avgUptimePct)} average SLA.`
          : delta < 0
            ? `Average SLA worsened by ${Math.abs(delta).toFixed(2)} points into ${last.yearMonth}, now sitting at ${fmtPct(last.avgUptimePct)}.`
            : `Average SLA improved by ${delta.toFixed(2)} points into ${last.yearMonth}, now sitting at ${fmtPct(last.avgUptimePct)}.`
      } : {
        badge: 'No Data',
        tone: '#0f172a',
        message: 'Trend insight is not available for the selected range.'
      }
    }
  }, [overview, visibleIsps]) // eslint-disable-line react-hooks/exhaustive-deps

  const monthColumns = useMemo(() => {
    return (data.months || []).map((m) => ({
      field: `m_${m.replace('-', '_')}`,
      headerName: m,
      width: 88,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      valueGetter: (_, row) => row?.monthValues?.[m] ?? null,
      renderCell: (p) => {
        const v = p.value ?? p.row?.monthValues?.[m] ?? null
        return (
          <Chip
            size="small"
            color={pctChipColor(v)}
            label={fmtPct(v)}
            sx={{ fontWeight: 600 }}
          />
        )
      }
    }))
  }, [data.months])

  const baseColumns = useMemo(() => ([
    {
      field: 'frogfootlinklabel',
      headerName: 'FRG Link',
      width: 190,
      renderCell: (p) => (
        <Button
          size="small"
          variant="text"
          startIcon={<VisibilityOutlinedIcon />}
          onClick={() => openLinkDetails(p.row.frogfootlinklabel)}
          sx={{ textTransform: 'none', fontWeight: 600 }}
        >
          {p.row.frogfootlinklabel}
        </Button>
      )
    },
    {
      field: 'avgUptimePct',
      headerName: 'Avg SLA',
      width: 100,
      align: 'center',
      headerAlign: 'center',
      renderCell: (p) => (
        <Chip
          size="small"
          color={pctChipColor(p.row.avgUptimePct)}
          label={fmtPct(p.row.avgUptimePct)}
          sx={{ fontWeight: 600 }}
        />
      )
    },
    {
      field: 'worstUptimePct',
      headerName: 'Worst SLA',
      width: 100,
      align: 'center',
      headerAlign: 'center',
      renderCell: (p) => (
        <Chip
          size="small"
          color={pctChipColor(p.row.worstUptimePct)}
          label={fmtPct(p.row.worstUptimePct)}
          sx={{ fontWeight: 600 }}
        />
      )
    },
    {
      field: 'impactedMonths',
      headerName: 'Impacted Months',
      width: 118,
      align: 'center',
      headerAlign: 'center',
    },
    {
      field: 'totalDowntimeHours',
      headerName: 'Downtime',
      width: 104,
      align: 'center',
      headerAlign: 'center',
      renderCell: (p) => fmtHours(p.row.totalDowntimeHours)
    }
  ]), []) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = useMemo(() => [...baseColumns, ...monthColumns], [baseColumns, monthColumns])

  return (
    <Box
      px={{ xs: 1, md: 2 }}
      py={1.25}
      sx={{
        width: '100%',
        maxWidth: '100%',
        overflowX: 'hidden',
        mx: 0
      }}
    >
      <Paper
        elevation={0}
        sx={{
          mb: 1.25,
          p: { xs: 1, md: 1.1 },
          border: '1px solid #0b6b49',
          borderRadius: 3,
          color: '#f8fafc',
          background: 'linear-gradient(135deg, #0b7a4b 0%, #125c6d 58%, #142a45 100%)',
          boxShadow: '0 18px 36px rgba(15, 23, 42, 0.18)',
          overflow: 'hidden'
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.02 }}>
          SLA Performance Dashboard
        </Typography>
      </Paper>

      <Paper
        elevation={0}
        sx={{
          p: 1.25,
          mb: 1.25,
          border: '1px solid #d8e3dd',
          borderRadius: 3,
          bgcolor: '#f7fbf8',
          background: 'linear-gradient(180deg, #fbfefd 0%, #f7fbf8 100%)',
          boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
          overflow: 'hidden'
        }}
      >
        <Stack spacing={1}>
          <Box
            sx={{
              display: 'grid',
              gap: 1,
              gridTemplateColumns: {
                xs: '1fr',
                xl: '1.45fr 1fr'
              }
            }}
          >
            <Box
              sx={{
                p: 1,
                borderRadius: 2.5,
                border: '1px solid #dce8e1',
                bgcolor: '#ffffff',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)'
              }}
            >
              <Typography variant="overline" sx={{ letterSpacing: 0.9, color: '#0f766e' }}>
                Range And Scope
              </Typography>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                alignItems={{ xs: 'stretch', md: 'center' }}
                useFlexGap
                flexWrap="wrap"
                sx={{ minWidth: 0, mt: 0.5 }}
              >
                <TextField
                  size="small"
                  label="From"
                  type="month"
                  value={range.from}
                  onChange={(e) => setRange(s => ({ ...s, from: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                  sx={{ minWidth: 138 }}
                />
                <TextField
                  size="small"
                  label="To"
                  type="month"
                  value={range.to}
                  onChange={(e) => setRange(s => ({ ...s, to: e.target.value }))}
                  InputLabelProps={{ shrink: true }}
                  sx={{ minWidth: 138 }}
                />
                <TextField
                  size="small"
                  select
                  label="Product Group"
                  value={productGroupFilter}
                  onChange={(e) => setProductGroupFilter(e.target.value)}
                  sx={{ minWidth: 154 }}
                >
                  <MenuItem value="">All Groups</MenuItem>
                  {((overview.productGroups && overview.productGroups.length ? overview.productGroups : data.productGroups) || []).map((pg) => (
                    <MenuItem key={`pg-${pg}`} value={pg}>{pg}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  select
                  label="Product Type"
                  value={productTypeFilter}
                  onChange={(e) => setProductTypeFilter(e.target.value)}
                  sx={{ minWidth: 166 }}
                >
                  <MenuItem value="">All Products</MenuItem>
                  {((overview.productTypes && overview.productTypes.length ? overview.productTypes : data.productTypes) || []).map((pt) => (
                    <MenuItem key={`pt-${pt}`} value={pt}>{pt}</MenuItem>
                  ))}
                </TextField>
                <TextField
                  size="small"
                  select
                  label="Service Type"
                  value={serviceTypeFilter}
                  onChange={(e) => setServiceTypeFilter(e.target.value)}
                  sx={{ minWidth: 166 }}
                >
                  <MenuItem value="">All Services</MenuItem>
                  {((overview.serviceTypes && overview.serviceTypes.length ? overview.serviceTypes : data.serviceTypes) || []).map((st) => (
                    <MenuItem key={`st-${st}`} value={st}>{st}</MenuItem>
                  ))}
                </TextField>
              </Stack>
            </Box>

            <Box
              sx={{
                p: 1,
                borderRadius: 2.5,
                border: '1px solid #dce8e1',
                bgcolor: '#ffffff',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.85)'
              }}
            >
              <Typography variant="overline" sx={{ letterSpacing: 0.9, color: '#1d4ed8' }}>
                Explorer And Actions
              </Typography>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                alignItems={{ xs: 'stretch', md: 'center' }}
                useFlexGap
                flexWrap="wrap"
                sx={{ minWidth: 0, mt: 0.5 }}
              >
                <TextField
                  size="small"
                  label="Explorer ISP Search"
                  placeholder="e.g. Vox"
                  value={ispSearch}
                  onChange={(e) => setIspSearch(e.target.value)}
                  sx={{ minWidth: 170 }}
                />
                <TextField
                  size="small"
                  label="Explorer FRG Search"
                  placeholder="e.g. FRG1109853"
                  value={frgSearch}
                  onChange={(e) => setFrgSearch(e.target.value)}
                  sx={{ minWidth: 186 }}
                />
                <Button size="small" variant="contained" onClick={refreshCurrentTab} disabled={currentTabLoading}>
                  Refresh
                </Button>
                <Button size="small" variant="outlined" onClick={clearFilters}>
                  Reset
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => exportCurrentView().catch(console.error)}
                  disabled={exportingCurrent}
                >
                  {exportingCurrent ? 'Exporting...' : 'Export Current View'}
                </Button>
                <Chip
                  size="small"
                  label={`Range: ${overview.from || data.from || range.from || '-'} to ${overview.to || data.to || range.to || '-'}`}
                  sx={{ fontWeight: 700, bgcolor: '#ecfdf5', color: '#166534' }}
                />
              </Stack>
            </Box>
          </Box>

          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', md: 'center' }}
            useFlexGap
            flexWrap="wrap"
            sx={{ minWidth: 0 }}
          >
            <Typography variant="caption" sx={{ minWidth: 78, opacity: 0.75, fontWeight: 700 }}>
              Quick Range
            </Typography>
            <Button size="small" variant="outlined" onClick={() => setRange(recentMonthRange(3))} sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700 }}>Last 3M</Button>
            <Button size="small" variant="outlined" onClick={() => setRange(recentMonthRange(6))} sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700 }}>Last 6M</Button>
            <Button size="small" variant="outlined" onClick={() => setRange(recentMonthRange(12))} sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700 }}>Last 12M</Button>
            <Button size="small" variant="outlined" onClick={() => setRange(ytdRange())} sx={{ borderRadius: 3, textTransform: 'none', fontWeight: 700 }}>YTD</Button>
            <Chip size="small" label={`Tab ${activeTab.replace('-', ' ')}`} sx={{ fontWeight: 700 }} />
            {productGroupFilter ? <Chip size="small" label={`Group ${productGroupFilter}`} sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }} /> : null}
            {productTypeFilter ? <Chip size="small" label={`Product ${productTypeFilter}`} sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }} /> : null}
            {serviceTypeFilter ? <Chip size="small" label={`Service ${serviceTypeFilter}`} sx={{ bgcolor: '#eff6ff', color: '#1d4ed8', fontWeight: 700 }} /> : null}
          </Stack>
        </Stack>
      </Paper>

      <Paper elevation={0} sx={{ mb: 1.25, border: '1px solid #e5e7eb', borderRadius: 3, overflow: 'hidden', boxShadow: '0 10px 24px rgba(15, 23, 42, 0.04)' }}>
        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            px: 1,
            minHeight: 48,
            '& .MuiTab-root': {
              minHeight: 48,
              textTransform: 'none',
              fontWeight: 700,
              fontSize: 13
            },
            '& .Mui-selected': {
              color: '#0f766e !important'
            },
            '& .MuiTabs-indicator': {
              height: 3,
              borderRadius: 3,
              bgcolor: '#0f766e'
            }
          }}
        >
          <Tab value="overview" label="Overview" />
          <Tab value="breaches" label="Breach Monitor" />
          <Tab value="outages" label="Outages" />
          <Tab value="tickets" label="Tickets" />
          <Tab value="explorer" label="Link Explorer" />
        </Tabs>
      </Paper>

      {activeTab === 'overview' ? (
        <SlaOverviewTab
          loading={overviewLoading}
          error={overviewError}
          overview={overview}
          insights={overviewInsights}
          trendLoading={overviewTrendLoading}
          trendError={[overviewTrendError, overviewOpsError].filter(Boolean).join(' ')}
          focusLoading={overviewFocusLoading}
          focusError={overviewFocusError}
          fmtPct={fmtPct}
          fmtHours={fmtHours}
          fmtCount={fmtCount}
          onViewBreaches={openBreachesTab}
          onSelectIsp={focusIsp}
          onSelectProductGroup={focusProductGroup}
          onSelectProductType={focusProductType}
          onSelectServiceType={focusServiceType}
        />
      ) : null}

      {activeTab === 'breaches' ? (
        <SlaBreachesTab
          loading={breachLoading}
          error={breachError}
          breachData={breachData}
          breachPagination={breachPagination}
          setBreachPagination={setBreachPagination}
          breachSearch={breachSearch}
          setBreachSearch={setBreachSearch}
          breachThreshold={breachThreshold}
          setBreachThreshold={setBreachThreshold}
          fmtCount={fmtCount}
          fmtPct={fmtPct}
          fmtHours={fmtHours}
          pctChipColor={pctChipColor}
          openLinkDetails={openLinkDetails}
        />
      ) : null}

      {activeTab === 'outages' ? (
        <SlaOutagesTab
          loading={outageLoading}
          error={outageError}
          outageData={outageData}
          fmtCount={fmtCount}
          fmtHours={fmtHours}
          fmtTs={fmtTs}
          onOpenOutage={openOutageDetails}
        />
      ) : null}

      {activeTab === 'tickets' ? (
        <SlaTicketsTab
          loading={ticketLoading}
          error={ticketError}
          ticketData={ticketData}
          fmtCount={fmtCount}
          fmtHours={fmtHours}
          onOpenTicket={openTicketDetails}
        />
      ) : null}

      {activeTab === 'explorer' ? (loading ? (
        <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 3, boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)' }}>
          <CircularProgress size={28} />
          <Typography variant="body2" sx={{ mt: 1.2 }}>Loading SLA data...</Typography>
        </Paper>
      ) : (
        <>
          <Paper
            elevation={0}
            sx={{
              p: 1.25,
              mb: 1.1,
              border: '1px solid #e5e7eb',
              borderRadius: 3,
              overflow: 'hidden',
              boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
              background: 'linear-gradient(180deg, #f7fbff 0%, #ffffff 100%)'
            }}
          >
            <Stack spacing={1.1}>
              <Box>
                <Typography variant="overline" sx={{ letterSpacing: 0.9, color: '#1d4ed8' }}>
                  Link Explorer
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.74 }}>
                  Open an ISP to inspect FRG-level SLA movement, monthly evidence, and drilldown detail.
                </Typography>
              </Box>

              <Stack direction={{ xs: 'column', lg: 'row' }} spacing={1} alignItems={{ xs: 'stretch', lg: 'center' }} useFlexGap flexWrap="wrap" sx={{ minWidth: 0 }}>
                <TextField
                  size="small"
                  select
                  label="Explorer View"
                  value={explorerMode}
                  onChange={(e) => setExplorerMode(e.target.value)}
                  sx={{ minWidth: 170 }}
                >
                  <MenuItem value="all">All ISPs</MenuItem>
                  <MenuItem value="impacted">Impacted Only</MenuItem>
                  <MenuItem value="breach">Breaching Only</MenuItem>
                </TextField>
                <TextField
                  size="small"
                  select
                  label="ISP Sort"
                  value={ispSort}
                  onChange={(e) => setIspSort(e.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="risk">Highest Risk First</MenuItem>
                  <MenuItem value="downtime">Most Downtime</MenuItem>
                  <MenuItem value="alphabetical">A-Z</MenuItem>
                </TextField>
                <Chip size="small" label={`Mode ${explorerModeLabel}`} sx={{ fontWeight: 700, bgcolor: '#eff6ff', color: '#1d4ed8' }} />
                <Chip size="small" label={`Sort ${explorerSortLabel}`} sx={{ fontWeight: 700 }} />
                <Chip size="small" label={`Filters ${fmtCount(activeFilterCount)}`} sx={{ fontWeight: 700 }} />
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
                <ExplorerStatCard
                  label="Showing"
                  value={`${fmtCount(explorerSummary.visible)} / ${fmtCount(data.isps?.length || 0)}`}
                  subtext="Visible ISPs after explorer mode and search filters."
                  tone="#1d4ed8"
                />
                <ExplorerStatCard
                  label="Impacted ISPs"
                  value={fmtCount(explorerSummary.impacted)}
                  subtext="ISPs with any impacted links in the visible set."
                  tone="#f59e0b"
                />
                <ExplorerStatCard
                  label="Breaching ISPs"
                  value={fmtCount(explorerSummary.breaching)}
                  subtext={`ISPs sitting below ${SLA_TARGET}% average SLA.`}
                  tone="#dc2626"
                />
                <ExplorerStatCard
                  label="Weakest Visible ISP"
                  value={explorerWorstIsp?.isp || '-'}
                  subtext={explorerWorstIsp ? `Average ${fmtPct(explorerWorstIsp.avgUptimePct)} | Downtime ${fmtHours(explorerWorstIsp.totalDowntimeHours)}` : 'No ISP loaded in the current explorer slice.'}
                  tone="#0f172a"
                />
              </Box>
            </Stack>
          </Paper>

          {(visibleIsps || []).map((isp) => (
            <Accordion
              key={isp.isp}
              expanded={expandedIsp === isp.isp}
              onChange={(_, expanded) => {
                const meta = getIspMeta(isp.isp)
                if (meta.loading) return
                setExpandedIsp(expanded ? isp.isp : '')
                if (expanded) {
                  if (!meta.loaded) {
                    loadIspLinks(isp.isp, 0, DEFAULT_ISP_PAGE_SIZE).catch(console.error)
                  }
                }
              }}
              sx={{
                mb: 1,
                overflow: 'hidden',
                border: '1px solid #e5e7eb',
                borderLeft: `4px solid ${Number(isp.avgUptimePct || 100) < SLA_TARGET ? '#dc2626' : Number(isp.impactedLinks || 0) > 0 ? '#f59e0b' : '#0f766e'}`,
                borderRadius: 3,
                boxShadow: '0 10px 24px rgba(15, 23, 42, 0.04)',
                bgcolor: '#fff',
                '&:before': {
                  display: 'none'
                }
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{
                  px: 1.25,
                  py: 0.25,
                  background: 'linear-gradient(180deg, #fbfdff 0%, #ffffff 100%)',
                  '& .MuiAccordionSummary-content': {
                    my: 1
                  }
                }}
              >
                <Stack
                  direction={{ xs: 'column', md: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'flex-start', md: 'center' }}
                  sx={{ width: '100%' }}
                >
                  <Typography variant="subtitle1" fontWeight={800}>{isp.isp}</Typography>
                  {getIspMeta(isp.isp).loading ? <CircularProgress size={16} /> : null}
                  <Chip size="small" label={`Links ${isp.linkCount}`} sx={{ fontWeight: 700 }} />
                  <Chip size="small" label={`Impacted ${isp.impactedLinks}`} color={isp.impactedLinks > 0 ? 'warning' : 'success'} sx={{ fontWeight: 700 }} />
                  <Chip size="small" label={`Avg ${fmtPct(isp.avgUptimePct)}`} color={pctChipColor(isp.avgUptimePct)} sx={{ fontWeight: 700 }} />
                  <Chip size="small" label={`Worst ${fmtPct(isp.worstUptimePct)}`} color={pctChipColor(isp.worstUptimePct)} sx={{ fontWeight: 700 }} />
                  <Chip size="small" label={`Downtime ${fmtHours(isp.totalDowntimeHours)}`} sx={{ fontWeight: 700 }} />
                </Stack>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                {(() => {
                  const meta = getIspMeta(isp.isp)
                  const rows = (linksByIsp[isp.isp] || []).map((l) => ({ id: l.frogfootlinklabel, ...l }))
                  const hasNoRows = !meta.loading && meta.loaded && rows.length === 0

                  return (
                    <Box>
                      {meta.error ? (
                        <Alert severity="warning" sx={{ m: 1 }}>
                          {meta.error}
                        </Alert>
                      ) : null}

                      {meta.loading && !rows.length ? (
                        <Box py={2.25} textAlign="center">
                          <CircularProgress size={22} />
                          <Typography variant="body2" sx={{ mt: 1 }}>Loading links...</Typography>
                        </Box>
                      ) : hasNoRows ? (
                        <Paper elevation={0} sx={{ p: 1.5, borderTop: '1px solid #eee', borderRadius: 0 }}>
                          <Typography variant="body2">No FRG link records returned for this ISP in the selected range.</Typography>
                        </Paper>
                      ) : (
                        <Box sx={{ width: '100%', maxWidth: '100%', overflowX: 'auto' }}>
                          <DataGrid
                            rows={rows}
                            columns={columns}
                            autoHeight
                            density="compact"
                            rowCount={meta.totalCount || rows.length}
                            pageSizeOptions={[25, 50, 100, 200]}
                            paginationMode="server"
                            paginationModel={{ page: meta.page || 0, pageSize: meta.pageSize || DEFAULT_ISP_PAGE_SIZE }}
                            onPaginationModelChange={(model) => {
                              loadIspLinks(isp.isp, model.page, model.pageSize).catch(console.error)
                            }}
                            loading={Boolean(meta.loading)}
                            slots={{ toolbar: GridToolbar }}
                            slotProps={{
                              toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 250 } }
                            }}
                            sx={{
                              border: 0,
                              minWidth: 920,
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
                      )}
                    </Box>
                  )
                })()}
              </AccordionDetails>
            </Accordion>
          ))}

          {!visibleIsps?.length && (
            <Paper elevation={0} sx={{ p: 2, border: '1px solid #e5e7eb', borderRadius: 3, boxShadow: '0 10px 24px rgba(15, 23, 42, 0.04)' }}>
              <Typography variant="body2">
                {data.isps?.length
                  ? 'No ISPs match your current search.'
                  : 'No SLA records found for selected range.'}
              </Typography>
            </Paper>
          )}
        </>
      )) : null}

      <Dialog
        open={Boolean(openLink)}
        onClose={() => {
          setOpenLink('')
          setDetailError('')
        }}
        fullWidth
        maxWidth="xl"
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" component="span">
            FRG Details: {openLink}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => exportOpenLinkDetails().catch(console.error)}
            disabled={!detail || exportingDetail}
          >
            {exportingDetail ? 'Exporting...' : 'Export Detail'}
          </Button>
        </DialogTitle>
        <DialogContent dividers sx={{ overflowX: 'hidden' }}>
          {detailLoading ? (
            <Box py={3} textAlign="center">
              <CircularProgress size={24} />
              <Typography variant="body2" sx={{ mt: 1 }}>Loading link details...</Typography>
            </Box>
          ) : detailError ? (
            <Alert severity="error">{detailError}</Alert>
          ) : detail ? (
            <Stack spacing={1.2}>
              {(detail.details || []).map((m) => {
                const timeline = buildMonthlyTimelineData(m)
                return (
                  <Accordion key={m.yearMonth} defaultExpanded={m.yearMonth === detail.to}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', md: 'center' }}>
                        <Typography variant="subtitle2" fontWeight={700}>{m.yearMonth}</Typography>
                        <Chip size="small" label={`SLA ${fmtPct(m.sla?.uptimePct)}`} color={pctChipColor(m.sla?.uptimePct)} />
                        <Chip size="small" label={`Downtime ${fmtHours(m.sla?.downtimeHours)}`} />
                        <Chip size="small" label={`Active ${fmtHours(m.sla?.activeHours)}`} />
                        <Chip size="small" label={`Tickets ${m.tickets?.length || 0}`} />
                        <Chip size="small" label={`Outages ${m.outages?.length || 0}`} />
                        <Chip size="small" label={`Linked tickets ${m.overlap?.linkedTickets || 0}`} />
                        <Chip size="small" label={`Overlap tickets ${m.overlap?.overlapTickets || 0}`} />
                        <Chip size="small" label={`Overlap pairs ${m.overlap?.overlapPairs || 0}`} />
                      </Stack>
                    </AccordionSummary>
                    <AccordionDetails>
                      {timeline ? (
                        <Paper elevation={0} sx={{ mb: 1.2, p: 1, border: '1px solid #eee' }}>
                          <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                            Monthly Uptime Timeline
                          </Typography>
                          <Typography variant="caption" sx={{ display: 'block', mb: 0.75, opacity: 0.8 }}>
                            Green = up, red = down. Hover red periods for outage/ticket details. Orange dots are non-downtime tickets.
                          </Typography>
                          <Box sx={{ width: '100%' }}>
                            <Box sx={{ display: 'flex', width: '100%', height: 20, borderRadius: 1, overflow: 'hidden', border: '1px solid #ddd' }}>
                              {timeline.days.map((d) => {
                                const downEvents = d.downEvents || []
                                const otherTickets = d.otherTickets || []
                                const title = (
                                  <Box>
                                    <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                                      {d.label}
                                    </Typography>
                                    {d.isDown ? (
                                      <>
                                        <Typography variant="caption" sx={{ display: 'block', mb: 0.25 }}>
                                          Downtime events: {downEvents.length}
                                        </Typography>
                                        {downEvents.slice(0, 6).map((ev) => (
                                          <Typography key={`${d.day}-${ev.key}`} variant="caption" sx={{ display: 'block' }}>
                                            {ev.type} {ev.id}: {ev.start} - {ev.stop}
                                          </Typography>
                                        ))}
                                        {downEvents.length > 6 ? (
                                          <Typography variant="caption" sx={{ display: 'block' }}>
                                            +{downEvents.length - 6} more
                                          </Typography>
                                        ) : null}
                                      </>
                                    ) : (
                                      <Typography variant="caption" sx={{ display: 'block' }}>
                                        No downtime
                                      </Typography>
                                    )}
                                    {otherTickets.length ? (
                                      <Typography variant="caption" sx={{ display: 'block', mt: 0.25 }}>
                                        Other tickets: {otherTickets.map((t) => t.id).join(', ')}
                                      </Typography>
                                    ) : null}
                                  </Box>
                                )

                                return (
                                  <Tooltip key={`day-bar-${d.day}`} title={title} arrow placement="top">
                                    <Box
                                      sx={{
                                        flex: 1,
                                        bgcolor: d.isDown ? '#d32f2f' : '#2e7d32',
                                        borderRight: d.day < timeline.days.length ? '1px solid rgba(255,255,255,0.35)' : 'none',
                                        cursor: 'pointer'
                                      }}
                                    />
                                  </Tooltip>
                                )
                              })}
                            </Box>

                            <Box sx={{ display: 'flex', width: '100%', mt: 0.35 }}>
                              {timeline.days.map((d) => (
                                <Box key={`day-dot-${d.day}`} sx={{ flex: 1, display: 'flex', justifyContent: 'center', minHeight: 8 }}>
                                  {d.otherTickets?.length ? (
                                    <Tooltip
                                      title={`${d.label} non-downtime tickets: ${d.otherTickets.map((t) => t.id).join(', ')}`}
                                      arrow
                                      placement="top"
                                    >
                                      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#f57c00', mt: 0.15, cursor: 'pointer' }} />
                                    </Tooltip>
                                  ) : null}
                                </Box>
                              ))}
                            </Box>

                            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.3 }}>
                              <Typography variant="caption" sx={{ opacity: 0.75 }}>Day 01</Typography>
                              <Typography variant="caption" sx={{ opacity: 0.75 }}>Day {String(timeline.days.length).padStart(2, '0')}</Typography>
                            </Box>
                          </Box>
                        </Paper>
                      ) : null}

                      <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Tickets</Typography>
                      <Box sx={{ width: '100%', overflowX: 'auto' }}>
                        <Table size="small" sx={{ minWidth: 720 }}>
                          <TableHead>
                            <TableRow>
                              <TableCell>Ticket ID</TableCell>
                              <TableCell>Created</TableCell>
                              <TableCell>Stop</TableCell>
                              <TableCell>Category</TableCell>
                              <TableCell>Linked Outage</TableCell>
                              <TableCell>Overlaps</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {(m.tickets || []).map((t) => (
                              <TableRow key={`${m.yearMonth}-${t.ticket_id}-${t.created_date || ''}`}>
                                <TableCell>{t.ticket_id || '-'}</TableCell>
                                <TableCell>{fmtTs(t.created_date)}</TableCell>
                                <TableCell>{fmtTs(t.impact_stop_time)}</TableCell>
                                <TableCell>{t.category || '-'}</TableCell>
                                <TableCell>{t.linkedOutageRef || '-'}</TableCell>
                                <TableCell>{(t.overlapOutageRefs || []).join(', ') || '-'}</TableCell>
                              </TableRow>
                            ))}
                            {!m.tickets?.length && (
                              <TableRow>
                                <TableCell colSpan={6}>No tickets in this month.</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </Box>

                    <Divider sx={{ my: 1.2 }} />

                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>Outages</Typography>
                    <Box sx={{ width: '100%', overflowX: 'auto' }}>
                      <Table size="small" sx={{ minWidth: 900 }}>
                        <TableHead>
                          <TableRow>
                            <TableCell>Outage Ref</TableCell>
                            <TableCell>Start</TableCell>
                            <TableCell>Stop</TableCell>
                            <TableCell>Impact</TableCell>
                            <TableCell>Force Majeure</TableCell>
                            <TableCell>Title</TableCell>
                            <TableCell>Summary</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {(m.outages || []).map((o) => (
                            <TableRow key={`${m.yearMonth}-${o.outage_ref}`}>
                              <TableCell>{o.outage_ref || '-'}</TableCell>
                              <TableCell>{fmtTs(o.impact_start)}</TableCell>
                              <TableCell>{fmtTs(o.impact_stop)}</TableCell>
                              <TableCell>{o.impact_type || '-'}</TableCell>
                              <TableCell>{o.force_majeure || '-'}</TableCell>
                              <TableCell>{o.outagetitle || '-'}</TableCell>
                              <TableCell>{o.summary || '-'}</TableCell>
                            </TableRow>
                          ))}
                          {!m.outages?.length && (
                            <TableRow>
                              <TableCell colSpan={7}>No outages in this month.</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </Box>
                    </AccordionDetails>
                  </Accordion>
                )
              })}
            </Stack>
          ) : (
            <Typography variant="body2">No details available.</Typography>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedOutage)}
        onClose={() => setSelectedOutage(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>
          Outage Detail: {selectedOutage?.outageRef || '-'}
        </DialogTitle>
        <DialogContent dividers sx={{ overflowX: 'hidden' }}>
          {selectedOutage ? (
            <Stack spacing={1.25}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" label={`Month ${selectedOutage.yearMonth || '-'}`} />
                <Chip size="small" label={`Affected Links ${fmtCount(selectedOutage.affectedLinks)}`} color={selectedOutage.affectedLinks ? 'warning' : 'default'} />
                <Chip size="small" label={`Duration ${fmtHours(selectedOutage.durationHours)}`} color={selectedOutage.durationHours ? 'error' : 'default'} />
                <Chip size="small" label={selectedOutage.impactType || 'Unknown impact'} />
              </Stack>

              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb' }}>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }
                  }}
                >
                  <DetailField label="Impact Type" value={selectedOutage.impactType} />
                  <DetailField label="Cause Class" value={selectedOutage.causeClass} />
                  <DetailField label="Region" value={selectedOutage.region} />
                  <DetailField label="Party At Fault" value={selectedOutage.partyAtFault} />
                  <DetailField label="Impact Start" value={fmtTs(selectedOutage.impactStart)} />
                  <DetailField label="Impact Stop" value={fmtTs(selectedOutage.impactStop)} />
                  <DetailField label="Affected Links" value={fmtCount(selectedOutage.affectedLinks)} />
                  <DetailField label="Duration Hours" value={fmtHours(selectedOutage.durationHours)} />
                </Box>
              </Paper>

              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb' }}>
                <Typography variant="caption" sx={{ display: 'block', textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.66, mb: 0.5 }}>
                  Summary
                </Typography>
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {selectedOutage.summary || 'No outage summary captured for this record.'}
                </Typography>
              </Paper>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(selectedTicket)}
        onClose={() => setSelectedTicket(null)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
          <Typography variant="h6" component="span">
            Ticket Detail: {selectedTicket?.ticketId || '-'}
          </Typography>
          {selectedTicket?.frg ? (
            <Button
              size="small"
              variant="outlined"
              onClick={() => {
                const frg = selectedTicket.frg
                setSelectedTicket(null)
                openLinkDetails(frg).catch(console.error)
              }}
            >
              Open FRG Timeline
            </Button>
          ) : null}
        </DialogTitle>
        <DialogContent dividers sx={{ overflowX: 'hidden' }}>
          {selectedTicket ? (
            <Stack spacing={1.25}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" label={`FRG ${selectedTicket.frg || '-'}`} />
                <Chip size="small" label={`Month ${selectedTicket.yearMonth || '-'}`} />
                <Chip size="small" label={selectedTicket.category || 'Unknown category'} color={String(selectedTicket.category || '').toLowerCase() === DOWNTIME_CATEGORY ? 'warning' : 'default'} />
                <Chip size="small" label={`Final ${fmtHours(selectedTicket.finalHours)}`} color={selectedTicket.finalHours ? 'error' : 'default'} />
              </Stack>

              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb' }}>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }
                  }}
                >
                  <DetailField label="Created" value={fmtTs(selectedTicket.createdDate)} />
                  <DetailField label="Impact Stop" value={fmtTs(selectedTicket.impactStopTime)} />
                  <DetailField label="Severity" value={selectedTicket.severity} />
                  <DetailField label="Party At Fault" value={selectedTicket.partyAtFault} />
                  <DetailField label="Product Type" value={selectedTicket.productType} />
                  <DetailField label="Service Type" value={selectedTicket.serviceType} />
                  <DetailField label="Site Access" value={selectedTicket.siteAccessTimes} />
                  <DetailField label="FRG Link" value={selectedTicket.frg} />
                </Box>
              </Paper>

              <Paper elevation={0} sx={{ p: 1.5, border: '1px solid #e5e7eb' }}>
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }
                  }}
                >
                  <DetailField label="Raw Downtime" value={fmtHours(selectedTicket.rawHours)} />
                  <DetailField label="Excluded Site Access" value={fmtHours(selectedTicket.excludedHours)} />
                  <DetailField label="Final Downtime" value={fmtHours(selectedTicket.finalHours)} />
                </Box>
              </Paper>
            </Stack>
          ) : null}
        </DialogContent>
      </Dialog>
    </Box>
  )
}

