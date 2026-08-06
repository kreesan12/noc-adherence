import { Box, Paper, Stack, TableCell, TableRow, Typography } from '@mui/material'

function alphaHex(color, alpha) {
  return `${color}${alpha}`
}

function sectionSurface(tone) {
  return `linear-gradient(135deg, ${alphaHex(tone, '12')} 0%, ${alphaHex(tone, '04')} 52%, rgba(255,255,255,0) 100%)`
}

export function AnalyticsMetricCard({
  label,
  title,
  value,
  tone = '#0f172a',
  subtext = '',
  icon = null,
  rootSx = {},
  valueSx = {}
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        p: 1.2,
        borderRadius: 2.8,
        border: '1px solid #e5e7eb',
        borderTop: `4px solid ${tone}`,
        background: `linear-gradient(180deg, ${alphaHex(tone, '10')} 0%, #ffffff 46%, #ffffff 100%)`,
        boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
        ...rootSx
      }}
    >
      <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mb: 0.35 }}>
        {icon ? (
          <Box
            sx={{
              width: 24,
              height: 24,
              display: 'grid',
              placeItems: 'center',
              borderRadius: 1.6,
              bgcolor: alphaHex(tone, '14'),
              color: tone
            }}
          >
            {icon}
          </Box>
        ) : null}
        <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6, opacity: 0.72 }}>
          {label || title}
        </Typography>
      </Stack>
      <Typography variant="h6" sx={{ mt: 0.1, fontWeight: 900, lineHeight: 1, ...valueSx }}>
        {value}
      </Typography>
      {subtext ? (
        <Typography variant="body2" sx={{ mt: 0.6, fontSize: 12.5, opacity: 0.72 }}>
          {subtext}
        </Typography>
      ) : null}
    </Paper>
  )
}

export function AnalyticsSectionCard({
  title,
  subtitle,
  children,
  minHeight = 300,
  tone = '#0f172a',
  action = null,
  bodySx = {},
  rootSx = {}
}) {
  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid #e5e7eb',
        borderRadius: 3.25,
        height: '100%',
        minWidth: 0,
        overflow: 'hidden',
        boxShadow: '0 12px 28px rgba(15, 23, 42, 0.05)',
        ...rootSx
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        justifyContent="space-between"
        alignItems="flex-start"
        sx={{ px: 1.35, py: 1.15, borderBottom: '1px solid #eef2f7', background: sectionSurface(tone) }}
      >
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="subtitle2" fontWeight={800}>
            {title}
          </Typography>
          {subtitle ? (
            <Typography variant="body2" sx={{ opacity: 0.72, fontSize: 12.5 }}>
              {subtitle}
            </Typography>
          ) : null}
        </Box>
        {action ? <Box sx={{ flexShrink: 0 }}>{action}</Box> : null}
      </Stack>
      <Box sx={{ minHeight, px: 1.2, py: 1.1, ...bodySx }}>{children}</Box>
    </Paper>
  )
}

export function AnalyticsChartFallback({ message = 'No data available for this view.', minHeight = 220 }) {
  return (
    <Box
      sx={{
        minHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        color: 'text.secondary'
      }}
    >
      <Typography variant="body2">{message}</Typography>
    </Box>
  )
}

export function AnalyticsEmptyTableRow({ colSpan, message }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan}>
        <Typography variant="body2" sx={{ py: 1 }}>
          {message}
        </Typography>
      </TableCell>
    </TableRow>
  )
}

export function AnalyticsLoadingBlock({ message }) {
  return (
    <Paper elevation={0} sx={{ p: 4, textAlign: 'center', border: '1px solid #e5e7eb', borderRadius: 3.25 }}>
      <Typography variant="body2">{message}</Typography>
    </Paper>
  )
}
