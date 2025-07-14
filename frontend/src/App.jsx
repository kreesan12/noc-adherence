// frontend/src/App.js
import React, { useState } from 'react'
import { CssBaseline, ThemeProvider } from '@mui/material'
import { styled } from '@mui/material/styles'   // ← FIX
import theme from './theme'
import './lib/dayjs.js'            // registers plugins once

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

/* ── pages ──────────────────────────────────────────────── */
import AdherencePage  from './pages/AdherencePage'
import SchedulePage   from './pages/SchedulePage'
import VolumePage     from './pages/VolumePage'
import RosterUpload   from './components/RosterUpload'
import LoginPage      from './pages/LoginPage'
import AgentsPage     from './pages/AgentsPage'
import StaffingPage   from './pages/StaffingPage'
import ShiftManager   from './pages/ShiftManager'
import LeavePlannerPage    from './pages/LeavePlannerPage'   // ← NEW

/* ── auth / routing helpers ─────────────────────────────── */
import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute            from './components/ProtectedRoute'

/* ─── Drawer styling ────────────────────────────────────── */
const DRAWER_WIDTH = 230

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

  const sections = [
    {
      title: 'DAILY OPERATIONS',
      items: [
        { label:'Adherence Tracking', path:'/',          icon:<DashboardIcon/> },
        { label:'Weekly Schedule',    path:'/schedule',  icon:<CalendarTodayIcon/> },
      ],
    },
    {
      title: 'STAFFING  &  SCHEDULING',
      items: [
        { label:'Forecasting',           path:'/volume',   icon:<BarChartIcon/> },
        { label:'Staffing & Scheduling', path:'/staffing', icon:<WorkHistoryIcon/> },
        { label:'Shift Manager',         path:'/shifts',   icon:<ManageAccountsIcon/> },
        { label:'Leave Planner',         path:'/leave-planner',   icon:<EventBusyIcon/> },
      ],
    },
    {
      title: 'SETTINGS',
      items: [
        { label:'Admin',         path:'/agents', icon:<AdminPanelSettingsIcon/> },
        { label:'Upload Roster', path:'/roster', icon:<UploadIcon/> },
      ],
    },
  ]

  const [openState, setOpenState] = useState(
    Object.fromEntries(sections.map(s => [s.title, false]))
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
            NOC&nbsp;Dashboard
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
                  fontSize: 18,
                  fontWeight: 700,
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
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage/>}/>

              {/* Protected */}
              <Route element={<ProtectedRoute/>}>
                <Route path="/"         element={<AdherencePage/>}/>
                <Route path="/schedule" element={<SchedulePage/>}/>
                <Route path="/volume"   element={<VolumePage/>}/>
                <Route path="/roster"   element={<RosterUpload/>}/>
                <Route path="/agents"   element={<AgentsPage/>}/>
                <Route path="/staffing" element={<StaffingPage/>}/>
                <Route path="/shifts"   element={<ShiftManager/>}/>
                <Route path='/leave-planner'   element={<LeavePlannerPage />} />
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
