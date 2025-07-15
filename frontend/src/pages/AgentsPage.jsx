// frontend/src/pages/AgentsPage.jsx
import { useEffect, useState } from 'react'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  Stack,
  TextField,
  Checkbox,
  FormControlLabel,
  MenuItem
} from '@mui/material'
import api from '../api'
import { listTeams, createTeam } from '../api/workforce'  // ← teams API

/* ─── shared roles list ────────────────────────────────────── */
const ROLES = ['NOC Tier 1', 'NOC Tier 2', 'NOC Tier 3']

export default function AgentsPage() {
  /* ─── state ──────────────────────────────────────────────── */
  // agents
  const [agents, setAgents]       = useState([])
  const [openAgent, setOpenAgent] = useState(false)
  const [agentForm, setAgentForm] = useState({
    fullName: '', email: '', role: ROLES[0], standby: false
  })

  // supervisors
  const [supers, setSupers]     = useState([])
  const [openSup, setOpenSup]   = useState(false)
  const [supForm, setSupForm]   = useState({
    fullName: '', email: '', password: ''
  })

  // teams
  const [teams, setTeams]       = useState([])
  const [openTeam, setOpenTeam] = useState(false)
  const [teamName, setTeamName] = useState('')

  /* ─── load data on mount ─────────────────────────────────── */
  useEffect(() => {
    api.get('/agents').then(r => setAgents(r.data))
    api.get('/supervisors').then(r => setSupers(r.data))
    listTeams().then(r => setTeams(r.data))
  }, [])

  /* ─── grid definitions ───────────────────────────────────── */
  const agentCols = [
    { field: 'id',       headerName: 'ID',     width: 70 },
    { field: 'fullName', headerName: 'Name',   flex: 1  },
    { field: 'email',    headerName: 'Email',  flex: 1  },
    { field: 'role',     headerName: 'Role',   width: 130 },
    {
      field: 'standbyFlag',
      headerName: 'Stand-by',
      width: 110,
      renderCell: params => (params.value ? '✅' : '—')
    }
  ]

  const supCols = [
    { field: 'id',       headerName: 'ID',    width: 70 },
    { field: 'fullName', headerName: 'Name',  flex: 1  },
    { field: 'email',    headerName: 'Email', flex: 1  },
    { field: 'role',     headerName: 'Role',  width: 130 }
  ]

  const teamCols = [
    { field: 'id',   headerName: 'ID',       width: 70 },
    { field: 'name', headerName: 'Team Name', flex: 1 }
  ]

  /* ─── handlers ───────────────────────────────────────────── */
  async function handleAgentSave() {
    await api.post('/agents', {
      fullName: agentForm.fullName,
      email:    agentForm.email,
      role:     agentForm.role,
      standby:  agentForm.standby
    })
    const { data } = await api.get('/agents')
    setAgents(data)
    setOpenAgent(false)
    setAgentForm({ fullName:'', email:'', role:ROLES[0], standby:false })
  }

  async function handleSupSave() {
    await api.post('/supervisors', {
      fullName: supForm.fullName,
      email:    supForm.email,
      password: supForm.password
    })
    const { data } = await api.get('/supervisors')
    setSupers(data)
    setOpenSup(false)
    setSupForm({ fullName:'', email:'', password:'' })
  }

  async function handleTeamSave() {
    if (!teamName.trim()) return
    await createTeam(teamName.trim())
    const { data } = await listTeams()
    setTeams(data)
    setOpenTeam(false)
    setTeamName('')
  }

  /* ─── render ─────────────────────────────────────────────── */
  return (
    <Box p={2}>
      {/* ── Agents ──────────────────────────────────────────── */}
      <Typography variant="h6" gutterBottom>
        Agents
      </Typography>
      <Button
        variant="contained"
        sx={{ mb: 2 }}
        onClick={() => setOpenAgent(true)}
      >
        + Add agent
      </Button>
      <DataGrid
        rows={agents}
        columns={agentCols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
      />

      {/* Add-agent dialog */}
      <Dialog open={openAgent} onClose={() => setOpenAgent(false)}>
        <DialogTitle>New agent</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1, width: 320 }}>
            <TextField
              label="Full name"
              value={agentForm.fullName}
              onChange={e => setAgentForm({ ...agentForm, fullName: e.target.value })}
              required
            />
            <TextField
              label="Email"
              type="email"
              value={agentForm.email}
              onChange={e => setAgentForm({ ...agentForm, email: e.target.value })}
              required
            />
            <TextField
              label="Role"
              select
              value={agentForm.role}
              onChange={e => setAgentForm({ ...agentForm, role: e.target.value })}
            >
              {ROLES.map(r => (
                <MenuItem key={r} value={r}>{r}</MenuItem>
              ))}
            </TextField>
            <FormControlLabel
              control={
                <Checkbox
                  checked={agentForm.standby}
                  onChange={e => setAgentForm({ ...agentForm, standby: e.target.checked })}
                />
              }
              label="Stand-by rota"
            />
            <Button variant="contained" onClick={handleAgentSave}>
              Save
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>

      {/* ── Supervisors ─────────────────────────────────────── */}
      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        Supervisors
      </Typography>
      <Button
        variant="contained"
        sx={{ mb: 2 }}
        onClick={() => setOpenSup(true)}
      >
        + Add supervisor
      </Button>
      <DataGrid
        rows={supers}
        columns={supCols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar: GridToolbar }}
      />

      {/* Add-supervisor dialog */}
      <Dialog open={openSup} onClose={() => setOpenSup(false)}>
        <DialogTitle>New supervisor</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1, width: 320 }}>
            <TextField
              label="Full name"
              value={supForm.fullName}
              onChange={e => setSupForm({ ...supForm, fullName: e.target.value })}
              required
            />
            <TextField
              label="Email"
              type="email"
              value={supForm.email}
              onChange={e => setSupForm({ ...supForm, email: e.target.value })}
              required
            />
            <TextField
              label="Password"
              type="password"
              value={supForm.password}
              onChange={e => setSupForm({ ...supForm, password: e.target.value })}
              required
            />
            <Button variant="contained" onClick={handleSupSave}>
              Save
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>

      {/* ── Teams ─────────────────────────────────────────────── */}
      <Typography variant="h6" gutterBottom sx={{ mt: 4 }}>
        Teams
      </Typography>
      <Button
        variant="contained"
        sx={{ mb: 2 }}
        onClick={() => setOpenTeam(true)}
      >
        + Add team
      </Button>
      <DataGrid
        rows={teams}
        columns={teamCols}
        autoHeight
        disableRowSelectionOnClick
      />

      {/* Add-team dialog */}
      <Dialog open={openTeam} onClose={() => setOpenTeam(false)}>
        <DialogTitle>New team</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, width: 320 }}>
            <TextField
              label="Team name"
              fullWidth
              value={teamName}
              onChange={e => setTeamName(e.target.value)}
              required
            />
            <Button
              variant="contained"
              onClick={handleTeamSave}
              sx={{ mt: 2 }}
            >
              Save
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
