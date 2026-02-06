// frontend/src/techApp/TechLoginPage.jsx
import { useState } from 'react'
import { Box, Paper, Typography, TextField, Button } from '@mui/material'
import { techLogin } from './techApi'
import { useNavigate } from 'react-router-dom'

export default function TechLoginPage() {
  const nav = useNavigate()
  const [phone, setPhone] = useState('')
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    setErr('')
    setBusy(true)
    try {
      const data = await techLogin({ phone, pin })
      localStorage.setItem('techToken', data.token)
      localStorage.setItem('techName', data.tech?.name || '')
      nav('/tech', { replace: true })
    } catch (e) {
      setErr(String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 8 }}>
      <Paper variant="outlined" sx={{ width: 420, p: 3, borderRadius: 3 }}>
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Technician Login
        </Typography>

        <Typography sx={{ opacity: 0.8, mt: 1 }}>
          Enter your phone and PIN.
        </Typography>

        <TextField
          label="Phone"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          fullWidth
          sx={{ mt: 2 }}
        />
        <TextField
          label="PIN"
          value={pin}
          onChange={e => setPin(e.target.value)}
          fullWidth
          sx={{ mt: 2 }}
        />

        {err ? (
          <Typography sx={{ mt: 2, color: 'crimson' }}>
            {err}
          </Typography>
        ) : null}

        <Button
          variant="contained"
          fullWidth
          sx={{ mt: 2 }}
          onClick={submit}
          disabled={busy}
        >
          Sign in
        </Button>
      </Paper>
    </Box>
  )
}
