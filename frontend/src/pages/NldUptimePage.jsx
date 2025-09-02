// frontend/src/pages/NldUptimePage.jsx
import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  Box, Paper, Typography, Accordion, AccordionSummary, AccordionDetails,
  Chip, Stack
} from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import api from '../api'

/* ── date helpers ─────────────────────────────────────── */
const START_MONTH = dayjs('2025-06-01') // inclusive
const NOW = dayjs()

function monthsFromStartToNow() {
  const out = []
  let m = START_MONTH.startOf('month')
  const end = NOW.endOf('month')
  while (m.isBefore(end) || m.isSame(end, 'month')) {
    out.push(m)
    m = m.add(1, 'month')
  }
  return out
}

function monthKey(m) { return m.format('YYYY-MM') }
function monthLabel(m) { return m.format('MMM YYYY') }

function hoursInMonthWindow(m) {
  // Full hours for past months; for current month, only count hours up to now.
  const start = m.startOf('month')
  const end = m.isSame(NOW, 'month') ? NOW : m.endOf('month').add(1, 'millisecond')
  return Math.max(0, end.diff(start, 'hour', true))
}

/* ── UI helpers ───────────────────────────────────────── */
function pctChipForValue(pct) {
  if (pct == null) return { color:'default', label:'—' }
  if (pct >= 99.5) return { color:'success', label:`${pct.toFixed(2)}%` }
  if (pct >= 98.0) return { color:'warning', label:`${pct.toFixed(2)}%` }
  return { color:'error', label:`${pct.toFixed(2)}%` }
}

function groupBy(arr, key) {
  return arr.reduce((m, r) => ((m[r[key] ?? '—'] ??= []).push(r), m), {})
}

function formatPct(p) {
  return p == null ? '—' : `${p.toFixed(2)}%`
}

export default function NldUptimePage() {
  const [circuits, setCircuits] = useState([])         // base rows from /engineering/circuits
  const [eventsById, setEventsById] = useState({})     // { [id]: LightLevelEvent[] }
  const months = useMemo(monthsFromStartToNow, [])

  /* ── load circuits ─────────────────────────────────── */
  useEffect(() => {
    api.get('/engineering/circuits').then(r => setCircuits(r.data))
  }, [])

  /* ── load lightEvents per circuit (N calls in parallel) ─ */
  useEffect(() => {
    if (!circuits.length) return
    let cancelled = false

    ;(async () => {
      const ids = circuits.map(c => c.id)
      const results = await Promise.all(ids.map(async (id) => {
        const { data } = await api.get(`/engineering/circuit/${id}`)
        return [id, data?.lightEvents ?? []]
      }))
      if (!cancelled) {
        setEventsById(Object.fromEntries(results))
      }
    })()

    return () => { cancelled = true }
  }, [circuits])

  /* ── compute uptime metrics per circuit x month ────── */
  const rowsWithUptime = useMemo(() => {
    if (!circuits.length) return []
    return circuits.map(c => {
      const evts = eventsById[c.id] ?? []
      // Pre-bucket events by month string
      const byMonth = {}
      for (const e of evts) {
        if (!e?.eventDate) continue
        const k = dayjs(e.eventDate).format('YYYY-MM')
        ;(byMonth[k] ??= []).push(e)
      }
      // Compute per month
      const uptime = {}
      for (const m of months) {
        const key = monthKey(m)
        const totalHrs = hoursInMonthWindow(m)
        const list = byMonth[key] ?? []
        const downHrs = list.reduce((sum, e) => {
          const h = parseFloat(e.impactHours)
          return sum + (isFinite(h) ? Math.max(0, h) : 0)
        }, 0)
        if (totalHrs > 0) {
          const pct = Math.min(100, Math.max(0, (1 - (downHrs / totalHrs)) * 100))
          uptime[key] = { pct, downHrs, totalHrs }
        } else {
          uptime[key] = { pct: null, downHrs: 0, totalHrs: 0 }
        }
      }
      return { ...c, uptime }
    })
  }, [circuits, eventsById, months])

  /* ── NLD summaries for tiles ─────────────────────────
     - avg3moPct: weighted by hours across circuits (existing)
     - events90: total events in last 90 days
     - nldPathLatestPct: "whole NLD" path uptime for latest month (min of circuit uptimes)
  ------------------------------------------------------ */
  const nldSummaries = useMemo(() => {
    if (!rowsWithUptime.length) return []

    // last 3 calendar months present in "months"
    const last3 = months.slice(-3)
    const last90Start = NOW.subtract(90, 'day').startOf('day')

    // Determine the latest month that actually has pct values
    const latestWithData = [...months].reverse().find(m => {
      const k = monthKey(m)
      return rowsWithUptime.some(r => r.uptime?.[k]?.pct != null)
    })

    const byNld = groupBy(rowsWithUptime, 'nldGroup')

    return Object.entries(byNld).map(([nld, list]) => {
      // Weighted by hours across circuits for last 3 months
      let totalHours = 0
      let totalDown = 0
      for (const r of list) {
        for (const m of last3) {
          const k = monthKey(m)
          const u = r.uptime?.[k]
          if (!u || !isFinite(u.totalHrs) || u.totalHrs <= 0) continue
          totalHours += u.totalHrs
          totalDown += (u.downHrs ?? 0)
        }
      }
      const avg3moPct = totalHours > 0 ? Math.max(0, Math.min(100, (1 - totalDown / totalHours) * 100)) : null

      // Events in last 90 days, grouped (not per circuit)
      let events90 = 0
      for (const r of list) {
        const evts = eventsById[r.id] ?? []
        events90 += evts.filter(e => e?.eventDate && dayjs(e.eventDate).isAfter(last90Start)).length
      }

      // Whole-NLD "path" uptime for the latest month: bottleneck (min across circuits)
      let nldPathLatestPct = null
      if (latestWithData) {
        const lk = monthKey(latestWithData)
        const pcts = list
          .map(r => r.uptime?.[lk]?.pct)
          .filter(p => p != null && isFinite(p))
        if (pcts.length) nldPathLatestPct = Math.min(...pcts)
      }

      return {
        nld,
        avg3moPct,
        events90,
        nldPathLatestPct,
        latestMonthLabel: latestWithData ? monthLabel(latestWithData) : '—'
      }
    }).sort((a,b) => String(a.nld).localeCompare(String(b.nld)))
  }, [rowsWithUptime, eventsById, months])

  /* ── dynamic columns (Circuit info + month columns) ── */
  const columns = useMemo(() => {
    const circuitCols = [
      { field:'circuitId', headerName:'Circuit', flex:1, minWidth:170 },
      { field:'nodeA', headerName:'Node A', flex:1, minWidth:120 },
      { field:'nodeB', headerName:'Node B', flex:1, minWidth:120 },
      { field:'techType', headerName:'Tech', width:80 },
    ]

    const monthCols = months.map(m => {
      const key = monthKey(m)
      const label = monthLabel(m)
      return {
        field: `m_${key}`,
        headerName: label,
        width: 140,
        align: 'center',
        headerAlign: 'center',
        sortable: true,
        cellClassName: 'uptimeCell',
        renderCell: (p) => {
          const u = p?.row?.uptime?.[key]
          const pct = u?.pct
          const chip = pctChipForValue(pct)
          const hours = u?.downHrs ?? 0
          const tip = pct == null
            ? 'No data'
            : `Uptime: ${pct.toFixed(2)}%\nDowntime: ${hours.toFixed(2)} h\nTotal: ${u.totalHrs.toFixed(1)} h`
          return (
            <Stack
              sx={{ width:'100%', lineHeight: 1.2 }}
              alignItems="center"
              spacing={0.25}
            >
              <Chip size="small" color={chip.color} label={chip.label} title={tip} sx={{ fontWeight: 600 }} />
              <Typography variant="caption" sx={{ opacity: 0.75 }}>
                ↓ {hours.toFixed(2)}h
              </Typography>
            </Stack>
          )
        },
        sortComparator: (_a, _b, p1, p2) => {
          const u1 = p1?.row?.uptime?.[key]?.pct ?? -Infinity
          const u2 = p2?.row?.uptime?.[key]?.pct ?? -Infinity
          return u1 - u2
        }
      }
    })

    return [...circuitCols, ...monthCols]
  }, [months])

  /* ── render per-NLD group ──────────────────────────── */
  const byNld = useMemo(() => groupBy(rowsWithUptime, 'nldGroup'), [rowsWithUptime])

  return (
    <Box px={2} py={1}>
      <Typography variant="h5" fontWeight={700} mb={1}>
        NLD Uptime
      </Typography>
      <Typography variant="body2" sx={{ mb: 2, opacity: 0.85 }}>
        Uptime is calculated per circuit per month from <strong>June 2025</strong> to <strong>{NOW.format('MMMM YYYY')}</strong> using
        <em> impactHours</em> from light-level events. For the current month, uptime is based on elapsed hours to date.
      </Typography>

      {/* ===== Summary Tiles (industry-style) ===== */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)' },
          gap: 1.25,
          mb: 2
        }}
      >
        {nldSummaries.map(s => (
          <Paper key={s.nld} elevation={2} sx={{ p: 1.5 }}>
            <Stack spacing={0.75}>
              <Typography variant="subtitle2" sx={{ opacity: 0.8 }}>
                {s.nld}
              </Typography>

              {/* Main metric: whole-NLD (bottleneck) for latest month */}
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  NLD Path Uptime ({s.latestMonthLabel})
                </Typography>
                <Chip
                  size="small"
                  color={pctChipForValue(s.nldPathLatestPct).color}
                  label={formatPct(s.nldPathLatestPct)}
                  sx={{ fontWeight: 700 }}
                />
              </Stack>

              {/* Existing metrics kept */}
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  Avg Uptime (last 3 mo)
                </Typography>
                <Chip
                  size="small"
                  color={pctChipForValue(s.avg3moPct).color}
                  label={formatPct(s.avg3moPct)}
                  sx={{ fontWeight: 700 }}
                />
              </Stack>

              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  Events (last 90d)
                </Typography>
                <Chip
                  size="small"
                  color={s.events90 > 0 ? 'warning' : 'success'}
                  label={s.events90}
                  sx={{ fontWeight: 700 }}
                />
              </Stack>
            </Stack>
          </Paper>
        ))}
      </Box>

      {Object.entries(byNld).map(([grp, list]) => (
        <Accordion key={grp} defaultExpanded sx={{ mb:1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography variant="subtitle1" fontWeight={600}>
              {grp}&nbsp;
              <Chip label={list.length} size="small" sx={{ ml:1 }} />
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p:0 }}>
            <Paper elevation={0}>
              <DataGrid
                rows={list}
                columns={columns}
                getRowId={(r) => r.id}
                rowHeight={64}
                columnHeaderHeight={44}
                density="standard"
                pageSizeOptions={[25,50,100]}
                initialState={{ pagination:{ paginationModel:{ pageSize:25 } } }}
                slots={{ toolbar: GridToolbar }}
                slotProps={{ toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 300 } } }}
                sx={(theme) => ({
                  border: 0,
                  '.MuiDataGrid-cell:hover': { bgcolor:'rgba(0,0,0,0.04)' },
                  '& .uptimeCell': {
                    display: 'flex',
                    alignItems: 'center',
                    py: 0.5,
                  },
                })}
              />
            </Paper>
          </AccordionDetails>
        </Accordion>
      ))}
    </Box>
  )
}
