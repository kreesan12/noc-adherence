/* frontend/src/pages/WorkforcePage.jsx
   — Uses plain MUI <Table> to avoid DataGrid internals — */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Paper, Tabs, Tab, Button, Tooltip, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Grid, TextField, MenuItem, Table, TableHead,
  TableBody, TableRow, TableCell, TableContainer, Typography
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DownloadIcon from '@mui/icons-material/Download'
import dayjs from 'dayjs'

// ── Recharts for Headcount chart ─────────────────────────────
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, CartesianGrid,
  Tooltip as ReTooltip, Legend
} from 'recharts'

import {
  listTeams, listAgents,
  listEngagements, createEngagement, terminateEngagement,
  headcountReport,
  listVacancies, updateVacancy, downloadReqDoc,
  createVacancy
} from '../api/workforce'

const COLORS = ['#1976d2', '#9c27b0', '#ff9800', '#2e7d32', '#d32f2f'];

// ── TableCell helpers for Vacancies tab ──────────────────────
const TH = props => <TableCell sx={{ fontWeight: 'bold' }} {...props} />;
const TC = props => <TableCell {...props} />;

export default function WorkforcePage() {
  /* ─── basic look-ups ───────────────────────────────── */
  const [tab, setTab]       = useState(0)    // 0-move 1-head 2-vac
  const [teams, setTeams]   = useState([])
  const [agents, setAgents] = useState([])

  useEffect(() => { listTeams().then(r => setTeams(r.data)) }, [])
  useEffect(() => { listAgents().then(r => setAgents(r.data)) }, [])

  /* ─── MOVEMENTS ───────────────────────────────────── */
  const [eng, setEng] = useState([])
  const loadEng = useCallback(() => {
    listEngagements({}).then(r => {
      setEng(r.data.map(e => ({
        id:      e.id,
        agentId: e.agent.id,
        agent:   e.agent.fullName,
        teamId:  e.team.id,
        team:    e.team.name,
        start:   e.startDate ? e.startDate.slice(0,10) : '',
        end:     e.endDate   ? e.endDate.slice(0,10)   : '—',
        note:    e.note ?? ''
      })))
    })
  }, [])
  useEffect(loadEng, [])

  /* ─── Add-Movement dialog state ───────────────────── */
  const [openMove, setOpenMove] = useState(false)
  const [moveForm, setMoveForm] = useState({
    sourceTeamId: '',
    agentId:      '',
    destTeamId:   '',
    reason:       '',
    moveDate:     dayjs().format('YYYY-MM-DD'),
    endDate:      dayjs().format('YYYY-MM-DD'),
  })

  const handleMoveSave = async () => {
    const {
      sourceTeamId, agentId,
      destTeamId, reason,
      moveDate, endDate
    } = moveForm

    // find the current engagement, if any
    const current = eng.find(e => e.agentId === +agentId)

    try {
      if (current) {
        // Terminate existing engagement
        await terminateEngagement(current.id, {
          endDate: destTeamId === 'left' ? endDate : moveDate,
          note:    reason
        })
      }

      // If moving to another team, start a new engagement
      if (destTeamId !== 'left' && current) {
        await createEngagement({
          agentId:   +agentId,
          teamId:    +destTeamId,
          startDate: moveDate,
          note:      reason
        })
      }

      // Always create a pending vacancy in the source team
      // 3️⃣ Create a pending vacancy in the old team,
      //     using the *actual* leave date
      const vacancyDate = destTeamId === 'left' ? endDate : moveDate
      await createVacancy({
        teamId:   +sourceTeamId,
        openFrom: vacancyDate,
        status:   'PENDING',
        reason
      })

      // 4️⃣ refresh *both* tables so you see the terminated engagement
      await loadEng()
      await loadVac()
    } catch (err) {
      console.error('Movement save failed', err)
    } finally {
      setOpenMove(false)
    }
  }

  /* ─── HEADCOUNT ─────────────────────────────────────── */
  const [gran, setGran]  = useState('month')
  const [hc, setHc]      = useState([])
  const [hcLoad, setHcL] = useState(false)
  useEffect(() => {
    if (tab !== 1) return
    const from = dayjs().subtract(5,'month').startOf('month').format('YYYY-MM-DD')
    const to   = dayjs().add(1,'month').endOf('month').format('YYYY-MM-DD')
    setHcL(true)
    headcountReport(from, to, gran)
      .then(r => setHc(r.data))
      .finally(() => setHcL(false))
  }, [tab, gran])

  /* ─── VACANCIES ─────────────────────────────────────── */
  const [vac, setVac]   = useState([])
  const loadVac = useCallback(() => {
    listVacancies().then(r => {
      setVac(r.data.map(v => ({
        id:     v.id,
        team:   v.team.name,
        open:   v.openFrom.slice(0,10),
        status: v.status
      })))
    })
  }, [])
  useEffect(() => { if (tab === 2) loadVac() }, [tab])

  const updateStatus = (row, status) =>
    updateVacancy(row.id, { status }).then(loadVac)

  /* ─── render ───────────────────────────────────────── */
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Movements" />
        <Tab label="Headcount" />
        <Tab label="Vacancies" />
      </Tabs>

      {/* ─── MOVEMENTS TAB ────────────────────────────────── */}
      {tab === 0 && (
        <Paper sx={{ p: 2, bgcolor: 'white' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>
              Movements
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setOpenMove(true)}
            >
              Add Movement
            </Button>
          </Box>

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
                {eng.map(r => (
                  <TableRow key={r.id}>
                    <TC>{r.agent}</TC>
                    <TC>{r.team}</TC>
                    <TC>{r.start}</TC>
                    <TC>{r.end}</TC>
                    <TC>{r.note}</TC>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Add-Movement dialog */}
          <Dialog open={openMove} onClose={() => setOpenMove(false)} fullWidth maxWidth="sm">
            <DialogTitle>New Movement</DialogTitle>
            <DialogContent>
              <Grid container spacing={3} sx={{ pt: 1 }}>
                {/* 1) From Team */}
                <Grid item xs={12}>
                  <TextField
                    select label="From Team" fullWidth
                    value={moveForm.sourceTeamId}
                    onChange={e =>
                      setMoveForm(f => ({
                        ...f,
                        sourceTeamId: e.target.value,
                        agentId: '',
                        destTeamId: ''
                      }))
                    }
                  >
                    {teams.map(t => (
                      <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                    ))}
                  </TextField>
                </Grid>

                {/* 2) Agent (filtered) */}
                <Grid item xs={12}>
                  <TextField
                    select label="Agent" fullWidth
                    disabled={!moveForm.sourceTeamId}
                    value={moveForm.agentId}
                    onChange={e =>
                      setMoveForm(f => ({ ...f, agentId: e.target.value, destTeamId: '' }))
                    }
                  >
                    {agents
                      .filter(a => {
                        const src = teams.find(t => t.id === +moveForm.sourceTeamId)
                        return src && a.role === src.name
                      })
                      .map(a => (
                        <MenuItem key={a.id} value={a.id}>{a.fullName}</MenuItem>
                      ))}
                  </TextField>
                </Grid>

                {/* 3) To Team or Left NOC */}
                <Grid item xs={12}>
                  <TextField
                    select label="To Team" fullWidth
                    disabled={!moveForm.agentId}
                    value={moveForm.destTeamId}
                    onChange={e =>
                      setMoveForm(f => ({ ...f, destTeamId: e.target.value }))
                    }
                  >
                    {teams
                      .filter(t => t.id !== +moveForm.sourceTeamId)
                      .map(t => (
                        <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                      ))}
                    <MenuItem value="left">Left NOC</MenuItem>
                  </TextField>
                </Grid>

                {/* 4a) Moved to another team */}
                {moveForm.destTeamId && moveForm.destTeamId !== 'left' && (
                  <>
                    <Grid item xs={12}>
                      <TextField
                        label="Reason (e.g. promotion)"
                        fullWidth multiline minRows={2}
                        value={moveForm.reason}
                        onChange={e =>
                          setMoveForm(f => ({ ...f, reason: e.target.value }))
                        }
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="Move Date" type="date"
                        fullWidth InputLabelProps={{ shrink: true }}
                        value={moveForm.moveDate}
                        onChange={e =>
                          setMoveForm(f => ({ ...f, moveDate: e.target.value }))
                        }
                      />
                    </Grid>
                  </>
                )}

                {/* 4b) Left NOC */}
                {moveForm.destTeamId === 'left' && (
                  <>
                    <Grid item xs={12}>
                      <TextField
                        label="Reason for leaving"
                        fullWidth multiline minRows={2}
                        value={moveForm.reason}
                        onChange={e =>
                          setMoveForm(f => ({ ...f, reason: e.target.value }))
                        }
                      />
                    </Grid>
                    <Grid item xs={12}>
                      <TextField
                        label="End Date" type="date"
                        fullWidth InputLabelProps={{ shrink: true }}
                        value={moveForm.endDate}
                        onChange={e =>
                          setMoveForm(f => ({ ...f, endDate: e.target.value }))
                        }
                      />
                    </Grid>
                  </>
                )}
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenMove(false)}>Cancel</Button>
              <Button onClick={handleMoveSave} variant="contained">
                Save Movement
              </Button>
            </DialogActions>
          </Dialog>
        </Paper>
      )}

      {/* ─── HEADCOUNT TAB ────────────────────────────────── */}
      {tab === 1 && (
        <Paper sx={{ p: 2, bgcolor: 'white' }}>
          <Box mb={2}>
            <TextField select size="small" value={gran}
              onChange={e => setGran(e.target.value)}
            >
              <MenuItem value="month">Month</MenuItem>
              <MenuItem value="week">Week</MenuItem>
            </TextField>
          </Box>
          {hcLoad ? (
            'Loading…'
          ) : (
            <>
              <Box sx={{ height: 300, mb: 3 }}>
                <ResponsiveContainer>
                  <BarChart
                    data={Object.values(
                      hc.reduce((acc, cur) => {
                        const p = cur.period
                        if (!acc[p]) acc[p] = { period: p }
                        acc[p][cur.name] = cur.headcount
                        return acc
                      }, {})
                    ).sort((a,b) => a.period.localeCompare(b.period))}
                    margin={{ top:10, right:20, left:0, bottom:10 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" />
                    <YAxis allowDecimals={false} />
                    <ReTooltip />
                    <Legend />
                    {[...new Set(hc.map(r => r.name))].map((team, idx) => (
                      <Bar
                        key={team}
                        dataKey={team}
                        name={team}
                        fill={COLORS[idx % COLORS.length]}
                        label={{ position:'top' }}
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
                      <TH>{gran==='month'?'Month':'Week'}</TH>
                      <TH>Heads</TH>
                      <TH>Vac.</TH>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {hc.map((r,i) => (
                      <TableRow key={i}>
                        <TC>{r.name}</TC>
                        <TC>{r.period}</TC>
                        <TC>{r.headcount}</TC>
                        <TC>{r.vacancies}</TC>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </Paper>
      )}

      {/* ─── VACANCIES TAB ────────────────────────────────── */}
      {tab === 2 && (
        <Paper sx={{ p: 2, bgcolor: 'white' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TH>Team</TH><TH>Left Date</TH><TH>Status</TH><TH>Req.</TH>
                </TableRow>
              </TableHead>
              <TableBody>
                {vac.map(r => (
                  <TableRow key={r.id}>
                    <TC>{r.team}</TC><TC>{r.open}</TC>
                    <TC>
                      <TextField select size="small" value={r.status}
                        onChange={e => updateStatus(r,e.target.value)}
                      >
                        {[
                          'OPEN','AWAITING_APPROVAL','APPROVED','INTERVIEWING',
                          'OFFER_SENT','OFFER_ACCEPTED','CLOSED'
                        ].map(s => (
                          <MenuItem key={s} value={s}>
                            {s.replace('_',' ')}
                          </MenuItem>
                        ))}
                      </TextField>
                    </TC>
                    <TC>
                      <Tooltip title="Download requisition DOCX">
                        <IconButton size="small" onClick={async() => {
                          const {data} = await downloadReqDoc(r.id)
                          const url = URL.createObjectURL(data)
                          const a = document.createElement('a')
                          a.href = url
                          a.download = `requisition-${r.id}.docx`
                          a.click()
                          URL.revokeObjectURL(url)
                        }}>
                          <DownloadIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TC>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  )
}
