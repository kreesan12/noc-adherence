// frontend/src/components/UserStatus.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Avatar, Typography, Chip,
  IconButton, Menu, MenuItem, Divider, Stack, Tooltip
} from '@mui/material'
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded'
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded'
import PersonRoundedIcon from '@mui/icons-material/PersonRounded'
import { useAuth } from '../context/AuthContext'

function getInitials(name = '') {
  const parts = name.trim().split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('')
}

function roleChipProps(roleRaw) {
  const role = (roleRaw || '').toLowerCase()
  if (role === 'engineering') return { color: 'success', label: 'engineering' }
  if (role === 'admin')       return { color: 'warning', label: 'admin' }
  if (role === 'manager')     return { color: 'info',    label: 'manager' }
  if (role === 'supervisor')  return { color: 'info',    label: 'supervisor' }
  return { color: 'default',   label: roleRaw || 'user' }
}

export default function UserStatus() {
  const { user: ctxUser, logout: ctxLogout } = useAuth()
  const [anchorEl, setAnchorEl] = useState(null)
  const [fallbackUser, setFallbackUser] = useState(null)
  const open = Boolean(anchorEl)

  useEffect(() => {
    if (!ctxUser) {
      const t = localStorage.getItem('token')
      if (t) {
        try {
          const payload = JSON.parse(atob(t.split('.')[1]))
          setFallbackUser({ name: payload.name, role: payload.role })
        } catch { /* ignore */ }
      }
    }
  }, [ctxUser])

  const user = ctxUser ?? fallbackUser

  const initials = useMemo(() => getInitials(user?.name), [user])
  const chip = useMemo(() => roleChipProps(user?.role), [user])

  const handleOpen = (e) => setAnchorEl(e.currentTarget)
  const handleClose = () => setAnchorEl(null)

  const handleLogout = () => {
    handleClose()
    if (typeof ctxLogout === 'function') {
      ctxLogout()
    } else {
      localStorage.removeItem('token')
      window.location.href = '/noc-adherence/login'
    }
  }

  return (
    <Box sx={{ position: 'fixed', top: 12, right: 12, zIndex: 2100 }}>
      <Paper
        elevation={3}
        sx={{
          px: 1.25, py: 0.75, borderRadius: 999,
          display: 'flex', alignItems: 'center', gap: 1,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}
      >
        {user ? (
          <>
            <Avatar sx={{ width: 28, height: 28, fontSize: 13 }}>
              {initials || <PersonRoundedIcon fontSize="small" />}
            </Avatar>

            <Stack spacing={0} sx={{ mr: 0.5 }}>
              <Typography variant="body2" sx={{ lineHeight: 1.2, fontWeight: 600 }}>
                {user.name}
              </Typography>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip
                  size="small"
                  variant="filled"
                  color={chip.color}
                  label={chip.label}
                  sx={{ height: 20, '& .MuiChip-label': { px: 0.75, fontSize: 11 } }}
                />
              </Stack>
            </Stack>

            <Tooltip title="Account">
              <IconButton size="small" onClick={handleOpen}>
                <KeyboardArrowDownRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Menu
              anchorEl={anchorEl}
              open={open}
              onClose={handleClose}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              <Box sx={{ px: 2, py: 1.25 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {user.name}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.75 }}>
                  {user.role}
                </Typography>
              </Box>
              <Divider />
              <MenuItem onClick={handleLogout}>
                <LogoutRoundedIcon fontSize="small" style={{ marginRight: 8 }} />
                Logout
              </MenuItem>
            </Menu>
          </>
        ) : (
          <>
            <Avatar sx={{ width: 28, height: 28 }}>
              <PersonRoundedIcon fontSize="small" />
            </Avatar>
            <Typography variant="body2">Not logged in</Typography>
          </>
        )}
      </Paper>
    </Box>
  )
}
