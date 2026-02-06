// frontend/src/theme.js
import { createTheme, alpha } from '@mui/material/styles'

export default createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0B6E4F' },     // Frogfoot-ish green
    secondary: { main: '#1E88E5' },   // crisp blue for accents
    background: {
      default: '#F6F8FB',
      paper: '#FFFFFF'
    },
    text: {
      primary: '#111827',
      secondary: '#4B5563'
    },
    divider: alpha('#111827', 0.08)
  },

  shape: { borderRadius: 14 },

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
    h4: { fontWeight: 900, letterSpacing: -0.4 },
    h5: { fontWeight: 900, letterSpacing: -0.3 },
    h6: { fontWeight: 800, letterSpacing: -0.2 },
    button: { fontWeight: 800, textTransform: 'none' }
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: '#F6F8FB' },
        '#root': { minHeight: '100vh' }
      }
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid rgba(17, 24, 39, 0.08)',
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
          paddingBlock: 10
        }
      }
    },

    MuiTextField: {
      defaultProps: { size: 'small' }
    },

    MuiInputBase: {
      styleOverrides: {
        root: { borderRadius: 12 }
      }
    },

    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 999 }
      }
    },

    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 18 }
      }
    }
  }
})
