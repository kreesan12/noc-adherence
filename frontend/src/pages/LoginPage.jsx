import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
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
import QueryStatsRoundedIcon from '@mui/icons-material/QueryStatsRounded'
import StorageRoundedIcon from '@mui/icons-material/StorageRounded'
import ManageAccountsRoundedIcon from '@mui/icons-material/ManageAccountsRounded'
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

const loginSideNotes = [
  {
    icon: <ManageAccountsRoundedIcon fontSize="small" />,
    title: 'Managed access',
    body: 'Accounts, password resets, and role updates stay under the admin workflow.'
  },
  {
    icon: <StorageRoundedIcon fontSize="small" />,
    title: 'Shared data layer',
    body: 'Engineering, SLA, and stock screens all read from the same live platform datasets.'
  },
  {
    icon: <QueryStatsRoundedIcon fontSize="small" />,
    title: 'Operational visibility',
    body: 'Daily ingestion, watcher jobs, and reporting views sit behind one sign-in.'
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
        px: { xs: 1.2, md: 2.4 },
        py: { xs: 1.2, md: 2.8 },
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
            'radial-gradient(circle at 12% 16%, rgba(45,212,191,0.18) 0%, transparent 24%)',
            'radial-gradient(circle at 86% 18%, rgba(59,130,246,0.14) 0%, transparent 20%)',
            'radial-gradient(circle at 52% 82%, rgba(99,102,241,0.1) 0%, transparent 22%)',
            'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 24%)'
          ].join(',')
        }}
      />

      <Paper
        sx={{
          width: '100%',
          maxWidth: 1220,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.24fr) minmax(360px, 420px)' },
          gap: 0,
          minHeight: { xs: 'auto', lg: 650 },
          position: 'relative',
          zIndex: 1,
          overflow: 'hidden',
          borderRadius: 4,
          background: [
            'radial-gradient(circle at top left, rgba(45,212,191,0.24) 0%, transparent 26%)',
            'linear-gradient(145deg, #0d5d63 0%, #11465b 38%, #16233f 100%)'
          ].join(','),
          boxShadow: '0 36px 90px rgba(15, 23, 42, 0.18)'
        }}
      >
        <Box
          sx={{
            position: 'relative',
            color: '#f8fafc',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            p: { xs: 1.45, md: 2.1, lg: 2.35 },
            gap: 1.6
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              background: [
                'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 38%)',
                'radial-gradient(circle at 70% 34%, rgba(255,255,255,0.08) 0%, transparent 26%)'
              ].join(',')
            }}
          />

          <Stack spacing={1.35} sx={{ position: 'relative' }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={0.8}
              alignItems={{ xs: 'flex-start', sm: 'center' }}
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
                  maxWidth: 700,
                  fontSize: { xs: '1.9rem', md: '2.25rem' },
                  lineHeight: 1.02
                }}
              >
                {BRAND.loginHeadline}
              </Typography>
              <Typography
                sx={{
                  mt: 0.85,
                  fontSize: { xs: 12.6, md: 13.2 },
                  lineHeight: 1.66,
                  color: 'rgba(226,232,240,0.86)',
                  maxWidth: 650
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
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'linear-gradient(180deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.05) 100%)',
                    minHeight: 88
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
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 0.85
              }}
            >
              {highlights.map((item) => (
                <HighlightCard key={item.title} {...item} />
              ))}
            </Box>
          </Stack>

          <Stack spacing={1.15} sx={{ position: 'relative' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.35, color: 'rgba(226,232,240,0.68)' }}>
              Platform coverage
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.8} useFlexGap flexWrap="wrap">
              <FeatureChip icon={<ShieldRoundedIcon fontSize="small" />} label="Secure sign-in" />
              <FeatureChip icon={<LanRoundedIcon fontSize="small" />} label="Shared workspace data" />
              <FeatureChip icon={<InsightsRoundedIcon fontSize="small" />} label="Live operational visibility" />
            </Stack>
          </Stack>
        </Box>

        <Box
          sx={{
            p: { xs: 1.15, md: 1.5, lg: 1.7 },
            background: { xs: 'rgba(255,255,255,0.04)', lg: 'rgba(255,255,255,0.06)' },
            borderLeft: { xs: 'none', lg: '1px solid rgba(255,255,255,0.08)' },
            display: 'flex',
            alignItems: 'stretch'
          }}
        >
          <Paper
            sx={{
              width: '100%',
              minHeight: { xs: 'auto', lg: '100%' },
              p: { xs: 1.35, md: 1.5, lg: 1.65 },
              borderRadius: 3,
              background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.98) 100%)',
              boxShadow: '0 24px 50px rgba(15, 23, 42, 0.12)',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              gap: 1.2
            }}
          >
            <Stack spacing={1.15} component="form" onSubmit={handleSubmit}>
              <Box>
                <Typography variant="subtitle2" sx={{ color: 'primary.main', mb: 0.4 }}>
                  {BRAND.loginEyebrow}
                </Typography>
                <Typography variant="h5" sx={{ mb: 0.35 }}>
                  {BRAND.loginWelcome}
                </Typography>
                <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 340 }}>
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

              <Button type="submit" variant="contained" disabled={busy} sx={{ minHeight: 38 }}>
                {busy ? 'Signing in...' : 'Login'}
              </Button>

              <Stack direction="row" spacing={0.6} useFlexGap flexWrap="wrap">
                <Chip size="small" label="Admin-issued accounts" sx={{ fontWeight: 700 }} />
                <Chip size="small" label="xneelo hosted" sx={{ fontWeight: 700, bgcolor: '#eff6ff', color: '#1d4ed8' }} />
                <Chip size="small" label="Shared access model" sx={{ fontWeight: 700, bgcolor: '#ecfeff', color: '#0f766e' }} />
              </Stack>
            </Stack>

            <Divider />

            <Stack spacing={0.8}>
              {loginSideNotes.map((item) => (
                <Box
                  key={item.title}
                  sx={{
                    p: 0.9,
                    borderRadius: 2,
                    border: '1px solid rgba(15,23,42,0.07)',
                    background: 'rgba(255,255,255,0.74)'
                  }}
                >
                  <Stack direction="row" spacing={0.85} alignItems="flex-start">
                    <Box
                      sx={{
                        mt: 0.1,
                        width: 24,
                        height: 24,
                        borderRadius: 1.5,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: 'rgba(15,118,110,0.1)',
                        color: 'primary.main',
                        flexShrink: 0
                      }}
                    >
                      {item.icon}
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 11.5, fontWeight: 800, color: 'text.primary' }}>
                        {item.title}
                      </Typography>
                      <Typography sx={{ mt: 0.2, fontSize: 10.9, lineHeight: 1.5, color: 'text.secondary' }}>
                        {item.body}
                      </Typography>
                    </Box>
                  </Stack>
                </Box>
              ))}
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
              Need access or a password reset? Contact a platform admin through the user management workflow.
            </Typography>
          </Paper>
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
        borderRadius: 2.2,
        border: '1px solid rgba(255,255,255,0.12)',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.04) 100%)',
        minHeight: 104
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
