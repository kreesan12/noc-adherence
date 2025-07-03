// frontend/src/theme.js
import { createTheme } from '@mui/material/styles'

// ---------- LIGHT PALETTE ----------
export default createTheme({
  palette: {
    mode:    'light',

    // primary buttons / highlights
    primary:   { main: '#1976d2' },     // MUI blue[700]
    secondary: { main: '#009688' },     // teal[500]

    background: {
      default: '#ffffff',               // page background
      paper:   '#fafafa'                // cards / drawers
    },

    text: {
      primary:   '#1a1a1a',             // near-black
      secondary: '#555555'              // mid-grey
    }
  },

  // ---------- Component tweaks ----------
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          // a very light grey behind the drawer shadow
          backgroundColor: '#ffffff'
        }
      }
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#f5f5f5',   // lighter drawer
          color: '#1a1a1a'
        }
      }
    },
    MuiDataGrid: {
      styleOverrides: {
        root: { fontSize: 14 },
        columnHeaders: { backgroundColor: '#f0f0f0' }
      }
    }
  }
})
