import { useMemo } from 'react'
import { Box, Button, Chip, Stack, Typography } from '@mui/material'
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded'
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded'
import LanRoundedIcon from '@mui/icons-material/LanRounded'
import HomeRoundedIcon from '@mui/icons-material/HomeRounded'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { PageShell, SectionCard } from '../components/ui/PageScaffold'
import { buildNavigationSections, flattenNavigationItems } from '../config/navigation.jsx'
import { BRAND } from '../config/brand'
import { normalizeRole } from '../utils/access'

const ACCENT = '#0f766e'

export default function LandingDashboardPage({ vacancyCount = 0 }) {
  const { user } = useAuth()
  const sections = useMemo(() => buildNavigationSections(user, vacancyCount), [user, vacancyCount])
  const items = useMemo(() => flattenNavigationItems(sections), [sections])
  const primaryItems = useMemo(
    () => items.filter((item) => ['ENGINEERING', 'SLA REPORTING', 'STOCK MANAGEMENT'].includes(item.section)).slice(0, 4),
    [items]
  )

  return (
    <PageShell
      eyebrow="Workspace"
      title={BRAND.homeTitle}
      description={BRAND.homeDescription}
      accent={ACCENT}
      stats={[
        { label: 'Role', value: normalizeRole(user?.role || 'user').toUpperCase(), helper: user?.name || 'signed in user' },
        { label: 'Sections', value: sections.length, helper: 'navigation groups available' },
        { label: 'Views', value: items.length, helper: 'workspaces reachable from this account' },
        { label: 'Vacancies', value: vacancyCount, helper: 'current workforce callouts' }
      ]}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', xl: '1.25fr 1fr' },
          gap: 1.05
        }}
      >
        <SectionCard
          title="Launchpad"
          subtitle="Quick access to the most-used workspaces from one place."
          accent={ACCENT}
        >
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
              gap: 0.85
            }}
          >
            {primaryItems.map((item) => (
              <Box
                key={item.path}
                sx={{
                  p: 1,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: 'divider',
                  background: 'linear-gradient(180deg, rgba(15,118,110,0.08) 0%, rgba(255,255,255,0.96) 100%)'
                }}
              >
                <Stack spacing={0.7}>
                  <Stack direction="row" spacing={0.7} alignItems="center">
                    <Box
                      sx={{
                        width: 30,
                        height: 30,
                        borderRadius: 1.5,
                        display: 'grid',
                        placeItems: 'center',
                        bgcolor: 'rgba(15,118,110,0.14)',
                        color: ACCENT
                      }}
                    >
                      {item.icon}
                    </Box>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        {item.label}
                      </Typography>
                      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                        {item.section}
                      </Typography>
                    </Box>
                  </Stack>
                  <Typography variant="body2" sx={{ color: 'text.secondary', minHeight: 40 }}>
                    {item.summary}
                  </Typography>
                  <Button
                    component={Link}
                    to={item.path}
                    size="small"
                    variant="outlined"
                    endIcon={<ArrowForwardRoundedIcon />}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    Open
                  </Button>
                </Stack>
              </Box>
            ))}
          </Box>
        </SectionCard>

        <SectionCard
          title="Workspace Notes"
          subtitle="A quick orientation for the main lanes in this platform."
          accent="#2563eb"
        >
          <Stack spacing={0.85}>
            <InfoNote
              icon={<HomeRoundedIcon fontSize="small" />}
              title="Use this page as your starting point"
              body="You no longer have to land inside one specific module first. The side nav still stays available for direct movement."
              tone="#0f766e"
            />
            <InfoNote
              icon={<LanRoundedIcon fontSize="small" />}
              title="Admin users can operate across engineering"
              body="Engineering edit functions now follow shared access logic so admin access behaves like a full platform account, not a reduced viewer."
              tone="#2563eb"
            />
            <InfoNote
              icon={<InsightsRoundedIcon fontSize="small" />}
              title="Navigation can now be hidden"
              body="Use the top-left toggle to collapse or reopen the side navigation when you want more screen space on data-heavy pages."
              tone="#7c3aed"
            />
          </Stack>
        </SectionCard>
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(3, minmax(0, 1fr))' },
          gap: 1.05
        }}
      >
        {sections.map((section) => (
          <SectionCard
            key={section.title}
            title={section.title}
            subtitle={`${section.items.length} available view${section.items.length === 1 ? '' : 's'}`}
            accent={section.title === 'ENGINEERING' ? '#0f766e' : section.title === 'SLA REPORTING' ? '#2563eb' : '#1f2937'}
          >
            <Stack spacing={0.75}>
              {section.items.map((item) => (
                <Box
                  key={item.path}
                  sx={{
                    p: 0.9,
                    borderRadius: 1.8,
                    border: '1px solid',
                    borderColor: 'divider',
                    bgcolor: 'rgba(255,255,255,0.78)'
                  }}
                >
                  <Stack direction="row" spacing={0.9} alignItems="flex-start" justifyContent="space-between">
                    <Stack direction="row" spacing={0.9} alignItems="flex-start" sx={{ minWidth: 0 }}>
                      <Box sx={{ color: 'text.secondary', mt: 0.1 }}>{item.icon}</Box>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                          {item.label}
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {item.summary}
                        </Typography>
                      </Box>
                    </Stack>
                    <Button component={Link} to={item.path} size="small" variant="text" sx={{ whiteSpace: 'nowrap' }}>
                      Open
                    </Button>
                  </Stack>
                </Box>
              ))}
            </Stack>
          </SectionCard>
        ))}
      </Box>
    </PageShell>
  )
}

function InfoNote({ icon, title, body, tone }) {
  return (
    <Box
      sx={{
        p: 1,
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'divider',
        background: `linear-gradient(180deg, ${tone}14 0%, rgba(255,255,255,0.98) 100%)`
      }}
    >
      <Stack spacing={0.55}>
        <Stack direction="row" spacing={0.7} alignItems="center">
          <Box
            sx={{
              width: 28,
              height: 28,
              borderRadius: 1.4,
              display: 'grid',
              placeItems: 'center',
              bgcolor: `${tone}18`,
              color: tone
            }}
          >
            {icon}
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            {title}
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {body}
        </Typography>
      </Stack>
    </Box>
  )
}

