/* ── frontend/src/pages/AgentsPage.jsx ───────────────────────── */
import { useEffect, useMemo, useState } from 'react'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import {
  Box, Button, Checkbox, Dialog, DialogContent, DialogTitle, FormControlLabel,
  MenuItem, Select, Stack, Tab, Tabs, TextField, Typography
} from '@mui/material'
import dayjs from 'dayjs'

import api from '../api'
import { listTeams, createTeam } from '../api/workforce'
import AssignTab from '../components/AssignTab'

export default function AgentsPage () {
  /* ─────────── state ───────────────────────────────────────── */
  const [agents, setAgents] = useState([])
  const [teams, setTeams]   = useState([])

  /* add-agent dialog */
  const [openAgent, setOpenAgent] = useState(false)
  const [agentForm, setAgentForm] = useState({
    fullName: '', email: '', role: '', standby: false,
    employeeNo: '', startDate: '', address: '', province: ''
  })

  /* supervisors */
  const [supers, setSupers]       = useState([])
  const [openSup, setOpenSup]     = useState(false)
  const [supForm, setSupForm]     = useState({ fullName: '', email: '', password: '' })

  /* teams dialog */
  const [openTeam, setOpenTeam] = useState(false)
  const [teamName, setTeamName] = useState('')

  /* filters + tab */
  const [teamFilter, setTeamFilter] = useState('')
  const [tab, setTab] = useState(0)                     // 0 = Agents grid, 1 = Assign tab

  /* ─────────── load once ───────────────────────────────────── */
  useEffect(() => {
    ;(async () => {
      const [{ data: agentRows }, { data: teamRows }, { data: supRows }] =
        await Promise.all([
          api.get('/agents'),
          listTeams(),
          api.get('/supervisors')
        ])

      setAgents(agentRows)
      setTeams(teamRows)
      setSupers(supRows)

      /* default role in dialog = first team */
      if (teamRows.length) {
        setAgentForm(f => ({ ...f, role: teamRows[0].name }))
      }
    })().catch(console.error)
  }, [])

  /* ─────────── row-edit save (MUI v6) ──────────────────────── */
  const handleRowUpdate = async (newRow, oldRow) => {
    const allowed = ['employeeNo', 'startDate', 'province']
    const diff = Object.fromEntries(
      allowed
        .filter(k => newRow[k] !== oldRow[k])
        .map(k => [k, newRow[k] || null])
    )

    try {
      if (Object.keys(diff).length) {
        await api.patch(`/agents/${newRow.id}`, diff)
        /* refresh list so other tabs stay in sync */
        const { data } = await api.get('/agents')
        setAgents(data)
      }
      return newRow
    } catch (err) {
      console.error(err)
      throw err
    }
  }

  /* ─────────── helpers ─────────────────────────────────────── */
  const resetAgentForm = () => setAgentForm({
    fullName: '', email: '', role: teams[0]?.name || '', standby: false,
    employeeNo: '', startDate: '', address: '', province: ''
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

  /* ─────────── filtered rows ───────────────────────────────── */
  const viewRows = useMemo(
    () => (teamFilter ? agents.filter(a => a.role === teamFilter) : agents),
    [agents, teamFilter]
  )

  /* ─────────── column defs ─────────────────────────────────── */
  const cols = [
    { field: 'id', headerName: 'ID', width: 70 },
    { field: 'fullName', headerName: 'Name', flex: 1 },
    { field: 'email', headerName: 'Email', flex: 1 },
    { field: 'role', headerName: 'Team', width: 160 },
    { field: 'employeeNo', headerName: 'Emp #', width: 100, editable: true },
    {
      field: 'startDate',
      headerName: 'Start',
      width: 120,
      editable: true,
      renderCell: p =>
        p.value ? dayjs(p.value).format('YYYY-MM-DD') : '—'
    },
    { field: 'province', headerName: 'Province', width: 120, editable: true },
    {
      field: 'standbyFlag',
      headerName: 'Stand-by',
      width: 100,
      renderCell: p => (p.value ? '✅' : '—')
    }
  ]

  const supCols = [
    { field: 'id', width: 70 },
    { field: 'fullName', flex: 1, headerName: 'Name' },
    { field: 'email', flex: 1 },
    { field: 'role', width: 130 }
  ]

  const teamCols = [
    { field: 'id', width: 70 },
    { field: 'name', flex: 1, headerName: 'Team Name' }
  ]

  /* ─────────── render ──────────────────────────────────────── */
  return (
    <Box p={2}>
      {/* tabs header */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Agents" />
        <Tab label="Assign supervisors" />
      </Tabs>

      {/* ---------- TAB 0 : agents grid + dialogs ---------- */}
      {tab === 0 && (
        <>
          {/* header row */}
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6" sx={{ flexGrow: 1 }}>Agents</Typography>

            <Select
              value={teamFilter}
              onChange={e => setTeamFilter(e.target.value)}
              displayEmpty size="small" sx={{ mr: 2, minWidth: 160 }}
            >
              <MenuItem value=''><em>All teams</em></MenuItem>
              {teams.map(t => (
                <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>
              ))}
            </Select>

            <Button variant="contained" onClick={() => setOpenAgent(true)}>
              + Add agent
            </Button>
          </Box>

          {/* agents grid */}
          <DataGrid
            rows={viewRows}
            columns={cols}
            autoHeight
            editMode="cell"
            processRowUpdate={handleRowUpdate}
            onProcessRowUpdateError={console.error}
            disableRowSelectionOnClick
            slots={{ toolbar: GridToolbar }}
            getRowId={r => r.id}
          />

          {/* --- add-agent dialog --- */}
          <Dialog open={openAgent} onClose={() => setOpenAgent(false)}>
            <DialogTitle>New agent</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1, width: 340 }}>
                <TextField
                  label="Full name" required
                  value={agentForm.fullName}
                  onChange={e => setAgentForm({ ...agentForm, fullName: e.target.value })}
                />
                <TextField
                  label="Email" type="email" required
                  value={agentForm.email}
                  onChange={e => setAgentForm({ ...agentForm, email: e.target.value })}
                />
                <TextField label="Team" select
                  value={agentForm.role}
                  onChange={e => setAgentForm({ ...agentForm, role: e.target.value })}
                >
                  {teams.map(t => (
                    <MenuItem key={t.id} value={t.name}>{t.name}</MenuItem>
                  ))}
                </TextField>

                <TextField
                  label="Employee #" value={agentForm.employeeNo}
                  onChange={e => setAgentForm({ ...agentForm, employeeNo: e.target.value })}
                />
                <TextField
                  label="Start date" type="date" InputLabelProps={{ shrink: true }}
                  value={agentForm.startDate}
                  onChange={e => setAgentForm({ ...agentForm, startDate: e.target.value })}
                />
                <TextField
                  label="Province" value={agentForm.province}
                  onChange={e => setAgentForm({ ...agentForm, province: e.target.value })}
                />

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

          {/* --- supervisors grid --- */}
          <Box py={4}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ flexGrow: 1 }}>Supervisors</Typography>
              <Button variant="contained" sx={{ mb: 2 }} onClick={() => setOpenSup(true)}>
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

            {/* add-supervisor dialog */}
            <Dialog open={openSup} onClose={() => setOpenSup(false)}>
              <DialogTitle>New supervisor</DialogTitle>
              <DialogContent>
                <Stack spacing={2} sx={{ mt: 1, width: 320 }}>
                  <TextField
                    label="Full name" required
                    value={supForm.fullName}
                    onChange={e => setSupForm({ ...supForm, fullName: e.target.value })}
                  />
                  <TextField
                    label="Email" type="email" required
                    value={supForm.email}
                    onChange={e => setSupForm({ ...supForm, email: e.target.value })}
                  />
                  <TextField
                    label="Password" type="password" required
                    value={supForm.password}
                    onChange={e => setSupForm({ ...supForm, password: e.target.value })}
                  />
                  <Button variant="contained" onClick={handleSupSave}>
                    Save
                  </Button>
                </Stack>
              </DialogContent>
            </Dialog>
          </Box>

          {/* --- teams grid --- */}
          <Box py={2}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" sx={{ flexGrow: 1 }}>Teams</Typography>
              <Button variant="contained" sx={{ mb: 2 }} onClick={() => setOpenTeam(true)}>
                + Add team
              </Button>
            </Box>

            <DataGrid
              rows={teams}
              columns={teamCols}
              autoHeight
              disableRowSelectionOnClick
            />

            {/* add-team dialog */}
            <Dialog open={openTeam} onClose={() => setOpenTeam(false)}>
              <DialogTitle>New team</DialogTitle>
              <DialogContent>
                <Box sx={{ mt: 1, width: 320 }}>
                  <TextField
                    label="Team name" fullWidth required
                    value={teamName}
                    onChange={e => setTeamName(e.target.value)}
                  />
                  <Button variant="contained" sx={{ mt: 2 }} onClick={handleTeamSave}>
                    Save
                  </Button>
                </Box>
              </DialogContent>
            </Dialog>
          </Box>
        </>
      )}

      {/* ---------- TAB 1 : drag-and-drop supervisor assign ---------- */}
      {tab === 1 && (
        <AssignTab
          agents={agents}
          supers={supers}
          refreshAgents={async () =>
            setAgents((await api.get('/agents')).data)
          }
        />
      )}
    </Box>
  )
}
