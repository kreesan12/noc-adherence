// frontend/src/App.js
import { ThemeProvider } from '@mui/material/styles'
import theme            from './theme'
import {CssBaseline, Drawer, List, ListItem, ListItemIcon, ListItemText} from '@mui/material'
import { BrowserRouter, Routes, Route, Link, Navigate, useLocation } from 'react-router-dom'

import DashboardIcon          from '@mui/icons-material/Dashboard'
import CalendarTodayIcon      from '@mui/icons-material/CalendarToday'
import AdminPanelSettingsIcon from '@mui/icons-material/AdminPanelSettings'
import BarChartIcon           from '@mui/icons-material/BarChart'
import UploadIcon             from '@mui/icons-material/Upload'

import AdherencePage  from './pages/AdherencePage'
import SchedulePage   from './pages/SchedulePage'
import VolumePage     from './pages/VolumePage'
import RosterUpload   from './components/RosterUpload'
import LoginPage      from './pages/LoginPage'
import AgentsPage     from './pages/AgentsPage'
import StaffingPage   from './pages/StaffingPage'

import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'

function SideNav() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  if (!user || pathname === '/login') return null

  const items = [
    { label: 'Adherence',    path: '/',          icon: <DashboardIcon /> },
    { label: 'Schedule',     path: '/schedule',  icon: <CalendarTodayIcon /> },
    { label: 'Admin',        path: '/agents',    icon: <AdminPanelSettingsIcon /> },
    { label: 'Volume',       path: '/volume',    icon: <BarChartIcon /> },
    { label: 'Upload Roster',path: '/roster',    icon: <UploadIcon /> },
  ]

  return (
    <Drawer variant="permanent" sx={{ width:200, '& .MuiDrawer-paper':{ width:200 } }}>
      <List>
        {items.map(item => (
          <ListItem
            button
            key={item.label}
            component={Link}
            to={item.path}
          >
            <ListItemIcon>
              {item.icon}
            </ListItemIcon>
            <ListItemText primary={item.label} />
          </ListItem>
        ))}
      </List>
    </Drawer>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline/>
        <BrowserRouter basename="/noc-adherence">
          <SideNav/>
          <main style={{ marginLeft:200, padding:24 }}>
            <Routes>
              {/* Public */}
              <Route path="/login" element={<LoginPage/>}/>

              {/* Protected */}
              <Route element={<ProtectedRoute/>}>
                <Route path="/"          element={<AdherencePage/>}/>
                <Route path="/schedule"  element={<SchedulePage/>}/>
                <Route path="/volume"    element={<VolumePage/>}/>
                <Route path="/roster"    element={<RosterUpload/>}/>
                <Route path="/agents"    element={<AgentsPage/>}/>
                <Route path="/staffing"  element={<StaffingPage />} />
              </Route>

              {/* Catch-all → if you hit any other path, send to "/" (which will itself redirect to /login if unauth'd) */}
              <Route path="*" element={<Navigate to="/" replace/>}/>
            </Routes>
          </main>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  )
}
