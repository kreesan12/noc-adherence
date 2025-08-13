// frontend/src/components/UserStatus.jsx
import { useEffect, useState } from 'react'
import { Box, Button, Typography } from '@mui/material'
import { useAuth } from '../context/AuthContext'

export default function UserStatus() {
  const { user } = useAuth()                 // ← trust the context (works in SideNav)
  const [fallbackUser, setFallbackUser] = useState(null)

  // Fallback: if context is momentarily null, decode the JWT to show something
  useEffect(() => {
    if (!user) {
      const t = localStorage.getItem('token')
      if (t) {
        try {
          const payload = JSON.parse(atob(t.split('.')[1]))
          setFallbackUser({ name: payload.name, role: payload.role })
        } catch {}
      }
    }
  }, [user])

  const display = user ?? fallbackUser

  const handleLogout = () => {
    // if your AuthContext exposes logout(), call it here instead
    localStorage.removeItem('token')
    window.location.href = '/noc-adherence/login'
  }

  return (
    <Box sx={{
      position:'fixed', top:8, left:8, zIndex:2000,
      bgcolor:'white', border:'1px solid #ddd', borderRadius:1,
      px:1, py:0.5, boxShadow:1
    }}>
      {display ? (
        <>
          <Typography variant="body2">
            <strong>{display.name}</strong>{' '}
            <span style={{opacity:.8}}>({display.role})</span>
          </Typography>
          <Button size="small" variant="text" onClick={handleLogout}>Logout</Button>
        </>
      ) : (
        <Typography variant="body2">Not logged in</Typography>
      )}
    </Box>
  )
}
