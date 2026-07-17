// frontend/src/components/AppFrame.jsx
import { Box } from '@mui/material'
import { useLocation } from 'react-router-dom'

export default function AppFrame({ drawerWidth, children }) {
  const location = useLocation()
  const isTech = location.pathname.startsWith('/tech')
  const isLogin = location.pathname === '/login'

  // Tech app and login should not reserve drawer space
  const reserveDrawer = !isTech && !isLogin

  return (
    <Box
      sx={{
        ml: reserveDrawer ? { xs: 0, md: `${drawerWidth}px` } : 0,
        p: reserveDrawer ? { xs: 0, md: 1.5 } : 0,
        width: reserveDrawer ? { xs: '100%', md: `calc(100% - ${drawerWidth}px)` } : '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
        overflowX: 'hidden'
      }}
    >
      {children}
    </Box>
  )
}
