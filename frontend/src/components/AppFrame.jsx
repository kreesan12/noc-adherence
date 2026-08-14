// frontend/src/components/AppFrame.jsx
import { Box } from '@mui/material'
import { useLocation } from 'react-router-dom'

export default function AppFrame({ drawerWidth, reserveDrawer = true, compact = false, children }) {
  const location = useLocation()
  const isLogin = location.pathname === '/login'
  const shouldReserveDrawer = !isLogin && reserveDrawer

  return (
    <Box
      sx={{
        position: 'relative',
        ml: shouldReserveDrawer ? { xs: 0, md: `${drawerWidth}px` } : 0,
        p: shouldReserveDrawer
          ? { xs: 0.8, md: compact ? 0.95 : 1.2 }
          : compact
            ? { xs: 0.7, md: 0.85 }
            : 0,
        width: shouldReserveDrawer ? { xs: '100%', md: `calc(100% - ${drawerWidth}px)` } : '100%',
        maxWidth: '100%',
        minHeight: '100vh',
        minWidth: 0,
        boxSizing: 'border-box',
        overflowX: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: shouldReserveDrawer
            ? 'radial-gradient(circle at top left, rgba(15, 118, 110, 0.08) 0%, transparent 24%), radial-gradient(circle at top right, rgba(37, 99, 235, 0.08) 0%, transparent 18%)'
            : 'radial-gradient(circle at top center, rgba(15, 118, 110, 0.08) 0%, transparent 24%)'
        }
      }}
    >
      <Box sx={{ position: 'relative', zIndex: 1 }}>
        {children}
      </Box>
    </Box>
  )
}
