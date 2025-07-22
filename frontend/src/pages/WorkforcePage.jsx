/* frontend/src/pages/WorkforcePage.jsx */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Paper, Tabs, Tab, Button, Dialog, DialogTitle, DialogContent,
  Grid, TextField, MenuItem, IconButton, Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import dayjs from 'dayjs';

import GridSafe          from '../components/GridSafe';
import { flatVacancy,
         flatEngagement } from '../lib/flat';

import {
  /* look-ups & movements */
  listTeams, listAgents,
  listEngagements, createEngagement, terminateEngagement,
  /* head-count */
  headcountReport,
  /* vacancies */
  listVacancies, updateVacancy, downloadReqDoc
} from '../api/workforce';

/* ────────────────────────────────────────────────────────── */
export default function WorkforcePage () {
/* ───── tabs & static look-ups ───── */
  const [tab, setTab]   = useState(0);          // 0-move 1-head 2-vac
  const [teams,   setTeams]  = useState([]);
  const [agents,  setAgents] = useState([]);
  useEffect(()=>{ listTeams().then(r=>setTeams(r.data)) },[]);
  useEffect(()=>{ listAgents().then(r=>setAgents(r.data)) },[]);

/* ───── MOVEMENTS ───── */
  const [eng, setEng] = useState([]);
  const loadEng = useCallback(() =>
    listEngagements({}).then(r=> setEng(r.data.map(flatEngagement)))
  ,[]);
  useEffect(loadEng,[]);

/* ───── HEAD-COUNT ───── */
  const [gran, setGran]   = useState('month');
  const [hcRows, setHc]   = useState([]);
  const [hcLoad, setHcL]  = useState(false);
  useEffect(()=> {
    if (tab!==1) return;
    const from = dayjs().subtract(5,'month').startOf('month').format('YYYY-MM-DD');
    const to   = dayjs().add(1,'month').endOf('month').format('YYYY-MM-DD');
    setHcL(true);
    headcountReport(from,to,gran)
      .then(r=>setHc(r.data))
      .finally(()=>setHcL(false));
  },[tab,gran]);

/* ───── VACANCIES ───── */
  const [vac, setVac] = useState([]);
  const loadVac = useCallback(() =>
    listVacancies().then(r=> setVac(r.data.map(flatVacancy)))
  ,[]);
  useEffect(()=>{ if(tab===2) loadVac() },[tab]);

/* ───── column defs (all primitives) ───── */
  const engCols = [
    {field:'agent', headerName:'Agent', flex:1},
    {field:'team',  headerName:'Team',  flex:1},
    {field:'start', headerName:'Start', flex:1},
    {field:'end',   headerName:'End',   flex:1},
    {field:'note',  headerName:'Note',  flex:1}
  ];
  const hcCols = [
    {field:'name',      headerName:'Team',  flex:1},
    {field:'period',    headerName: gran==='month'?'Month':'Week', flex:1},
    {field:'headcount', headerName:'Heads', flex:1, type:'number'},
    {field:'vacancies', headerName:'Vac.',  flex:1, type:'number'}
  ];
  const vacCols = [
    {field:'team',  headerName:'Team', flex:1},
    {field:'open',  headerName:'Open', flex:1},
    {field:'status',headerName:'Status', flex:1,
      renderCell:({row})=>(
        <TextField size="small" select value={row.status}
          onChange={e=>{
            updateVacancy(row.id,{status:e.target.value}).then(loadVac);
          }}>
          {['OPEN','AWAITING_APPROVAL','APPROVED','INTERVIEWING',
            'OFFER_SENT','OFFER_ACCEPTED','CLOSED'].map(s=>(
              <MenuItem key={s} value={s}>{s.replace('_',' ')}</MenuItem>
          ))}
        </TextField>
      )
    },
    {field:'doc', headerName:'Req.', width:90,
      renderCell:({row})=>(
        <Tooltip title="Download requisition DOCX">
          <IconButton size="small" onClick={async()=>{
            const {data}=await downloadReqDoc(row.id);
            const url = URL.createObjectURL(data);
            const a=document.createElement('a');
            a.href=url; a.download=`requisition-${row.id}.docx`; a.click();
            URL.revokeObjectURL(url);
          }}>
            <DownloadIcon fontSize="small"/>
          </IconButton>
        </Tooltip>
      )
    }
  ];

/* ───── RENDER ───── */
  return (
    <Box>
      <Tabs value={tab} onChange={(_,v)=>setTab(v)} sx={{mb:2}}>
        <Tab label="Movements"/><Tab label="Headcount"/><Tab label="Vacancies"/>
      </Tabs>

      {/* MOVEMENTS */}
      {tab===0 && (
        <Paper sx={{p:2}}>
          <GridSafe key={eng.length}
            rows={eng} columns={engCols} pageSize={10}
            getRowId={r=>r.id} autoHeight/>
        </Paper>
      )}

      {/* HEADCOUNT */}
      {tab===1 && (
        <Paper sx={{p:2}}>
          <Box mb={2}>
            <TextField select size="small" value={gran}
              onChange={e=>setGran(e.target.value)}>
              <MenuItem value="month">Month</MenuItem>
              <MenuItem value="week">Week</MenuItem>
            </TextField>
          </Box>
          <GridSafe key={`hc-${gran}`}
            rows={hcRows}
            columns={hcCols}
            loading={hcLoad}
            pageSize={20}
            getRowId={r=>`${r.name}-${r.period}`}
            autoHeight/>
        </Paper>
      )}

      {/* VACANCIES */}
      {tab===2 && (
        <Paper sx={{p:2}}>
          <GridSafe key={vac.length}
            rows={vac} columns={vacCols} pageSize={10}
            getRowId={r=>r.id} autoHeight/>
        </Paper>
      )}
    </Box>
  );
}
