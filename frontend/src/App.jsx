import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import {
  Box,
  Chip,
  Collapse,
  CssBaseline,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ThemeProvider,
  CircularProgress,
  Typography,
  IconButton,
  Tooltip
} from '@mui/material'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import KeyboardDoubleArrowLeftRoundedIcon from '@mui/icons-material/KeyboardDoubleArrowLeftRounded'
import MenuRoundedIcon from '@mui/icons-material/MenuRounded'
import theme from './theme'
import AppFrame from './components/AppFrame'
import './lib/dayjs.js'
import { listVacancies } from './api/workforce'
import LoginPage from './pages/LoginPage'
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import UserStatus from './components/UserStatus'
import { buildNavigationSections, sectionHasActive, isActivePath } from './config/navigation.jsx'
import { BRAND } from './config/brand'

const RosterUpload = lazy(() => import('./components/RosterUpload'))
const LandingDashboardPage = lazy(() => import('./pages/LandingDashboardPage'))
const AdherencePage = lazy(() => import('./pages/AdherencePage'))
const SchedulePage = lazy(() => import('./pages/SchedulePage'))
const VolumePage = lazy(() => import('./pages/VolumePage'))
const AgentsPage = lazy(() => import('./pages/AgentsPage'))
const StaffingPage = lazy(() => import('./pages/StaffingPage'))
const ShiftManager = lazy(() => import('./pages/ShiftManager'))
const LeavePlannerPage = lazy(() => import('./pages/LeavePlannerPage'))
const WorkforcePage = lazy(() => import('./pages/WorkforcePage'))
const UserAdminPage = lazy(() => import('./pages/UserAdminPage'))
const WhatsAppWatchersPage = lazy(() => import('./pages/WhatsAppWatchersPage'))
const NldLightLevelsPage = lazy(() => import('./pages/NldLightLevelsPage'))
const NldMappingPage = lazy(() => import('./pages/NldMappingPage'))
const NldMapPage = lazy(() => import('./pages/NldMapPage'))
const NldUptimePage = lazy(() => import('./pages/NldUptimePage'))
const CircuitEditorPage = lazy(() => import('./pages/CircuitEditorPage'))
const NldServicesPage = lazy(() => import('./pages/NldServicesPage.jsx'))
const OvertimeCapturePage = lazy(() => import('./pages/OvertimeCapturePage'))
const OvertimeSupervisorPage = lazy(() => import('./pages/OvertimeSupervisorPage'))
const OvertimeManagerPage = lazy(() => import('./pages/OvertimeManagerPage'))
const SignaturePage = lazy(() => import('./pages/SignaturePage'))
const SlaReportingPage = lazy(() => import('./pages/SlaReportingPage'))
const StockManagementPage = lazy(() => import('./pages/StockManagementPage'))

const DRAWER_WIDTH = 236
const NAV_STORAGE_KEY = 'noc-nav-open'
const routerBasename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

function RouteFallback() {
  return (
    <Box
      sx={{
        minHeight: '40vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      <CircularProgress size={26} />
    </Box>
  )
}

function loadable(element) {
  return <Suspense fallback={<RouteFallback />}>{element}</Suspense>
}

function SideNav({ open, onToggle, vacancyCount }) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user || location.pathname === '/login' || !open) {
    return null
  }

  const sections = useMemo(() => buildNavigationSections(user, vacancyCount), [user, vacancyCount])
  const [openState, setOpenState] = useState(() =>
    Object.fromEntries(sections.map((section) => [section.title, sectionHasActive(location.pathname, section)]))
  )

  useEffect(() => {
    setOpenState((prev) => {
      const next = { ...prev }
      for (const section of sections) {
        if (sectionHasActive(location.pathname, section)) next[section.title] = true
        if (!(section.title in next)) next[section.title] = false
      }
      return next
    })
  }, [location.pathname, sections])

  return (
    <Drawer
      variant="permanent"
      sx={{
        '& .MuiDrawer-paper': {
          width: DRAWER_WIDTH,
          borderRight: 'none',
          color: '#e2e8f0',
          background: [
            'radial-gradient(circle at top left, rgba(45, 212, 191, 0.26) 0%, transparent 28%)',
            'linear-gradient(180deg, #0f5f61 0%, #11485a 40%, #16233f 100%)'
          ].join(','),
          boxShadow: '22px 0 42px rgba(15, 23, 42, 0.22)'
        }
      }}
    >
      <Box sx={{ px: 1.1, pt: 1.15, pb: 1, borderBottom: '1px solid rgba(255,255,255,0.12)' }}>
        <Box
          sx={{
            px: 1.1,
            py: 1,
            borderRadius: 2.4,
            background: 'linear-gradient(145deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.06) 100%)',
            border: '1px solid rgba(255,255,255,0.16)',
            backdropFilter: 'blur(12px)'
          }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}>
            <StackedBrand />
            <Tooltip title="Hide navigation">
              <IconButton size="small" onClick={onToggle} sx={{ color: '#e2e8f0' }}>
                <KeyboardDoubleArrowLeftRoundedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ mt: 0.9 }}>
            <UserStatus inDrawer />
          </Box>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 0.75, py: 0.75 }}>
        <List disablePadding sx={{ display: 'grid', gap: 0.7 }}>
          {sections.map((section) => {
            const expanded = !!openState[section.title]
            const activeSection = sectionHasActive(location.pathname, section)
            return (
              <Box
                key={section.title}
                sx={{
                  borderRadius: 2.2,
                  border: '1px solid rgba(255,255,255,0.08)',
                  backgroundColor: activeSection ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.03)',
                  overflow: 'hidden'
                }}
              >
                <ListItemButton
                  onClick={() => setOpenState((state) => ({ ...state, [section.title]: !expanded }))}
                  sx={{
                    px: 1.1,
                    py: 0.7,
                    borderRadius: 0,
                    '&:hover': { backgroundColor: 'rgba(255,255,255,0.05)' }
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 28, color: '#dbeafe' }}>
                    {section.icon}
                  </ListItemIcon>
                  <ListItemText
                    primary={section.title}
                    secondary={`${section.items.length} views`}
                    primaryTypographyProps={{
                      fontSize: 11.2,
                      fontWeight: 800,
                      letterSpacing: 0.5,
                      color: '#f8fafc'
                    }}
                    secondaryTypographyProps={{
                      fontSize: 10.2,
                      color: 'rgba(226,232,240,0.72)'
                    }}
                  />
                  {expanded ? (
                    <ExpandLessRoundedIcon sx={{ fontSize: 18, color: '#cbd5e1' }} />
                  ) : (
                    <ExpandMoreRoundedIcon sx={{ fontSize: 18, color: '#cbd5e1' }} />
                  )}
                </ListItemButton>

                <Collapse in={expanded} timeout="auto" unmountOnExit>
                  <List disablePadding sx={{ px: 0.8, pb: 0.8, display: 'grid', gap: 0.4 }}>
                    {section.items.map((item) => {
                      const active = isActivePath(location.pathname, item.path)
                      return (
                        <ListItemButton
                          key={item.label}
                          component={Link}
                          to={item.path}
                          sx={{
                            minHeight: 34,
                            px: 1,
                            py: 0.5,
                            borderRadius: 1.7,
                            background: active
                              ? 'linear-gradient(135deg, rgba(255,255,255,0.2) 0%, rgba(191,219,254,0.14) 100%)'
                              : 'transparent',
                            border: active ? '1px solid rgba(191,219,254,0.28)' : '1px solid transparent',
                            '&:hover': {
                              backgroundColor: 'rgba(255,255,255,0.08)'
                            }
                          }}
                        >
                          <ListItemIcon sx={{ minWidth: 24, color: active ? '#ffffff' : '#cbd5e1' }}>
                            {item.icon}
                          </ListItemIcon>
                          <ListItemText
                            primary={item.label}
                            secondary={item.summary}
                            primaryTypographyProps={{
                              fontSize: 11.6,
                              fontWeight: active ? 800 : 600,
                              color: '#f8fafc',
                              lineHeight: 1.2
                            }}
                            secondaryTypographyProps={{
                              fontSize: 10.2,
                              color: 'rgba(226,232,240,0.72)',
                              lineHeight: 1.25
                            }}
                          />
                        </ListItemButton>
                      )
                    })}
                  </List>
                </Collapse>
              </Box>
            )
          })}
        </List>
      </Box>
    </Drawer>
  )
}

function StackedBrand() {
  return (
    <Box sx={{ display: 'grid', gap: 0.55 }}>
      <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', alignItems: 'center' }}>
        <Chip size="small" label={BRAND.loginBadge} color="primary" sx={{ bgcolor: 'rgba(45,212,191,0.18)', color: '#ccfbf1' }} />
        <Chip size="small" label="xneelo live" sx={{ bgcolor: 'rgba(59,130,246,0.18)', color: '#dbeafe' }} />
      </Box>
      <Typography sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1.05, color: '#f8fafc', letterSpacing: -0.4 }}>
        {BRAND.shellTitle}
      </Typography>
      <Typography sx={{ fontSize: 11.2, lineHeight: 1.45, color: 'rgba(226,232,240,0.82)' }}>
        {BRAND.shellDescription}
      </Typography>
    </Box>
  )
}

function FloatingTechUserStatus() {
  return null
}

function ShellLayout() {
  const { user } = useAuth()
  const location = useLocation()
  const isLogin = location.pathname === '/login'
  const [navOpen, setNavOpen] = useState(() => localStorage.getItem(NAV_STORAGE_KEY) !== '0')
  const [vacancyCount, setVacancyCount] = useState(0)

  useEffect(() => {
    localStorage.setItem(NAV_STORAGE_KEY, navOpen ? '1' : '0')
  }, [navOpen])

  useEffect(() => {
    if (!user || isLogin) return
    listVacancies(true)
      .then((res) => setVacancyCount(res.data.length))
      .catch(() => {})
  }, [user, isLogin])

  const drawerWidth = !isLogin && navOpen ? DRAWER_WIDTH : 0

  return (
    <>
      <SideNav open={navOpen} onToggle={() => setNavOpen(false)} vacancyCount={vacancyCount} />

      {!isLogin && !navOpen ? (
        <Tooltip title="Show navigation">
          <IconButton
            onClick={() => setNavOpen(true)}
            sx={{
              position: 'fixed',
              top: 14,
              left: 14,
              zIndex: 2200,
              bgcolor: 'rgba(15, 23, 42, 0.86)',
              color: '#f8fafc',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 14px 34px rgba(15, 23, 42, 0.22)',
              '&:hover': {
                bgcolor: 'rgba(15, 23, 42, 0.96)'
              }
            }}
          >
            <MenuRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : null}

      <AppFrame drawerWidth={drawerWidth}>
        <FloatingTechUserStatus />

        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedRoute />}>
            <Route path="/" element={loadable(<LandingDashboardPage vacancyCount={vacancyCount} />)} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/adherence" element={loadable(<AdherencePage />)} />
            <Route path="/schedule" element={loadable(<SchedulePage />)} />
            <Route path="/volume" element={loadable(<VolumePage />)} />
            <Route path="/roster" element={loadable(<RosterUpload />)} />
            <Route path="/agents" element={loadable(<AgentsPage />)} />
            <Route path="/staffing" element={loadable(<StaffingPage />)} />
            <Route path="/shifts" element={loadable(<ShiftManager />)} />
            <Route path="/leave-planner" element={loadable(<LeavePlannerPage />)} />
            <Route path="/workforce" element={loadable(<WorkforcePage />)} />
            <Route path="/managers" element={<Navigate to="/settings/users" replace />} />
            <Route path="/settings/users" element={loadable(<UserAdminPage />)} />
            <Route path="/settings/whatsapp-watchers" element={loadable(<WhatsAppWatchersPage />)} />
            <Route path="/engineering/nlds" element={loadable(<NldLightLevelsPage />)} />
            <Route path="/nld-mapping" element={loadable(<NldMappingPage />)} />
            <Route path="/nld-map" element={loadable(<NldMapPage />)} />
            <Route path="/nld-uptime" element={loadable(<NldUptimePage />)} />
            <Route path="/nld-admin" element={loadable(<CircuitEditorPage />)} />
            <Route path="/engineering/nld-services" element={loadable(<NldServicesPage />)} />
            <Route path="/sla-reporting" element={loadable(<SlaReportingPage />)} />
            <Route path="/stock-management" element={loadable(<StockManagementPage />)} />
            <Route path="/overtime/capture" element={loadable(<OvertimeCapturePage />)} />
            <Route path="/overtime/supervisor" element={loadable(<OvertimeSupervisorPage />)} />
            <Route path="/overtime/manager" element={loadable(<OvertimeManagerPage />)} />
            <Route path="/settings/signature" element={loadable(<SignaturePage />)} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppFrame>
    </>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter basename={routerBasename}>
          <ShellLayout />
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  )
}

