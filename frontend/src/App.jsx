// frontend/src/App.js
import React, { useState, useEffect } from 'react'
import { CssBaseline, ThemeProvider, styled, Badge } from '@mui/material'
import theme from './theme'
import './lib/dayjs.js'            // registers plugins once
import { listVacancies } from './api/workforce'   // ← make sure the path is correct

import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Collapse,
} from '@mui/material'
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'

/* ── icons ─────────────────────────────────────────────── */
import DashboardIcon          from '@mui/icons-material/Dashboard'
import CalendarTodayIcon      from '@mui/icons-material/CalendarToday'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import BarChartIcon           from '@mui/icons-material/BarChart'
import UploadIcon             from '@mui/icons-material/Upload'
import WorkHistoryIcon        from '@mui/icons-material/WorkHistory'
import ExpandLess             from '@mui/icons-material/ExpandLess'
import ExpandMore             from '@mui/icons-material/ExpandMore'
import ManageAccountsIcon     from '@mui/icons-material/ManageAccounts';
import EventBusyIcon          from '@mui/icons-material/EventBusy';
import PeopleIcon             from '@mui/icons-material/People';
import LanOutlinedIcon        from '@mui/icons-material/LanOutlined';
import MapIcon                from '@mui/icons-material/Map'
import AvTimerIcon            from '@mui/icons-material/AvTimer'


/* ── pages ──────────────────────────────────────────────── */
import AdherencePage  from './pages/AdherencePage'
import SchedulePage   from './pages/SchedulePage'
import VolumePage     from './pages/VolumePage'
import RosterUpload   from './components/RosterUpload'
import LoginPage      from './pages/LoginPage'
import AgentsPage     from './pages/AgentsPage'
import StaffingPage   from './pages/StaffingPage'
import ShiftManager   from './pages/ShiftManager'
import LeavePlannerPage    from './pages/LeavePlannerPage'   
import WorkforcePage  from './pages/WorkforcePage'         
import NldLightLevelsPage  from './pages/NldLightLevelsPage'
import NldMappingPage     from './pages/NldMappingPage'
import ManagersPage       from './pages/ManagersPage'
import NldMapPage from './pages/NldMapPage'
import NldUptimePage from './pages/NldUptimePage'
import CircuitEditorPage from './pages/CircuitEditorPage'
import NldServicesPage from './pages/NldServicesPage.jsx'

/* ── auth / routing helpers ─────────────────────────────── */
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute            from './components/ProtectedRoute'
import UserStatus from './components/UserStatus'

/* ─── Drawer styling ────────────────────────────────────── */
const DRAWER_WIDTH = 250

const StyledDrawer = styled(Drawer)(({ theme }) => ({
  '& .MuiDrawer-paper': {
    width: DRAWER_WIDTH,
    backdropFilter: 'blur(6px)',
    background: 'rgb(0, 184, 75)',
    color: '#fff',
    borderRight: 'none',
  },
}))

/* helper to highlight the current route */
function isActive(pathname, itemPath) {
  if (itemPath === '/') return pathname === '/'
  return pathname.startsWith(itemPath)
}

/* ──────────────── SideNav ──────────────────────────────── */
function SideNav() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user || location.pathname === '/login') return null

  // --- vacancy badge state + loader ---
  const [vacancyCount, setVacancyCount] = useState(0)
  useEffect(() => {
    listVacancies(true).then(res => {
      setVacancyCount(res.data.length)
    })
  }, [])

  const sections = [
    {
      title: 'DAILY OPERATIONS',
      items: [
        { label:'Adherence Tracking', path:'/',                 icon:<DashboardIcon/> },
        { label:'Weekly Schedule',    path:'/schedule',         icon:<CalendarTodayIcon/> },
        { label:'Leave Planner',      path:'/leave-planner',    icon:<EventBusyIcon/> },
      ],
    },
    {
      title: 'STAFFING/SCHEDULING',
      items: [
        { label:'Volumes & Forecasting', path:'/volume',   icon:<BarChartIcon/> },
        { label:'Staffing & Scheduling', path:'/staffing', icon:<WorkHistoryIcon/> },
        { label:'Shift Manager',         path:'/shifts',   icon:<ManageAccountsIcon/> },
      ],
    },
    {
      title: 'SETTINGS',
      items: [
        {label: 'Workforce',
         path:  '/workforce',
         icon: (
            <Badge badgeContent={vacancyCount} color="secondary">
              <PeopleIcon/>
            </Badge>
              )
        },
        { label:'Admin',         path:'/agents', icon:<AdminPanelSettingsIcon/> },
        { label:'Upload Roster', path:'/roster', icon:<UploadIcon/> },
        ...(user.role === 'admin'
          ? [{ label:'Managers', path:'/managers', icon:<ManageAccountsIcon/> }]
          : []),
      ],
    },
    {
      title: 'ENGINEERING',
      items: [
        { label:'NLD Light Levels', path:'/engineering/nlds', icon:<LanOutlinedIcon/> },
        { label:'NLD Uptime',       path:'/nld-uptime',       icon:<AvTimerIcon/> },
        { label:'NLD Mapping',      path:'/nld-mapping',      icon:<MapIcon/> },
        { label:'NLD Map',          path:'/nld-map',          icon:<MapIcon/> },
        { label:'NLD Admin',        path:'/nld-admin',        icon:<AdminPanelSettingsIcon/> },
        { label:'NLD Services',     path:'/engineering/nld-services',     icon:<AdminPanelSettingsIcon/> },
      ],
    },
  ]

  const [openState, setOpenState] = useState(
    Object.fromEntries(sections.map(s => [s.title, true]))
  )

  return (
    <StyledDrawer variant="permanent">
      <List
        subheader={
          <ListSubheader
            disableSticky
            sx={{
              lineHeight: 1.2,
              fontSize: 18,
              fontWeight: 700,
              color: '#fff',
              bgcolor: 'transparent',
              mt: 1,
            }}
          >
            
          </ListSubheader>
        }
      >
        {sections.map(section => (
          <Box key={section.title}>
            <ListItemButton
              onClick={() =>
                setOpenState(o => ({ ...o, [section.title]: !o[section.title] }))
              }
              sx={{ px: 2, py: 1 }}
            >
              <ListItemText
                primary={section.title}
                primaryTypographyProps={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: 0.5,
                  color: '#fff',
                }}
              />
              {openState[section.title] ? <ExpandLess/> : <ExpandMore/>}
            </ListItemButton>

            <Collapse in={openState[section.title]} timeout="auto" unmountOnExit>
              <List component="div" disablePadding>
                {section.items.map(item => (
                  <ListItemButton
                    key={item.label}
                    component={Link}
                    to={item.path}
                    sx={{
                      pl: 4,
                      mb: 0.5,
                      borderRadius: 1,
                      bgcolor: isActive(location.pathname, item.path)
                        ? 'rgba(255,255,255,0.15)'
                        : 'transparent',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.08)' },
                    }}
                  >
                    <ListItemIcon sx={{ color:'#fff', minWidth:32 }}>
                      {item.icon}
                    </ListItemIcon>
                    <ListItemText primary={item.label}/>
                  </ListItemButton>
                ))}
              </List>
            </Collapse>
          </Box>
        ))}
      </List>
    </StyledDrawer>
  )
}

/* ──────────────────────── App ──────────────────────────── */
export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline/>
        <BrowserRouter basename="/noc-adherence">
          <SideNav/>
          <Box sx={{ ml:`${DRAWER_WIDTH}px`, p:3 }}>
            <UserStatus />
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage/>}/>

              {/* Protected */}
              <Route element={<ProtectedRoute/>}>
                <Route path="/"                 element={<AdherencePage/>}/>
                <Route path="/schedule"         element={<SchedulePage/>}/>
                <Route path="/volume"           element={<VolumePage/>}/>
                <Route path="/roster"           element={<RosterUpload/>}/>
                <Route path="/agents"           element={<AgentsPage/>}/>
                <Route path="/staffing"         element={<StaffingPage/>}/>
                <Route path="/shifts"           element={<ShiftManager/>}/>
                <Route path='/leave-planner'    element={<LeavePlannerPage />} />
                <Route path="/workforce"        element={<WorkforcePage />} />
                <Route path="/managers"         element={<ManagersPage />} />
                <Route path="/engineering/nlds" element={<NldLightLevelsPage/>} />
                <Route path="/nld-mapping"      element={<NldMappingPage/>}/>
                <Route path="/nld-map"          element={<NldMapPage/>}/>
                <Route path="/nld-uptime"       element={<NldUptimePage/>}/>
                <Route path="/nld-admin"       element={<CircuitEditorPage/>}/>
                <Route path="/engineering/nld-services" element={<NldServicesPage />} />
              </Route>

              {/* Fallback */}
              <Route path="*" element={<Navigate to="/" replace/>}/>
            </Routes>
          </Box>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  )
}
