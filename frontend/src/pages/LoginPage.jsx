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
import LanRoundedIcon from '@mui/icons-material/LanRounded'
import { useAuth } from '../context/AuthContext'
import { BRAND } from '../config/brand'

const highlights = [
  {
    icon: <ShieldRoundedIcon fontSize="small" />,
    title: 'Role-based access',
    body: 'Admin, engineering, supervisor, and manager access stays controlled from one shared auth layer.'
  },
  {
    icon: <HubRoundedIcon fontSize="small" />,
    title: 'Shared engineering data',
    body: 'NLD services, mapping, light levels, and uptime all point to the same live platform data.'
  },
  {
    icon: <InsightsRoundedIcon fontSize="small" />,
    title: 'Live SLA evidence',
    body: 'Tickets, outages, and service performance can be reviewed from the same operational workspace.'
  },
  {
    icon: <Inventory2RoundedIcon fontSize="small" />,
    title: 'Stock control',
    body: 'Warehouse stock, regional gaps, and run-rate monitoring remain part of the same toolset.'
  }
]

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
        py: 2.2,
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: [
            'radial-gradient(circle at 18% 18%, rgba(45,212,191,0.14) 0%, transparent 26%)',
            'radial-gradient(circle at 82% 22%, rgba(59,130,246,0.12) 0%, transparent 22%)',
            'radial-gradient(circle at 55% 78%, rgba(124,58,237,0.08) 0%, transparent 20%)'
          ].join(',')
        }}
      />

      <Box
        sx={{
          width: '100%',
          maxWidth: 1040,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1.15fr 0.85fr' },
          gap: 1.2,
          alignItems: 'center',
          position: 'relative',
          zIndex: 1
        }}
      >
        <Paper
          sx={{
            p: { xs: 1.5, md: 1.75 },
            borderRadius: 3.2,
            background: [
              'radial-gradient(circle at top left, rgba(45,212,191,0.2) 0%, transparent 28%)',
              'linear-gradient(145deg, #0f5f61 0%, #11485a 34%, #16233f 100%)'
            ].join(','),
            color: '#f8fafc',
            minHeight: { xs: 'auto', md: 420 },
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 24px 54px rgba(15, 23, 42, 0.16)'
          }}
        >
          <Stack spacing={1.25}>
            <Stack direction="row" spacing={0.7} sx={{ flexWrap: 'wrap' }}>
              <Chip size="small" label={BRAND.loginBadge} sx={{ bgcolor: 'rgba(255,255,255,0.12)', color: '#ecfeff' }} />
              <Chip size="small" label={BRAND.loginBadgeSecondary} sx={{ bgcolor: 'rgba(191,219,254,0.16)', color: '#dbeafe' }} />
            </Stack>

            <Box>
              <Typography variant="h4" sx={{ color: '#ffffff', maxWidth: 520 }}>
                {BRAND.loginHeadline}
              </Typography>
              <Typography sx={{ mt: 0.9, fontSize: 13, lineHeight: 1.62, color: 'rgba(226,232,240,0.86)', maxWidth: 560 }}>
                {BRAND.loginBody}
              </Typography>
            </Box>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 0.8
              }}
            >
              {highlights.map((item) => (
                <HighlightCard key={item.title} {...item} />
              ))}
            </Box>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap" sx={{ mt: 1.2 }}>
            <FeatureChip icon={<ShieldRoundedIcon fontSize="small" />} label="Secure sign-in" />
            <FeatureChip icon={<LanRoundedIcon fontSize="small" />} label="Shared workspace data" />
            <FeatureChip icon={<InsightsRoundedIcon fontSize="small" />} label="Live operational visibility" />
          </Stack>
        </Paper>

        <Paper
          sx={{
            p: { xs: 1.35, md: 1.55 },
            borderRadius: 3.2,
            maxWidth: 390,
            width: '100%',
            justifySelf: { xs: 'stretch', md: 'start' },
            alignSelf: 'center',
            boxShadow: '0 20px 44px rgba(15, 23, 42, 0.08)'
          }}
        >
          <Stack spacing={1.05} component="form" onSubmit={handleSubmit}>
            <Box>
              <Typography variant="subtitle2" sx={{ color: 'primary.main', mb: 0.4 }}>
                {BRAND.loginEyebrow}
              </Typography>
              <Typography variant="h5" sx={{ mb: 0.35 }}>
                {BRAND.loginWelcome}
              </Typography>
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                {BRAND.loginHelp}
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

            <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 34 }}>
              {busy ? 'Signing in...' : 'Login'}
            </Button>

            <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
              <Chip size="small" label="Admin-issued accounts" sx={{ fontWeight: 700 }} />
              <Chip size="small" label="xneelo hosted" sx={{ fontWeight: 700, bgcolor: '#eff6ff', color: '#1d4ed8' }} />
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.45 }}>
              Need access or a password reset? Contact a platform admin through the user management workflow.
            </Typography>
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

function HighlightCard({ icon, title, body }) {
  return (
    <Box
      sx={{
        p: 0.95,
        borderRadius: 2,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.04) 100%)',
        minHeight: 96
      }}
    >
      <Stack spacing={0.55}>
        <Box
          sx={{
            width: 26,
            height: 26,
            borderRadius: 1.5,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'rgba(255,255,255,0.12)',
            color: '#ccfbf1'
          }}
        >
          {icon}
        </Box>
        <Typography sx={{ fontSize: 12, fontWeight: 800, color: '#ffffff' }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: 11.1, lineHeight: 1.45, color: 'rgba(226,232,240,0.78)' }}>
          {body}
        </Typography>
      </Stack>
    </Box>
  )
}
