// frontend/src/pages/WorkforcePage.jsx
import React, { useState, useEffect } from 'react'
import {
  Box,
  Tab,
  Tabs,
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  TextField,
  MenuItem,
  Grid,
  IconButton
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts'
import dayjs from 'dayjs'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'

import {
  listTeams,
  listAgents,
  listEngagements,
  createEngagement,
  terminateEngagement,
  headcountReport
} from '../api/workforce'

export default function WorkforcePage() {
  const [tab, setTab] = useState(0)

  // ── lookups ─────────────────────────────
  const [teams, setTeams] = useState([])
  useEffect(() => {
    listTeams().then(r => setTeams(r.data))
  }, [])

  const [agents, setAgents] = useState([])
  useEffect(() => {
    listAgents().then(r => setAgents(r.data))
  }, [])

  // ── track current open engagements ─────────────────
  const [engs, setEngs] = useState([])
  useEffect(() => {
    const today = dayjs().format('YYYY-MM-DD')
    listEngagements({ activeOn: today })
      .then(r => setEngs(r.data))
  }, [])

  // ── Movements tab data ─────────────────────────────
  const [rows, setRows] = useState([])
  const loadEngagements = () =>
    listEngagements({}).then(r => setRows(r.data))
  useEffect(loadEngagements, [])

  // ── dialog state ────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({
    agentId: '',
    teamId: '',
    startDate: ''
  })

  const saveEngagement = async () => {
    if (form.teamId === 0) {
      // terminate
      const current = engs.find(
        e => e.agentId === form.agentId && !e.endDate
      )
      if (!current) {
        alert('No active engagement to terminate')
        return
      }
      await terminateEngagement(current.id, {
        endDate: form.startDate,
        note: 'Left NOC'
      })
    } else {
      // new engagement
      await createEngagement(form)
    }

    setDialogOpen(false)
    await loadEngagements()

    const today = dayjs().format('YYYY-MM-DD')
    listEngagements({ activeOn: today }).then(r => setEngs(r.data))
  }

  // ── Headcount chart data ────────────────────────────
  const [rawChart, setRawChart] = useState([])
  const [barData, setBarData]   = useState([])
  const [chartTeams, setChartTeams] = useState([])

  useEffect(() => {
    const from = dayjs().startOf('year').format('YYYY-MM-DD')
    const to   = dayjs().endOf('year').format('YYYY-MM-DD')
    headcountReport(from, to).then(r => {
      const data = r.data
      setRawChart(data)

      // figure out which teams appear
      const names = Array.from(new Set(data.map(d => d.name)))
      setChartTeams(names)

      // pivot into { month, [team1]: count, [team2]: count, ... }
      const pivot = {}
      data.forEach(({ month, name, headcount }) => {
        if (!pivot[month]) pivot[month] = { month }
        pivot[month][name] = headcount
      })
      setBarData(Object.values(pivot))
    })
  }, [])

  // ── DataGrid columns ────────────────────────────────
  const cols = [
    {
      field: 'agent.fullName',
      headerName: 'Agent',
      flex: 1,
      valueGetter: params => params.row.agent?.fullName || ''
    },
    {
      field: 'team.name',
      headerName: 'Team',
      flex: 1,
      valueGetter: params => params.row.team?.name || ''
    },
    {
      field: 'startDate',
      headerName: 'Start',
      flex: 1,
      valueGetter: params => params.row.startDate?.slice(0, 10) || ''
    },
    {
      field: 'endDate',
      headerName: 'End',
      flex: 1,
      valueGetter: params => params.row.endDate?.slice(0, 10) || '—'
    },
    { field: 'note', headerName: 'Note', flex: 1 }
  ]

  return (
    <Box>
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ mb: 2 }}
      >
        <Tab label='Movements' />
        <Tab label='Headcount' />
      </Tabs>

      {tab === 0 && (
        <Paper sx={{ p: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <Button
              startIcon={<AddIcon />}
              variant='contained'
              onClick={() => {
                setForm({ agentId: '', teamId: '', startDate: '' })
                setDialogOpen(true)
              }}
            >
              Add engagement
            </Button>
          </Box>

          <DataGrid
            autoHeight
            rows={rows}
            columns={cols}
            getRowId={r => r.id}
            pageSize={10}
          />

          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
          >
            <DialogTitle>
              New engagement
              <IconButton
                onClick={() => setDialogOpen(false)}
                sx={{ position: 'absolute', right: 8, top: 8 }}
              >
                <CloseIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={4}>
                <Grid item xs={12}>
                  <TextField
                    select
                    label='Agent'
                    fullWidth
                    value={form.agentId || ''}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        agentId: Number(e.target.value)
                      }))
                    }
                  >
                    <MenuItem value=''>
                      <em>Select agent</em>
                    </MenuItem>
                    {agents.map(a => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.fullName} ({a.role})
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                {form.agentId && (
                  <Grid item xs={12}>
                    <TextField
                      label='Current Team'
                      fullWidth
                      disabled
                      value={
                        agents.find(a => a.id === form.agentId)
                          ?.role || ''
                      }
                    />
                  </Grid>
                )}

                <Grid item xs={12}>
                  <TextField
                    select
                    label='Move to'
                    fullWidth
                    value={form.teamId ?? ''}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        teamId: Number(e.target.value)
                      }))
                    }
                  >
                    <MenuItem value=''>
                      <em>Select team</em>
                    </MenuItem>
                    {teams.map(t => (
                      <MenuItem key={t.id} value={t.id}>
                        {t.name}
                      </MenuItem>
                    ))}
                    <MenuItem value={0}>
                      <em>Left NOC</em>
                    </MenuItem>
                  </TextField>
                </Grid>

                <Grid item xs={12}>
                  <TextField
                    label='Start date'
                    type='date'
                    fullWidth
                    InputLabelProps={{ shrink: true }}
                    value={form.startDate || ''}
                    onChange={e =>
                      setForm(f => ({
                        ...f,
                        startDate: e.target.value
                      }))
                    }
                  />
                </Grid>

                <Grid item xs={12}>
                  <Button
                    variant='contained'
                    fullWidth
                    onClick={saveEngagement}
                    disabled={
                      !form.agentId ||
                      form.teamId === '' ||
                      !form.startDate
                    }
                  >
                    Save
                  </Button>
                </Grid>
              </Grid>
            </DialogContent>
          </Dialog>
        </Paper>
      )}

      {tab === 1 && (
        <Paper sx={{ p: 2, height: 400 }}>
          <ResponsiveContainer width='100%' height='100%'>
            <BarChart data={barData}>
              <XAxis dataKey='month' />
              <YAxis />
              <Tooltip />
              <Legend />
              {chartTeams.map(team => (
                <Bar
                  key={team}
                  dataKey={team}
                  stackId='a'
                  name={team}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Paper>
      )}
    </Box>
  )
}
