// frontend/src/components/ProtectedRoute.jsx
import { useAuth }     from '../context/AuthContext'
import { Navigate, Outlet } from 'react-router-dom'

export default function ProtectedRoute() {
  const { user } = useAuth()
  // if no user, send them to /login
  if (!user) {
    return <Navigate to="/login" replace />
  }
  // otherwise render whatever nested routes are inside
  return <Outlet />
}
