/* frontend/src/pages/WorkforcePage.jsx
   ——— Uses plain MUI <Table> to avoid DataGrid internals ——— */
import React, { useState, useEffect, useCallback } from 'react'
import {
  Box, Paper, Tabs, Tab, Button, Dialog, DialogTitle, DialogContent,
  Grid, TextField, MenuItem, IconButton, Tooltip,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import DownloadIcon from '@mui/icons-material/Download'
import dayjs from 'dayjs'
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend
} from 'recharts';


import {
  listTeams, listAgents,
  listEngagements, createEngagement, terminateEngagement,
  headcountReport,
  listVacancies, updateVacancy, downloadReqDoc
} from '../api/workforce'

export default function WorkforcePage () {
/* ─── basic look-ups ────────────────────────────────────────── */
  const [tab,setTab] = useState(0)                 // 0-move 1-head 2-vac
  const [teams,setTeams]   = useState([])
  const [agents,setAgents] = useState([])
  useEffect(()=>{ listTeams().then(r=>setTeams(r.data)) },[])
  useEffect(()=>{ listAgents().then(r=>setAgents(r.data)) },[])

/* ─── MOVEMENTS ─────────────────────────────────────────────── */
  const [eng,setEng] = useState([])
  const loadEng = useCallback(()=> {
    listEngagements({}).then(r=>{
      setEng(r.data.map(e=>({
        id:e.id,
        agent:e.agent.fullName,
        team :e.team.name,
        start:e.startDate?e.startDate.slice(0,10):'',
        end  :e.endDate  ?e.endDate.slice(0,10):'—',
        note :e.note??''
      })))
    })
  },[])
  useEffect(loadEng,[])

/* ─── HEADCOUNT ─────────────────────────────────────────────── */
  const [gran,setGran]   = useState('month')
  const [hc,setHc]       = useState([])
  const [hcLoad,setHcL]  = useState(false)
  useEffect(()=> {
    if (tab!==1) return
    const from = dayjs().subtract(5,'month').startOf('month').format('YYYY-MM-DD')
    const to   = dayjs().add(1,'month').endOf('month').format('YYYY-MM-DD')
    setHcL(true)
    headcountReport(from,to,gran)
      .then(r=>setHc(r.data))
      .finally(()=>setHcL(false))
  },[tab,gran])

/* ─── VACANCIES ─────────────────────────────────────────────── */
  const [vac,setVac] = useState([])
  const loadVac = useCallback(()=> {
    listVacancies().then(r=>{
      setVac(r.data.map(v=>({
        id:v.id,
        team :v.team.name,
        open :v.openFrom.slice(0,10),
        status:v.status
      })))
    })
  },[])
  useEffect(()=>{ if(tab===2) loadVac() },[tab])

  const updateStatus = (row, status) =>
    updateVacancy(row.id,{status}).then(loadVac)

/* ─── simple cell renderer helpers ──────────────────────────── */
  const TH = p => <TableCell sx={{fontWeight:'bold'}} {...p}/>
  const TC = p => <TableCell {...p}/>

/* ─── RENDER ────────────────────────────────────────────────── */
  return (
    <Box>
      <Tabs value={tab} onChange={(_,v)=>setTab(v)} sx={{mb:2}}>
        <Tab label="Movements"/><Tab label="Headcount"/><Tab label="Vacancies"/>
      </Tabs>

{/* MOVEMENTS TABLE */}
{tab===0 && (
<Paper sx={{p:2}}>
  <TableContainer>
  <Table size="small">
    <TableHead><TableRow>
      <TH>Agent</TH><TH>Team</TH><TH>Start</TH><TH>End</TH><TH>Note</TH>
    </TableRow></TableHead>
    <TableBody>
      {eng.map(r=>(
        <TableRow key={r.id}>
          <TC>{r.agent}</TC><TC>{r.team}</TC><TC>{r.start}</TC>
          <TC>{r.end}</TC><TC>{r.note}</TC>
        </TableRow>
      ))}
    </TableBody>
  </Table></TableContainer>
</Paper>
)}

{/* HEADCOUNT TABLE */}
{tab===1 && (
<Paper sx={{p:2}}>
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
      <LineChart
        data={hcRows}                     /* same rows as the table */
        margin={{ top: 10, right: 20, left: 0, bottom: 10 }}
      >
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="period" />
        <YAxis allowDecimals={false}/>
        <Tooltip />
        <Legend />
        {/* one line per team */}
        {[...new Set(hcRows.map(r => r.name))].map(team => (
          <Line
            key={team}
            type="monotone"
            dataKey={d => (d.name === team ? d.headcount : null)}
            name={team}
            connectNulls
            strokeWidth={2}
          />
        ))}
      </LineChart>
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
<Paper sx={{p:2}}>
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
