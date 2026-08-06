// frontend/src/components/ProtectedRoute.jsx
import { useAuth }     from '../context/AuthContext'
import { Navigate, Outlet } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'

export default function ProtectedRoute() {
  const { user, authReady } = useAuth()

  if (!authReady) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <CircularProgress size={26} />
      </Box>
    )
  }

  // if no user, send them to /login
  if (!user) {
    return <Navigate to="/login" replace />
  }
  // otherwise render whatever nested routes are inside
  return <Outlet />
}
