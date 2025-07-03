import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Button, TextField, Paper, Stack, Typography } from '@mui/material'

export default function LoginPage () {
  const { login } = useAuth()
  const nav       = useNavigate()
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
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
    <Paper sx={{ p:4, maxWidth:360, mx:'auto', mt:10 }}>
      <Typography variant="h5" gutterBottom>Sign in</Typography>
      <Stack component="form" onSubmit={handleSubmit} spacing={2}>
        <TextField label="Email"    value={email}    onChange={e=>setEmail(e.target.value)} />
        <TextField label="Password" value={password} onChange={e=>setPassword(e.target.value)}
                   type="password" />
        {err && <Typography color="error">{err}</Typography>}
        <Button type="submit" variant="contained">Login</Button>
      </Stack>
    </Paper>
  )
}
