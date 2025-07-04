// frontend/src/App.js
import { ThemeProvider } from '@mui/material/styles'
import theme            from './theme'
import { CssBaseline, Drawer, List, ListItem, ListItemText } from '@mui/material'
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'

import AdherencePage  from './pages/AdherencePage'
import SchedulePage   from './pages/SchedulePage'
import VolumePage     from './pages/VolumePage'
import RosterUpload   from './components/RosterUpload'
import LoginPage      from './pages/LoginPage'
import AgentsPage     from './pages/AgentsPage'

import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'

function SideNav() {
  const { user } = useAuth()
  if (!user) return null
  const items = [
    ['Adherence'    , '/'],
    ['Schedule'     , '/schedule'],
    ['Agents'       , '/agents'],
    ['Volume'       , '/volume'],
    ['Roster Upload', '/roster'],
  ]
  return (
    <Drawer variant="permanent" sx={{ width:200, '& .MuiDrawer-paper':{ width:200 } }}>
      <List>
        {items.map(([label, path]) => (
          <ListItem button key={label} component={Link} to={path}>
            <ListItemText primary={label}/>
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
