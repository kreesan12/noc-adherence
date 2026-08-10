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

const statTiles = [
  {
    value: '1',
    label: 'Shared auth lane',
    helper: 'Admin, engineering, supervisor, and manager access'
  },
  {
    value: '4',
    label: 'Core workspaces',
    helper: 'Operations, NLD, SLA reporting, and stock control'
  },
  {
    value: 'Live',
    label: 'Data posture',
    helper: 'Hosted on xneelo with one production API surface'
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
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 1.1, md: 2.2 },
        py: { xs: 1.15, md: 2.2 },
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
            'radial-gradient(circle at 14% 14%, rgba(45,212,191,0.18) 0%, transparent 26%)',
            'radial-gradient(circle at 84% 16%, rgba(59,130,246,0.16) 0%, transparent 20%)',
            'radial-gradient(circle at 68% 78%, rgba(99,102,241,0.12) 0%, transparent 24%)',
            'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 26%)'
          ].join(',')
        }}
      />

      <Paper
        sx={{
          width: '100%',
          maxWidth: 1240,
          minHeight: { xs: 'auto', lg: 640 },
          position: 'relative',
          zIndex: 1,
          overflow: 'hidden',
          borderRadius: 4.4,
          background: [
            'radial-gradient(circle at top left, rgba(45,212,191,0.22) 0%, transparent 24%)',
            'radial-gradient(circle at 78% 28%, rgba(96,165,250,0.14) 0%, transparent 22%)',
            'linear-gradient(145deg, #0b5b64 0%, #113f56 42%, #14213b 100%)'
          ].join(','),
          boxShadow: '0 34px 86px rgba(15, 23, 42, 0.2)'
        }}
      >
        <Box
          sx={{
            position: 'relative',
            p: { xs: 1.25, md: 1.7, lg: 2.05 }
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              background: [
                'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 32%)',
                'radial-gradient(circle at 72% 38%, rgba(255,255,255,0.1) 0%, transparent 24%)',
                'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 36%)'
              ].join(',')
            }}
          />

          <Box
            sx={{
              position: 'relative',
              color: '#f8fafc',
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.35fr) 380px' },
              gap: { xs: 1.25, lg: 1.8 },
              alignItems: 'stretch'
            }}
          >
            <Stack
              spacing={1.1}
              sx={{
                order: { xs: 2, lg: 1 },
                minWidth: 0,
                pr: { lg: 0.4 }
              }}
            >
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={0.8}
                alignItems={{ xs: 'flex-start', md: 'center' }}
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={0.7} sx={{ flexWrap: 'wrap' }}>
                  <Chip size="small" label={BRAND.loginBadge} sx={{ bgcolor: 'rgba(255,255,255,0.14)', color: '#ecfeff' }} />
                  <Chip size="small" label={BRAND.loginBadgeSecondary} sx={{ bgcolor: 'rgba(191,219,254,0.16)', color: '#dbeafe' }} />
                  <Chip size="small" label="xneelo live" sx={{ bgcolor: 'rgba(45,212,191,0.16)', color: '#ccfbf1' }} />
                </Stack>

                <Typography sx={{ fontSize: 11.5, fontWeight: 700, color: 'rgba(226,232,240,0.76)' }}>
                  Shared operational workspace
                </Typography>
              </Stack>

              <Box>
                <Typography
                  variant="h4"
                  sx={{
                    color: '#ffffff',
                    maxWidth: 760,
                    fontSize: { xs: '1.92rem', md: '2.45rem', lg: '2.82rem' },
                    lineHeight: 0.98,
                    letterSpacing: -1.08
                  }}
                >
                  {BRAND.loginHeadline}
                </Typography>
                <Typography
                  sx={{
                    mt: 0.9,
                    fontSize: { xs: 12.5, md: 13.2 },
                    lineHeight: 1.68,
                    color: 'rgba(226,232,240,0.86)',
                    maxWidth: 700
                  }}
                >
                  {BRAND.loginBody}
                </Typography>
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
                  gap: 0.85
                }}
              >
                {statTiles.map((item) => (
                  <Box
                    key={item.label}
                    sx={{
                      p: 1.05,
                      borderRadius: 2.4,
                      border: '1px solid rgba(255,255,255,0.1)',
                      background: 'linear-gradient(180deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.05) 100%)',
                      backdropFilter: 'blur(10px)',
                      minHeight: 92
                    }}
                  >
                    <Typography sx={{ fontSize: 20, fontWeight: 800, color: '#ffffff', lineHeight: 1 }}>
                      {item.value}
                    </Typography>
                    <Typography sx={{ mt: 0.45, fontSize: 11.7, fontWeight: 800, color: '#ffffff' }}>
                      {item.label}
                    </Typography>
                    <Typography sx={{ mt: 0.35, fontSize: 10.8, lineHeight: 1.5, color: 'rgba(226,232,240,0.76)' }}>
                      {item.helper}
                    </Typography>
                  </Box>
                ))}
              </Box>

              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
                  gap: 0.85
                }}
              >
                {highlights.map((item) => (
                  <HighlightCard key={item.title} {...item} />
                ))}
              </Box>

              <Stack spacing={0.75}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.35, color: 'rgba(226,232,240,0.68)' }}>
                  Platform coverage
                </Typography>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap">
                  <FeatureChip icon={<ShieldRoundedIcon fontSize="small" />} label="Secure sign-in" />
                  <FeatureChip icon={<LanRoundedIcon fontSize="small" />} label="Shared workspace data" />
                  <FeatureChip icon={<InsightsRoundedIcon fontSize="small" />} label="Live operational visibility" />
                </Stack>
              </Stack>
            </Stack>

            <Paper
              sx={{
                order: { xs: 1, lg: 2 },
                p: { xs: 1.2, md: 1.35, lg: 1.45 },
                borderRadius: 3.1,
                minHeight: { xs: 'auto', lg: 548 },
                maxWidth: { xs: '100%', lg: 380 },
                width: '100%',
                justifySelf: { lg: 'end' },
                alignSelf: { lg: 'start' },
                mt: { lg: 1.35 },
                background: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(248,250,252,0.95) 100%)',
                boxShadow: '0 26px 58px rgba(15, 23, 42, 0.18)',
                backdropFilter: 'blur(18px)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                position: 'relative'
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
                  <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 320 }}>
                    {BRAND.loginHelp}
                  </Typography>
                </Box>

                {err ? <Alert severity="error">{err}</Alert> : null}

                <Stack spacing={0.9}>
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
                </Stack>

                <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 39 }}>
                  {busy ? 'Signing in...' : 'Login'}
                </Button>

                <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                  <Chip size="small" label="Admin-issued accounts" sx={{ fontWeight: 700 }} />
                  <Chip size="small" label="xneelo hosted" sx={{ fontWeight: 700, bgcolor: '#eff6ff', color: '#1d4ed8' }} />
                  <Chip size="small" label="Shared access model" sx={{ fontWeight: 700, bgcolor: '#ecfeff', color: '#0f766e' }} />
                </Stack>
              </Stack>

              <Stack spacing={0.8} sx={{ mt: 1.2 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.35, color: 'text.secondary' }}>
                  Support lane
                </Typography>
                <Box
                  sx={{
                    p: 0.9,
                    borderRadius: 2.2,
                    background: 'linear-gradient(180deg, rgba(15,118,110,0.06) 0%, rgba(37,99,235,0.03) 100%)',
                    border: '1px solid rgba(15,23,42,0.07)'
                  }}
                >
                  <Typography sx={{ fontSize: 11.1, lineHeight: 1.55, color: 'text.secondary' }}>
                    Need access or a password reset? Contact a platform admin through the user management workflow.
                  </Typography>
                </Box>
              </Stack>
            </Paper>
          </Box>
        </Box>
      </Paper>
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
        borderRadius: 2.35,
        border: '1px solid rgba(255,255,255,0.11)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.045) 100%)',
        backdropFilter: 'blur(12px)',
        minHeight: 108
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


