import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Chip,
  CircularProgress,
  Stack,
  Typography
} from '@mui/material'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import api from '../api'
import { PageShell, SectionCard } from '../components/ui/PageScaffold'

const START_MONTH = dayjs('2025-06-01')
const NOW = dayjs()
const ACCENT = '#0f766e'

function monthsFromStartToNow() {
  const out = []
  let month = START_MONTH.startOf('month')
  const end = NOW.endOf('month')

  while (month.isBefore(end) || month.isSame(end, 'month')) {
    out.push(month)
    month = month.add(1, 'month')
  }

  return out
}

function monthKey(month) {
  return month.format('YYYY-MM')
}

function monthLabel(month) {
  return month.format('MMM YYYY')
}

function hoursInMonthWindow(month) {
  const start = month.startOf('month')
  const end = month.isSame(NOW, 'month') ? NOW : month.endOf('month').add(1, 'millisecond')
  return Math.max(0, end.diff(start, 'hour', true))
}

function pctChipForValue(pct) {
  if (pct == null) return { color: 'default', label: '-' }
  if (pct >= 99.5) return { color: 'success', label: `${pct.toFixed(2)}%` }
  if (pct >= 98.0) return { color: 'warning', label: `${pct.toFixed(2)}%` }
  return { color: 'error', label: `${pct.toFixed(2)}%` }
}

function groupBy(list, key) {
  return list.reduce((memo, row) => {
    const groupKey = row[key] ?? 'Unassigned'
    ;(memo[groupKey] ??= []).push(row)
    return memo
  }, {})
}

function formatPct(value) {
  return value == null ? '-' : `${value.toFixed(2)}%`
}

function SummaryTile({ title, chip, rows }) {
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'rgba(255,255,255,0.82)',
        minHeight: 116
      }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {title}
          </Typography>
          {chip}
        </Stack>
        {rows.map((row) => (
          <Stack key={row.label} direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {row.label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {row.value}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Box>
  )
}

export default function NldUptimePage() {
  const [circuits, setCircuits] = useState([])
  const [eventsById, setEventsById] = useState({})
  const [loadingCircuits, setLoadingCircuits] = useState(true)
  const [loadingEvents, setLoadingEvents] = useState(false)
  const months = useMemo(monthsFromStartToNow, [])

  useEffect(() => {
    let cancelled = false

    setLoadingCircuits(true)
    api.get('/engineering/circuits')
      .then((response) => {
        if (!cancelled) setCircuits(response.data ?? [])
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoadingCircuits(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!circuits.length) {
      setLoadingEvents(false)
      return undefined
    }

    let cancelled = false

    ;(async () => {
      setLoadingEvents(true)
      try {
        const results = await Promise.all(
          circuits.map(async (circuit) => {
            const { data } = await api.get(`/engineering/circuit/${circuit.id}`)
            return [circuit.id, data?.lightEvents ?? []]
          })
        )

        if (!cancelled) {
          setEventsById(Object.fromEntries(results))
        }
      } catch (error) {
        console.error(error)
      } finally {
        if (!cancelled) setLoadingEvents(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [circuits])

  const isLoading = loadingCircuits || loadingEvents

  const rowsWithUptime = useMemo(() => {
    if (!circuits.length) return []

    return circuits.map((circuit) => {
      const events = eventsById[circuit.id] ?? []
      const byMonth = {}

      for (const event of events) {
        if (!event?.eventDate) continue
        const key = dayjs(event.eventDate).format('YYYY-MM')
        ;(byMonth[key] ??= []).push(event)
      }

      const uptime = {}
      for (const month of months) {
        const key = monthKey(month)
        const totalHours = hoursInMonthWindow(month)
        const monthEvents = byMonth[key] ?? []
        const downHours = monthEvents.reduce((sum, event) => {
          const parsed = parseFloat(event.impactHours)
          return sum + (Number.isFinite(parsed) ? Math.max(0, parsed) : 0)
        }, 0)

        if (totalHours > 0) {
          const pct = Math.min(100, Math.max(0, (1 - (downHours / totalHours)) * 100))
          uptime[key] = { pct, downHrs: downHours, totalHrs: totalHours }
        } else {
          uptime[key] = { pct: null, downHrs: 0, totalHrs: 0 }
        }
      }

      return { ...circuit, uptime }
    })
  }, [circuits, eventsById, months])

  const groupedByNld = useMemo(() => groupBy(rowsWithUptime, 'nldGroup'), [rowsWithUptime])
  const nldCount = useMemo(() => Object.keys(groupedByNld).length, [groupedByNld])

  const nldSummaries = useMemo(() => {
    if (!rowsWithUptime.length) return []

    const last3Months = months.slice(-3)
    const last90Start = NOW.subtract(90, 'day').startOf('day')
    const latestWithData = [...months].reverse().find((month) => {
      const key = monthKey(month)
      return rowsWithUptime.some((row) => row.uptime?.[key]?.pct != null)
    })

    return Object.entries(groupedByNld)
      .map(([nld, list]) => {
        let totalHours = 0
        let totalDown = 0

        for (const row of list) {
          for (const month of last3Months) {
            const key = monthKey(month)
            const uptime = row.uptime?.[key]
            if (!uptime || !Number.isFinite(uptime.totalHrs) || uptime.totalHrs <= 0) continue
            totalHours += uptime.totalHrs
            totalDown += uptime.downHrs ?? 0
          }
        }

        const avg3moPct = totalHours > 0
          ? Math.max(0, Math.min(100, (1 - totalDown / totalHours) * 100))
          : null

        let events90 = 0
        for (const row of list) {
          const events = eventsById[row.id] ?? []
          events90 += events.filter((event) => event?.eventDate && dayjs(event.eventDate).isAfter(last90Start)).length
        }

        let nldPathLatestPct = null
        if (latestWithData) {
          const latestKey = monthKey(latestWithData)
          const pcts = list
            .map((row) => row.uptime?.[latestKey]?.pct)
            .filter((pct) => pct != null && Number.isFinite(pct))
          if (pcts.length) nldPathLatestPct = Math.min(...pcts)
        }

        return {
          nld,
          avg3moPct,
          events90,
          nldPathLatestPct,
          latestMonthLabel: latestWithData ? monthLabel(latestWithData) : '-'
        }
      })
      .sort((a, b) => String(a.nld).localeCompare(String(b.nld)))
  }, [eventsById, groupedByNld, months, rowsWithUptime])

  const summaryCards = useMemo(
    () => nldSummaries.map((summary) => (
      <SummaryTile
        key={summary.nld}
        title={summary.nld}
        chip={(
          <Chip
            size="small"
            color={pctChipForValue(summary.nldPathLatestPct).color}
            label={formatPct(summary.nldPathLatestPct)}
            sx={{ fontWeight: 700 }}
          />
        )}
        rows={[
          { label: `Path uptime (${summary.latestMonthLabel})`, value: formatPct(summary.nldPathLatestPct) },
          { label: 'Avg uptime (last 3 months)', value: formatPct(summary.avg3moPct) },
          { label: 'Events (last 90 days)', value: summary.events90 }
        ]}
      />
    )),
    [nldSummaries]
  )

  const columns = useMemo(() => {
    const baseColumns = [
      { field: 'circuitId', headerName: 'Circuit', flex: 1, minWidth: 170 },
      { field: 'nodeA', headerName: 'Node A', flex: 0.9, minWidth: 130 },
      { field: 'nodeB', headerName: 'Node B', flex: 0.9, minWidth: 130 },
      { field: 'techType', headerName: 'Tech', width: 92 }
    ]

    const monthColumns = months.map((month) => {
      const key = monthKey(month)
      return {
        field: `m_${key}`,
        headerName: monthLabel(month),
        width: 136,
        align: 'center',
        headerAlign: 'center',
        sortable: true,
        cellClassName: 'uptimeCell',
        renderCell: (params) => {
          const uptime = params?.row?.uptime?.[key]
          const pct = uptime?.pct
          const chip = pctChipForValue(pct)
          const hours = uptime?.downHrs ?? 0
          const title = pct == null
            ? 'No data'
            : `Uptime: ${pct.toFixed(2)}%\nDowntime: ${hours.toFixed(2)} h\nTotal: ${uptime.totalHrs.toFixed(1)} h`

          return (
            <Stack sx={{ width: '100%', lineHeight: 1.15 }} alignItems="center" spacing={0.25}>
              <Chip size="small" color={chip.color} label={chip.label} title={title} sx={{ fontWeight: 700 }} />
              <Typography variant="caption" sx={{ opacity: 0.72 }}>
                down {hours.toFixed(2)}h
              </Typography>
            </Stack>
          )
        },
        sortComparator: (_a, _b, p1, p2) => {
          const valueA = p1?.row?.uptime?.[key]?.pct ?? -Infinity
          const valueB = p2?.row?.uptime?.[key]?.pct ?? -Infinity
          return valueA - valueB
        }
      }
    })

    return [...baseColumns, ...monthColumns]
  }, [months])

  return (
    <PageShell
      eyebrow="Engineering"
      title="NLD Uptime"
      description="Per-circuit monthly uptime from light-level events, with NLD path summaries and grouped drilldown from June 2025 through the current month."
      accent={ACCENT}
      stats={[
        { label: 'Circuits', value: circuits.length, helper: 'tracked in engineering base' },
        { label: 'NLD Groups', value: nldCount, helper: 'visible service groups' },
        { label: 'Months Covered', value: months.length, helper: `${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}` },
        { label: 'Status', value: isLoading ? 'Loading...' : 'Ready', helper: isLoading ? 'building uptime view' : 'uptime view available' }
      ]}
    >
      <SectionCard
        title="Uptime Summary"
        subtitle="Latest path health, weighted three-month uptime, and recent event counts by NLD group."
        accent={ACCENT}
      >
        {isLoading ? (
          <Box
            sx={{
              minHeight: 220,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'column',
              gap: 1.2
            }}
          >
            <CircularProgress size={30} />
            <Typography variant="body2" color="text.secondary">
              Loading circuit and event history...
            </Typography>
          </Box>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
              gap: 0.9
            }}
          >
            {summaryCards}
          </Box>
        )}
      </SectionCard>

      <SectionCard
        title="Circuit Uptime by NLD"
        subtitle="Expand an NLD group to inspect monthly uptime per circuit. Current month values use elapsed hours to date."
        accent={ACCENT}
        noPadding
      >
        {Object.entries(groupedByNld)
          .sort(([left], [right]) => String(left).localeCompare(String(right)))
          .map(([group, list]) => (
            <Accordion key={group} defaultExpanded disableGutters sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
              <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />} sx={{ px: 1.2, minHeight: 48 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%' }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {group}
                  </Typography>
                  <Chip size="small" label={`${list.length} circuits`} />
                </Stack>
              </AccordionSummary>
              <AccordionDetails sx={{ p: 0 }}>
                <Box sx={{ height: 520 }}>
                  <DataGrid
                    rows={list}
                    columns={columns}
                    getRowId={(row) => row.id}
                    density="compact"
                    rowHeight={58}
                    columnHeaderHeight={42}
                    pageSizeOptions={[25, 50, 100]}
                    initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                    slots={{ toolbar: GridToolbar }}
                    slotProps={{ toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 250 } } }}
                    sx={{
                      border: 0,
                      '& .MuiDataGrid-toolbarContainer': {
                        px: 1,
                        py: 0.7,
                        borderBottom: '1px solid',
                        borderColor: 'divider'
                      },
                      '& .uptimeCell': {
                        display: 'flex',
                        alignItems: 'center',
                        py: 0.35
                      }
                    }}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>
          ))}
      </SectionCard>
    </PageShell>
  )
}
