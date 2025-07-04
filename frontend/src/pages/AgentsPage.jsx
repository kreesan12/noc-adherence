// frontend/src/pages/AgentsPage.jsx
import { useEffect, useState } from 'react'
import {
  DataGrid,
  GridToolbar,
} from '@mui/x-data-grid'
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

export default function AgentsPage() {
  // agents state & dialog
  const [agents, setAgents]     = useState([])
  const [openAgent, setOpenAgent] = useState(false)
  const [agentForm, setAgentForm] = useState({
    fullName:'', email:'', role:'NOC-I', standby:false
  })

  // supervisors state & dialog
  const [supers, setSupers]     = useState([])
  const [openSup, setOpenSup]   = useState(false)
  const [supForm, setSupForm]   = useState({
    fullName:'', email:'', password:''
  })

  // Fetch both lists on mount
  useEffect(() => {
    api.get('/agents').then(r => setAgents(r.data))
    api.get('/supervisors').then(r => setSupers(r.data))
  }, [])

  // Agent grid columns
  const agentCols = [
    { field:'id',       headerName:'ID',      width:70 },
    { field:'fullName', headerName:'Name',    flex:1  },
    { field:'email',    headerName:'Email',   flex:1  },
    { field:'role',     headerName:'Role',    width:110 },
    {
      field: 'standbyFlag',
      headerName: 'Stand-by',
      width: 110,
      // just look at the cell value, no row dereferencing
      renderCell: params => (params.value ? '✅' : '—')
    },
  ]

  // Supervisor grid columns
  const supCols = [
    { field:'id',       headerName:'ID',    width:70 },
    { field:'fullName', headerName:'Name',  flex:1  },
    { field:'email',    headerName:'Email', flex:1  },
    { field:'role',     headerName:'Role',  width:130 }
  ]

  // Save new agent
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
  }

  // Save new supervisor
  async function handleSupSave() {
    await api.post('/supervisors', {
      fullName: supForm.fullName,
      email:    supForm.email,
      password: supForm.password
    })
    const { data } = await api.get('/supervisors')
    setSupers(data)
    setOpenSup(false)
  }

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Agents
      </Typography>
      <Button
        variant="contained"
        sx={{ mb:2 }}
        onClick={()=>setOpenAgent(true)}
      >
        + Add agent
      </Button>
      <DataGrid
        rows={agents}
        columns={agentCols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar:GridToolbar }}
      />

      <Dialog open={openAgent} onClose={()=>setOpenAgent(false)}>
        <DialogTitle>New agent</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:320 }}>
            <TextField  label="Full name" value={agentForm.fullName} required
              onChange={e=>setAgentForm({ ...agentForm, fullName:e.target.value })}/>
            <TextField  label="Email" type="email" value={agentForm.email} required
              onChange={e=>setAgentForm({ ...agentForm, email:e.target.value })}/>
            <TextField  label="Role" select value={agentForm.role}
              onChange={e=>setAgentForm({ ...agentForm, role:e.target.value })}>
              {['NOC-I','NOC-II','NOC-III'].map(r=>
                <MenuItem key={r} value={r}>{r}</MenuItem>
              )}
            </TextField>
            <FormControlLabel control={
              <Checkbox
                checked={agentForm.standby}
                onChange={e=>setAgentForm({ ...agentForm, standby:e.target.checked })}
              />
            } label="Stand-by rota"/>
            <Button variant="contained" onClick={handleAgentSave}>
              Save
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>

      {/* ─────────────────────────────────────────────────────────────── */}

      <Typography variant="h6" gutterBottom sx={{ mt:4 }}>
        Supervisors
      </Typography>
      <Button
        variant="contained"
        sx={{ mb:2 }}
        onClick={()=>setOpenSup(true)}
      >
        + Add supervisor
      </Button>
      <DataGrid
        rows={supers}
        columns={supCols}
        autoHeight
        disableRowSelectionOnClick
        slots={{ toolbar:GridToolbar }}
      />

      <Dialog open={openSup} onClose={()=>setOpenSup(false)}>
        <DialogTitle>New supervisor</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt:1, width:320 }}>
            <TextField  label="Full name" value={supForm.fullName} required
              onChange={e=>setSupForm({ ...supForm, fullName:e.target.value })}/>
            <TextField  label="Email" type="email" value={supForm.email} required
              onChange={e=>setSupForm({ ...supForm, email:e.target.value })}/>
            <TextField  label="Password" type="password" value={supForm.password} required
              onChange={e=>setSupForm({ ...supForm, password:e.target.value })}/>
            <Button variant="contained" onClick={handleSupSave}>
              Save
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>
    </Box>
  )
}
