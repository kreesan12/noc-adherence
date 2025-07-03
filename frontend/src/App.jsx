import { ThemeProvider } from '@mui/material/styles'
import theme from './theme'
import { CssBaseline, Drawer, List, ListItem, ListItemText } from '@mui/material'
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom'
import AdherencePage from './pages/AdherencePage'
import SchedulePage  from './pages/SchedulePage'
import VolumePage    from './pages/VolumePage'
import RosterUpload  from './components/RosterUpload'

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline/>
      <BrowserRouter basename="/noc-adherence">
        <Drawer variant="permanent" sx={{ width:200, [`& .MuiDrawer-paper`]:{ width:200 } }}>
          <List>
            {[
              ['Adherence','/'],
              ['Schedule','/schedule'],
              ['Volume','/volume'],
              ['Roster Upload','/roster']
            ].map(([label,path])=>(
              <ListItem button key={label} component={Link} to={path}>
                <ListItemText primary={label}/>
              </ListItem>
            ))}
          </List>
        </Drawer>

        <main style={{ marginLeft:200, padding:24 }}>
          <Routes>
            <Route path="/" element={<AdherencePage/>}/>
            <Route path="/schedule" element={<SchedulePage/>}/>
            <Route path="/volume" element={<VolumePage/>}/>
            <Route path="/roster" element={<RosterUpload/>}/>
          </Routes>
        </main>
      </BrowserRouter>
    </ThemeProvider>
  )
}
