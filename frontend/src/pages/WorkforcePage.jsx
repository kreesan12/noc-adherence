import React, { useState, useEffect } from 'react'
import {
  Box, Tab, Tabs, Paper, Button, Dialog, DialogTitle, DialogContent,
  TextField, MenuItem, Grid, IconButton
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import {
  listTeams, listEngagements, createEngagement,
  terminateEngagement, headcountReport
} from './api/workforce.js'
import dayjs from 'dayjs'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'

export default function WorkforcePage() {
  const [tab, setTab] = useState(0)

  /* lookups */
  const [teams, setTeams] = useState([])
  useEffect(() => { listTeams().then(r => setTeams(r.data)) }, [])

  /* Movements tab */
  const [rows, setRows] = useState([])
  const loadEngagements = () =>
    listEngagements({}).then(r => setRows(r.data))
  useEffect(loadEngagements, [])

  /* create dialog */
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ agentId:'', teamId:'', startDate:'' })

  const saveEngagement = async () => {
    await createEngagement(form)
    setDialogOpen(false)
    loadEngagements()
  }

  /* Headcount chart */
  const [chart, setChart] = useState([])
  useEffect(() => {
    const from = dayjs().startOf('year').format('YYYY-MM-DD')
    const to   = dayjs().endOf('year').format('YYYY-MM-DD')
    headcountReport(from,to).then(r => setChart(r.data))
  }, [])

  /* grid columns */
  const cols = [
    { field:'agent.fullName', headerName:'Agent', valueGetter: p => p.row.agent.fullName, flex:1 },
    { field:'team.name',      headerName:'Team',  valueGetter: p => p.row.team.name, flex:1 },
    { field:'startDate',      headerName:'Start', valueGetter: p => p.row.startDate.slice(0,10) },
    { field:'endDate',        headerName:'End',   valueGetter: p => p.row.endDate?.slice(0,10) || '—' },
    { field:'note',           headerName:'Note',  flex:1 },
  ]

  return (
    <Box>
      <Tabs value={tab} onChange={(_,v)=>setTab(v)} sx={{ mb:2 }}>
        <Tab label="Movements" />
        <Tab label="Headcount" />
      </Tabs>

      {tab===0 && (
        <Paper sx={{ p:2 }}>
          <Box sx={{ display:'flex', justifyContent:'flex-end', mb:1 }}>
            <Button startIcon={<AddIcon/>} variant="contained"
                    onClick={()=>{setForm({}); setDialogOpen(true)}}>
              Add engagement
            </Button>
          </Box>

          <DataGrid autoHeight rows={rows} columns={cols} getRowId={r=>r.id} />

          <Dialog open={dialogOpen} onClose={()=>setDialogOpen(false)}>
            <DialogTitle>
              New engagement
              <IconButton onClick={()=>setDialogOpen(false)}
                          sx={{ position:'absolute', right:8, top:8 }}>
                <CloseIcon/>
              </IconButton>
            </DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={2}>
                <Grid item xs={12}>
                  <TextField label="Agent ID" fullWidth
                             value={form.agentId||''}
                             onChange={e=>setForm(f=>({...f, agentId:Number(e.target.value)}))}/>
                </Grid>
                <Grid item xs={12}>
                  <TextField select label="Team" fullWidth
                             value={form.teamId||''}
                             onChange={e=>setForm(f=>({...f, teamId:Number(e.target.value)}))}>
                    {teams.map(t=>(
                      <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12}>
                  <TextField label="Start date" type="date" fullWidth
                             InputLabelProps={{ shrink:true }}
                             value={form.startDate||''}
                             onChange={e=>setForm(f=>({...f, startDate:e.target.value}))}/>
                </Grid>
                <Grid item xs={12}>
                  <Button variant="contained" fullWidth onClick={saveEngagement}>
                    Save
                  </Button>
                </Grid>
              </Grid>
            </DialogContent>
          </Dialog>
        </Paper>
      )}

      {tab===1 && (
        <Paper sx={{ p:2, height:400 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}>
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              {Array.from(new Set(chart.map(r=>r.name))).map(team=>(
                <Bar key={team} dataKey={r=>r.name===team ? r.headcount : 0} stackId="a" />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Paper>
      )}
    </Box>
  )
}
