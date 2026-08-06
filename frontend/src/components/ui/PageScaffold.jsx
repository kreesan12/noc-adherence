import { Box, Paper, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'

function accentGradient(accent) {
  return [
    `radial-gradient(circle at top right, ${alpha(accent, 0.16)} 0%, transparent 28%)`,
    `linear-gradient(145deg, ${alpha(accent, 0.1)} 0%, rgba(15, 23, 42, 0.02) 58%, #ffffff 100%)`
  ].join(',')
}

export function PageShell({
  eyebrow = 'Workspace',
  title,
  description,
  accent = '#0f766e',
  actions = null,
  stats = [],
  children
}) {
  return (
    <Box sx={{ p: { xs: 1.1, md: 1.35 }, display: 'grid', gap: 1.05 }}>
      <Paper
        sx={{
          p: 1.3,
          borderRadius: 2.6,
          background: accentGradient(accent)
        }}
      >
        <Stack
          direction={{ xs: 'column', lg: 'row' }}
          spacing={1.15}
          alignItems={{ xs: 'flex-start', lg: 'center' }}
          justifyContent="space-between"
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography
              variant="subtitle2"
              sx={{
                color: accent,
                textTransform: 'uppercase',
                letterSpacing: 0.7,
                mb: 0.45
              }}
            >
              {eyebrow}
            </Typography>
            <Typography variant="h4" sx={{ mb: 0.4 }}>
              {title}
            </Typography>
            {description ? (
              <Typography variant="body1" sx={{ color: 'text.secondary', maxWidth: 860 }}>
                {description}
              </Typography>
            ) : null}
          </Box>

          {actions ? (
            <Box sx={{ width: { xs: '100%', lg: 'auto' } }}>
              {actions}
            </Box>
          ) : null}
        </Stack>

        {stats.length ? (
          <Box
            sx={{
              mt: 1.1,
              display: 'grid',
              gridTemplateColumns: {
                xs: 'repeat(2, minmax(0, 1fr))',
                md: `repeat(${Math.min(Math.max(stats.length, 2), 6)}, minmax(0, 1fr))`
              },
              gap: 0.8
            }}
          >
            {stats.map((stat) => (
              <MiniStat key={stat.label} {...stat} accent={stat.accent || accent} />
            ))}
          </Box>
        ) : null}
      </Paper>

      {children}
    </Box>
  )
}

export function SectionCard({
  title,
  subtitle = '',
  accent = '#0f766e',
  actions = null,
  noPadding = false,
  children
}) {
  return (
    <Paper sx={{ borderRadius: 2.4, overflow: 'hidden' }}>
      <Box
        sx={{
          px: 1.15,
          py: 0.95,
          borderBottom: '1px solid',
          borderColor: 'divider',
          background: `linear-gradient(180deg, ${alpha(accent, 0.08)} 0%, rgba(255,255,255,0.9) 100%)`
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={0.8}
          alignItems={{ xs: 'flex-start', md: 'center' }}
          justifyContent="space-between"
        >
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6">{title}</Typography>
            {subtitle ? (
              <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.15 }}>
                {subtitle}
              </Typography>
            ) : null}
          </Box>
          {actions ? <Box sx={{ width: { xs: '100%', md: 'auto' } }}>{actions}</Box> : null}
        </Stack>
      </Box>

      <Box sx={noPadding ? undefined : { p: 1.05 }}>
        {children}
      </Box>
    </Paper>
  )
}

export function FilterStrip({ children }) {
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.75,
        flexWrap: 'wrap',
        alignItems: 'center',
        p: 0.85,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'rgba(255,255,255,0.82)'
      }}
    >
      {children}
    </Box>
  )
}

function MiniStat({ label, value, helper, accent = '#0f766e' }) {
  return (
    <Box
      sx={{
        p: 0.85,
        borderRadius: 2,
        border: '1px solid',
        borderColor: alpha(accent, 0.18),
        bgcolor: alpha(accent, 0.05)
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary', textTransform: 'uppercase', letterSpacing: 0.45 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ mt: 0.2 }}>
        {value}
      </Typography>
      {helper ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.15 }}>
          {helper}
        </Typography>
      ) : null}
    </Box>
  )
}
