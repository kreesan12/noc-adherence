
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

  shape: { borderRadius: 8 },

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
    h5: { fontWeight: 950, letterSpacing: -0.4, fontSize: '1.45rem' },
    h6: { fontWeight: 900, letterSpacing: -0.3, fontSize: '1.08rem' },
    subtitle1: { fontSize: '0.92rem' },
    subtitle2: { fontSize: '0.84rem', fontWeight: 700 },
    body1: { fontSize: '0.9rem' },
    body2: { fontSize: '0.82rem' },
    caption: { fontSize: '0.74rem' },
    button: { fontWeight: 900, textTransform: 'none', fontSize: '0.82rem' }
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { fontSize: '14px' },
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
          borderRadius: 10,
          minHeight: 34,
          paddingInline: 12,
          paddingBlock: 7
        }
      }
    },

    MuiTextField: {
      defaultProps: { size: 'small' }
    },

    MuiInputBase: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          fontSize: '0.84rem'
        }
      }
    },

    MuiOutlinedInput: {
      styleOverrides: {
        input: {
          padding: '9px 11px'
        }
      }
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.8rem'
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
        root: {
          borderRadius: 999,
          fontWeight: 800,
          height: 22,
          '& .MuiChip-label': {
            paddingInline: 8,
            fontSize: '0.74rem'
          }
        }
      }
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '8px 10px',
          fontSize: '0.82rem'
        },
        head: {
          fontSize: '0.76rem',
          fontWeight: 800
        }
      }
    },

    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 36,
          paddingInline: 10,
          paddingBlock: 8,
          fontSize: '0.82rem'
        }
      }
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 34,
          fontSize: '0.84rem'
        }
      }
    },

    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 14,
          '&:last-child': {
            paddingBottom: 14
          }
        }
      }
    }
  }
})
