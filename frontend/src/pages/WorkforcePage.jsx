// frontend/src/pages/WorkforcePage.jsx
import React, { useState, useEffect } from 'react'
import {
  Box, Tab, Tabs, Paper, Button, Dialog, DialogTitle, DialogContent,
  TextField, MenuItem, Grid, IconButton
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import dayjs from 'dayjs'
import AddIcon   from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'

import {
  listTeams, listAgents, listEngagements,
  createEngagement, terminateEngagement,
  headcountReport                         // ← already in your api helper
} from '../api/workforce'

export default function WorkforcePage() {
  /* ─────────── state ─────────── */
  const [tab, setTab]               = useState(0)
  const [teams,   setTeams]         = useState([])
  const [agents,  setAgents]        = useState([])
  const [engs,    setEngs]          = useState([])      // active engagements
  const [rows,    setRows]          = useState([])      // movements grid
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form,    setForm]          = useState({ agentId:'', teamId:'', startDate:'' })

  /* head-count report */
  const [hcRows,     setHcRows]     = useState([])
  const [hcLoading,  setHcLoading]  = useState(false)

  /* ─────────── look-ups ─────────── */
  useEffect(() => { listTeams().then(r => setTeams(r.data)) }, [])
  useEffect(() => { listAgents().then(r => setAgents(r.data)) }, [])

  /* active engagements (needed when terminating) */
  useEffect(() => {
    const today = dayjs().format('YYYY-MM-DD')
    listEngagements({ activeOn: today }).then(r => setEngs(r.data))
  }, [])

  /* ─────────── Movements grid ─────────── */
  const loadEngagements = () =>
    listEngagements({}).then(r => {
      const flat = r.data.map(e => ({
        id:        e.id,
        agentName: e.agent.fullName,
        teamName:  e.team.name,
        start:     e.startDate ? dayjs(e.startDate).format('YYYY-MM-DD') : '',
        end:       e.endDate   ? dayjs(e.endDate)  .format('YYYY-MM-DD') : '—',
        note:      e.note || ''
      }))
      setRows(flat)
    })
  useEffect(loadEngagements, [])

  /* save or terminate engagement */
  const saveEngagement = async () => {
    if (form.teamId === 0) {
      /* termination */
      const current = engs.find(e => e.agentId === form.agentId && !e.endDate)
      if (!current) { alert('No active engagement'); return }
      await terminateEngagement(current.id, {
        endDate: form.startDate,
        note:    'Left NOC'
      })
    } else {
      /* new / move */
      await createEngagement(form)
    }

    setDialogOpen(false)
    await loadEngagements()
    listEngagements({ activeOn: dayjs().format('YYYY-MM-DD') })
      .then(r => setEngs(r.data))
  }

  /* ─────────── Head-count report ─────────── */
  useEffect(() => {
    if (tab !== 1) return                    // only when Headcount tab active
    setHcLoading(true)

    const from = dayjs().subtract(5, 'month').startOf('month').format('YYYY-MM-DD')
    const to   = dayjs().add(1, 'month').endOf('month').format('YYYY-MM-DD')

    /* helper expects positional args — adjust if you changed it */
    headcountReport(from, to)
      .then(r => setHcRows(r.data))
      .catch(console.error)
      .finally(() => setHcLoading(false))
  }, [tab])

  /* ─────────── column configs ─────────── */
  const movementCols = [
    { field:'agentName', headerName:'Agent', flex:1 },
    { field:'teamName',  headerName:'Team',  flex:1 },
    { field:'start',     headerName:'Start', flex:1 },
    { field:'end',       headerName:'End',   flex:1 },
    { field:'note',      headerName:'Note',  flex:1 }
  ]

  const hcCols = [
    { field:'name',       headerName:'Team',      flex:1 },
    { field:'month',      headerName:'Month',     flex:1 },
    { field:'headcount',  headerName:'Heads',     flex:1, type:'number' },
    { field:'vacancies',  headerName:'Vacancies', flex:1, type:'number' }
  ]

  /* ─────────── render ─────────── */
  return (
    <Box>
      <Tabs value={tab} onChange={(_,v)=>setTab(v)} sx={{ mb:2 }}>
        <Tab label="Movements" />
        <Tab label="Headcount" />
      </Tabs>

      {/* ── MOVEMENTS TAB ─────────────────────────────────────── */}
      {tab === 0 && (
        <Paper sx={{ p:2 }}>
          <Box sx={{ display:'flex', justifyContent:'flex-end', mb:1 }}>
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              onClick={()=>{
                setForm({ agentId:'', teamId:'', startDate:'' })
                setDialogOpen(true)
              }}
            >
              Add engagement
            </Button>
          </Box>

          <DataGrid
            autoHeight
            rows={rows}
            columns={movementCols}
            pageSize={10}
          />

          {/* ── dialog ── */}
          <Dialog open={dialogOpen} onClose={()=>setDialogOpen(false)}>
            <DialogTitle>
              New engagement
              <IconButton
                onClick={()=>setDialogOpen(false)}
                sx={{ position:'absolute', right:8, top:8 }}
              >
                <CloseIcon />
              </IconButton>
            </DialogTitle>

            <DialogContent dividers>
              <Grid container spacing={2}>

                {/* agent picker */}
                <Grid item xs={12}>
                  <TextField select label="Agent" fullWidth
                    value={form.agentId || ''}
                    onChange={e=>setForm(f=>({...f,agentId:Number(e.target.value)}))}
                  >
                    <MenuItem value=""><em>Select agent</em></MenuItem>
                    {agents.map(a=>(
                      <MenuItem key={a.id} value={a.id}>
                        {a.fullName} ({a.role})
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>

                {/* current team display */}
                {form.agentId && (
                  <Grid item xs={12}>
                    <TextField
                      label="Current Team"
                      fullWidth disabled
                      value={agents.find(a=>a.id===form.agentId)?.role || ''}
                    />
                  </Grid>
                )}

                {/* move-to team */}
                <Grid item xs={12}>
                  <TextField select label="Move to" fullWidth
                    value={form.teamId || ''}
                    onChange={e=>setForm(f=>({...f,teamId:Number(e.target.value)}))}
                  >
                    <MenuItem value=""><em>Select team</em></MenuItem>
                    {teams.map(t=>(
                      <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                    ))}
                    <MenuItem value={0}><em>Left NOC</em></MenuItem>
                  </TextField>
                </Grid>

                {/* start date */}
                <Grid item xs={12}>
                  <TextField
                    label="Start date" type="date" fullWidth
                    InputLabelProps={{ shrink:true }}
                    value={form.startDate || ''}
                    onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Button
                    variant="contained" fullWidth onClick={saveEngagement}
                    disabled={!form.agentId || form.teamId==='' || !form.startDate}
                  >
                    Save
                  </Button>
                </Grid>
              </Grid>
            </DialogContent>
          </Dialog>
        </Paper>
      )}

      {/* ── HEADCOUNT TAB ─────────────────────────────────────── */}
      {tab === 1 && (
        <Paper sx={{ p:2 }}>
          <DataGrid
            autoHeight
            rows={hcRows.map((r,i)=>({ id:i, ...r }))}
            columns={hcCols}
            loading={hcLoading}
            pageSize={20}
          />
        </Paper>
      )}
    </Box>
  )
}
