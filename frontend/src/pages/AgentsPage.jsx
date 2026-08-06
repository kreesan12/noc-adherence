import { useEffect, useMemo, useState } from 'react'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography
} from '@mui/material'
import dayjs from 'dayjs'
import api from '../api'
import { createTeam, listTeams } from '../api/workforce'
import AssignTab from '../components/AssignTab'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

function fmtCount(value) {
  return new Intl.NumberFormat().format(Number(value || 0))
}

export default function AgentsPage() {
  const [agents, setAgents] = useState([])
  const [teams, setTeams] = useState([])
  const [supers, setSupers] = useState([])

  const [openAgent, setOpenAgent] = useState(false)
  const [agentForm, setAgentForm] = useState({
    fullName: '',
    email: '',
    role: '',
    standby: false,
    employeeNo: '',
    startDate: '',
    address: '',
    province: ''
  })

  const [openSup, setOpenSup] = useState(false)
  const [supForm, setSupForm] = useState({ fullName: '', email: '', password: '' })

  const [openTeam, setOpenTeam] = useState(false)
  const [teamName, setTeamName] = useState('')

  const [teamFilter, setTeamFilter] = useState('')
  const [tab, setTab] = useState(0)

  useEffect(() => {
    ;(async () => {
      const [{ data: agentRows }, { data: teamRows }, { data: supRows }] = await Promise.all([
        api.get('/agents'),
        listTeams(),
        api.get('/supervisors')
      ])

      setAgents(agentRows)
      setTeams(teamRows)
      setSupers(supRows)

      if (teamRows.length) {
        setAgentForm((form) => ({ ...form, role: teamRows[0].name }))
      }
    })().catch(console.error)
  }, [])

  const handleRowUpdate = async (newRow, oldRow) => {
    const allowed = ['employeeNo', 'startDate', 'province']
    const diff = Object.fromEntries(
      allowed
        .filter((key) => newRow[key] !== oldRow[key])
        .map((key) => [key, newRow[key] || null])
    )

    try {
      if (Object.keys(diff).length) {
        await api.patch(`/agents/${newRow.id}`, diff)
        const { data } = await api.get('/agents')
        setAgents(data)
      }
      return newRow
    } catch (error) {
      console.error(error)
      throw error
    }
  }

  const resetAgentForm = () => setAgentForm({
    fullName: '',
    email: '',
    role: teams[0]?.name || '',
    standby: false,
    employeeNo: '',
    startDate: '',
    address: '',
    province: ''
  })

  const handleAgentSave = async () => {
    await api.post('/agents', {
      fullName: agentForm.fullName,
      email: agentForm.email,
      role: agentForm.role,
      standby: agentForm.standby,
      employeeNo: agentForm.employeeNo,
      startDate: agentForm.startDate || null,
      address: agentForm.address,
      province: agentForm.province
    })
    setAgents((await api.get('/agents')).data)
    setOpenAgent(false)
    resetAgentForm()
  }

  const handleSupSave = async () => {
    await api.post('/supervisors', supForm)
    setSupers((await api.get('/supervisors')).data)
    setOpenSup(false)
    setSupForm({ fullName: '', email: '', password: '' })
  }

  const handleTeamSave = async () => {
    if (!teamName.trim()) return
    await createTeam(teamName.trim())
    setTeams((await listTeams()).data)
    setOpenTeam(false)
    setTeamName('')
  }

  const viewRows = useMemo(
    () => (teamFilter ? agents.filter((agent) => agent.role === teamFilter) : agents),
    [agents, teamFilter]
  )

  const stats = useMemo(() => {
    const standby = agents.filter((agent) => agent.standbyFlag || agent.standby).length
    return [
      { label: 'Agents', value: fmtCount(agents.length), helper: teamFilter || 'All teams' },
      { label: 'Supervisors', value: fmtCount(supers.length), helper: 'Current login owners', accent: '#2563eb' },
      { label: 'Teams', value: fmtCount(teams.length), helper: 'Available roster groups', accent: '#7c3aed' },
      { label: 'Stand-by', value: fmtCount(standby), helper: 'Flagged for rota support', accent: '#f59e0b' }
    ]
  }, [agents, supers.length, teamFilter, teams.length])

  const agentCols = [
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'fullName', headerName: 'Name', flex: 1, minWidth: 180 },
    { field: 'email', headerName: 'Email', flex: 1, minWidth: 220 },
    { field: 'role', headerName: 'Team', width: 150 },
    { field: 'employeeNo', headerName: 'Emp #', width: 90, editable: true },
    {
      field: 'startDate',
      headerName: 'Start',
      width: 120,
      editable: true,
      renderCell: (params) => (params.value ? dayjs(params.value).format('YYYY-MM-DD') : '-')
    },
    { field: 'province', headerName: 'Province', width: 110, editable: true },
    {
      field: 'standbyFlag',
      headerName: 'Stand-by',
      width: 96,
      renderCell: (params) => (params.value ? 'Yes' : '-')
    }
  ]

  const supCols = [
    { field: 'id', width: 70 },
    { field: 'fullName', flex: 1, minWidth: 160, headerName: 'Name' },
    { field: 'email', flex: 1, minWidth: 200, headerName: 'Email' },
    { field: 'role', width: 120, headerName: 'Role' }
  ]

  const teamCols = [
    { field: 'id', width: 70, headerName: 'ID' },
    { field: 'name', flex: 1, minWidth: 180, headerName: 'Team Name' }
  ]

  return (
    <PageShell
      eyebrow="Settings"
      title="People And Team Control"
      description="Manage agents, supervisors, and team structures from one operational page, then switch into assignment mode to align supervisors against live staff groups."
      accent="#7c3aed"
      stats={stats}
      actions={
        <Tabs
          value={tab}
          onChange={(_, value) => setTab(value)}
          sx={{
            minHeight: 34,
            '& .MuiTab-root': { minHeight: 34 }
          }}
        >
          <Tab label="Agents and Teams" />
          <Tab label="Assign Supervisors" />
        </Tabs>
      }
    >
      {tab === 0 ? (
        <Box sx={{ display: 'grid', gap: 1.05 }}>
          <SectionCard
            title="Agent Register"
            subtitle="Maintain the core roster, edit employee metadata inline, and keep team membership clean."
            accent="#7c3aed"
            actions={
              <Stack direction="row" spacing={0.7} flexWrap="wrap">
                <Button variant="contained" onClick={() => setOpenAgent(true)}>
                  Add Agent
                </Button>
              </Stack>
            }
            noPadding
          >
            <Box sx={{ p: 1.05, display: 'grid', gap: 0.95 }}>
              <FilterStrip>
                <TextField
                  select
                  label="Team filter"
                  value={teamFilter}
                  onChange={(event) => setTeamFilter(event.target.value)}
                  sx={{ minWidth: 180 }}
                >
                  <MenuItem value="">All teams</MenuItem>
                  {teams.map((teamRow) => (
                    <MenuItem key={teamRow.id} value={teamRow.name}>{teamRow.name}</MenuItem>
                  ))}
                </TextField>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {fmtCount(viewRows.length)} agents shown
                </Typography>
              </FilterStrip>

              <DataGrid
                rows={viewRows}
                columns={agentCols}
                autoHeight
                editMode="cell"
                processRowUpdate={handleRowUpdate}
                onProcessRowUpdateError={console.error}
                disableRowSelectionOnClick
                slots={{ toolbar: GridToolbar }}
                slotProps={{ toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 250 } } }}
                getRowId={(row) => row.id}
                initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                pageSizeOptions={[25, 50, 100]}
              />
            </Box>
          </SectionCard>

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', xl: '1fr 0.9fr' }, gap: 1.05 }}>
            <SectionCard
              title="Supervisors"
              subtitle="Current supervisor accounts used for operational oversight."
              accent="#2563eb"
              actions={<Button variant="contained" onClick={() => setOpenSup(true)}>Add Supervisor</Button>}
              noPadding
            >
              <Box sx={{ p: 1.05 }}>
                <DataGrid
                  rows={supers}
                  columns={supCols}
                  autoHeight
                  disableRowSelectionOnClick
                  slots={{ toolbar: GridToolbar }}
                  slotProps={{ toolbar: { showQuickFilter: true, quickFilterProps: { debounceMs: 250 } } }}
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  pageSizeOptions={[10, 25, 50]}
                />
              </Box>
            </SectionCard>

            <SectionCard
              title="Teams"
              subtitle="The source list used across workforce planning, staffing, and adherence filters."
              accent="#0f766e"
              actions={<Button variant="contained" onClick={() => setOpenTeam(true)}>Add Team</Button>}
              noPadding
            >
              <Box sx={{ p: 1.05 }}>
                <DataGrid
                  rows={teams}
                  columns={teamCols}
                  autoHeight
                  disableRowSelectionOnClick
                  initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
                  pageSizeOptions={[10, 25, 50]}
                />
              </Box>
            </SectionCard>
          </Box>
        </Box>
      ) : (
        <SectionCard
          title="Supervisor Assignment Board"
          subtitle="Drag staff into the right supervisory lanes and refresh the people model without leaving the page."
          accent="#7c3aed"
        >
          <AssignTab
            agents={agents}
            supers={supers}
            refreshAgents={async () => setAgents((await api.get('/agents')).data)}
          />
        </SectionCard>
      )}

      <Dialog open={openAgent} onClose={() => setOpenAgent(false)}>
        <DialogTitle>New agent</DialogTitle>
        <DialogContent>
          <Stack spacing={1.05} sx={{ mt: 1, width: 340 }}>
            <TextField
              label="Full name"
              required
              value={agentForm.fullName}
              onChange={(event) => setAgentForm({ ...agentForm, fullName: event.target.value })}
            />
            <TextField
              label="Email"
              type="email"
              required
              value={agentForm.email}
              onChange={(event) => setAgentForm({ ...agentForm, email: event.target.value })}
            />
            <TextField
              label="Team"
              select
              value={agentForm.role}
              onChange={(event) => setAgentForm({ ...agentForm, role: event.target.value })}
            >
              {teams.map((teamRow) => (
                <MenuItem key={teamRow.id} value={teamRow.name}>{teamRow.name}</MenuItem>
              ))}
            </TextField>
            <TextField
              label="Employee #"
              value={agentForm.employeeNo}
              onChange={(event) => setAgentForm({ ...agentForm, employeeNo: event.target.value })}
            />
            <TextField
              label="Start date"
              type="date"
              InputLabelProps={{ shrink: true }}
              value={agentForm.startDate}
              onChange={(event) => setAgentForm({ ...agentForm, startDate: event.target.value })}
            />
            <TextField
              label="Province"
              value={agentForm.province}
              onChange={(event) => setAgentForm({ ...agentForm, province: event.target.value })}
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={agentForm.standby}
                  onChange={(event) => setAgentForm({ ...agentForm, standby: event.target.checked })}
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

      <Dialog open={openSup} onClose={() => setOpenSup(false)}>
        <DialogTitle>New supervisor</DialogTitle>
        <DialogContent>
          <Stack spacing={1.05} sx={{ mt: 1, width: 320 }}>
            <TextField
              label="Full name"
              required
              value={supForm.fullName}
              onChange={(event) => setSupForm({ ...supForm, fullName: event.target.value })}
            />
            <TextField
              label="Email"
              type="email"
              required
              value={supForm.email}
              onChange={(event) => setSupForm({ ...supForm, email: event.target.value })}
            />
            <TextField
              label="Password"
              type="password"
              required
              value={supForm.password}
              onChange={(event) => setSupForm({ ...supForm, password: event.target.value })}
            />
            <Button variant="contained" onClick={handleSupSave}>
              Save
            </Button>
          </Stack>
        </DialogContent>
      </Dialog>

      <Dialog open={openTeam} onClose={() => setOpenTeam(false)}>
        <DialogTitle>New team</DialogTitle>
        <DialogContent>
          <Box sx={{ mt: 1, width: 320 }}>
            <TextField
              label="Team name"
              fullWidth
              required
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
            />
            <Button variant="contained" sx={{ mt: 1.2 }} onClick={handleTeamSave}>
              Save
            </Button>
          </Box>
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}
