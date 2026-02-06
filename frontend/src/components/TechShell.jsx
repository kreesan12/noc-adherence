// frontend/src/components/TechShell.jsx
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  AppBar, Toolbar, Typography, Box, IconButton, Chip, Stack,
  BottomNavigation, BottomNavigationAction, Paper
} from '@mui/material'
import RefreshIcon from '@mui/icons-material/Refresh'
import LogoutIcon from '@mui/icons-material/Logout'
import TodayIcon from '@mui/icons-material/Today'
import AssignmentIcon from '@mui/icons-material/Assignment'
import { safeFlushQueue } from '../utils/techSync'
import { countQueuedEvents } from '../utils/techOfflineQueue'

export default function TechShell() {
  const nav = useNavigate()
  const location = useLocation()

  const techName = localStorage.getItem('techName') || ''
  const techId = localStorage.getItem('techId') || ''
  const techToken = localStorage.getItem('techToken') || ''

  const isLogin = location.pathname === '/tech/login'

  useEffect(() => {
    if (!isLogin && (!techToken || !techId)) nav('/tech/login', { replace: true })
  }, [isLogin, techToken, techId, nav])

  async function syncNow() {
    await safeFlushQueue().catch(() => {})
  }

  async function logout() {
    localStorage.removeItem('techToken')
    localStorage.removeItem('techId')
    localStorage.removeItem('techName')
    nav('/tech/login', { replace: true })
  }

  const navValue =
    location.pathname.startsWith('/tech/my-day') ? 'myday' :
    location.pathname.startsWith('/tech/appointments') ? 'appointments' :
    'myday'

  if (isLogin) {
    return (
      <Box sx={{ minHeight: '100vh', px: 2, py: 2 }}>
        <Outlet />
      </Box>
    )
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <AppBar position="sticky" elevation={0}>
        <Toolbar sx={{ gap: 1 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="h6" sx={{ fontWeight: 950, lineHeight: 1.1 }}>
              My Day
            </Typography>

            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
              <Chip size="small" label={techName ? techName : `Tech ${techId || '-'}`} />
              <Chip size="small" color={navigator.onLine ? 'success' : 'warning'} label={navigator.onLine ? 'Online' : 'Offline'} />
            </Stack>
          </Box>

          <IconButton onClick={syncNow} aria-label="Sync">
            <RefreshIcon />
          </IconButton>
          <IconButton color="error" onClick={logout} aria-label="Logout">
            <LogoutIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Box sx={{ px: 2, py: 2, pb: 10 }}>
        <Outlet />
      </Box>

      <Paper
        elevation={0}
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 0
        }}
      >
        <BottomNavigation
          value={navValue}
          onChange={async (_e, v) => {
            if (v === 'myday') nav('/tech/my-day')
            if (v === 'appointments') nav('/tech/my-day') // same page for now; you can add tabs later
          }}
          showLabels
        >
          <BottomNavigationAction value="myday" label="My Day" icon={<TodayIcon />} />
          <BottomNavigationAction value="appointments" label="Appointments" icon={<AssignmentIcon />} />
        </BottomNavigation>
      </Paper>
    </Box>
  )
}
