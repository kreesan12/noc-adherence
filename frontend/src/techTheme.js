
// frontend/src/techTheme.js
import { createTheme, alpha } from '@mui/material/styles'

export default createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1E88E5' },      // strong action blue
    secondary: { main: '#0B6E4F' },
    background: {
      default: '#F3F6FB',
      paper: '#FFFFFF'
    },
    text: {
      primary: '#0F172A',
      secondary: '#475569'
    },
    divider: alpha('#0F172A', 0.08),
    success: { main: '#16A34A' },
    warning: { main: '#F59E0B' },
    error: { main: '#DC2626' }
  },

  shape: { borderRadius: 10 },

  typography: {
    fontFamily: [
      'Inter',
      'system-ui',
      '-apple-system',
      'Segoe UI',
      'Roboto',
      'Helvetica',
      'Arial',
      'sans-serif'
    ].join(','),
    h5: { fontWeight: 950, letterSpacing: -0.4 },
    h6: { fontWeight: 900, letterSpacing: -0.3 },
    button: { fontWeight: 900, textTransform: 'none' }
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#F3F6FB' },
        '#root': { minHeight: '100vh' }
      }
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid rgba(15, 23, 42, 0.08)',
          backgroundImage: 'none'
        }
      }
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 12,
          paddingInline: 14,
          paddingBlock: 12
        }
      }
    },

    MuiAppBar: {
      styleOverrides: {
        root: {
          background: '#FFFFFF',
          color: '#0F172A',
          borderBottom: '1px solid rgba(15, 23, 42, 0.08)'
        }
      }
    },

    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          borderTop: '1px solid rgba(15, 23, 42, 0.08)',
          background: '#FFFFFF'
        }
      }
    },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999, fontWeight: 800 }
      }
    }
  }
})
