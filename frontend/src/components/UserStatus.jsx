// frontend/src/components/UserStatus.jsx
import { useEffect, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import api from '../api'

export default function UserStatus() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    api.get('/me')
      .then(res => setUser(res.data))
      .catch(() => setUser(null))
  }, [])

  const handleLogout = () => {
    localStorage.removeItem('token')
    window.location.href = '/login'
  }

  return (
    <Box sx={{
      position:'fixed', top:8, right:8, zIndex:2000,
      bgcolor:'white', border:'1px solid #ddd', borderRadius:1,
      px:1, py:0.5, boxShadow:1
    }}>
      {user ? (
        <>
          <Typography variant="body2">
            <strong>{user.name}</strong> ({user.role})
          </Typography>
          <Button size="small" variant="text" onClick={handleLogout}>Logout</Button>
        </>
      ) : (
        <Typography variant="body2">Not logged in</Typography>
      )}
    </Box>
  )
}
