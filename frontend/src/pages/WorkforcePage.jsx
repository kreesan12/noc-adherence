import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  IconButton,
  MenuItem,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DownloadIcon from '@mui/icons-material/Download'
import dayjs from 'dayjs'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis
} from 'recharts'
import {
  createEngagement,
  createVacancy,
  downloadReqDoc,
  headcountReport,
  listAgents,
  listEngagements,
  listTeams,
  listVacancies,
  terminateEngagement,
  updateVacancy
} from '../api/workforce'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

const COLORS = ['#1976d2', '#9c27b0', '#ff9800', '#2e7d32', '#d32f2f']
const TH = (props) => <TableCell sx={{ fontWeight: 'bold' }} {...props} />
const TC = (props) => <TableCell {...props} />

export default function WorkforcePage() {
  const [tab, setTab] = useState(0)
  const [teams, setTeams] = useState([])
  const [agents, setAgents] = useState([])

  useEffect(() => {
    listTeams().then((response) => setTeams(response.data))
  }, [])

  useEffect(() => {
    listAgents().then((response) => setAgents(response.data))
  }, [])

  const [eng, setEng] = useState([])
  const loadEng = useCallback(() => {
    listEngagements({}).then((response) => {
      setEng(response.data.map((engagement) => ({
        id: engagement.id,
        agentId: engagement.agent.id,
        agent: engagement.agent.fullName,
        teamId: engagement.team.id,
        team: engagement.team.name,
        start: engagement.startDate ? engagement.startDate.slice(0, 10) : '',
        end: engagement.endDate ? engagement.endDate.slice(0, 10) : '-',
        note: engagement.note ?? ''
      })))
    })
  }, [])
  useEffect(loadEng, [loadEng])

  const [openMove, setOpenMove] = useState(false)
  const [moveForm, setMoveForm] = useState({
    sourceTeamId: '',
    agentId: '',
    destTeamId: '',
    reason: '',
    moveDate: dayjs().format('YYYY-MM-DD'),
    endDate: dayjs().format('YYYY-MM-DD')
  })

  const [gran, setGran] = useState('month')
  const [hc, setHc] = useState([])
  const [hcLoad, setHcL] = useState(false)

  const [vac, setVac] = useState([])
  const loadVac = useCallback(() => {
    listVacancies().then((response) => {
      setVac(response.data.map((vacancy) => ({
        id: vacancy.id,
        team: vacancy.team.name,
        open: vacancy.openFrom.slice(0, 10),
        status: vacancy.status
      })))
    })
  }, [])

  useEffect(() => {
    if (tab !== 1) return
    const from = dayjs().subtract(5, 'month').startOf('month').format('YYYY-MM-DD')
    const to = dayjs().add(1, 'month').endOf('month').format('YYYY-MM-DD')
    setHcL(true)
    headcountReport(from, to, gran)
      .then((response) => setHc(response.data))
      .finally(() => setHcL(false))
  }, [tab, gran])

  useEffect(() => {
    if (tab === 2) loadVac()
  }, [tab, loadVac])

  const handleMoveSave = async () => {
    const {
      sourceTeamId,
      agentId,
      destTeamId,
      reason,
      moveDate,
      endDate
    } = moveForm

    const current = eng.find((entry) => entry.agentId === Number(agentId))

    try {
      if (current) {
        await terminateEngagement(current.id, {
          endDate: destTeamId === 'left' ? endDate : moveDate,
          note: reason
        })
      }

      if (destTeamId !== 'left' && current) {
        await createEngagement({
          agentId: Number(agentId),
          teamId: Number(destTeamId),
          startDate: moveDate,
          note: reason
        })
      }

      const vacancyDate = destTeamId === 'left' ? endDate : moveDate
      await createVacancy({
        teamId: Number(sourceTeamId),
        openFrom: vacancyDate,
        status: 'PENDING',
        reason
      })

      await loadEng()
      await loadVac()
    } catch (error) {
      console.error('Movement save failed', error)
    } finally {
      setOpenMove(false)
    }
  }

  const updateStatus = (row, status) => updateVacancy(row.id, { status }).then(loadVac)

  const stats = useMemo(() => {
    const openVacancies = vac.filter((row) => row.status !== 'CLOSED').length
    const latestHeads = hc.length ? hc[hc.length - 1]?.headcount ?? 0 : 0
    return [
      { label: 'Teams', value: teams.length, helper: 'Operational groups in scope' },
      { label: 'Movements', value: eng.length, helper: 'Captured engagement entries', accent: '#2563eb' },
      { label: 'Latest Heads', value: latestHeads, helper: 'Newest headcount point', accent: '#16a34a' },
      { label: 'Open Vacancies', value: openVacancies, helper: 'Not yet closed', accent: '#dc2626' }
    ]
  }, [eng.length, hc, teams.length, vac])

  const chartData = useMemo(() => (
    Object.values(
      hc.reduce((acc, current) => {
        const period = current.period
        if (!acc[period]) acc[period] = { period }
        acc[period][current.name] = current.headcount
        return acc
      }, {})
    ).sort((left, right) => left.period.localeCompare(right.period))
  ), [hc])

  return (
    <PageShell
      eyebrow="Settings"
      title="Workforce Planning Hub"
      description="Review team movements, headcount history, and vacancy pressure from one cleaner control surface so staffing decisions stay tied to live operating reality."
      accent="#ea580c"
      stats={stats}
      actions={
        <Tabs value={tab} onChange={(_, value) => setTab(value)} sx={{ minHeight: 34, '& .MuiTab-root': { minHeight: 34 } }}>
          <Tab label="Movements" />
          <Tab label="Headcount" />
          <Tab label="Vacancies" />
        </Tabs>
      }
    >
      {tab === 0 && (
        <SectionCard
          title="Team Movements"
          subtitle="Capture promotions, transfers, and exits so vacancies and headcount stay aligned with real team changes."
          accent="#ea580c"
          actions={
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpenMove(true)}>
              Add Movement
            </Button>
          }
        >
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TH>Agent</TH>
                  <TH>Team</TH>
                  <TH>Start</TH>
                  <TH>End</TH>
                  <TH>Note</TH>
                </TableRow>
              </TableHead>
              <TableBody>
                {eng.map((row) => (
                  <TableRow key={row.id}>
                    <TC>{row.agent}</TC>
                    <TC>{row.team}</TC>
                    <TC>{row.start}</TC>
                    <TC>{row.end}</TC>
                    <TC>{row.note}</TC>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          <Dialog open={openMove} onClose={() => setOpenMove(false)} fullWidth maxWidth="sm">
            <DialogTitle>New Movement</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ pt: 0.5 }}>
                <Grid item xs={12}>
                  <TextField
                    select
                    label="From Team"
                    fullWidth
                    value={moveForm.sourceTeamId}
                    onChange={(event) => setMoveForm((form) => ({
                      ...form,
                      sourceTeamId: event.target.value,
                      agentId: '',
                      destTeamId: ''
                    }))}
                  >
                    {teams.map((team) => (
                      <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    select
                    label="Agent"
                    fullWidth
                    disabled={!moveForm.sourceTeamId}
                    value={moveForm.agentId}
                    onChange={(event) => setMoveForm((form) => ({
                      ...form,
                      agentId: event.target.value,
                      destTeamId: ''
                    }))}
                  >
                    {agents
                      .filter((agent) => {
                        const source = teams.find((team) => team.id === Number(moveForm.sourceTeamId))
                        return source && agent.role === source.name
                      })
                      .map((agent) => (
                        <MenuItem key={agent.id} value={agent.id}>{agent.fullName}</MenuItem>
                      ))}
                  </TextField>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    select
                    label="To Team"
                    fullWidth
                    disabled={!moveForm.agentId}
                    value={moveForm.destTeamId}
                    onChange={(event) => setMoveForm((form) => ({ ...form, destTeamId: event.target.value }))}
                  >
                    {teams
                      .filter((team) => team.id !== Number(moveForm.sourceTeamId))
                      .map((team) => (
                        <MenuItem key={team.id} value={team.id}>{team.name}</MenuItem>
                      ))}
                    <MenuItem value="left">Left NOC</MenuItem>
                  </TextField>
                </Grid>

                {moveForm.destTeamId && moveForm.destTeamId !== 'left' && (
                  <>
                    <Grid item xs={12}>
                      <TextField
                        label="Reason (e.g. promotion)"
                        fullWidth
                        multiline
                        minRows={2}
                        value={moveForm.reason}
                        onChange={(event) => setMoveForm((form) => ({ ...form, reason: event.target.value }))}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="Move Date"
                        type="date"
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                        value={moveForm.moveDate}
                        onChange={(event) => setMoveForm((form) => ({ ...form, moveDate: event.target.value }))}
                      />
                    </Grid>
                  </>
                )}

                {moveForm.destTeamId === 'left' && (
                  <>
                    <Grid item xs={12}>
                      <TextField
                        label="Reason for leaving"
                        fullWidth
                        multiline
                        minRows={2}
                        value={moveForm.reason}
                        onChange={(event) => setMoveForm((form) => ({ ...form, reason: event.target.value }))}
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="End Date"
                        type="date"
                        fullWidth
                        InputLabelProps={{ shrink: true }}
                        value={moveForm.endDate}
                        onChange={(event) => setMoveForm((form) => ({ ...form, endDate: event.target.value }))}
                      />
                    </Grid>
                  </>
                )}
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenMove(false)}>Cancel</Button>
              <Button onClick={handleMoveSave} variant="contained">Save Movement</Button>
            </DialogActions>
          </Dialog>
        </SectionCard>
      )}

      {tab === 1 && (
        <SectionCard
          title="Headcount Story"
          subtitle="Switch between month and week granularity to compare workforce shape against vacancy pressure."
          accent="#2563eb"
        >
          <Box sx={{ display: 'grid', gap: 1 }}>
            <FilterStrip>
              <TextField select size="small" label="Granularity" value={gran} onChange={(event) => setGran(event.target.value)}>
                <MenuItem value="month">Month</MenuItem>
                <MenuItem value="week">Week</MenuItem>
              </TextField>
            </FilterStrip>

            {hcLoad ? (
              'Loading...'
            ) : (
              <>
                <Box sx={{ height: 250 }}>
                  <ResponsiveContainer>
                    <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="period" />
                      <YAxis allowDecimals={false} />
                      <ReTooltip />
                      <Legend />
                      {[...new Set(hc.map((row) => row.name))].map((team, index) => (
                        <Bar
                          key={team}
                          dataKey={team}
                          name={team}
                          fill={COLORS[index % COLORS.length]}
                          label={{ position: 'top' }}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </Box>

                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TH>Team</TH>
                        <TH>{gran === 'month' ? 'Month' : 'Week'}</TH>
                        <TH>Heads</TH>
                        <TH>Vac.</TH>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {hc.map((row, index) => (
                        <TableRow key={index}>
                          <TC>{row.name}</TC>
                          <TC>{row.period}</TC>
                          <TC>{row.headcount}</TC>
                          <TC>{row.vacancies}</TC>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
          </Box>
        </SectionCard>
      )}

      {tab === 2 && (
        <SectionCard
          title="Vacancy Control"
          subtitle="Update recruitment status, then download the requisition document when the role is ready to move forward."
          accent="#dc2626"
        >
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TH>Team</TH>
                  <TH>Left Date</TH>
                  <TH>Status</TH>
                  <TH>Req.</TH>
                </TableRow>
              </TableHead>
              <TableBody>
                {vac.map((row) => (
                  <TableRow key={row.id}>
                    <TC>{row.team}</TC>
                    <TC>{row.open}</TC>
                    <TC>
                      <TextField
                        select
                        size="small"
                        value={row.status}
                        onChange={(event) => updateStatus(row, event.target.value)}
                      >
                        {[
                          'OPEN',
                          'AWAITING_APPROVAL',
                          'APPROVED',
                          'INTERVIEWING',
                          'OFFER_SENT',
                          'OFFER_ACCEPTED',
                          'CLOSED'
                        ].map((status) => (
                          <MenuItem key={status} value={status}>
                            {status.replace('_', ' ')}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TC>
                    <TC>
                      <Tooltip title="Download requisition DOCX">
                        <IconButton
                          size="small"
                          onClick={async () => {
                            const { data } = await downloadReqDoc(row.id)
                            const url = URL.createObjectURL(data)
                            const anchor = document.createElement('a')
                            anchor.href = url
                            anchor.download = `requisition-${row.id}.docx`
                            anchor.click()
                            URL.revokeObjectURL(url)
                          }}
                        >
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TC>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </SectionCard>
      )}
    </PageShell>
  )
}
