import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  Button,
  TextField,
  Paper,
  Stack,
  Typography,
  IconButton,
  InputAdornment
} from '@mui/material'
import Visibility from '@mui/icons-material/Visibility'
import VisibilityOff from '@mui/icons-material/VisibilityOff'

export default function LoginPage () {
  const { login } = useAuth()
  const nav       = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw]     = useState(false)
  const [err, setErr]           = useState('')

  async function handleSubmit (e) {
    e.preventDefault()
    try {
      await login(email, password)
      nav('/')                            // go to dashboard
    } catch {
      setErr('Invalid credentials')
    }
  }

  return (
    <Paper sx={{ p: 2.5, maxWidth: 340, mx: 'auto', mt: 7, borderRadius: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 800, mb: 1 }}>Sign in</Typography>
      <Stack component="form" onSubmit={handleSubmit} spacing={1.25}>
        <TextField
          label="Email"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        <TextField
          label="Password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          type={showPw ? 'text' : 'password'}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label="toggle password visibility"
                  onClick={() => setShowPw(!showPw)}
                  edge="end"
                >
                  {showPw ? <VisibilityOff /> : <Visibility />}
                </IconButton>
              </InputAdornment>
            )
          }}
        />

        {err && <Typography color="error" variant="body2">{err}</Typography>}
        <Button type="submit" variant="contained">Login</Button>
      </Stack>
    </Paper>
  )
}
