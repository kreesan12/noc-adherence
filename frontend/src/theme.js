
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
    h4: { fontWeight: 900, letterSpacing: -0.4, fontSize: '1.8rem' },
    h5: { fontWeight: 900, letterSpacing: -0.3, fontSize: '1.45rem' },
    h6: { fontWeight: 800, letterSpacing: -0.2, fontSize: '1.1rem' },
    subtitle1: { fontSize: '0.92rem' },
    subtitle2: { fontSize: '0.84rem', fontWeight: 700 },
    body1: { fontSize: '0.9rem' },
    body2: { fontSize: '0.82rem' },
    caption: { fontSize: '0.74rem' },
    button: { fontWeight: 800, textTransform: 'none', fontSize: '0.82rem' }
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { fontSize: '14px' },
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
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 22,
          '& .MuiChip-label': {
            paddingInline: 8,
            fontSize: '0.74rem'
          }
        }
      }
    },

    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 10 }
      }
    }
  }
})
