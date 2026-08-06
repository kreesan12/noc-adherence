import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
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
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import { DataGrid, GridToolbar } from '@mui/x-data-grid'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded'
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import EditRoundedIcon from '@mui/icons-material/EditRounded'
import EmailRoundedIcon from '@mui/icons-material/EmailRounded'
import LockResetRoundedIcon from '@mui/icons-material/LockResetRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import SupervisorAccountRoundedIcon from '@mui/icons-material/SupervisorAccountRounded'
import EngineeringRoundedIcon from '@mui/icons-material/EngineeringRounded'
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import { useAuth } from '../context/AuthContext'
import {
  createUser,
  deleteUser,
  listUsers,
  resetUserPassword,
  updateUser
} from '../api/userAdmin'

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'manager', label: 'Manager' },
  { value: 'engineering', label: 'Engineering' }
]

const EMPTY_FORM = {
  fullName: '',
  email: '',
  role: 'manager',
  password: ''
}

function extractError(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

function fmtDateTime(value) {
  if (!value) return 'Never'
  const d = dayjs(value)
  return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : String(value)
}

function roleVisual(role) {
  const key = String(role || '').toLowerCase()
  if (key === 'admin') return { color: 'warning', icon: <AdminPanelSettingsRoundedIcon fontSize="inherit" /> }
  if (key === 'supervisor') return { color: 'info', icon: <SupervisorAccountRoundedIcon fontSize="inherit" /> }
  if (key === 'engineering') return { color: 'success', icon: <EngineeringRoundedIcon fontSize="inherit" /> }
  return { color: 'default', icon: <ManageAccountsRoundedIcon fontSize="inherit" /> }
}

function kindVisual(kind) {
  if (kind === 'supervisor') return { color: 'secondary', label: 'Supervisor table' }
  return { color: 'primary', label: 'Manager table' }
}

function passwordVisual(state) {
  if (state === 'legacy_plaintext') return { color: 'warning', label: 'Needs upgrade' }
  return { color: 'success', label: 'Hashed' }
}

function MetricCard({ title, value, subtext, accent = '#0f766e', icon = null }) {
  return (
    <Paper
      sx={{
        p: 1.15,
        minWidth: 160,
        flex: '1 1 160px',
        borderRadius: 2.2,
        borderTop: `3px solid ${accent}`,
        background: `linear-gradient(180deg, ${accent}14 0%, #ffffff 58%)`
      }}
    >
      <Stack direction="row" spacing={0.8} alignItems="center" sx={{ mb: 0.5 }}>
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: 1.6,
            display: 'grid',
            placeItems: 'center',
            bgcolor: `${accent}18`,
            color: accent
          }}
        >
          {icon}
        </Box>
        <Typography variant="subtitle2" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </Typography>
      </Stack>
      <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.05 }}>
        {value}
      </Typography>
      <Typography variant="body2" sx={{ mt: 0.35, color: 'text.secondary' }}>
        {subtext}
      </Typography>
    </Paper>
  )
}

function buildMailto(draft) {
  if (!draft?.to) return '#'
  const to = encodeURIComponent(draft.to)
  const subject = encodeURIComponent(draft.subject || '')
  const body = encodeURIComponent(draft.body || '')
  return `mailto:${to}?subject=${subject}&body=${body}`
}

export default function UserAdminPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    admins: 0,
    supervisors: 0,
    managers: 0,
    engineering: 0,
    legacyPasswordCount: 0
  })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [kindFilter, setKindFilter] = useState('')
  const [formMode, setFormMode] = useState('create')
  const [formOpen, setFormOpen] = useState(false)
  const [formUser, setFormUser] = useState(null)
  const [form, setForm] = useState(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [draftPayload, setDraftPayload] = useState(null)

  async function refresh() {
    if (!isAdmin) return
    setLoading(true)
    setError('')
    try {
      const { data } = await listUsers()
      setRows(data.users || [])
      setSummary(data.summary || {})
    } catch (err) {
      setError(extractError(err, 'Failed to load users'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [isAdmin])

  const filteredRows = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (roleFilter && row.role !== roleFilter) return false
      if (kindFilter && row.kind !== kindFilter) return false
      if (!term) return true
      return [row.fullName, row.email, row.role, row.kind]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [rows, search, roleFilter, kindFilter])

  function openCreate() {
    setFormMode('create')
    setFormUser(null)
    setForm({ ...EMPTY_FORM, role: 'manager' })
    setFormOpen(true)
  }

  function openEdit(row) {
    setFormMode('edit')
    setFormUser(row)
    setForm({
      fullName: row.fullName || '',
      email: row.email || '',
      role: row.role || 'manager',
      password: ''
    })
    setFormOpen(true)
  }

  async function submitForm() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      if (formMode === 'create') {
        const { data } = await createUser(form)
        setDraftPayload({
          title: 'Account created',
          subtitle: `${data.user.fullName} can sign in with the temporary password below.`,
          temporaryPassword: data.onboarding?.temporaryPassword,
          emailDraft: data.onboarding?.emailDraft
        })
        setNotice(`Created ${data.user.fullName}`)
      } else if (formUser) {
        await updateUser(formUser.kind, formUser.id, {
          fullName: form.fullName,
          email: form.email,
          role: form.role
        })
        setNotice(`Updated ${form.fullName}`)
      }

      setFormOpen(false)
      await refresh()
    } catch (err) {
      setError(extractError(err, `Failed to ${formMode} user`))
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(row) {
    setBusy(true)
    setError('')
    try {
      const { data } = await resetUserPassword(row.kind, row.id)
      setDraftPayload({
        title: 'Password reset complete',
        subtitle: `A new temporary password has been generated for ${data.user.fullName}.`,
        temporaryPassword: data.reset?.temporaryPassword,
        emailDraft: data.reset?.emailDraft
      })
      setNotice(`Password reset for ${data.user.fullName}`)
      await refresh()
    } catch (err) {
      setError(extractError(err, 'Failed to reset password'))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setBusy(true)
    setError('')
    try {
      await deleteUser(deleteTarget.kind, deleteTarget.id)
      setNotice(`Deleted ${deleteTarget.fullName}`)
      setDeleteTarget(null)
      await refresh()
    } catch (err) {
      setError(extractError(err, 'Failed to delete user'))
    } finally {
      setBusy(false)
    }
  }

  async function copyText(value, successMessage) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setNotice(successMessage)
    } catch {
      setError('Clipboard copy failed on this browser')
    }
  }

  const columns = [
    {
      field: 'fullName',
      headerName: 'Name',
      flex: 1.1,
      minWidth: 180
    },
    {
      field: 'email',
      headerName: 'Email',
      flex: 1.2,
      minWidth: 220
    },
    {
      field: 'role',
      headerName: 'Role',
      width: 132,
      renderCell: (params) => {
        const visual = roleVisual(params.value)
        return (
          <Chip
            size="small"
            color={visual.color}
            icon={visual.icon}
            label={String(params.value || '').toUpperCase()}
            variant="outlined"
          />
        )
      }
    },
    {
      field: 'kind',
      headerName: 'Access Lane',
      width: 136,
      renderCell: (params) => {
        const visual = kindVisual(params.value)
        return <Chip size="small" color={visual.color} label={visual.label} />
      }
    },
    {
      field: 'passwordState',
      headerName: 'Password State',
      width: 126,
      renderCell: (params) => {
        const visual = passwordVisual(params.value)
        return <Chip size="small" color={visual.color} label={visual.label} variant="outlined" />
      }
    },
    {
      field: 'lastLogin',
      headerName: 'Last Login',
      width: 136,
      valueGetter: (_value, row) => fmtDateTime(row.lastLogin)
    },
    {
      field: 'createdAt',
      headerName: 'Created',
      width: 136,
      valueGetter: (_value, row) => fmtDateTime(row.createdAt)
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 210,
      sortable: false,
      filterable: false,
      disableColumnMenu: true,
      renderCell: (params) => (
        <Stack direction="row" spacing={0.35} sx={{ py: 0.3 }}>
          <Tooltip title="Edit user">
            <Button size="small" variant="outlined" onClick={() => openEdit(params.row)}>
              <EditRoundedIcon fontSize="inherit" />
            </Button>
          </Tooltip>
          <Tooltip title="Reset password">
            <Button size="small" variant="outlined" color="warning" onClick={() => handleReset(params.row)}>
              <LockResetRoundedIcon fontSize="inherit" />
            </Button>
          </Tooltip>
          <Tooltip title="Delete user">
            <Button size="small" variant="outlined" color="error" onClick={() => setDeleteTarget(params.row)}>
              <DeleteOutlineRoundedIcon fontSize="inherit" />
            </Button>
          </Tooltip>
        </Stack>
      )
    }
  ]

  if (!isAdmin) {
    return (
      <Box sx={{ p: { xs: 1.25, md: 1.5 } }}>
        <Alert severity="warning">Only admin users can manage sign-in accounts.</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ p: { xs: 1.1, md: 1.35 }, display: 'grid', gap: 1.1 }}>
      <Paper
        sx={{
          p: 1.3,
          borderRadius: 2.6,
          background:
            'radial-gradient(circle at top right, rgba(37, 99, 235, 0.14) 0%, transparent 26%), linear-gradient(135deg, rgba(15, 118, 110, 0.12) 0%, rgba(15, 23, 42, 0.02) 68%, #ffffff 100%)'
        }}
      >
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.2} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between">
          <Box>
            <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mb: 0.45, flexWrap: 'wrap' }}>
              <Chip size="small" label="SETTINGS" sx={{ bgcolor: 'rgba(15,118,110,0.12)', color: '#0f766e' }} />
              <Chip size="small" label="User Admin" color="primary" />
            </Stack>
            <Typography variant="h4" sx={{ mb: 0.35 }}>
              Login Access Control
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 760 }}>
              Create, update, reset, and retire application logins across admin, supervisor, manager, and engineering roles. Password actions generate a ready-to-send onboarding draft so handover stays quick.
            </Typography>
          </Box>

          <Stack direction="row" spacing={0.7} flexWrap="wrap">
            <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={refresh} disabled={loading || busy}>
              Refresh
            </Button>
            <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={openCreate}>
              New User
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}
      {summary.legacyPasswordCount > 0 ? (
        <Alert severity="warning">
          {summary.legacyPasswordCount} user account{summary.legacyPasswordCount === 1 ? '' : 's'} still need a hashed password path. Any successful sign-in or manual reset will upgrade them.
        </Alert>
      ) : null}

      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
        <MetricCard title="Total Users" value={summary.total || 0} subtext="All active logins across both auth tables" accent="#0f766e" icon={<ShieldRoundedIcon fontSize="small" />} />
        <MetricCard title="Admins" value={summary.admins || 0} subtext="Highest privilege accounts" accent="#d97706" icon={<AdminPanelSettingsRoundedIcon fontSize="small" />} />
        <MetricCard title="Supervisors" value={summary.supervisors || 0} subtext="Operational oversight roles" accent="#0284c7" icon={<SupervisorAccountRoundedIcon fontSize="small" />} />
        <MetricCard title="Managers" value={summary.managers || 0} subtext="Planning and people management access" accent="#4f46e5" icon={<ManageAccountsRoundedIcon fontSize="small" />} />
        <MetricCard title="Engineering" value={summary.engineering || 0} subtext="Engineering and platform users" accent="#16a34a" icon={<EngineeringRoundedIcon fontSize="small" />} />
      </Stack>

      <Paper sx={{ p: 1.1, borderRadius: 2.4 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap" alignItems={{ xs: 'stretch', md: 'center' }}>
          <TextField
            label="Search users"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            sx={{ minWidth: 240, flex: 1 }}
          />
          <TextField
            select
            label="Role"
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">All roles</MenuItem>
            {ROLE_OPTIONS.map((role) => (
              <MenuItem key={role.value} value={role.value}>{role.label}</MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Access lane"
            value={kindFilter}
            onChange={(event) => setKindFilter(event.target.value)}
            sx={{ minWidth: 150 }}
          >
            <MenuItem value="">Both tables</MenuItem>
            <MenuItem value="supervisor">Supervisor table</MenuItem>
            <MenuItem value="manager">Manager table</MenuItem>
          </TextField>
          <Chip
            label={`${filteredRows.length} shown`}
            sx={{ alignSelf: 'center', bgcolor: 'rgba(15,118,110,0.12)', color: '#0f766e' }}
          />
        </Stack>
      </Paper>

      <Paper sx={{ p: 0.55, borderRadius: 2.6 }}>
        <DataGrid
          rows={filteredRows}
          columns={columns}
          autoHeight
          loading={loading}
          disableRowSelectionOnClick
          getRowId={(row) => `${row.kind}-${row.id}`}
          pageSizeOptions={[10, 25, 50, 100]}
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
      </Paper>

      <Dialog open={formOpen} onClose={() => !busy && setFormOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{formMode === 'create' ? 'Create login user' : 'Update login user'}</DialogTitle>
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
              select
              label="Role"
              value={form.role}
              onChange={(event) => setForm((state) => ({ ...state, role: event.target.value }))}
            >
              {ROLE_OPTIONS.map((role) => (
                <MenuItem key={role.value} value={role.value}>{role.label}</MenuItem>
              ))}
            </TextField>
            {formMode === 'create' ? (
              <TextField
                label="Temporary password"
                placeholder="Leave blank to auto-generate"
                value={form.password}
                onChange={(event) => setForm((state) => ({ ...state, password: event.target.value }))}
                helperText="If you leave this blank, the backend will generate a secure temporary password for the user."
              />
            ) : null}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={submitForm} variant="contained" disabled={busy}>
            {formMode === 'create' ? 'Create user' : 'Save changes'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => !busy && setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete login user</DialogTitle>
        <DialogContent>
          <Typography variant="body1">
            Delete <strong>{deleteTarget?.fullName}</strong> and remove their ability to log in?
          </Typography>
          <Typography variant="body2" sx={{ mt: 0.7, color: 'text.secondary' }}>
            This removes the record from the underlying auth table and cannot be undone from the UI.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" onClick={handleDelete} disabled={busy}>
            Delete user
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={!!draftPayload} onClose={() => setDraftPayload(null)} fullWidth maxWidth="md">
        <DialogTitle>{draftPayload?.title || 'Credential draft'}</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography variant="body1" sx={{ color: 'text.secondary' }}>
              {draftPayload?.subtitle}
            </Typography>

            <Paper sx={{ p: 1.1, borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} alignItems={{ xs: 'flex-start', md: 'center' }} justifyContent="space-between">
                <Box>
                  <Typography variant="subtitle2">Temporary password</Typography>
                  <Typography variant="h6" sx={{ mt: 0.2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                    {draftPayload?.temporaryPassword || 'Not supplied'}
                  </Typography>
                </Box>
                <Button
                  variant="outlined"
                  startIcon={<ContentCopyRoundedIcon />}
                  onClick={() => copyText(draftPayload?.temporaryPassword, 'Temporary password copied')}
                >
                  Copy Password
                </Button>
              </Stack>
            </Paper>

            <Paper sx={{ p: 1.1, borderRadius: 2 }}>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={0.8} justifyContent="space-between" alignItems={{ xs: 'flex-start', md: 'center' }} sx={{ mb: 0.8 }}>
                <Box>
                  <Typography variant="subtitle2">Email draft</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Ready to paste into Outlook or your preferred mail client.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.6} flexWrap="wrap">
                  <Button
                    variant="outlined"
                    startIcon={<ContentCopyRoundedIcon />}
                    onClick={() => copyText(draftPayload?.emailDraft?.body, 'Email body copied')}
                  >
                    Copy Body
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<EmailRoundedIcon />}
                    onClick={() => window.open(buildMailto(draftPayload?.emailDraft), '_self')}
                  >
                    Open Draft
                  </Button>
                </Stack>
              </Stack>

              <Stack spacing={0.8}>
                <TextField label="To" value={draftPayload?.emailDraft?.to || ''} InputProps={{ readOnly: true }} />
                <TextField label="Subject" value={draftPayload?.emailDraft?.subject || ''} InputProps={{ readOnly: true }} />
                <TextField
                  label="Body"
                  value={draftPayload?.emailDraft?.body || ''}
                  InputProps={{ readOnly: true }}
                  multiline
                  minRows={10}
                />
              </Stack>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraftPayload(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
