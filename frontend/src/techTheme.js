import { alpha, createTheme } from '@mui/material/styles'

const primaryMain = '#1d4ed8'
const secondaryMain = '#0f766e'
const ink = '#0f172a'

export default createTheme({
  palette: {
    mode: 'light',
    primary: { main: primaryMain },
    secondary: { main: secondaryMain },
    success: { main: '#16a34a' },
    warning: { main: '#f59e0b' },
    error: { main: '#dc2626' },
    info: { main: '#0284c7' },
    background: {
      default: '#f3f7fb',
      paper: '#ffffff'
    },
    text: {
      primary: ink,
      secondary: '#475569'
    },
    divider: alpha(ink, 0.08)
  },

  shape: { borderRadius: 10 },

  typography: {
    fontFamily: [
      'Manrope',
      'system-ui',
      '-apple-system',
      'BlinkMacSystemFont',
      'Segoe UI',
      'sans-serif'
    ].join(','),
    h5: { fontWeight: 800, letterSpacing: -0.45, fontSize: '1.28rem' },
    h6: { fontWeight: 800, letterSpacing: -0.28, fontSize: '1.02rem' },
    subtitle1: { fontSize: '0.88rem', fontWeight: 700 },
    subtitle2: { fontSize: '0.78rem', fontWeight: 800 },
    body1: { fontSize: '0.82rem', lineHeight: 1.45 },
    body2: { fontSize: '0.76rem', lineHeight: 1.45 },
    caption: { fontSize: '0.7rem' },
    button: { fontWeight: 800, textTransform: 'none', fontSize: '0.76rem' }
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { fontSize: '13px' },
        body: { backgroundColor: '#f3f7fb' },
        '#root': { minHeight: '100vh' }
      }
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: '1px solid rgba(15, 23, 42, 0.08)',
          backgroundImage: 'none',
          boxShadow: '0 16px 36px rgba(15, 23, 42, 0.05)'
        }
      }
    },

    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: 10,
          minHeight: 31,
          paddingInline: 11,
          paddingBlock: 6
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
          fontSize: '0.78rem'
        }
      }
    },

    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          backgroundColor: alpha('#ffffff', 0.94)
        },
        input: {
          padding: '8px 10px'
        }
      }
    },

    MuiAppBar: {
      styleOverrides: {
        root: {
          background: alpha('#ffffff', 0.96),
          color: ink,
          borderBottom: '1px solid rgba(15, 23, 42, 0.08)',
          backdropFilter: 'blur(10px)'
        }
      }
    },

    MuiBottomNavigation: {
      styleOverrides: {
        root: {
          borderTop: '1px solid rgba(15, 23, 42, 0.08)',
          background: alpha('#ffffff', 0.96),
          backdropFilter: 'blur(10px)'
        }
      }
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          fontWeight: 800,
          height: 21,
          '& .MuiChip-label': {
            paddingInline: 8,
            fontSize: '0.68rem'
          }
        }
      }
    },

    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '7px 9px',
          fontSize: '0.76rem'
        },
        head: {
          fontSize: '0.72rem',
          fontWeight: 800
        }
      }
    },

    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 34,
          paddingInline: 9,
          paddingBlock: 7,
          fontSize: '0.76rem'
        }
      }
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 32,
          fontSize: '0.78rem'
        }
      }
    },

    MuiToolbar: {
      styleOverrides: {
        root: {
          minHeight: 44,
          '@media (min-width: 600px)': {
            minHeight: 44
          }
        }
      }
    },

    MuiFormControlLabel: {
      styleOverrides: {
        label: {
          fontSize: '0.76rem'
        }
      }
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          padding: '12px 14px',
          fontSize: '0.96rem',
          fontWeight: 800
        }
      }
    },

    MuiDialogContent: {
      styleOverrides: {
        root: {
          padding: '10px 14px'
        }
      }
    },

    MuiDialogActions: {
      styleOverrides: {
        root: {
          padding: '10px 14px 14px'
        }
      }
    },

    MuiDataGrid: {
      defaultProps: {
        rowHeight: 32,
        columnHeaderHeight: 34
      },
      styleOverrides: {
        root: {
          fontSize: '0.76rem',
          borderRadius: 12
        },
        columnHeaders: {
          fontSize: '0.72rem'
        },
        columnHeaderTitle: {
          fontWeight: 800
        },
        cell: {
          paddingInline: 8
        },
        footerContainer: {
          minHeight: 36
        },
        toolbarContainer: {
          padding: '6px 8px'
        }
      }
    }
  }
})
