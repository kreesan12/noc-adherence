// frontend/src/pages/WorkforcePage.jsx
import React, { useState, useEffect } from 'react'
import {
  Box, Paper, Tabs, Tab, Button, Dialog, DialogTitle, DialogContent,
  Grid, TextField, MenuItem, IconButton, Tooltip
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'
import AddIcon   from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import dayjs from 'dayjs'

import {
  /* look-ups & movements */
  listTeams, listAgents,
  listEngagements, createEngagement, terminateEngagement,

  /* head-count */
  headcountReport,

  /* vacancies */
  listVacancies, updateVacancy, downloadReqDoc
} from '../api/workforce'

/* ────────────────────────────────────────────────────────── */
export default function WorkforcePage () {
  /* ————————————————— STATE ————————————————— */
  const [tab, setTab]     = useState(0)          // 0=movements 1=head 2=vac
  const [teams,   setTeams]   = useState([])
  const [agents,  setAgents]  = useState([])

  /* movements */
  const [engRows, setEngRows] = useState([])
  const [activeEngs, setActiveEngs] = useState([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState({ agentId:'', teamId:'', startDate:'' })

  /* head-count */
  const [hcRows, setHcRows]   = useState([])
  const [hcLoading, setHcLoading] = useState(false)
  const [gran, setGran] = useState('month')      // month | week

  /* vacancies */
  const [vacRows, setVacRows] = useState([])

  /* ————————————————— LOOK-UPS ————————————————— */
  useEffect(()=>{ listTeams().then(r=>setTeams(r.data)) },[])
  useEffect(()=>{ listAgents().then(r=>setAgents(r.data)) },[])

  /* ————————————————— MOVEMENTS ————————————————— */
  const loadEngagements = () =>
    listEngagements({}).then(r=>{
      const flat = r.data.map(e=>({
        id: e.id,
        agentName: e.agent.fullName,
        teamName : e.team.name,
        start:    e.startDate ? dayjs(e.startDate).format('YYYY-MM-DD') : '',
        end:      e.endDate   ? dayjs(e.endDate).format('YYYY-MM-DD')   : '—',
        note:     e.note ?? ''
      }))
      setEngRows(flat)
    })
  useEffect(loadEngagements,[])

  /* active engagements for termination logic */
  useEffect(()=>{
    listEngagements({ activeOn: dayjs().format('YYYY-MM-DD') })
      .then(r=>setActiveEngs(r.data))
  },[])

  const saveEngagement = async () => {
    if (form.teamId === 0) {
      const cur = activeEngs.find(e=>e.agentId===form.agentId && !e.endDate)
      if (!cur) { alert('No active engagement'); return }
      await terminateEngagement(cur.id,{ endDate:form.startDate, note:'Left NOC' })
    } else {
      await createEngagement(form)
    }
    setDialogOpen(false)
    await loadEngagements()
  }

  /* ————————————————— HEAD-COUNT ————————————————— */
  useEffect(()=>{
    if (tab!==1) return
    const from = dayjs().subtract(5,'month').startOf('month').format('YYYY-MM-DD')
    const to   = dayjs().add(1,'month').endOf('month').format('YYYY-MM-DD')
    setHcLoading(true)
    headcountReport(from,to,gran)
      .then(r=>setHcRows(r.data))
      .finally(()=>setHcLoading(false))
  },[tab,gran])

  /* ————————————————— VACANCIES ————————————————— */
  const loadVacancies = ()=> listVacancies().then(r=>setVacRows(r.data))
  useEffect(()=>{ if(tab===2) loadVacancies() },[tab])

  const updateStatus = async (row, status) => {
    await updateVacancy(row.id,{ status })
    loadVacancies()
  }

  const downloadDocx = async id => {
    const { data } = await downloadReqDoc(id)
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url; a.download = `requisition-${id}.docx`; a.click()
    URL.revokeObjectURL(url)
  }

  /* ————————————————— COLUMN CONFIGS ————————————————— */
  const engCols = [
    { field:'agentName', headerName:'Agent', flex:1 },
    { field:'teamName',  headerName:'Team',  flex:1 },
    { field:'start',     headerName:'Start', flex:1 },
    { field:'end',       headerName:'End',   flex:1 },
    { field:'note',      headerName:'Note',  flex:1 }
  ]
  const hcCols = [
    { field:'name',     headerName:'Team',   flex:1 },
    { field:'period',   headerName: gran==='month' ? 'Month' : 'Week', flex:1 },
    { field:'headcount',headerName:'Heads',  flex:1, type:'number' },
    { field:'vacancies',headerName:'Vac.',   flex:1, type:'number' }
  ]
  const vacCols = [
    { field:'team', headerName:'Team', flex:1,
      valueGetter:({row})=>row.team.name },
    { field:'openFrom', headerName:'Open From', flex:1,
      valueGetter:({row})=>row.openFrom.slice(0,10) },
    { field:'status', headerName:'Status', flex:1,
      renderCell:({row})=>(
        <TextField
          select size="small" value={row.status}
          onChange={e=>updateStatus(row,e.target.value)}
        >
          {['OPEN','AWAITING_APPROVAL','APPROVED','INTERVIEWING',
            'OFFER_SENT','OFFER_ACCEPTED','CLOSED'].map(s=>(
              <MenuItem key={s} value={s}>{s.replace('_',' ')}</MenuItem>
          ))}
        </TextField>
      )
    },
    { field:'doc', headerName:'Req.', width:90,
      renderCell:({row})=>(
        <Tooltip title="Download requisition DOCX">
          <IconButton size="small" onClick={()=>downloadDocx(row.id)}>
            <DownloadIcon fontSize="small"/>
          </IconButton>
        </Tooltip>
      )
    }
  ]

  /* ————————————————— RENDER ————————————————— */
  return (
    <Box>
      <Tabs value={tab} onChange={(_,v)=>setTab(v)} sx={{ mb:2 }}>
        <Tab label="Movements"/>
        <Tab label="Headcount"/>
        <Tab label="Vacancies"/>
      </Tabs>

      {/* MOVEMENTS */}
      {tab===0 && (
        <Paper sx={{p:2}}>
          <Box sx={{display:'flex',justifyContent:'flex-end',mb:1}}>
            <Button
              startIcon={<AddIcon/>}
              variant="contained"
              onClick={()=>{ setDialogOpen(true); setForm({agentId:'',teamId:'',startDate:''}) }}
            >
              Add engagement
            </Button>
          </Box>

          <DataGrid
            autoHeight
            rows={engRows}
            columns={engCols}
            pageSize={10}
            getRowId={(r) => r.id}         // ← explicit
          />

          {/* modal */}
          <Dialog open={dialogOpen} onClose={()=>setDialogOpen(false)} maxWidth="sm" fullWidth>
            <DialogTitle>
              New engagement
              <IconButton onClick={()=>setDialogOpen(false)}
                sx={{position:'absolute',right:8,top:8}}>
                <CloseIcon/>
              </IconButton>
            </DialogTitle>
            <DialogContent dividers>
              <Grid container spacing={2}>
                {/* agent */}
                <Grid item xs={12}>
                  <TextField select label="Agent" fullWidth
                    value={form.agentId||''}
                    onChange={e=>setForm(f=>({...f,agentId:Number(e.target.value)}))}
                  >
                    <MenuItem value=""><em>Select agent</em></MenuItem>
                    {agents.map(a=>(
                      <MenuItem key={a.id} value={a.id}>{a.fullName} ({a.role})</MenuItem>
                    ))}
                  </TextField>
                </Grid>

                {/* current team */}
                {form.agentId && (
                  <Grid item xs={12}>
                    <TextField
                      label="Current Team" fullWidth disabled
                      value={agents.find(a=>a.id===form.agentId)?.role||''}
                    />
                    <TextField
                      label="Hire date"
                      fullWidth disabled
                      value={
                        agents.find(a=>a.id===form.agentId)?.startDate?.slice(0,10) || ''
                      }
                    />
                  </Grid>
                )}

                {/* move to */}
                <Grid item xs={12}>
                  <TextField select label="Move to" fullWidth
                    value={form.teamId||''}
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
                    InputLabelProps={{shrink:true}}
                    value={form.startDate||''}
                    onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}
                  />
                </Grid>

                <Grid item xs={12}>
                  <Button fullWidth variant="contained" onClick={saveEngagement}
                    disabled={!form.agentId||form.teamId===''||!form.startDate}>
                    Save
                  </Button>
                </Grid>
              </Grid>
            </DialogContent>
          </Dialog>
        </Paper>
      )}

      {/* HEADCOUNT */}
      {tab===1 && (
        <Paper sx={{p:2}}>
          <Box sx={{mb:2}}>
            <TextField select size="small" value={gran}
              onChange={e=>setGran(e.target.value)}>
              <MenuItem value="month">Month</MenuItem>
              <MenuItem value="week">Week</MenuItem>
            </TextField>
          </Box>
          <DataGrid
            key={`hc-${gran}`}                /* forces a clean mount on gran change */

            autoHeight
            rows={hcRows}
            columns={hcCols}
            loading={hcLoading}
            pageSize={20}

            /* always unique: team-name + period (e.g. “NOC-2025-07”) */
            getRowId={(r) => `${r.name}-${r.period}`}
          />
        </Paper>
      )}

      {/* VACANCIES */}
      {tab===2 && (
        <Paper sx={{p:2}}>
        <DataGrid
          autoHeight
          rows={vacRows}
          columns={vacCols}
          pageSize={10}
          getRowId={(r) => r.id}         /* explicit & stable */
        />
        </Paper>
      )}
    </Box>
  )
}
