import { useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import EngineeringRoundedIcon from '@mui/icons-material/EngineeringRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import { useAuth } from '../context/AuthContext'
import { addManager, deleteManager, listManagers } from '../api/managers'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

const EMPTY_FORM = {
  fullName: '',
  email: '',
  password: '',
  role: 'manager'
}

function roleColor(role) {
  if (role === 'engineering') return 'success'
  if (role === 'manager') return 'primary'
  return 'default'
}

export default function ManagersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)

  async function refresh() {
    setLoading(true)
    setError('')
    try {
      const { data } = await listManagers()
      setRows(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to load manager access records')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (roleFilter && row.role !== roleFilter) return false
      if (!term) return true

      return [row.fullName, row.email, row.role]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [roleFilter, rows, search])

  const summary = useMemo(() => {
    const managers = rows.filter((row) => row.role === 'manager').length
    const engineering = rows.filter((row) => row.role === 'engineering').length
    const recent = rows.filter((row) => row.lastLogin).length

    return {
      total: rows.length,
      managers,
      engineering,
      recent
    }
  }, [rows])

  async function save() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await addManager(form)
      await refresh()
      setOpen(false)
      setForm(EMPTY_FORM)
      setNotice(`${form.fullName} added successfully`)
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to save manager record')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id) {
    if (!window.confirm('Delete this manager or engineer login?')) return

    setBusy(true)
    setError('')
    setNotice('')
    try {
      await deleteManager(id)
      await refresh()
      setNotice('User removed successfully')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to delete manager record')
    } finally {
      setBusy(false)
    }
  }

  const columns = [
    { field: 'id', headerName: 'ID', width: 80 },
    { field: 'fullName', headerName: 'Name', flex: 1.1, minWidth: 180 },
    { field: 'email', headerName: 'Email', flex: 1.2, minWidth: 220 },
    {
      field: 'role',
      headerName: 'Role',
      width: 140,
      renderCell: (params) => (
        <Chip size="small" color={roleColor(params.value)} label={String(params.value || '').toUpperCase()} />
      )
    },
    {
      field: 'lastLogin',
      headerName: 'Last Login',
      width: 160,
      valueGetter: (_value, row) => {
        if (!row.lastLogin) return 'Never'
        return new Date(row.lastLogin).toLocaleString()
      }
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 110,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: (params) =>
        isAdmin ? (
          <Button size="small" color="error" variant="outlined" onClick={() => remove(params.row.id)}>
            <DeleteOutlineRoundedIcon fontSize="inherit" />
          </Button>
        ) : null
    }
  ]

  return (
    <PageShell
      eyebrow="Settings"
      title="Managers and Engineers"
      description="Maintain the planning and engineering logins that sit outside the supervisor table. This keeps the smaller access lane clean and easy to review."
      accent="#2563eb"
      actions={
        <Stack direction="row" spacing={0.7} flexWrap="wrap">
          <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={refresh} disabled={loading || busy}>
            Refresh
          </Button>
          {isAdmin ? (
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setOpen(true)}>
              New Login
            </Button>
          ) : null}
        </Stack>
      }
      stats={[
        {
          label: 'Total Logins',
          value: summary.total,
          helper: 'Manager table records',
          accent: '#2563eb'
        },
        {
          label: 'Managers',
          value: summary.managers,
          helper: 'Planning and people ops access',
          accent: '#0f766e'
        },
        {
          label: 'Engineering',
          value: summary.engineering,
          helper: 'Engineering access lane',
          accent: '#16a34a'
        },
        {
          label: 'Seen Active',
          value: summary.recent,
          helper: 'Users with recorded sign-in activity',
          accent: '#d97706'
        }
      ]}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

      <SectionCard
        title="Access Register"
        subtitle="Review the current manager and engineering accounts, then add or retire access without leaving the page."
        accent="#2563eb"
        noPadding
      >
        <Box sx={{ p: 1 }}>
          <FilterStrip>
            <TextField
              label="Search name or email"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              sx={{ minWidth: 240, flex: 1 }}
            />
            <TextField
              select
              label="Role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">All roles</MenuItem>
              <MenuItem value="manager">Manager</MenuItem>
              <MenuItem value="engineering">Engineering</MenuItem>
            </TextField>
            <Chip icon={<ShieldRoundedIcon />} label={`${filteredRows.length} shown`} />
            <Chip icon={<ManageAccountsRoundedIcon />} label={`${summary.managers} managers`} variant="outlined" />
            <Chip icon={<EngineeringRoundedIcon />} label={`${summary.engineering} engineering`} variant="outlined" color="success" />
          </FilterStrip>
        </Box>

        <Box sx={{ px: 0.6, pb: 0.6 }}>
          <DataGrid
            rows={filteredRows}
            columns={columns}
            autoHeight
            loading={loading}
            disableRowSelectionOnClick
            getRowId={(row) => row.id}
            pageSizeOptions={[10, 25, 50]}
            initialState={{
              pagination: { paginationModel: { pageSize: 25, page: 0 } },
              sorting: { sortModel: [{ field: 'fullName', sort: 'asc' }] }
            }}
            slots={{ toolbar: GridToolbar }}
            slotProps={{
              toolbar: {
                showQuickFilter: false,
                printOptions: { disableToolbarButton: true }
              }
            }}
          />
        </Box>
      </SectionCard>

      <Dialog open={open} onClose={() => !busy && setOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add manager or engineer login</DialogTitle>
        <DialogContent>
          <Stack spacing={1.1} sx={{ pt: 0.8 }}>
            <TextField
              label="Full name"
              value={form.fullName}
              onChange={(event) => setForm((state) => ({ ...state, fullName: event.target.value }))}
            />
            <TextField
              label="Email"
              type="email"
              value={form.email}
              onChange={(event) => setForm((state) => ({ ...state, email: event.target.value }))}
            />
            <TextField
              label="Password"
              type="password"
              value={form.password}
              onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
              helperText="Minimum 8 characters."
            />
            <TextField
              select
              label="Role"
              value={form.role}
              onChange={(event) => setForm((state) => ({ ...state, role: event.target.value }))}
            >
              <MenuItem value="manager">Manager</MenuItem>
              <MenuItem value="engineering">Engineering</MenuItem>
            </TextField>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={save} variant="contained" disabled={busy}>Save Login</Button>
        </DialogActions>
      </Dialog>
    </PageShell>
  )
}
