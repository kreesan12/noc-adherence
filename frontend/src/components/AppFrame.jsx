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
        p: reserveDrawer ? { xs: 0, md: 3 } : 0,
        width: '100%'
      }}
    >
      {children}
    </Box>
  )
}
