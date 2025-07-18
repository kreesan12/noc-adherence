/* frontend/src/pages/AgentsPage.jsx */
import { useEffect, useState } from 'react'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent,
  Stack, TextField, Checkbox, FormControlLabel, MenuItem
} from '@mui/material'

import api                                from '../api'
import { listTeams, createTeam }          from '../api/workforce'

/* ── single canonical list – keep in one place ─────────────────────── */
const ROLES = ['NOC Tier 1', 'NOC Tier 2', 'NOC Tier 3']

/* =================================================================== */
export default function AgentsPage () {
/* ─────────────── STATE ───────────────────────────────────────────── */
  /** Agents grid + add-dialog                                   */
  const [agents, setAgents]       = useState([])
  const [openAgent, setOpenAgent] = useState(false)
  const [agentForm, setAgentForm] = useState({
    fullName  : '',   email:'',     role:ROLES[0], standby:false,
    employeeNo: '',   startDate:'', address:'',    province:''
  })

  /** Supervisors grid + dialog  (unchanged)                     */
  const [supers, setSupers]     = useState([])
  const [openSup, setOpenSup]   = useState(false)
  const [supForm, setSupForm]   = useState({ fullName:'', email:'', password:'' })

  /** Teams grid + dialog (unchanged)                            */
  const [teams, setTeams]       = useState([])
  const [openTeam, setOpenTeam] = useState(false)
  const [teamName, setTeamName] = useState('')

/* ─────────────── LOAD LOOK-UPS ONCE ─────────────────────────────── */
  useEffect(() => {
    api.get('/agents').then(r => setAgents(r.data))
    api.get('/supervisors').then(r => setSupers(r.data))
    listTeams().then(r => setTeams(r.data))
  }, [])

/* ─────────────── GRID COLUMNS ───────────────────────────────────── */
  const agentCols = [
    { field:'id',         headerName:'ID',       width:70  },
    { field:'fullName',   headerName:'Name',     flex:1    },
    { field:'email',      headerName:'Email',    flex:1    },
    { field:'role',       headerName:'Role',     width:130 },
    { field:'employeeNo', headerName:'Emp #',    width:90  },
    { field:'startDate',  headerName:'Start',    width:110,
      valueGetter:p => p.row.startDate?.slice(0,10) || '—' },
    { field:'province',   headerName:'Province', width:110 },
    {
      field:'standbyFlag', headerName:'Stand-by', width:100,
      renderCell:p => (p.value ? '✅' : '—')
    }
  ]

  const supCols  = [
    { field:'id',       headerName:'ID',    width:70 },
    { field:'fullName', headerName:'Name',  flex:1  },
    { field:'email',    headerName:'Email', flex:1  },
    { field:'role',     headerName:'Role',  width:130 }
  ]

  const teamCols = [
    { field:'id',   headerName:'ID',        width:70 },
    { field:'name', headerName:'Team Name', flex:1  }
  ]

/* ─────────────── HELPERS / HANDLERS ─────────────────────────────── */
  const resetAgentForm = () => setAgentForm({
    fullName:'', email:'', role:ROLES[0], standby:false,
    employeeNo:'', startDate:'', address:'', province:''
  })

  /* save new agent (or re-load list) */
  async function handleAgentSave () {
    await api.post('/agents', {
      fullName  : agentForm.fullName,
      email     : agentForm.email,
      role      : agentForm.role,
      standby   : agentForm.standby,
      employeeNo: agentForm.employeeNo,
      startDate : agentForm.startDate || null,
      address   : agentForm.address,
      province  : agentForm.province
    })
    setAgents((await api.get('/agents')).data)
    setOpenAgent(false)
    resetAgentForm()
  }

  async function handleSupSave () {
    await api.post('/supervisors', supForm)
    setSupers((await api.get('/supervisors')).data)
    setOpenSup(false)
    setSupForm({ fullName:'', email:'', password:'' })
  }

  async function handleTeamSave () {
    if (!teamName.trim()) return
    await createTeam(teamName.trim())
    setTeams((await listTeams()).data)
    setOpenTeam(false)
    setTeamName('')
  }

/* ─────────────── RENDER ─────────────────────────────────────────── */
  return (
    <Box p={2}>

      {/* ── AGENTS GRID ─────────────────────────────────────────── */}
      <Typography variant="h6" gutterBottom>Agents</Typography>
      <Button variant="contained" sx={{ mb:2 }} onClick={()=>setOpenAgent(true)}>
        + Add agent
      </Button>
      <DataGrid
        rows={agents}
        columns={agentCols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
      />

      {/* ── ADD-AGENT DIALOG ───────────────────────────────────── */}
      <Dialog open={openAgent} onClose={()=>setOpenAgent(false)}>
        <DialogTitle>New agent</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:340 }}>

            {/* basic details */}
            <TextField label="Full name" required
              value={agentForm.fullName}
              onChange={e=>setAgentForm({...agentForm, fullName:e.target.value})}
            />
            <TextField label="Email" type="email" required
              value={agentForm.email}
              onChange={e=>setAgentForm({...agentForm, email:e.target.value})}
            />
            <TextField label="Role" select
              value={agentForm.role}
              onChange={e=>setAgentForm({...agentForm, role:e.target.value})}
            >
              {ROLES.map(r => <MenuItem key={r} value={r}>{r}</MenuItem>)}
            </TextField>

            {/* new HR fields */}
            <TextField label="Employee #"
              value={agentForm.employeeNo}
              onChange={e=>setAgentForm({...agentForm, employeeNo:e.target.value})}
            />
            <TextField
              label="Start date" type="date" InputLabelProps={{ shrink:true }}
              value={agentForm.startDate}
              onChange={e=>setAgentForm({...agentForm, startDate:e.target.value})}
            />
            <TextField label="Address"
              value={agentForm.address}
              onChange={e=>setAgentForm({...agentForm, address:e.target.value})}
            />
            <TextField label="Province"
              value={agentForm.province}
              onChange={e=>setAgentForm({...agentForm, province:e.target.value})}
            />

            <FormControlLabel
              control={
                <Checkbox
                  checked={agentForm.standby}
                  onChange={e=>setAgentForm({...agentForm, standby:e.target.checked})}
                />
              }
              label="Stand-by rota"
            />

            <Button variant="contained" onClick={handleAgentSave}>Save</Button>
          </Stack>
        </DialogContent>
      </Dialog>

      {/* ── SUPERVISORS (unchanged) ────────────────────────────── */}
      <Typography variant="h6" gutterBottom sx={{ mt:4 }}>Supervisors</Typography>
      <Button variant="contained" sx={{ mb:2 }} onClick={()=>setOpenSup(true)}>
        + Add supervisor
      </Button>
      <DataGrid
        rows={supers}
        columns={supCols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
      />
      <Dialog open={openSup} onClose={()=>setOpenSup(false)}>
        <DialogTitle>New supervisor</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:320 }}>
            <TextField label="Full name" required
              value={supForm.fullName}
              onChange={e=>setSupForm({...supForm, fullName:e.target.value})}
            />
            <TextField label="Email" type="email" required
              value={supForm.email}
              onChange={e=>setSupForm({...supForm, email:e.target.value})}
            />
            <TextField label="Password" type="password" required
              value={supForm.password}
              onChange={e=>setSupForm({...supForm, password:e.target.value})}
            />
            <Button variant="contained" onClick={handleSupSave}>Save</Button>
          </Stack>
        </DialogContent>
      </Dialog>

      {/* ── TEAMS (unchanged) ─────────────────────────────────── */}
      <Typography variant="h6" gutterBottom sx={{ mt:4 }}>Teams</Typography>
      <Button variant="contained" sx={{ mb:2 }} onClick={()=>setOpenTeam(true)}>
        + Add team
      </Button>
      <DataGrid
        rows={teams}
        columns={teamCols}
        autoHeight
        disableRowSelectionOnClick
      />
      <Dialog open={openTeam} onClose={()=>setOpenTeam(false)}>
        <DialogTitle>New team</DialogTitle>
        <DialogContent>
          <Box sx={{ mt:1, width:320 }}>
            <TextField label="Team name" fullWidth required
              value={teamName}
              onChange={e=>setTeamName(e.target.value)}
            />
            <Button variant="contained" sx={{ mt:2 }} onClick={handleTeamSave}>
              Save
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
