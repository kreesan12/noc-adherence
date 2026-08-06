import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  TextField,
  Typography
} from '@mui/material'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded'
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded'
import HubRoundedIcon from '@mui/icons-material/HubRounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded'
import { useAuth } from '../context/AuthContext'

export default function LoginPage() {
  const { login, user, authReady } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (authReady && user) {
      nav('/', { replace: true })
    }
  }, [authReady, user, nav])

  async function handleSubmit(event) {
    event.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await login(email, password)
      nav('/', { replace: true })
    } catch {
      setErr('Invalid credentials. Please check the email and password and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        px: 1.4,
        py: 2
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 940,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.15fr 0.85fr' },
          gap: 1.1
        }}
      >
        <Paper
          sx={{
            p: { xs: 1.5, md: 1.8 },
            borderRadius: 3,
            background:
              'radial-gradient(circle at top left, rgba(45,212,191,0.18) 0%, transparent 28%), linear-gradient(145deg, #0f5f61 0%, #11485a 36%, #16233f 100%)',
            color: '#f8fafc',
            minHeight: 360,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between'
          }}
        >
          <Box>
            <Stack direction="row" spacing={0.7} sx={{ mb: 1.1, flexWrap: 'wrap' }}>
              <Chip size="small" label="FROGFOOT NOC" sx={{ bgcolor: 'rgba(255,255,255,0.12)', color: '#ecfeff' }} />
              <Chip size="small" label="Operations Portal" sx={{ bgcolor: 'rgba(191,219,254,0.16)', color: '#dbeafe' }} />
            </Stack>
            <Typography variant="h4" sx={{ color: '#ffffff', maxWidth: 460 }}>
              One workspace for operations, engineering, SLA control, and stock visibility.
            </Typography>
            <Typography sx={{ mt: 0.9, fontSize: 13.2, lineHeight: 1.6, color: 'rgba(226,232,240,0.86)', maxWidth: 520 }}>
              Sign in to manage daily operations, NLD health, SLA performance, and regional stock positions from the same live platform.
            </Typography>
          </Box>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap">
            <FeatureChip icon={<ShieldRoundedIcon fontSize="small" />} label="Role-based access" />
            <FeatureChip icon={<HubRoundedIcon fontSize="small" />} label="Shared engineering data" />
            <FeatureChip icon={<InsightsRoundedIcon fontSize="small" />} label="Live SLA reporting" />
            <FeatureChip icon={<Inventory2RoundedIcon fontSize="small" />} label="Stock oversight" />
          </Stack>
        </Paper>

        <Paper sx={{ p: { xs: 1.4, md: 1.6 }, borderRadius: 3 }}>
          <Stack spacing={1.15} component="form" onSubmit={handleSubmit}>
            <Box>
              <Typography variant="subtitle2" sx={{ color: 'primary.main', mb: 0.45 }}>
                Secure Sign-In
              </Typography>
              <Typography variant="h5" sx={{ mb: 0.4 }}>
                Welcome back
              </Typography>
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                Use your NOC Adherence credentials to continue.
              </Typography>
            </Box>

            {err ? <Alert severity="error">{err}</Alert> : null}

            <TextField
              label="Email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="username"
              fullWidth
            />

            <TextField
              label="Password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type={showPw ? 'text' : 'password'}
              autoComplete="current-password"
              fullWidth
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label="toggle password visibility"
                      onClick={() => setShowPw((value) => !value)}
                      edge="end"
                    >
                      {showPw ? <VisibilityOffRoundedIcon /> : <VisibilityRoundedIcon />}
                    </IconButton>
                  </InputAdornment>
                )
              }}
            />

            <Button type="submit" variant="contained" disabled={busy}>
              {busy ? 'Signing in...' : 'Login'}
            </Button>
          </Stack>
        </Paper>
      </Box>
    </Box>
  )
}

function FeatureChip({ icon, label }) {
  return (
    <Stack
      direction="row"
      spacing={0.7}
      alignItems="center"
      sx={{
        px: 1,
        py: 0.75,
        borderRadius: 999,
        bgcolor: 'rgba(255,255,255,0.08)',
        border: '1px solid rgba(255,255,255,0.12)',
        width: 'fit-content'
      }}
    >
      <Box sx={{ display: 'grid', placeItems: 'center', color: '#ccfbf1' }}>{icon}</Box>
      <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: '#f8fafc' }}>{label}</Typography>
    </Stack>
  )
}
