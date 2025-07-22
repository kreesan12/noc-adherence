/* ── frontend/src/pages/AgentsPage.jsx ───────────────────────── */
import { useEffect, useState, useMemo } from 'react'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  Box, Typography, Button, Dialog, DialogTitle, DialogContent,
  Stack, TextField, Checkbox, FormControlLabel, MenuItem, Select
} from '@mui/material'
import api from '../api'
import { listTeams, createTeam } from '../api/workforce'
import dayjs from 'dayjs'

export default function AgentsPage () {
  /* ─────────── state ───────────────────────────────────────── */
  const [agents, setAgents]   = useState([])
  const [teams,  setTeams]    = useState([])

  /* add-agent dialog */
  const [openAgent, setOpenAgent] = useState(false)
  const [agentForm, setAgentForm] = useState({
    fullName:'', email:'', role:'', standby:false,
    employeeNo:'', startDate:'', address:'', province:''
  })

  /* supervisors + team-admin (unchanged) */
  const [supers, setSupers]     = useState([])
  const [openSup, setOpenSup]   = useState(false)
  const [supForm, setSupForm]   = useState({ fullName:'', email:'', password:'' })

  const [openTeam, setOpenTeam] = useState(false)
  const [teamName, setTeamName] = useState('')

  /* filter */
  const [teamFilter, setTeamFilter] = useState('')

  /* ─────────── load once ───────────────────────────────────── */
  useEffect(() => {
    const fetch = async () => {
      const [{ data:agentRows }, { data:teamRows }, { data:supRows }] =
        await Promise.all([api.get('/agents'), listTeams(), api.get('/supervisors')])
      console.log('first agent keys →', Object.keys(agentRows[0]))
      setAgents(agentRows)
      setTeams(teamRows)
      setSupers(supRows)

      /* default role in dialog = first team */
      if (teamRows.length) {
        setAgentForm(f => ({ ...f, role: teamRows[0].name }))
      }
    }
    fetch().catch(console.error)
  }, [])

  /* ─────────── inline edit save ────────────────────────────── */
  const handleCellEditCommit = async ({ id, field, value }) => {
    if (!['employeeNo', 'startDate', 'province'].includes(field)) return
    try {
      await api.patch(`/agents/${id}`, { [field]: value || null })
      setAgents(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r))
    } catch (err) {
      console.error('PATCH /agents failed', err?.response?.data || err)
    }
  }

  /* filtered view */
  const viewRows = useMemo(() =>
    teamFilter ? agents.filter(a => a.role === teamFilter) : agents
  , [agents, teamFilter])

  /* ─────────── columns ─────────────────────────────────────── */
  const cols = [
    { field:'id', headerName:'ID', width:70 },
    { field:'fullName', headerName:'Name', flex:1 },
    { field:'email', headerName:'Email', flex:1 },
    { field:'role', headerName:'Team', width:160 },
    { field:'employeeNo', headerName:'Emp #', width:100, editable:true },
/*    {
      field:'startDate', headerName:'Start', width:110, editable:true,
      valueGetter: (params) => {
      const v = params?.row?.startDate               // <- guard everything
      return v ? String(v).slice(0, 10) : '—'        // show YYYY-MM-DD or em-dash
    }
    },*/
    {
      field: 'startDate',
      headerName: 'Start',
      width: 120,
      editable: true,
      renderCell: (params) =>
        params.value
          ? dayjs(params.value).format('YYYY-MM-DD')
          : '—',          // show em-dash when null / blank
    },
    { field:'province', headerName:'Province', width:120, editable:true },
    {
      field:'standbyFlag', headerName:'Stand-by', width:100,
      renderCell:p => (p.value ? '✅' : '—')
    }
  ]

  const supCols = [
    { field:'id',       headerName:'ID',    width:70 },
    { field:'fullName', headerName:'Name',  flex:1  },
    { field:'email',    headerName:'Email', flex:1  },
    { field:'role',     headerName:'Role',  width:130 }
  ]

  const teamCols = [
    { field:'id',   headerName:'ID',        width:70 },
    { field:'name', headerName:'Team Name', flex:1  }
  ]

  /* ─────────── create / update helpers (unchanged) ─────────── */
  const resetAgentForm = () => setAgentForm({
    fullName:'', email:'', role:teams[0]?.name || '', standby:false,
    employeeNo:'', startDate:'', address:'', province:''
  })

  const handleAgentSave = async () => {
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

  const handleRowUpdate = async (newRow, oldRow) => {
    // Only send the fields that changed and that the API accepts
    const allowed = ['employeeNo', 'startDate', 'province']
    const diff = Object.fromEntries(
      allowed
        .filter(k => newRow[k] !== oldRow[k])
        .map(k => [k, newRow[k] || null])
    )

    if (Object.keys(diff).length) {
      await api.patch(`/agents/${newRow.id}`, diff)
    }

    // Return the row the grid should store
    return newRow
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

  /* ─────────── render ──────────────────────────────────────── */
  return (
    <Box p={2}>

      {/* header row with filter + add button */}
      <Box sx={{display:'flex', alignItems:'center', mb:2}}>
        <Typography variant="h6" sx={{flexGrow:1}}>Agents</Typography>

        <Select
          value={teamFilter}
          onChange={e => setTeamFilter(e.target.value)}
          displayEmpty size="small" sx={{ mr:2, minWidth:160 }}
        >
          <MenuItem value=''><em>All teams</em></MenuItem>
          {teams.map(t => <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>)}
        </Select>

        <Button variant="contained" onClick={()=>setOpenAgent(true)}>
          + Add agent
        </Button>
      </Box>

      <DataGrid
        rows={viewRows}
        columns={cols}
        autoHeight
        editMode="cell"                 // keep cell editing
        processRowUpdate={handleRowUpdate}
        onProcessRowUpdateError={(e)=>console.error(e)}
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
        getRowId={(r) => r.id}
      />

      {/* add-agent dialog – only change is dynamic team list */}
      <Dialog open={openAgent} onClose={()=>setOpenAgent(false)}>
        <DialogTitle>New agent</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:340 }}>
            <TextField label="Full name" required
              value={agentForm.fullName}
              onChange={e=>setAgentForm({...agentForm, fullName:e.target.value})}/>
            <TextField label="Email" type="email" required
              value={agentForm.email}
              onChange={e=>setAgentForm({...agentForm, email:e.target.value})}/>
            <TextField label="Team" select
              value={agentForm.role}
              onChange={e=>setAgentForm({...agentForm, role:e.target.value})}>
              {teams.map(t => <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>)}
            </TextField>

            <TextField label="Employee #"
              value={agentForm.employeeNo}
              onChange={e=>setAgentForm({...agentForm, employeeNo:e.target.value})}/>
            <TextField label="Start date" type="date" InputLabelProps={{shrink:true}}
              value={agentForm.startDate}
              onChange={e=>setAgentForm({...agentForm, startDate:e.target.value})}/>
            <TextField label="Province"
              value={agentForm.province}
              onChange={e=>setAgentForm({...agentForm, province:e.target.value})}/>

            <FormControlLabel control={
              <Checkbox checked={agentForm.standby}
                        onChange={e=>setAgentForm({...agentForm,
                                                   standby:e.target.checked})}/> }
              label="Stand-by rota"/>
            <Button variant="contained" onClick={handleAgentSave}>Save</Button>
          </Stack>
        </DialogContent>
      </Dialog>

      {/* SUPERVISORS GRID (unchanged) */}
      <Box p={2}>

        <Box sx={{display:'flex', alignItems:'center', mb:2}}>
          <Typography variant="h6" sx={{flexGrow:1}}>Supervisors</Typography>
          <Button variant="contained" sx={{ mb:2 }} onClick={()=>setOpenSup(true)}>
            + Add supervisor
          </Button>
        </Box>
      <DataGrid
        rows={supers}
        columns={supCols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
      />

      {/* Add-supervisor dialog (unchanged) */}
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
      </Box>

      {/* TEAMS GRID (unchanged) */}
      <Box p={2}>

        <Box sx={{display:'flex', alignItems:'center', mb:2}}>
          <Typography variant="h6" sx={{flexGrow:1}}>Teams</Typography>
          <Button variant="contained" sx={{ mb:2 }} onClick={()=>setOpenTeam(true)}>
            + Add team
          </Button>
        </Box>

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
    </Box>
  )
}

