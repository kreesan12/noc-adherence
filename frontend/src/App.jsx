// frontend/src/App.js
import { ThemeProvider } from '@mui/material/styles'
import theme              from './theme'
import {
  CssBaseline,
  Drawer,
  List, ListItem, ListItemText
}                         from '@mui/material'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'

import AdherencePage from './pages/AdherencePage'
import SchedulePage  from './pages/SchedulePage'
import VolumePage    from './pages/VolumePage'
import RosterUpload  from './components/RosterUpload'
import LoginPage     from './pages/LoginPage'

import { AuthProvider, useAuth } from './context/AuthContext'
import ProtectedRoute   from './components/ProtectedRoute'

/* -------- Drawer rendered only when a user is logged in -------- */
function SideNav () {
  const { user } = useAuth()
  if (!user) return null          // hide drawer on /login
  const items = [
    ['Adherence'   , '/'],
    ['Schedule'    , '/schedule'],
    ['Volume'      , '/volume'],
    ['Roster Upload', '/roster']
  ]
  return (
    <Drawer variant="permanent"
            sx={{ width:200, [`& .MuiDrawer-paper`]:{ width:200 } }}>
      <List>
        {items.map(([label, path]) => (
          <ListItem button key={label} component={Link} to={path}>
            <ListItemText primary={label} />
          </ListItem>
        ))}
      </List>
    </Drawer>
  )
}

export default function App () {
  return (
    <AuthProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <BrowserRouter basename="/noc-adherence">

          {/* drawer appears only when authenticated */}
          <SideNav />

          <main style={{ marginLeft:200, padding:24 }}>
            <Routes>
              {/* -------- public route -------- */}
              <Route path="/login" element={<LoginPage />} />

              {/* -------- protected routes ----- */}
              <Route element={<ProtectedRoute />}>
                <Route path="/"          element={<AdherencePage />} />
                <Route path="/schedule"  element={<SchedulePage  />} />
                <Route path="/volume"    element={<VolumePage    />} />
                <Route path="/roster"    element={<RosterUpload  />} />
              </Route>
            </Routes>
          </main>

        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  )
}
