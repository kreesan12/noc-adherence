// frontend/src/components/UserStatus.jsx
import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Avatar, Typography, Chip, Button,
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
  if (role === 'admin') return { color: 'warning', label: 'admin' }
  if (role === 'manager') return { color: 'info', label: 'manager' }
  if (role === 'supervisor') return { color: 'info', label: 'supervisor' }
  return { color: 'default', label: roleRaw || 'user' }
}

export default function UserStatus({ inDrawer = false }) {
  const { user: ctxUser, logout: ctxLogout } = useAuth()
  const [anchorEl, setAnchorEl] = useState(null)
  const [fallbackUser, setFallbackUser] = useState(null)
  const open = Boolean(anchorEl)

  useEffect(() => {
    const t = localStorage.getItem('token')
    if (!ctxUser && t) {
      try {
        const payload = JSON.parse(atob((t.split('.')[1] || '').replace(/-/g, '+').replace(/_/g, '/')))
        setFallbackUser({ name: payload.name, role: payload.role })
      } catch {
        setFallbackUser(null)
      }
    } else {
      setFallbackUser(null)
    }
  }, [ctxUser])

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'token' && e.newValue == null) {
        setFallbackUser(null)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const user = ctxUser ?? fallbackUser
  const initials = useMemo(() => getInitials(user?.name), [user])
  const chip = useMemo(() => roleChipProps(user?.role), [user])

  const handleOpen = (e) => setAnchorEl(e.currentTarget)
  const handleClose = () => setAnchorEl(null)

  const handleLogout = async () => {
    handleClose()
    try {
      if (typeof ctxLogout === 'function') await ctxLogout()
    } finally {
      localStorage.removeItem('token')
      setFallbackUser(null)
      window.location.replace('/noc-adherence/login')
    }
  }

  const avatarSx = inDrawer
    ? { width: 28, height: 28, fontSize: 12, bgcolor: 'rgba(255,255,255,0.18)', color: '#fff' }
    : { width: 26, height: 26, fontSize: 12 }

  if (inDrawer) {
    return (
      <Paper
        elevation={0}
        sx={{
          px: 1,
          py: 0.85,
          borderRadius: 1.75,
          border: '1px solid rgba(255,255,255,0.18)',
          bgcolor: 'rgba(255,255,255,0.12)',
          color: '#fff',
          backdropFilter: 'blur(8px)'
        }}
      >
        {user ? (
          <Stack spacing={0.8}>
            <Stack direction="row" spacing={0.85} alignItems="center">
              <Avatar sx={avatarSx}>
                {initials || <PersonRoundedIcon fontSize="small" />}
              </Avatar>

              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ lineHeight: 1.2, fontWeight: 600 }} noWrap>
                  {user.name}
                </Typography>
                <Chip
                  size="small"
                  variant="filled"
                  color={chip.color}
                  label={chip.label}
                  sx={{ mt: 0.35, height: 18, '& .MuiChip-label': { px: 0.65, fontSize: 10 } }}
                />
              </Box>
            </Stack>

            <Button
              size="small"
              variant="outlined"
              startIcon={<LogoutRoundedIcon fontSize="small" />}
              onClick={handleLogout}
              sx={{
                alignSelf: 'stretch',
                minHeight: 30,
                fontSize: 11.5,
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.35)',
                '&:hover': {
                  borderColor: '#fff',
                  bgcolor: 'rgba(255,255,255,0.08)'
                }
              }}
            >
              Logout
            </Button>
          </Stack>
        ) : (
          <Stack direction="row" spacing={1} alignItems="center">
            <Avatar sx={avatarSx}>
              <PersonRoundedIcon fontSize="small" />
            </Avatar>
            <Typography variant="body2">Not logged in</Typography>
          </Stack>
        )}
      </Paper>
    )
  }

  return (
    <Box sx={{ position: 'fixed', top: 10, right: 10, zIndex: 2100 }}>
      <Paper
        elevation={3}
        sx={{
          px: 1,
          py: 0.55,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          gap: 0.85,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}
      >
        {user ? (
          <>
            <Avatar sx={avatarSx}>
              {initials || <PersonRoundedIcon fontSize="small" />}
            </Avatar>

            <Stack spacing={0} sx={{ mr: 0.5 }}>
              <Typography variant="body2" sx={{ lineHeight: 1.15, fontWeight: 600, fontSize: 12 }}>
                {user.name}
              </Typography>
              <Stack direction="row" spacing={0.5} alignItems="center">
                <Chip
                  size="small"
                  variant="filled"
                  color={chip.color}
                  label={chip.label}
                  sx={{ height: 18, '& .MuiChip-label': { px: 0.65, fontSize: 10 } }}
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
                <LogoutRoundedIcon fontSize="small" sx={{ mr: 1 }} />
                Logout
              </MenuItem>
            </Menu>
          </>
        ) : (
          <>
            <Avatar sx={avatarSx}>
              <PersonRoundedIcon fontSize="small" />
            </Avatar>
            <Typography variant="body2">Not logged in</Typography>
          </>
        )}
      </Paper>
    </Box>
  )
}
