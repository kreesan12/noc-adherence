// frontend/src/pages/TechLoginPage.jsx
import { useState } from 'react'
import { Box, Paper, Typography, TextField, Button } from '@mui/material'
import { techLogin } from '../api/techAuth'
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
      const r = await techLogin({ phone, pin })
      const data = r.data
      localStorage.setItem('techToken', data.token)
      localStorage.setItem('techName', data.tech?.name || '')
      if (data.tech?.id) localStorage.setItem('techId', data.tech.id)
      nav('/tech/my-day', { replace: true })
    } catch (e) {
      setErr(e?.response?.data?.error || e?.response?.data || e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '70vh', px: 1 }}>
      <Paper variant="outlined" sx={{ width: '100%', maxWidth: 440, p: 3, borderRadius: 4 }}>
        <Typography variant="h5" sx={{ fontWeight: 950 }}>
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
          inputProps={{ inputMode: 'tel' }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />

        <TextField
          label="PIN"
          type="password"
          value={pin}
          onChange={e => setPin(e.target.value)}
          fullWidth
          sx={{ mt: 2 }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
        />

        {err ? (
          <Typography sx={{ mt: 2, color: 'error.main', fontWeight: 700 }}>
            {String(err)}
          </Typography>
        ) : null}

        <Button
          variant="contained"
          fullWidth
          sx={{ mt: 2, py: 1.4, borderRadius: 3 }}
          onClick={submit}
          disabled={busy}
        >
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </Paper>
    </Box>
  )
}
