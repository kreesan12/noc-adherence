import React, { useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Box,
  Chip,
  Collapse,
  CssBaseline,
  Divider,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ThemeProvider,
  Typography,
  styled
} from '@mui/material'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'

import DashboardRoundedIcon from '@mui/icons-material/DashboardRounded'
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded'
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded'
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded'
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
import EventBusyRoundedIcon from '@mui/icons-material/EventBusyRounded'
import PeopleRoundedIcon from '@mui/icons-material/PeopleRounded'
import LanRoundedIcon from '@mui/icons-material/LanRounded'
import MapRoundedIcon from '@mui/icons-material/MapRounded'
import AvTimerRoundedIcon from '@mui/icons-material/AvTimerRounded'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded'
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded'
import RouteRoundedIcon from '@mui/icons-material/RouteRounded'
import PrecisionManufacturingRoundedIcon from '@mui/icons-material/PrecisionManufacturingRounded'
import GroupWorkRoundedIcon from '@mui/icons-material/GroupWorkRounded'
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded'

import theme from './theme'
import techTheme from './techTheme'
import TechShell from './components/TechShell'
import AppFrame from './components/AppFrame'

import './lib/dayjs.js'
import { listVacancies } from './api/workforce'

import AdherencePage from './pages/AdherencePage'
import SchedulePage from './pages/SchedulePage'
import VolumePage from './pages/VolumePage'
import RosterUpload from './components/RosterUpload'
import LoginPage from './pages/LoginPage'
import AgentsPage from './pages/AgentsPage'
import StaffingPage from './pages/StaffingPage'
import ShiftManager from './pages/ShiftManager'
import LeavePlannerPage from './pages/LeavePlannerPage'
import WorkforcePage from './pages/WorkforcePage'
import NldLightLevelsPage from './pages/NldLightLevelsPage'
import NldMappingPage from './pages/NldMappingPage'
import NldMapPage from './pages/NldMapPage'
import NldUptimePage from './pages/NldUptimePage'
import CircuitEditorPage from './pages/CircuitEditorPage'
import NldServicesPage from './pages/NldServicesPage.jsx'
import OvertimeCapturePage from './pages/OvertimeCapturePage'
import OvertimeSupervisorPage from './pages/OvertimeSupervisorPage'
import OvertimeManagerPage from './pages/OvertimeManagerPage'
import SignaturePage from './pages/SignaturePage'
import RocAppointmentsPage from './pages/RocAppointmentsPage'
import SlaReportingPage from './pages/SlaReportingPage'
import StockManagementPage from './pages/StockManagementPage'
import UserAdminPage from './pages/UserAdminPage'

import TechMyDayPage from './pages/TechMyDayPage.jsx'
import TechAppointmentDetailPage from './pages/TechAppointmentDetailPage.jsx'
import TechLoginPage from './pages/TechLoginPage.jsx'

import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import UserStatus from './components/UserStatus'

const DRAWER_WIDTH = 236

const StyledDrawer = styled(Drawer)(() => ({
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
}))

function isActive(pathname, itemPath) {
  if (itemPath === '/') return pathname === '/'
  return pathname.startsWith(itemPath)
}

function sectionHasActive(pathname, section) {
  return section.items.some((item) => isActive(pathname, item.path))
}

function buildSections(user, vacancyCount) {
  return [
    {
      title: 'ROC AND MNT',
      icon: <PrecisionManufacturingRoundedIcon fontSize="small" />,
      items: [
        { label: 'ROC Appointments', path: '/roc-appointments', icon: <BuildRoundedIcon fontSize="small" /> },
        { label: 'Tech App', path: '/tech', icon: <RouteRoundedIcon fontSize="small" /> }
      ]
    },
    {
      title: 'DAILY OPERATIONS',
      icon: <DashboardRoundedIcon fontSize="small" />,
      items: [
        { label: 'Adherence Tracking', path: '/', icon: <DashboardRoundedIcon fontSize="small" /> },
        { label: 'Weekly Schedule', path: '/schedule', icon: <CalendarMonthRoundedIcon fontSize="small" /> },
        { label: 'Leave Planner', path: '/leave-planner', icon: <EventBusyRoundedIcon fontSize="small" /> }
      ]
    },
    {
      title: 'STAFFING AND SCHEDULING',
      icon: <GroupWorkRoundedIcon fontSize="small" />,
      items: [
        { label: 'Volumes and Forecasting', path: '/volume', icon: <QueryStatsRoundedIcon fontSize="small" /> },
        { label: 'Staffing and Scheduling', path: '/staffing', icon: <ManageAccountsRoundedIcon fontSize="small" /> },
        { label: 'Shift Manager', path: '/shifts', icon: <ManageAccountsRoundedIcon fontSize="small" /> }
      ]
    },
    {
      title: 'SETTINGS',
      icon: <SettingsSuggestRoundedIcon fontSize="small" />,
      items: [
        {
          label: 'Workforce',
          path: '/workforce',
          icon: (
            <Badge badgeContent={vacancyCount} color="secondary">
              <PeopleRoundedIcon fontSize="small" />
            </Badge>
          )
        },
        { label: 'Admin', path: '/agents', icon: <AdminPanelSettingsRoundedIcon fontSize="small" /> },
        { label: 'Upload Roster', path: '/roster', icon: <UploadFileRoundedIcon fontSize="small" /> },
        ...(user?.role === 'admin'
          ? [{ label: 'User Admin', path: '/settings/users', icon: <ManageAccountsRoundedIcon fontSize="small" /> }]
          : []),
        { label: 'Overtime Capturing', path: '/overtime/capture', icon: <LanRoundedIcon fontSize="small" /> },
        { label: 'Overtime Supervisor', path: '/overtime/supervisor', icon: <LanRoundedIcon fontSize="small" /> },
        { label: 'Overtime Manager', path: '/overtime/manager', icon: <LanRoundedIcon fontSize="small" /> },
        { label: 'Signatures', path: '/settings/signature', icon: <LanRoundedIcon fontSize="small" /> }
      ]
    },
    {
      title: 'ENGINEERING',
      icon: <LanRoundedIcon fontSize="small" />,
      items: [
        { label: 'NLD Light Levels', path: '/engineering/nlds', icon: <LanRoundedIcon fontSize="small" /> },
        { label: 'NLD Uptime', path: '/nld-uptime', icon: <AvTimerRoundedIcon fontSize="small" /> },
        { label: 'NLD Mapping', path: '/nld-mapping', icon: <MapRoundedIcon fontSize="small" /> },
        { label: 'NLD Map', path: '/nld-map', icon: <MapRoundedIcon fontSize="small" /> },
        { label: 'NLD Admin', path: '/nld-admin', icon: <AdminPanelSettingsRoundedIcon fontSize="small" /> },
        { label: 'NLD Services', path: '/engineering/nld-services', icon: <AdminPanelSettingsRoundedIcon fontSize="small" /> }
      ]
    },
    {
      title: 'SLA REPORTING',
      icon: <InsightsRoundedIcon fontSize="small" />,
      items: [
        { label: 'ISP SLA Dashboard', path: '/sla-reporting', icon: <InsightsRoundedIcon fontSize="small" /> }
      ]
    },
    {
      title: 'STOCK MANAGEMENT',
      icon: <Inventory2RoundedIcon fontSize="small" />,
      items: [
        { label: 'Stock Master', path: '/stock-management', icon: <Inventory2RoundedIcon fontSize="small" /> }
      ]
    }
  ]
}

function SideNav() {
  const { user } = useAuth()
  const location = useLocation()

  if (!user || location.pathname === '/login' || location.pathname.startsWith('/tech')) {
    return null
  }

  const [vacancyCount, setVacancyCount] = useState(0)

  useEffect(() => {
    listVacancies(true)
      .then((res) => setVacancyCount(res.data.length))
      .catch(() => {})
  }, [])

  const sections = useMemo(() => buildSections(user, vacancyCount), [user, vacancyCount])
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
    <StyledDrawer variant="permanent">
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
          <StackedBrand />
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
                  <ListItemIcon
                    sx={{
                      minWidth: 28,
                      color: '#dbeafe'
                    }}
                  >
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
                      const active = isActive(location.pathname, item.path)
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
                          <ListItemIcon
                            sx={{
                              minWidth: 24,
                              color: active ? '#ffffff' : '#cbd5e1'
                            }}
                          >
                            {item.icon}
                          </ListItemIcon>
                          <ListItemText
                            primary={item.label}
                            primaryTypographyProps={{
                              fontSize: 11.6,
                              fontWeight: active ? 800 : 600,
                              color: '#f8fafc',
                              lineHeight: 1.2
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
    </StyledDrawer>
  )
}

function StackedBrand() {
  return (
    <Box sx={{ display: 'grid', gap: 0.55 }}>
      <StackRow>
        <Chip size="small" label="FROGFOOT NOC" color="primary" sx={{ bgcolor: 'rgba(45,212,191,0.18)', color: '#ccfbf1' }} />
        <Chip size="small" label="xneelo live" sx={{ bgcolor: 'rgba(59,130,246,0.18)', color: '#dbeafe' }} />
      </StackRow>
      <Typography sx={{ fontSize: 18, fontWeight: 800, lineHeight: 1.05, color: '#f8fafc', letterSpacing: -0.4 }}>
        NOC Adherence Portal
      </Typography>
      <Typography sx={{ fontSize: 11.2, lineHeight: 1.45, color: 'rgba(226,232,240,0.82)' }}>
        Operations, engineering, SLA reporting, and stock control in one shared workspace.
      </Typography>
    </Box>
  )
}

function StackRow({ children }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.6, flexWrap: 'wrap', alignItems: 'center' }}>
      {children}
    </Box>
  )
}

function FloatingTechUserStatus() {
  const location = useLocation()

  if (!location.pathname.startsWith('/tech')) return null
  return <UserStatus />
}

const routerBasename = (import.meta.env.BASE_URL || '/').replace(/\/$/, '') || '/'

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter basename={routerBasename}>
          <SideNav />
          <AppFrame drawerWidth={DRAWER_WIDTH}>
            <FloatingTechUserStatus />

            <Routes>
              <Route path="/login" element={<LoginPage />} />

              <Route
                path="/tech"
                element={
                  <ThemeProvider theme={techTheme}>
                    <TechShell />
                  </ThemeProvider>
                }
              >
                <Route index element={<Navigate to="/tech/my-day" replace />} />
                <Route path="login" element={<TechLoginPage />} />
                <Route path="my-day" element={<TechMyDayPage />} />
                <Route path="appointments/:id" element={<TechAppointmentDetailPage />} />
              </Route>

              <Route element={<ProtectedRoute />}>
                <Route path="/" element={<AdherencePage />} />
                <Route path="/schedule" element={<SchedulePage />} />
                <Route path="/volume" element={<VolumePage />} />
                <Route path="/roster" element={<RosterUpload />} />
                <Route path="/agents" element={<AgentsPage />} />
                <Route path="/staffing" element={<StaffingPage />} />
                <Route path="/shifts" element={<ShiftManager />} />
                <Route path="/leave-planner" element={<LeavePlannerPage />} />
                <Route path="/workforce" element={<WorkforcePage />} />
                <Route path="/managers" element={<Navigate to="/settings/users" replace />} />
                <Route path="/settings/users" element={<UserAdminPage />} />
                <Route path="/engineering/nlds" element={<NldLightLevelsPage />} />
                <Route path="/nld-mapping" element={<NldMappingPage />} />
                <Route path="/nld-map" element={<NldMapPage />} />
                <Route path="/nld-uptime" element={<NldUptimePage />} />
                <Route path="/nld-admin" element={<CircuitEditorPage />} />
                <Route path="/engineering/nld-services" element={<NldServicesPage />} />
                <Route path="/sla-reporting" element={<SlaReportingPage />} />
                <Route path="/stock-management" element={<StockManagementPage />} />
                <Route path="/overtime/capture" element={<OvertimeCapturePage />} />
                <Route path="/overtime/supervisor" element={<OvertimeSupervisorPage />} />
                <Route path="/overtime/manager" element={<OvertimeManagerPage />} />
                <Route path="/settings/signature" element={<SignaturePage />} />
                <Route path="/roc-appointments" element={<RocAppointmentsPage />} />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AppFrame>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  )
}
