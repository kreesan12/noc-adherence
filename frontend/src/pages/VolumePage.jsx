import { useEffect, useMemo, useState } from 'react'
import Papa from 'papaparse'
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend
} from 'recharts'
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'
import api from '../api'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'
import {
  AnalyticsChartFallback as ChartFallback,
  AnalyticsLoadingBlock as LoadingBlock,
  AnalyticsMetricCard as MetricCard
} from '../components/ui/AnalyticsPrimitives'

function fmtCount(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

export default function VolumePage() {
  const [roles, setRoles] = useState([])
  const [team, setTeam] = useState('')
  const [startDate, setStartDate] = useState(dayjs().subtract(45, 'day'))
  const [endDate, setEndDate] = useState(dayjs())
  const [fcStart, setFcStart] = useState(dayjs())
  const [fcEnd, setFcEnd] = useState(dayjs().add(6, 'month').subtract(1, 'day'))
  const [lookBack, setLookBack] = useState(6)
  const [horizon, setHorizon] = useState(6)
  const [overwrite, setOverwrite] = useState(false)
  const [dailyData, setDailyData] = useState([])
  const [hourlyData, setHourlyData] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [fcDailyData, setFcDailyData] = useState([])
  const [stackAutomation, setStackAutomation] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')
  const [uploadTone, setUploadTone] = useState('success')
  const [pageError, setPageError] = useState('')
  const [actualLoading, setActualLoading] = useState(false)
  const [forecastLoading, setForecastLoading] = useState(false)
  const [hourlyLoading, setHourlyLoading] = useState(false)
  const [buildBusy, setBuildBusy] = useState(false)

  const monthChoices = [1, 2, 3, 4, 5, 6, 12, 18, 24, 36]

  useEffect(() => {
    api.get('/agents')
      .then((response) => {
        const uniqueRoles = [...new Set(response.data.map((agent) => agent.role))]
        setRoles(uniqueRoles)
        if (uniqueRoles.length) setTeam(uniqueRoles[0])
      })
      .catch((error) => {
        console.error(error)
        setPageError('Failed to load team list for the volume workspace.')
      })
  }, [])

  useEffect(() => {
    if (!team) return
    setActualLoading(true)
    setPageError('')
    fetchDailyActual()
      .then(setDailyData)
      .catch((error) => {
        console.error(error)
        setPageError('Failed to load actual volume for the selected team and date range.')
      })
      .finally(() => setActualLoading(false))
  }, [team, startDate, endDate])

  useEffect(() => {
    if (!team) return
    setForecastLoading(true)
    setPageError('')
    fetchDailyForecast()
      .then(setFcDailyData)
      .catch((error) => {
        console.error(error)
        setPageError('Failed to load forecast volume for the selected team and range.')
      })
      .finally(() => setForecastLoading(false))
  }, [team, fcStart, fcEnd])

  async function fetchDailyActual() {
    const { data } = await api.get('/reports/volume', {
      params: {
        role: team,
        start: startDate.format('YYYY-MM-DD'),
        end: endDate.format('YYYY-MM-DD')
      }
    })

    setSelectedDate(null)
    setHourlyData(
      Array.from({ length: 24 }, (_, hour) => ({
        hour,
        forecastCalls: 0,
        actualCalls: 0,
        forecastTickets: 0,
        actualTickets: 0,
        manualTickets: 0,
        autoDfa: 0,
        autoMnt: 0,
        autoOutage: 0,
        autoMntSolved: 0
      }))
    )

    return data
  }

  async function fetchDailyForecast() {
    const { data } = await api.get('/reports/volume/forecast', {
      params: {
        role: team,
        start: fcStart.format('YYYY-MM-DD'),
        end: fcEnd.format('YYYY-MM-DD')
      }
    })
    return data
  }

  function onBarClick(entry) {
    if (!entry || !entry.date) return
    const { date } = entry
    setSelectedDate(date)
    setHourlyLoading(true)
    setPageError('')

    api
      .get('/reports/volume/hourly', { params: { role: team, date } })
      .then((response) => {
        const filled = Array.from({ length: 24 }, (_, hour) => {
          const found = response.data.find((row) => row.hour === hour) || {}
          return {
            hour,
            forecastCalls: found.forecastCalls || 0,
            actualCalls: found.actualCalls || 0,
            forecastTickets: found.forecastTickets || 0,
            actualTickets: found.actualTickets || 0,
            manualTickets: found.manualTickets || 0,
            autoDfa: found.autoDfa || 0,
            autoMnt: found.autoMnt || 0,
            autoOutage: found.autoOutage || 0,
            autoMntSolved: found.autoMntSolved || 0
          }
        })
        setHourlyData(filled)
      })
      .catch((error) => {
        console.error(error)
        setPageError(`Failed to load hourly drill-down for ${date}.`)
      })
      .finally(() => setHourlyLoading(false))
  }

  function handleUploadActual(file) {
    if (!file) return

    setUploading(true)
    setUploadMsg('')
    setUploadTone('success')
    setPageError('')

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async ({ data }) => {
        try {
          const payload = data.map((row) => ({
            date: row.date,
            hour: Number(row.hour),
            calls: Number(row.calls),
            tickets: Number(row.tickets),
            priority1: Number(row.priority1 ?? 0),
            autoDfa: Number(row.autoDfa ?? 0),
            autoMnt: Number(row.autoMnt ?? 0),
            autoOutage: Number(row.autoOutage ?? 0),
            autoMntSolved: Number(row.autoMntSolved ?? 0)
          }))

          await api.post('/volume/actual', { role: team, data: payload })
          await fetchDailyActual().then(setDailyData)
          setUploadMsg('Upload successful')
          setUploadTone('success')
        } catch (err) {
          console.error(err)
          setUploadMsg('Upload failed')
          setUploadTone('error')
        } finally {
          setUploading(false)
        }
      }
    })
  }

  async function buildForecast() {
    setBuildBusy(true)
    setPageError('')
    try {
      await api.post('/volume/build-forecast', {
        role: team,
        lookBackMonths: lookBack,
        horizonMonths: horizon,
        overwrite
      })

      const newStart = dayjs().startOf('day')
      const newEnd = dayjs().add(horizon, 'month').subtract(1, 'day')
      setFcStart(newStart)
      setFcEnd(newEnd)

      setForecastLoading(true)
      fetchDailyForecast()
        .then(setFcDailyData)
        .finally(() => setForecastLoading(false))

      setUploadMsg('Forecast rebuild complete')
      setUploadTone('success')
    } catch (err) {
      console.error(err)
      setUploadMsg('Failed to build forecast')
      setUploadTone('error')
    } finally {
      setBuildBusy(false)
    }
  }

  const actualSummary = useMemo(() => {
    const totals = dailyData.reduce(
      (acc, row) => {
        acc.calls += Number(row.actualCalls || 0)
        acc.tickets += Number(row.actualTickets || 0)
        acc.manual += Number(row.manualTickets || 0)
        return acc
      },
      { calls: 0, tickets: 0, manual: 0 }
    )

    return {
      ...totals,
      days: dailyData.length
    }
  }, [dailyData])

  const forecastSummary = useMemo(() => {
    const totals = fcDailyData.reduce(
      (acc, row) => {
        acc.calls += Number(row.forecastCalls || 0)
        acc.tickets += Number(row.forecastTickets || 0)
        return acc
      },
      { calls: 0, tickets: 0 }
    )

    return {
      ...totals,
      days: fcDailyData.length
    }
  }, [fcDailyData])

  const volumeCards = useMemo(() => {
    const actualAvgCalls = actualSummary.days ? actualSummary.calls / actualSummary.days : 0
    const actualAvgTickets = actualSummary.days ? actualSummary.tickets / actualSummary.days : 0
    const forecastAvgCalls = forecastSummary.days ? forecastSummary.calls / forecastSummary.days : 0
    const forecastAvgTickets = forecastSummary.days ? forecastSummary.tickets / forecastSummary.days : 0
    const selectedHourPeak = hourlyData.length
      ? hourlyData.reduce((best, row) => {
          const activity = Number(row.actualCalls || 0) + Number(row.actualTickets || 0)
          if (!best || activity > best.activity) {
            return { hour: row.hour, activity }
          }
          return best
        }, null)
      : null

    return [
      {
        label: 'Actual Avg / Day',
        value: `${fmtCount(Math.round(actualAvgCalls))} calls`,
        subtext: `${fmtCount(Math.round(actualAvgTickets))} tickets per active day.`,
        tone: '#2563eb'
      },
      {
        label: 'Forecast Avg / Day',
        value: `${fmtCount(Math.round(forecastAvgCalls))} calls`,
        subtext: `${fmtCount(Math.round(forecastAvgTickets))} tickets per forecast day.`,
        tone: '#7c3aed'
      },
      {
        label: 'Drilldown',
        value: selectedDate ? dayjs(selectedDate).format('DD MMM YYYY') : 'No day selected',
        subtext: selectedDate && selectedHourPeak
          ? `Peak hour ${String(selectedHourPeak.hour).padStart(2, '0')}:00 with ${fmtCount(selectedHourPeak.activity)} total touches.`
          : 'Click a daily bar to open the hourly pattern.',
        tone: '#d97706'
      },
      {
        label: 'Mode',
        value: stackAutomation ? 'Automation split' : 'Combined tickets',
        subtext: stackAutomation
          ? 'Ticket bars are separated into manual and automation-driven lanes.'
          : 'Ticket totals are shown as one combined bar series.',
        tone: '#0f766e'
      }
    ]
  }, [actualSummary, forecastSummary, hourlyData, selectedDate, stackAutomation])

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <PageShell
        eyebrow="Daily Operations"
        title="Volume Dashboard"
        description="Track actual volume, compare hourly movement, and keep the forecast build controls in the same operational workspace."
        accent="#0f766e"
        stats={[
          {
            label: 'Team',
            value: team || 'Pending',
            helper: 'Current role view',
            accent: '#0f766e'
          },
          {
            label: 'Actual Calls',
            value: actualSummary.calls,
            helper: `${actualSummary.days} daily rows in range`,
            accent: '#2563eb'
          },
          {
            label: 'Actual Tickets',
            value: actualSummary.tickets,
            helper: `${actualSummary.manual} manual tickets included`,
            accent: '#d97706'
          },
          {
            label: 'Forecast Days',
            value: forecastSummary.days,
            helper: `${forecastSummary.calls} forecast calls loaded`,
            accent: '#7c3aed'
          }
        ]}
      >
        {pageError ? <Alert severity="error">{pageError}</Alert> : null}
        {uploadMsg ? <Alert severity={uploadTone}>{uploadMsg}</Alert> : null}

        <Box
          sx={{
            display: 'grid',
            gap: 0.95,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, minmax(0, 1fr))',
              xl: 'repeat(4, minmax(0, 1fr))'
            }
          }}
        >
          {volumeCards.map((card) => (
            <MetricCard
              key={card.label}
              label={card.label}
              value={card.value}
              subtext={card.subtext}
              tone={card.tone}
            />
          ))}
        </Box>

        <SectionCard
          title="Controls"
          subtitle="Switch teams, upload actuals, and rebuild the forecast model without leaving the same workspace."
          accent="#0f766e"
        >
          <Stack spacing={1}>
            <FilterStrip>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Team Scope</Typography>
              <FormControl sx={{ minWidth: 180 }} size="small">
                <InputLabel>Team</InputLabel>
                <Select value={team} label="Team" onChange={(event) => setTeam(event.target.value)}>
                  {roles.map((role) => (
                    <MenuItem key={role} value={role}>{role}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Chip label={`${roles.length} roles loaded`} variant="outlined" />
              <Chip label={`Actual ${startDate.format('DD MMM')} to ${endDate.format('DD MMM')}`} sx={{ fontWeight: 700 }} />
              <Chip label={`Forecast ${fcStart.format('DD MMM')} to ${fcEnd.format('DD MMM')}`} sx={{ fontWeight: 700 }} />
            </FilterStrip>

            <FilterStrip>
              <Typography variant="body2" sx={{ fontWeight: 800 }}>Forecast Build</Typography>
              <FormControl sx={{ minWidth: 120 }} size="small">
                <InputLabel>Look-back</InputLabel>
                <Select value={lookBack} label="Look-back" onChange={(event) => setLookBack(Number(event.target.value))}>
                  {monthChoices.map((month) => (
                    <MenuItem key={month} value={month}>{month} mo</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl sx={{ minWidth: 120 }} size="small">
                <InputLabel>Horizon</InputLabel>
                <Select value={horizon} label="Horizon" onChange={(event) => setHorizon(Number(event.target.value))}>
                  {monthChoices.map((month) => (
                    <MenuItem key={month} value={month}>{month} mo</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControlLabel
                control={<Switch checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />}
                label="Overwrite"
              />
              <Button variant="contained" onClick={buildForecast} disabled={buildBusy || !team}>
                {buildBusy ? 'Building...' : 'Build Forecast'}
              </Button>
              <Button variant="outlined" component="label" disabled={uploading || !team}>
                {uploading ? 'Uploading...' : 'Upload Actual CSV'}
                <input hidden type="file" accept=".csv" onChange={(event) => handleUploadActual(event.target.files?.[0])} />
              </Button>
              <Chip
                label={stackAutomation ? 'Automation lanes on' : 'Combined ticket bars'}
                sx={{ fontWeight: 700, bgcolor: stackAutomation ? '#eef2ff' : '#ecfeff', color: stackAutomation ? '#4338ca' : '#0f766e' }}
              />
            </FilterStrip>
          </Stack>
        </SectionCard>

        <SectionCard
          title="Daily Actual Volume"
          subtitle="Calls and tickets by day, with optional automation contribution stacked into the ticket volume."
          accent="#2563eb"
          actions={
            <Stack direction="row" spacing={0.8} flexWrap="wrap" alignItems="center">
              <DatePicker
                label="Actual from"
                value={startDate}
                onChange={(value) => value && setStartDate(value)}
                renderInput={(params) => <TextField {...params} size="small" />}
              />
              <DatePicker
                label="Actual to"
                value={endDate}
                onChange={(value) => value && setEndDate(value)}
                renderInput={(params) => <TextField {...params} size="small" />}
              />
              <FormControlLabel
                control={<Switch checked={stackAutomation} onChange={(event) => setStackAutomation(event.target.checked)} />}
                label="Automation split"
              />
              <Chip size="small" label={`${fmtCount(dailyData.length)} days`} sx={{ fontWeight: 700 }} />
            </Stack>
          }
        >
          {actualLoading ? (
            <LoadingBlock message="Loading actual volume..." />
          ) : dailyData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="actualCalls" name="Calls" fill="#82ca9d" onClick={onBarClick} />
                {stackAutomation ? (
                  <>
                    <Bar dataKey="manualTickets" name="Manual" fill="#ff8042" stackId="tickets" onClick={onBarClick} />
                    <Bar dataKey="autoDfa" name="Auto DFA" fill="#a4de6c" stackId="tickets" onClick={onBarClick} />
                    <Bar dataKey="autoMnt" name="Auto MNT" fill="#ffc658" stackId="tickets" onClick={onBarClick} />
                    <Bar dataKey="autoOutage" name="Auto Outage Linked" fill="#8884d8" stackId="tickets" onClick={onBarClick} />
                    <Bar dataKey="autoMntSolved" name="Auto MNT Solved" fill="#d0ed57" stackId="tickets" onClick={onBarClick} />
                  </>
                ) : (
                  <Bar dataKey="actualTickets" name="Tickets" fill="#ff8042" onClick={onBarClick} />
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback message="No actual volume rows are available for the current team and date range." />
          )}
        </SectionCard>

        <SectionCard
          title={selectedDate ? `Hourly Actual for ${dayjs(selectedDate).format('YYYY-MM-DD')}` : 'Hourly Drill-Down'}
          subtitle={selectedDate ? 'Drill-down from the daily chart to see where the day peaked by hour.' : 'Select a daily bar above to reveal the hourly pattern and compare the ticket mix.'}
          accent="#d97706"
        >
          {hourlyLoading ? (
            <LoadingBlock message="Loading hourly drill-down..." />
          ) : selectedDate ? (
            <ResponsiveContainer
              width="100%"
              height={260}
            >
              <BarChart
                data={hourlyData}
                margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                barCategoryGap="10%"
                barGap={3}
              >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="hour"
                  ticks={[...Array(24).keys()]}
                  allowDecimals={false}
                  tickFormatter={(hour) => `${String(hour).padStart(2, '0')}:00`}
                />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="actualCalls" fill="#82ca9d" />
                {stackAutomation ? (
                  <>
                    <Bar dataKey="manualTickets" fill="#ff8042" stackId="tickets" />
                    <Bar dataKey="autoDfa" fill="#a4de6c" stackId="tickets" />
                    <Bar dataKey="autoMnt" fill="#ffc658" stackId="tickets" />
                    <Bar dataKey="autoOutage" fill="#8884d8" stackId="tickets" />
                    <Bar dataKey="autoMntSolved" fill="#d0ed57" stackId="tickets" />
                  </>
                ) : (
                  <Bar dataKey="actualTickets" fill="#ff8042" />
                )}
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <ChartFallback message="Pick a day from the actual volume chart to inspect the hourly curve." />
          )}
        </SectionCard>

        {(fcDailyData.length || forecastLoading) ? (
          <SectionCard
            title="Daily Forecast Volume"
            subtitle="Forecasted call and ticket movement for the selected forward-looking range."
            accent="#7c3aed"
            actions={
              <Stack direction="row" spacing={0.8} flexWrap="wrap">
                <DatePicker
                  label="Forecast from"
                  value={fcStart}
                  onChange={(value) => value && setFcStart(value)}
                  renderInput={(params) => <TextField {...params} size="small" />}
                />
                <DatePicker
                  label="Forecast to"
                  value={fcEnd}
                  onChange={(value) => value && setFcEnd(value)}
                  renderInput={(params) => <TextField {...params} size="small" />}
                />
                <Chip size="small" label={`${fmtCount(fcDailyData.length)} forecast days`} sx={{ fontWeight: 700 }} />
              </Stack>
            }
          >
            {forecastLoading ? (
              <LoadingBlock message="Loading forecast volume..." />
            ) : fcDailyData.length ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={fcDailyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="forecastCalls" name="Forecast Calls" fill="#82ca9d" />
                  {stackAutomation ? (
                    <>
                      <Bar dataKey="manualTickets" name="Manual" fill="#ff8042" stackId="forecast" />
                      <Bar dataKey="autoDfa" name="Auto DFA" fill="#a4de6c" stackId="forecast" />
                      <Bar dataKey="autoMnt" name="Auto MNT" fill="#ffc658" stackId="forecast" />
                      <Bar dataKey="autoOutage" name="Auto Outage Linked" fill="#8884d8" stackId="forecast" />
                      <Bar dataKey="autoMntSolved" name="Auto MNT Solved" fill="#d0ed57" stackId="forecast" />
                    </>
                  ) : (
                    <Bar dataKey="forecastTickets" name="Forecast Tickets" fill="#ff8042" />
                  )}
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ChartFallback message="No forecast rows are available for the selected forward-looking range." />
            )}
          </SectionCard>
        ) : null}
      </PageShell>
    </LocalizationProvider>
  )
}
