/* frontend/src/pages/WorkforcePage.jsx
   — Uses plain MUI <Table> to avoid DataGrid internals — */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Paper, Tabs, Tab, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  Grid, TextField, MenuItem, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow,
  TableCell, TableContainer, Typography
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DownloadIcon from '@mui/icons-material/Download'
import dayjs from 'dayjs'

import {
  listTeams, listAgents,
  listEngagements, createEngagement, terminateEngagement,
  headcountReport,
  listVacancies, updateVacancy, downloadReqDoc
} from '../api/workforce'

const COLORS = ['#1976d2', '#9c27b0', '#ff9800', '#2e7d32', '#d32f2f'];

export default function WorkforcePage() {
  /* ─── basic look-ups ───────────────────────────────── */
  const [tab, setTab]       = useState(0)                 // 0-move 1-head 2-vac
  const [teams, setTeams]   = useState([])
  const [agents, setAgents] = useState([])

  useEffect(() => { listTeams().then(r => setTeams(r.data)) }, [])
  useEffect(() => { listAgents().then(r => setAgents(r.data)) }, [])

  /* ─── MOVEMENTS ───────────────────────────────────── */
  const [eng, setEng]       = useState([])
  const loadEng = useCallback(() => {
    listEngagements({}).then(r => {
      setEng(r.data.map(e => ({
        id:       e.id,
        agent:    e.agent.fullName,
        team:     e.team.name,
        start:    e.startDate ? e.startDate.slice(0,10) : '',
        end:      e.endDate   ? e.endDate.slice(0,10)   : '—',
        note:     e.note ?? ''
      })))
    })
  }, [])
  useEffect(loadEng, [])

  // new: state for Add-Movement dialog
  const [openMove, setOpenMove] = useState(false)
  const [moveForm, setMoveForm] = useState({
    agentId: '', teamId: '', 
    startDate: dayjs().format('YYYY-MM-DD'),
    note: ''
  })

  const handleMoveSave = async () => {
    await createEngagement({
      agentId:   moveForm.agentId,
      teamId:    moveForm.teamId,
      startDate: moveForm.startDate,
      note:      moveForm.note
    })
    setOpenMove(false)
    loadEng()
  }

  /* ─── HEADCOUNT ─────────────────────────────────────── */
  const [gran, setGran]    = useState('month')
  const [hc, setHc]        = useState([])
  const [hcLoad, setHcL]   = useState(false)
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
  const [vac, setVac]     = useState([])
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

      {/* MOVEMENTS TABLE + ADD BUTTON */}
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
                  <TableCell sx={{ fontWeight: 'bold' }}>Agent</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Team</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Start</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>End</TableCell>
                  <TableCell sx={{ fontWeight: 'bold' }}>Note</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {eng.map(r => (
                  <TableRow key={r.id}>
                    <TableCell>{r.agent}</TableCell>
                    <TableCell>{r.team}</TableCell>
                    <TableCell>{r.start}</TableCell>
                    <TableCell>{r.end}</TableCell>
                    <TableCell>{r.note}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Add-Movement dialog */}
          <Dialog open={openMove} onClose={() => setOpenMove(false)}>
            <DialogTitle>New Movement</DialogTitle>
            <DialogContent>
              <Grid container spacing={2} sx={{ pt: 1 }}>
                <Grid item xs={12}>
                  <TextField
                    select
                    label="Agent"
                    fullWidth
                    value={moveForm.agentId}
                    onChange={e =>
                      setMoveForm(f => ({ ...f, agentId: +e.target.value }))
                    }
                  >
                    {agents.map(a => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.fullName}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    select
                    label="Team"
                    fullWidth
                    value={moveForm.teamId}
                    onChange={e =>
                      setMoveForm(f => ({ ...f, teamId: +e.target.value }))
                    }
                  >
                    {teams.map(t => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="Start Date"
                    type="date"
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={moveForm.startDate}
                    onChange={e =>
                      setMoveForm(f => ({
                        ...f,
                        startDate: e.target.value
                      }))
                    }
                  />
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label="Note"
                    fullWidth
                    multiline
                    rows={3}
                    value={moveForm.note}
                    onChange={e =>
                      setMoveForm(f => ({ ...f, note: e.target.value }))
                    }
                  />
                </Grid>
              </Grid>
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setOpenMove(false)}>Cancel</Button>
              <Button onClick={handleMoveSave} variant="contained">
                Save
              </Button>
            </DialogActions>
          </Dialog>
        </Paper>
      )}

{/* HEADCOUNT TABLE */}
{tab===1 && (
<Paper sx={{ p: 2, bgcolor: 'white' }}>
  <Box mb={2}>
    <TextField select size="small" value={gran}
      onChange={e=>setGran(e.target.value)}>
      <MenuItem value="month">Month</MenuItem>
      <MenuItem value="week">Week</MenuItem>
    </TextField>
  </Box>

  {/* ─── HEADCOUNT CHART ───────────────────────────────────── */}
  <Box sx={{ height: 300, mb: 3 }}>
    <ResponsiveContainer>
    <BarChart
      data={
        /* pivot rows → one object per period with team head-counts */
        Object.values(
          hc.reduce((acc, cur) => {
            const p = cur.period;
            if (!acc[p]) acc[p] = { period: p };
            acc[p][cur.name] = cur.headcount;
            return acc;
          }, {})
        ).sort((a, b) => a.period.localeCompare(b.period))
      }
      margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
    >
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="period" />
      <YAxis allowDecimals={false} />
      <ReTooltip />
      <Legend />
      {/* one bar per team — clustered automatically */}
      {[...new Set(hc.map(r => r.name))].map((team, idx) => (
        <Bar
          key={team}
          dataKey={team}
          name={team}
          fill={COLORS[idx % COLORS.length]}
          label={{ position: 'top' }} 
        />
      ))}
    </BarChart>
    </ResponsiveContainer>
  </Box>
  {/* ───────────────────────────────────────────────────────── */}

  {hcLoad ? 'Loading…' : (
  <TableContainer>
  <Table size="small">
    <TableHead><TableRow>
      <TH>Team</TH><TH>{gran==='month'?'Month':'Week'}</TH>
      <TH>Heads</TH><TH>Vac.</TH>
    </TableRow></TableHead>
    <TableBody>
      {hc.map((r,i)=>(
        <TableRow key={i}>
          <TC>{r.name}</TC><TC>{r.period}</TC>
          <TC>{r.headcount}</TC><TC>{r.vacancies}</TC>
        </TableRow>
      ))}
    </TableBody>
  </Table></TableContainer>
  )}
</Paper>
)}

{/* VACANCIES TABLE */}
{tab===2 && (
<Paper sx={{ p: 2, bgcolor: 'white' }}>
  <TableContainer>
  <Table size="small">
    <TableHead><TableRow>
      <TH>Team</TH><TH>Open</TH><TH>Status</TH><TH>Req.</TH>
    </TableRow></TableHead>
    <TableBody>
      {vac.map(r=>(
        <TableRow key={r.id}>
          <TC>{r.team}</TC><TC>{r.open}</TC>
          <TC>
            <TextField select size="small" value={r.status}
              onChange={e=>updateStatus(r,e.target.value)}>
              {['OPEN','AWAITING_APPROVAL','APPROVED','INTERVIEWING',
                'OFFER_SENT','OFFER_ACCEPTED','CLOSED'].map(s=>(
                  <MenuItem key={s} value={s}>
                    {s.replace('_',' ')}
                  </MenuItem>
              ))}
            </TextField>
          </TC>
          <TC>
            <Tooltip title="Download requisition DOCX">
              <IconButton size="small" onClick={async()=>{
                const {data}=await downloadReqDoc(r.id)
                const url=URL.createObjectURL(data)
                const a=document.createElement('a')
                a.href=url; a.download=`requisition-${r.id}.docx`; a.click()
                URL.revokeObjectURL(url)
              }}>
                <DownloadIcon fontSize="small"/>
              </IconButton>
            </Tooltip>
          </TC>
        </TableRow>
      ))}
    </TableBody>
  </Table></TableContainer>
</Paper>
)}
    </Box>
  )
}
