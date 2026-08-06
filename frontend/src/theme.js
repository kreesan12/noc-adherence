import { alpha, createTheme } from '@mui/material/styles'

const primaryMain = '#0f766e'
const secondaryMain = '#2563eb'
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
      default: '#f7fafc',
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
    h4: { fontWeight: 800, letterSpacing: -0.6, fontSize: '1.55rem', lineHeight: 1.08 },
    h5: { fontWeight: 800, letterSpacing: -0.45, fontSize: '1.32rem', lineHeight: 1.1 },
    h6: { fontWeight: 800, letterSpacing: -0.25, fontSize: '1.04rem', lineHeight: 1.12 },
    subtitle1: { fontSize: '0.9rem', fontWeight: 700 },
    subtitle2: { fontSize: '0.78rem', fontWeight: 800, letterSpacing: 0.15 },
    body1: { fontSize: '0.84rem', lineHeight: 1.45 },
    body2: { fontSize: '0.76rem', lineHeight: 1.45 },
    caption: { fontSize: '0.7rem', lineHeight: 1.4 },
    button: { fontWeight: 800, textTransform: 'none', fontSize: '0.76rem', letterSpacing: 0.1 }
  },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        html: { fontSize: '13px' },
        body: { backgroundColor: '#f7fafc' },
        '#root': { minHeight: '100vh' }
      }
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          border: `1px solid ${alpha(ink, 0.07)}`,
          backgroundImage: 'none',
          boxShadow: '0 18px 38px rgba(15, 23, 42, 0.045)'
        }
      }
    },

    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 14
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
          paddingBlock: 6,
          boxShadow: 'none'
        }
      }
    },

    MuiTextField: {
      defaultProps: { size: 'small' }
    },

    MuiFormLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.76rem',
          fontWeight: 700,
          color: '#475569'
        }
      }
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
          backgroundColor: alpha('#ffffff', 0.92)
        },
        input: {
          padding: '8px 10px'
        }
      }
    },

    MuiInputLabel: {
      styleOverrides: {
        root: {
          fontSize: '0.76rem'
        }
      }
    },

    MuiDrawer: {
      styleOverrides: {
        paper: {
          boxShadow: '20px 0 48px rgba(15, 23, 42, 0.18)'
        }
      }
    },

    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 10
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
          fontWeight: 800,
          color: '#334155',
          backgroundColor: alpha(primaryMain, 0.04)
        }
      }
    },

    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 34,
          paddingInline: 9,
          paddingBlock: 7,
          fontSize: '0.76rem',
          fontWeight: 700
        }
      }
    },

    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 36
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

    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 12,
          '&:last-child': {
            paddingBottom: 12
          }
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

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 999,
          height: 21,
          fontWeight: 700,
          '& .MuiChip-label': {
            paddingInline: 8,
            fontSize: '0.68rem'
          }
        }
      }
    },

    MuiDialog: {
      styleOverrides: {
        paper: { borderRadius: 14 }
      }
    },

    MuiDialogTitle: {
      styleOverrides: {
        root: {
          padding: '12px 14px 8px',
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

    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          overflow: 'hidden',
          '&:before': {
            display: 'none'
          }
        }
      }
    },

    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 12
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
          borderRadius: 14,
          backgroundColor: '#ffffff'
        },
        columnHeaders: {
          fontSize: '0.72rem',
          backgroundColor: alpha(primaryMain, 0.04)
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
