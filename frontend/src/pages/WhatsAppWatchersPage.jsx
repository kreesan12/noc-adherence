import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import AddRoundedIcon from '@mui/icons-material/AddRounded'
import ChatRoundedIcon from '@mui/icons-material/ChatRounded'
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded'
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded'
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded'
import SaveRoundedIcon from '@mui/icons-material/SaveRounded'
import SendRoundedIcon from '@mui/icons-material/SendRounded'
import SettingsSuggestRoundedIcon from '@mui/icons-material/SettingsSuggestRounded'
import { useAuth } from '../context/AuthContext'
import {
  getWhatsAppWatcherConfig,
  getWhatsAppWatcherHistory,
  queueWhatsAppWatcherTest,
  saveWhatsAppWatcherConfig
} from '../api/whatsappWatchers'
import { getWhatsAppGroups } from '../api/whatsappGroups'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'
import { AnalyticsMetricCard as MetricCard } from '../components/ui/AnalyticsPrimitives'

const ROW_LIMIT_OPTIONS = [20, 50, 100, 200]
const WATCHER_ROUTE_ACTIONS = [
  { sectionKey: 'nld', watcherKey: 'nld', label: 'NLD', color: 'info' },
  { sectionKey: 'backhaul', watcherKey: 'backhaul', label: 'Backhaul', color: 'warning' },
  { sectionKey: 'majorOutage', watcherKey: 'major_outage', label: 'Major Outage', color: 'error' },
  { sectionKey: 'vip', watcherKey: 'vip', label: 'VIP', color: 'secondary' }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function extractError(error, fallback) {
  return error?.response?.data?.error || error?.message || fallback
}

function thresholdsToText(values) {
  return Array.isArray(values) ? values.join(', ') : ''
}

function parseThresholds(text, fallback) {
  const values = String(text || '')
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0)

  if (!values.length) return fallback
  return [...new Set(values)].sort((a, b) => a - b)
}

function toWholeNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback
}

function compactDelay(ms) {
  const seconds = Math.round(Number(ms || 0) / 1000)
  return `${seconds}s`
}

function fmtDateTime(value) {
  const dt = dayjs(value)
  return dt.isValid() ? dt.format('YYYY-MM-DD HH:mm:ss') : 'Unknown'
}

function compactPayload(payload) {
  if (!payload || typeof payload !== 'object') return 'No payload'

  const entries = Object.entries(payload)
    .filter(([, value]) => value !== null && value !== '')
    .slice(0, 4)
    .map(([key, value]) => `${key}: ${String(value)}`)

  return entries.length ? entries.join(' | ') : 'No payload'
}

function parseGroupIdsInput(value) {
  return [...new Set(
    String(value || '')
      .split(/[\n,;]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )].slice(0, 25)
}

function getGroupIds(section) {
  if (!section || typeof section !== 'object') return []

  const raw = Array.isArray(section.groupIds)
    ? section.groupIds
    : section.groupId
      ? [section.groupId]
      : []

  return [...new Set(raw.map((item) => String(item || '').trim()).filter(Boolean))]
}

function isWatcherAssigned(section, jid) {
  return getGroupIds(section).includes(String(jid || '').trim())
}

function watcherLabel(key) {
  switch (String(key || '').toLowerCase()) {
    case 'nld':
      return 'NLD'
    case 'backhaul':
      return 'Backhaul'
    case 'major_outage':
    case 'majoroutage':
      return 'Major Outage'
    case 'vip':
      return 'VIP'
    default:
      return String(key || '').toUpperCase()
  }
}

function buildNewVipRule(index) {
  return {
    key: `custom-${index + 1}`,
    tag: '',
    title: 'VIP alert',
    reason: '',
    includePriority: true
  }
}

function groupChipLabel(jid, groupLookup) {
  const group = groupLookup.get(jid)
  return group?.name ? `${group.name} | ${jid}` : jid
}

function SectionFieldGrid({ children }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 0.9,
        gridTemplateColumns: {
          xs: '1fr',
          md: 'repeat(2, minmax(0, 1fr))',
          xl: 'repeat(4, minmax(0, 1fr))'
        }
      }}
    >
      {children}
    </Box>
  )
}

function TemplateGrid({ children }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 0.9,
        gridTemplateColumns: {
          xs: '1fr',
          lg: 'repeat(2, minmax(0, 1fr))'
        }
      }}
    >
      {children}
    </Box>
  )
}

function WatcherGroupChips({ section, groupLookup, onDelete, color }) {
  const groupIds = getGroupIds(section)
  if (!groupIds.length) return null

  return (
    <Stack direction="row" spacing={0.6} flexWrap="wrap" useFlexGap>
      {groupIds.map((jid) => (
        <Chip
          key={jid}
          size="small"
          label={groupChipLabel(jid, groupLookup)}
          onDelete={() => onDelete(jid)}
          variant="outlined"
          color={color}
        />
      ))}
    </Stack>
  )
}

function TestButton({ watcherKey, testingWatcherKey, onClick, disabled = false }) {
  const busy = testingWatcherKey === watcherKey

  return (
    <Button
      size="small"
      variant="outlined"
      startIcon={busy ? <CircularProgress size={14} /> : <SendRoundedIcon />}
      onClick={() => onClick(watcherKey)}
      disabled={disabled || busy}
    >
      {busy ? 'Queueing...' : 'Send test'}
    </Button>
  )
}

export default function WhatsAppWatchersPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [activeTab, setActiveTab] = useState('controls')
  const [meta, setMeta] = useState(null)
  const [defaults, setDefaults] = useState(null)
  const [draft, setDraft] = useState(null)
  const [historyRows, setHistoryRows] = useState([])
  const [historyFilter, setHistoryFilter] = useState('')
  const [historyLimit, setHistoryLimit] = useState(20)
  const [groupRows, setGroupRows] = useState([])
  const [groupSearch, setGroupSearch] = useState('')
  const [groupLoading, setGroupLoading] = useState(false)
  const [groupLimit, setGroupLimit] = useState(20)
  const [testingWatcherKey, setTestingWatcherKey] = useState('')
  const [thresholdText, setThresholdText] = useState({
    nld: '',
    backhaul: '',
    majorOutage: ''
  })

  const groupLookup = useMemo(
    () => new Map((groupRows || []).map((row) => [String(row.jid), row])),
    [groupRows]
  )

  async function copyText(value, successMessage) {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setNotice(successMessage)
    } catch {
      setError('Clipboard copy failed on this browser')
    }
  }

  async function loadHistory(filter = historyFilter, limit = historyLimit) {
    try {
      const { data } = await getWhatsAppWatcherHistory({
        watcherKey: filter,
        limit
      })
      setHistoryRows(data.rows || [])
    } catch (err) {
      setError(extractError(err, 'Failed to load watcher alert history'))
    }
  }

  async function loadGroups(search = groupSearch, limit = groupLimit) {
    setGroupLoading(true)
    try {
      const { data } = await getWhatsAppGroups({ q: search, limit })
      setGroupRows(data.rows || [])
    } catch (err) {
      setError(extractError(err, 'Failed to load WhatsApp groups'))
    } finally {
      setGroupLoading(false)
    }
  }

  async function refresh() {
    if (!isAdmin) return
    setLoading(true)
    setError('')

    try {
      const { data } = await getWhatsAppWatcherConfig()
      setDraft(data.config)
      setDefaults(data.defaults || data.config)
      setMeta(data.meta || null)
      setThresholdText({
        nld: thresholdsToText(data.config?.nld?.breachThresholdsHours),
        backhaul: thresholdsToText(data.config?.backhaul?.breachThresholdsHours),
        majorOutage: thresholdsToText(data.config?.majorOutage?.breachThresholdsHours)
      })
      await loadHistory(historyFilter, historyLimit)
      await loadGroups(groupSearch, groupLimit)
    } catch (err) {
      setError(extractError(err, 'Failed to load WhatsApp watcher settings'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    loadHistory(historyFilter, historyLimit)
  }, [historyFilter, historyLimit, isAdmin])

  useEffect(() => {
    if (!isAdmin) return
    loadGroups(groupSearch, groupLimit)
  }, [groupSearch, groupLimit, isAdmin])

  function setSection(section, updater) {
    setDraft((current) => ({
      ...current,
      [section]: typeof updater === 'function' ? updater(current[section]) : updater
    }))
  }

  function setSectionField(section, field, value) {
    setSection(section, (current) => ({ ...current, [field]: value }))
  }

  function setTemplateField(section, field, value) {
    setSection(section, (current) => ({
      ...current,
      templates: {
        ...current.templates,
        [field]: value
      }
    }))
  }

  function resetSection(section) {
    if (!defaults?.[section]) return
    setSection(section, clone(defaults[section]))

    if (section === 'nld') {
      setThresholdText((current) => ({
        ...current,
        nld: thresholdsToText(defaults.nld.breachThresholdsHours)
      }))
    }
    if (section === 'backhaul') {
      setThresholdText((current) => ({
        ...current,
        backhaul: thresholdsToText(defaults.backhaul.breachThresholdsHours)
      }))
    }
    if (section === 'majorOutage') {
      setThresholdText((current) => ({
        ...current,
        majorOutage: thresholdsToText(defaults.majorOutage.breachThresholdsHours)
      }))
    }

    setNotice(`${section.toUpperCase()} watcher reset to defaults in the editor`)
  }

  function addVipRule() {
    setSection('vip', (current) => ({
      ...current,
      tagRules: [...(current.tagRules || []), buildNewVipRule(current.tagRules?.length || 0)]
    }))
  }

  function updateVipRule(index, field, value) {
    setSection('vip', (current) => ({
      ...current,
      tagRules: (current.tagRules || []).map((rule, ruleIndex) => (
        ruleIndex === index ? { ...rule, [field]: value } : rule
      ))
    }))
  }

  function removeVipRule(index) {
    setSection('vip', (current) => ({
      ...current,
      tagRules: (current.tagRules || []).filter((_, ruleIndex) => ruleIndex !== index)
    }))
  }

  function setWatcherGroupIds(section, nextGroupIds) {
    setSection(section, (current) => ({
      ...current,
      groupIds: [...new Set((nextGroupIds || []).map((item) => String(item || '').trim()).filter(Boolean))]
    }))
  }

  function applyGroupToWatcher(section, jid) {
    setSection(section, (current) => ({
      ...current,
      groupIds: [...new Set([...getGroupIds(current), String(jid || '').trim()])]
    }))
    setNotice(`${section.toUpperCase()} watcher group added in the editor. Save All to apply it live.`)
  }

  function removeGroupFromWatcher(section, jid) {
    setSection(section, (current) => ({
      ...current,
      groupIds: getGroupIds(current).filter((item) => item !== jid)
    }))
  }

  function updateWatcherGroupText(section, value) {
    setWatcherGroupIds(section, parseGroupIdsInput(value))
  }

  async function saveAll() {
    if (!draft || !defaults) return
    setSaving(true)
    setError('')
    setNotice('')

    try {
      const payload = clone(draft)
      payload.nld.breachThresholdsHours = parseThresholds(thresholdText.nld, defaults.nld.breachThresholdsHours)
      payload.backhaul.breachThresholdsHours = parseThresholds(thresholdText.backhaul, defaults.backhaul.breachThresholdsHours)
      payload.majorOutage.breachThresholdsHours = parseThresholds(thresholdText.majorOutage, defaults.majorOutage.breachThresholdsHours)

      const { data } = await saveWhatsAppWatcherConfig(payload)
      setDraft(data.config)
      setMeta(data.meta || meta)
      setThresholdText({
        nld: thresholdsToText(data.config?.nld?.breachThresholdsHours),
        backhaul: thresholdsToText(data.config?.backhaul?.breachThresholdsHours),
        majorOutage: thresholdsToText(data.config?.majorOutage?.breachThresholdsHours)
      })
      setNotice('Watcher settings saved. The automation server will pick them up on the next poll.')
    } catch (err) {
      setError(extractError(err, 'Failed to save watcher settings'))
    } finally {
      setSaving(false)
    }
  }

  async function sendWatcherTest(watcherKey) {
    setTestingWatcherKey(watcherKey)
    setError('')
    setNotice('')

    try {
      const { data } = await queueWhatsAppWatcherTest(watcherKey)
      const queuedTargets = data?.queued?.targetGroupIds?.length
        ? `${data.queued.targetGroupIds.length} configured group(s)`
        : 'the default WhatsApp group'

      setNotice(`${watcherLabel(watcherKey)} test queued to ${queuedTargets}. It will send from the automation host shortly.`)
      await loadHistory(historyFilter, historyLimit)
    } catch (err) {
      setError(extractError(err, `Failed to queue ${watcherLabel(watcherKey)} test message`))
    } finally {
      setTestingWatcherKey('')
    }
  }

  const summary = useMemo(() => {
    if (!draft) {
      return {
        enabledCount: 0,
        groupOverrides: 0,
        vipRules: 0
      }
    }

    const sections = [draft.nld, draft.backhaul, draft.majorOutage, draft.vip]
    const enabledCount = sections.filter((section) => section?.enabled).length
    const groupOverrides = sections.filter((section) => getGroupIds(section).length).length
    const vipRules = draft.vip?.tagRules?.length || 0

    return { enabledCount, groupOverrides, vipRules }
  }, [draft])

  if (!isAdmin) {
    return (
      <PageShell
        eyebrow="Settings"
        title="WhatsApp Watchers"
        description="Only platform admin accounts can manage automation routing, timing, and alert wording."
        accent="#0f766e"
      >
        <Alert severity="warning">Only admin users can manage WhatsApp watcher settings.</Alert>
      </PageShell>
    )
  }

  return (
    <PageShell
      eyebrow="Settings"
      title="WhatsApp Watchers"
      description="Manage Zendesk-to-WhatsApp watcher timing, routing, logs, and editable templates from one admin surface."
      accent="#0f766e"
      stats={[
        { label: 'Enabled Watchers', value: summary.enabledCount, helper: 'NLD, backhaul, major outage, and VIP lanes' },
        { label: 'Group Overrides', value: summary.groupOverrides, helper: 'watchers with explicit target groups' },
        { label: 'VIP Tag Rules', value: summary.vipRules, helper: 'custom VIP escalation rules' },
        { label: 'History Rows', value: historyRows.length, helper: `latest ${historyLimit} log rows in view` }
      ]}
      actions={(
        <Stack direction="row" spacing={0.7} flexWrap="wrap">
          <Button variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={refresh} disabled={loading || saving}>
            Refresh
          </Button>
          <Button variant="contained" startIcon={<SaveRoundedIcon />} onClick={saveAll} disabled={!draft || loading || saving}>
            Save All
          </Button>
        </Stack>
      )}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}
      {meta?.refreshBehavior ? <Alert severity="info">{meta.refreshBehavior}</Alert> : null}

      <Box
        sx={{
          display: 'grid',
          gap: 0.9,
          gridTemplateColumns: {
            xs: '1fr',
            sm: 'repeat(2, minmax(0, 1fr))',
            xl: 'repeat(5, minmax(0, 1fr))'
          }
        }}
      >
        <MetricCard
          label="Automation Host"
          value="xneelo"
          subtext="The live WhatsApp socket and watchers run on the automation server."
          tone="#0f766e"
          icon={<ChatRoundedIcon fontSize="small" />}
        />
        <MetricCard
          label="NLD Poll"
          value={draft ? compactDelay(draft.nld.pollMs) : '--'}
          subtext="Current configured NLD watcher poll interval."
          tone="#2563eb"
          icon={<SettingsSuggestRoundedIcon fontSize="small" />}
        />
        <MetricCard
          label="Backhaul Poll"
          value={draft ? compactDelay(draft.backhaul.pollMs) : '--'}
          subtext="Current configured backhaul watcher poll interval."
          tone="#ea580c"
          icon={<SettingsSuggestRoundedIcon fontSize="small" />}
        />
        <MetricCard
          label="Major Outage Poll"
          value={draft ? compactDelay(draft.majorOutage.pollMs) : '--'}
          subtext="Non-NLD outage polling cadence for the outage desk lane."
          tone="#dc2626"
          icon={<SettingsSuggestRoundedIcon fontSize="small" />}
        />
        <MetricCard
          label="VIP Poll"
          value={draft ? compactDelay(draft.vip.pollMs) : '--'}
          subtext="Current configured VIP watcher poll interval."
          tone="#7c3aed"
          icon={<SettingsSuggestRoundedIcon fontSize="small" />}
        />
      </Box>

      <Paper sx={{ borderRadius: 2.4, overflow: 'hidden' }}>
        <Tabs
          value={activeTab}
          onChange={(_, value) => setActiveTab(value)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ px: 1, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <Tab value="controls" label="Watcher Controls" />
          <Tab value="groups" label="WhatsApp Group IDs" />
          <Tab value="logs" label="Logs" />
        </Tabs>
      </Paper>

      {activeTab === 'controls' ? (
        <Stack spacing={1.05}>
          <SectionCard
            title="How This Works"
            subtitle="This page controls the live automation behavior. Routing can target multiple WhatsApp groups per watcher, and the template fields steer the alert wording without editing watcher files."
            accent="#0f766e"
          >
            <FilterStrip>
              <Chip label="Admin only" color="warning" variant="outlined" />
              <Chip label="No watcher restart needed" color="success" variant="outlined" />
              <Chip label="Route one watcher to multiple groups" color="secondary" variant="outlined" />
              <Chip label="Use test sends before saving major changes" color="info" variant="outlined" />
              <Chip label="Breach tiers use comma-separated hours" color="secondary" variant="outlined" />
            </FilterStrip>
          </SectionCard>

          {draft ? (
            <>
              <SectionCard
                title="NLD Outage Watcher"
                subtitle="Controls the outage lane, the partial-cluster checks, and the not-linked-to-outage reminders."
                accent="#2563eb"
                actions={(
                  <Stack direction="row" spacing={0.6} flexWrap="wrap">
                    <TestButton watcherKey="nld" testingWatcherKey={testingWatcherKey} onClick={sendWatcherTest} disabled={loading || saving} />
                    <Button size="small" variant="outlined" startIcon={<RestoreRoundedIcon />} onClick={() => resetSection('nld')}>
                      Reset section
                    </Button>
                  </Stack>
                )}
              >
                <Stack spacing={1.15}>
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={!!draft.nld.enabled}
                        onChange={(event) => setSectionField('nld', 'enabled', event.target.checked)}
                      />
                    )}
                    label="Watcher enabled"
                  />

                  <SectionFieldGrid>
                    <TextField
                      size="small"
                      label="Target WhatsApp groups"
                      value={getGroupIds(draft.nld).join('\n')}
                      onChange={(event) => updateWatcherGroupText('nld', event.target.value)}
                      helperText="One JID per line. Leave blank to use the default WhatsApp group."
                      multiline
                      minRows={2}
                      maxRows={4}
                      sx={{ gridColumn: { xs: '1 / -1', xl: 'span 2' } }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Poll interval (seconds)"
                      value={Math.round(Number(draft.nld.pollMs || 0) / 1000)}
                      onChange={(event) => setSectionField('nld', 'pollMs', toWholeNumber(event.target.value, 300) * 1000)}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Recent window (minutes)"
                      value={draft.nld.windowMinutes}
                      onChange={(event) => setSectionField('nld', 'windowMinutes', toWholeNumber(event.target.value, 60))}
                    />
                    <TextField
                      size="small"
                      label="Breach tiers (hours)"
                      value={thresholdText.nld}
                      onChange={(event) => setThresholdText((current) => ({ ...current, nld: event.target.value }))}
                      helperText="Example: 4, 8, 12, 24"
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Partial lookback (hours)"
                      value={draft.nld.partialLookbackHours}
                      onChange={(event) => setSectionField('nld', 'partialLookbackHours', toWholeNumber(event.target.value, 24))}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Cluster window (hours)"
                      value={draft.nld.clusterWindowHours}
                      onChange={(event) => setSectionField('nld', 'clusterWindowHours', toWholeNumber(event.target.value, 3))}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Cluster min events"
                      value={draft.nld.clusterMinEvents}
                      onChange={(event) => setSectionField('nld', 'clusterMinEvents', toWholeNumber(event.target.value, 3))}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Not-logged reminder (minutes)"
                      value={draft.nld.notLoggedMinutes}
                      onChange={(event) => setSectionField('nld', 'notLoggedMinutes', toWholeNumber(event.target.value, 30))}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Resolved lookback (hours)"
                      value={draft.nld.resolvedLookbackHours}
                      onChange={(event) => setSectionField('nld', 'resolvedLookbackHours', toWholeNumber(event.target.value, 24))}
                    />
                  </SectionFieldGrid>

                  <WatcherGroupChips
                    section={draft.nld}
                    groupLookup={groupLookup}
                    color="info"
                    onDelete={(jid) => removeGroupFromWatcher('nld', jid)}
                  />

                  <TemplateGrid>
                    <TextField
                      size="small"
                      label="Recent alert title"
                      value={draft.nld.templates.recentTitle}
                      onChange={(event) => setTemplateField('nld', 'recentTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Breach alert title"
                      value={draft.nld.templates.breachTitle}
                      onChange={(event) => setTemplateField('nld', 'breachTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Resolved alert title"
                      value={draft.nld.templates.resolvedTitle}
                      onChange={(event) => setTemplateField('nld', 'resolvedTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Partial cluster title"
                      value={draft.nld.templates.partialClusterTitle}
                      onChange={(event) => setTemplateField('nld', 'partialClusterTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Partial not-logged title"
                      value={draft.nld.templates.partialNotLoggedTitle}
                      onChange={(event) => setTemplateField('nld', 'partialNotLoggedTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Breach action line"
                      value={draft.nld.templates.breachAction}
                      onChange={(event) => setTemplateField('nld', 'breachAction', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Cluster action line"
                      value={draft.nld.templates.partialClusterAction}
                      onChange={(event) => setTemplateField('nld', 'partialClusterAction', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Not-logged action line"
                      value={draft.nld.templates.partialNotLoggedAction}
                      onChange={(event) => setTemplateField('nld', 'partialNotLoggedAction', event.target.value)}
                    />
                  </TemplateGrid>
                </Stack>
              </SectionCard>

              <SectionCard
                title="Backhaul Watcher"
                subtitle="Controls the backhaul lane that keys off the configured Zendesk tag and sends both aging breaches and close-out updates."
                accent="#ea580c"
                actions={(
                  <Stack direction="row" spacing={0.6} flexWrap="wrap">
                    <TestButton watcherKey="backhaul" testingWatcherKey={testingWatcherKey} onClick={sendWatcherTest} disabled={loading || saving} />
                    <Button size="small" variant="outlined" startIcon={<RestoreRoundedIcon />} onClick={() => resetSection('backhaul')}>
                      Reset section
                    </Button>
                  </Stack>
                )}
              >
                <Stack spacing={1.15}>
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={!!draft.backhaul.enabled}
                        onChange={(event) => setSectionField('backhaul', 'enabled', event.target.checked)}
                      />
                    )}
                    label="Watcher enabled"
                  />

                  <SectionFieldGrid>
                    <TextField
                      size="small"
                      label="Backhaul Zendesk tag"
                      value={draft.backhaul.tag}
                      onChange={(event) => setSectionField('backhaul', 'tag', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Target WhatsApp groups"
                      value={getGroupIds(draft.backhaul).join('\n')}
                      onChange={(event) => updateWatcherGroupText('backhaul', event.target.value)}
                      helperText="One JID per line. Leave blank to use the default WhatsApp group."
                      multiline
                      minRows={2}
                      maxRows={4}
                      sx={{ gridColumn: { xs: '1 / -1', xl: 'span 2' } }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Poll interval (seconds)"
                      value={Math.round(Number(draft.backhaul.pollMs || 0) / 1000)}
                      onChange={(event) => setSectionField('backhaul', 'pollMs', toWholeNumber(event.target.value, 300) * 1000)}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Fresh alert lookback (hours)"
                      value={draft.backhaul.lookbackHours}
                      onChange={(event) => setSectionField('backhaul', 'lookbackHours', toWholeNumber(event.target.value, 4))}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Resolved lookback (hours)"
                      value={draft.backhaul.resolvedLookbackHours}
                      onChange={(event) => setSectionField('backhaul', 'resolvedLookbackHours', toWholeNumber(event.target.value, 24))}
                    />
                    <TextField
                      size="small"
                      label="Breach tiers (hours)"
                      value={thresholdText.backhaul}
                      onChange={(event) => setThresholdText((current) => ({ ...current, backhaul: event.target.value }))}
                      helperText="Example: 4, 8, 12, 24"
                    />
                  </SectionFieldGrid>

                  <WatcherGroupChips
                    section={draft.backhaul}
                    groupLookup={groupLookup}
                    color="warning"
                    onDelete={(jid) => removeGroupFromWatcher('backhaul', jid)}
                  />

                  <TemplateGrid>
                    <TextField
                      size="small"
                      label="New alert title"
                      value={draft.backhaul.templates.newTitle}
                      onChange={(event) => setTemplateField('backhaul', 'newTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Breach alert title"
                      value={draft.backhaul.templates.breachTitle}
                      onChange={(event) => setTemplateField('backhaul', 'breachTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Resolved alert title"
                      value={draft.backhaul.templates.resolvedTitle}
                      onChange={(event) => setTemplateField('backhaul', 'resolvedTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="New alert action line"
                      value={draft.backhaul.templates.newAction}
                      onChange={(event) => setTemplateField('backhaul', 'newAction', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Breach action line"
                      value={draft.backhaul.templates.breachAction}
                      onChange={(event) => setTemplateField('backhaul', 'breachAction', event.target.value)}
                    />
                  </TemplateGrid>
                </Stack>
              </SectionCard>

              <SectionCard
                title="Major Outage Watcher"
                subtitle="Controls major outage alerts for the NOC Outage Team lane. This watcher follows Outage Capturing tickets but excludes NLD outages."
                accent="#dc2626"
                actions={(
                  <Stack direction="row" spacing={0.6} flexWrap="wrap">
                    <TestButton watcherKey="major_outage" testingWatcherKey={testingWatcherKey} onClick={sendWatcherTest} disabled={loading || saving} />
                    <Button size="small" variant="outlined" startIcon={<RestoreRoundedIcon />} onClick={() => resetSection('majorOutage')}>
                      Reset section
                    </Button>
                  </Stack>
                )}
              >
                <Stack spacing={1.15}>
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={!!draft.majorOutage.enabled}
                        onChange={(event) => setSectionField('majorOutage', 'enabled', event.target.checked)}
                      />
                    )}
                    label="Watcher enabled"
                  />

                  <SectionFieldGrid>
                    <TextField
                      size="small"
                      label="Target WhatsApp groups"
                      value={getGroupIds(draft.majorOutage).join('\n')}
                      onChange={(event) => updateWatcherGroupText('majorOutage', event.target.value)}
                      helperText="One JID per line. Leave blank to use the default WhatsApp group."
                      multiline
                      minRows={2}
                      maxRows={4}
                      sx={{ gridColumn: { xs: '1 / -1', xl: 'span 2' } }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Poll interval (seconds)"
                      value={Math.round(Number(draft.majorOutage.pollMs || 0) / 1000)}
                      onChange={(event) => setSectionField('majorOutage', 'pollMs', toWholeNumber(event.target.value, 300) * 1000)}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Fresh alert lookback (hours)"
                      value={draft.majorOutage.lookbackHours}
                      onChange={(event) => setSectionField('majorOutage', 'lookbackHours', toWholeNumber(event.target.value, 4))}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Resolved lookback (hours)"
                      value={draft.majorOutage.resolvedLookbackHours}
                      onChange={(event) => setSectionField('majorOutage', 'resolvedLookbackHours', toWholeNumber(event.target.value, 24))}
                    />
                    <TextField
                      size="small"
                      label="Breach tiers (hours)"
                      value={thresholdText.majorOutage}
                      onChange={(event) => setThresholdText((current) => ({ ...current, majorOutage: event.target.value }))}
                      helperText="Example: 2, 4, 8, 12"
                    />
                  </SectionFieldGrid>

                  <WatcherGroupChips
                    section={draft.majorOutage}
                    groupLookup={groupLookup}
                    color="error"
                    onDelete={(jid) => removeGroupFromWatcher('majorOutage', jid)}
                  />

                  <TemplateGrid>
                    <TextField
                      size="small"
                      label="New alert title"
                      value={draft.majorOutage.templates.newTitle}
                      onChange={(event) => setTemplateField('majorOutage', 'newTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Breach alert title"
                      value={draft.majorOutage.templates.breachTitle}
                      onChange={(event) => setTemplateField('majorOutage', 'breachTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Resolved alert title"
                      value={draft.majorOutage.templates.resolvedTitle}
                      onChange={(event) => setTemplateField('majorOutage', 'resolvedTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="New alert action line"
                      value={draft.majorOutage.templates.newAction}
                      onChange={(event) => setTemplateField('majorOutage', 'newAction', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Breach action line"
                      value={draft.majorOutage.templates.breachAction}
                      onChange={(event) => setTemplateField('majorOutage', 'breachAction', event.target.value)}
                    />
                  </TemplateGrid>
                </Stack>
              </SectionCard>

              <SectionCard
                title="VIP Watcher"
                subtitle="Controls organization-based VIP alerts as well as the tag-driven VIP and back-office rule lanes."
                accent="#7c3aed"
                actions={(
                  <Stack direction="row" spacing={0.6} flexWrap="wrap">
                    <TestButton watcherKey="vip" testingWatcherKey={testingWatcherKey} onClick={sendWatcherTest} disabled={loading || saving} />
                    <Button size="small" variant="outlined" startIcon={<AddRoundedIcon />} onClick={addVipRule}>
                      Add rule
                    </Button>
                    <Button size="small" variant="outlined" startIcon={<RestoreRoundedIcon />} onClick={() => resetSection('vip')}>
                      Reset section
                    </Button>
                  </Stack>
                )}
              >
                <Stack spacing={1.15}>
                  <FormControlLabel
                    control={(
                      <Switch
                        checked={!!draft.vip.enabled}
                        onChange={(event) => setSectionField('vip', 'enabled', event.target.checked)}
                      />
                    )}
                    label="Watcher enabled"
                  />

                  <SectionFieldGrid>
                    <TextField
                      size="small"
                      label="Target WhatsApp groups"
                      value={getGroupIds(draft.vip).join('\n')}
                      onChange={(event) => updateWatcherGroupText('vip', event.target.value)}
                      helperText="One JID per line. Leave blank to use the default WhatsApp group."
                      multiline
                      minRows={2}
                      maxRows={4}
                      sx={{ gridColumn: { xs: '1 / -1', xl: 'span 2' } }}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Poll interval (seconds)"
                      value={Math.round(Number(draft.vip.pollMs || 0) / 1000)}
                      onChange={(event) => setSectionField('vip', 'pollMs', toWholeNumber(event.target.value, 120) * 1000)}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label="Lookback (hours)"
                      value={draft.vip.lookbackHours}
                      onChange={(event) => setSectionField('vip', 'lookbackHours', toWholeNumber(event.target.value, 2))}
                    />
                    <TextField
                      size="small"
                      label="VIP organization ID"
                      value={draft.vip.orgId}
                      onChange={(event) => setSectionField('vip', 'orgId', event.target.value)}
                    />
                  </SectionFieldGrid>

                  <WatcherGroupChips
                    section={draft.vip}
                    groupLookup={groupLookup}
                    color="secondary"
                    onDelete={(jid) => removeGroupFromWatcher('vip', jid)}
                  />

                  <TemplateGrid>
                    <TextField
                      size="small"
                      label="Organization alert title"
                      value={draft.vip.templates.orgTitle}
                      onChange={(event) => setTemplateField('vip', 'orgTitle', event.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Organization reason line"
                      value={draft.vip.templates.orgReason}
                      onChange={(event) => setTemplateField('vip', 'orgReason', event.target.value)}
                    />
                  </TemplateGrid>

                  <Box sx={{ display: 'grid', gap: 0.85 }}>
                    {(draft.vip.tagRules || []).map((rule, index) => (
                      <Paper
                        key={`${rule.key || 'rule'}-${index}`}
                        sx={{
                          p: 1,
                          borderRadius: 2.2,
                          border: '1px solid',
                          borderColor: 'divider',
                          background: 'linear-gradient(135deg, rgba(124,58,237,0.05) 0%, rgba(255,255,255,1) 100%)'
                        }}
                      >
                        <Stack spacing={0.85}>
                          <Stack direction="row" spacing={0.8} alignItems="center" justifyContent="space-between">
                            <Stack direction="row" spacing={0.7} alignItems="center" flexWrap="wrap">
                              <Typography variant="subtitle2" fontWeight={800}>
                                VIP Tag Rule {index + 1}
                              </Typography>
                              <Chip size="small" label={rule.tag || 'No tag yet'} variant="outlined" />
                            </Stack>
                            <Tooltip title="Delete rule">
                              <IconButton size="small" color="error" onClick={() => removeVipRule(index)}>
                                <DeleteOutlineRoundedIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </Stack>

                          <SectionFieldGrid>
                            <TextField
                              size="small"
                              label="Rule key"
                              value={rule.key}
                              onChange={(event) => updateVipRule(index, 'key', event.target.value)}
                            />
                            <TextField
                              size="small"
                              label="Zendesk tag"
                              value={rule.tag}
                              onChange={(event) => updateVipRule(index, 'tag', event.target.value)}
                            />
                            <TextField
                              size="small"
                              label="Alert title"
                              value={rule.title}
                              onChange={(event) => updateVipRule(index, 'title', event.target.value)}
                            />
                            <TextField
                              size="small"
                              label="Reason line"
                              value={rule.reason}
                              onChange={(event) => updateVipRule(index, 'reason', event.target.value)}
                            />
                          </SectionFieldGrid>

                          <Box>
                            <TextField
                              select
                              size="small"
                              label="Include priority in alert"
                              value={rule.includePriority ? 'yes' : 'no'}
                              onChange={(event) => updateVipRule(index, 'includePriority', event.target.value === 'yes')}
                              sx={{ minWidth: 220 }}
                            >
                              <MenuItem value="yes">Yes</MenuItem>
                              <MenuItem value="no">No</MenuItem>
                            </TextField>
                          </Box>
                        </Stack>
                      </Paper>
                    ))}
                  </Box>
                </Stack>
              </SectionCard>
            </>
          ) : (
            <Alert severity="info">{loading ? 'Loading watcher settings...' : 'No watcher config loaded yet.'}</Alert>
          )}
        </Stack>
      ) : null}

      {activeTab === 'groups' ? (
        <SectionCard
          title="WhatsApp Group IDs"
          subtitle="Live groups are synced from the automation WhatsApp session into the database so admins can search by name and route watchers without guessing JIDs. Buttons grey out once a watcher already targets that group in the editor."
          accent="#0f766e"
          actions={(
            <FilterStrip>
              <TextField
                size="small"
                label="Search groups"
                value={groupSearch}
                onChange={(event) => setGroupSearch(event.target.value)}
                sx={{ minWidth: 220 }}
              />
              <TextField
                select
                size="small"
                label="Rows"
                value={groupLimit}
                onChange={(event) => setGroupLimit(Number(event.target.value) || 20)}
                sx={{ width: 110 }}
              >
                {ROW_LIMIT_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>{option}</MenuItem>
                ))}
              </TextField>
              <Button
                size="small"
                variant="outlined"
                startIcon={groupLoading ? <CircularProgress size={14} /> : <RefreshRoundedIcon />}
                onClick={() => loadGroups(groupSearch, groupLimit)}
                disabled={groupLoading}
              >
                {groupLoading ? 'Loading...' : 'Refresh groups'}
              </Button>
            </FilterStrip>
          )}
        >
          <Stack spacing={0.9}>
            <Typography variant="body2" color="text.secondary">
              Loaded {groupRows.length} group rows. Use the add buttons to stage watcher routing updates, then click Save All in the page header to apply them live.
            </Typography>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Group Name</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>JID</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Participants</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Last Seen</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Watcher Routing</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {groupRows.length ? groupRows.map((row) => (
                    <TableRow key={row.jid} hover>
                      <TableCell sx={{ minWidth: 260 }}>
                        <Typography variant="body2" fontWeight={700}>{row.name || 'Unnamed group'}</Typography>
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>{row.jid}</TableCell>
                      <TableCell>{row.participantCount}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDateTime(row.lastSeenAt)}</TableCell>
                      <TableCell sx={{ minWidth: 520 }}>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          <Button size="small" variant="outlined" onClick={() => copyText(row.jid, `Copied ${row.name || row.jid}`)}>
                            Copy JID
                          </Button>
                          {WATCHER_ROUTE_ACTIONS.map((action) => {
                            const assigned = draft ? isWatcherAssigned(draft[action.sectionKey], row.jid) : false
                            return (
                              <Button
                                key={`${row.jid}-${action.watcherKey}`}
                                size="small"
                                variant="outlined"
                                color={action.color}
                                disabled={!draft || assigned}
                                onClick={() => applyGroupToWatcher(action.sectionKey, row.jid)}
                                sx={assigned ? { opacity: 0.55 } : undefined}
                              >
                                {assigned ? `${action.label} linked` : `Add ${action.label}`}
                              </Button>
                            )
                          })}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          {groupLoading ? 'Loading groups...' : 'No WhatsApp groups are synced yet. Once the automation session sync runs, they will appear here.'}
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        </SectionCard>
      ) : null}

      {activeTab === 'logs' ? (
        <SectionCard
          title="Watcher Logs"
          subtitle="Latest deduplicated watcher sends recorded in the database. This helps us confirm what already went out before a restart, deploy, or template change."
          accent="#0f766e"
          actions={(
            <FilterStrip>
              <TextField
                select
                size="small"
                label="Watcher"
                value={historyFilter}
                onChange={(event) => setHistoryFilter(event.target.value)}
                sx={{ minWidth: 170 }}
              >
                <MenuItem value="">All watchers</MenuItem>
                <MenuItem value="nld">NLD</MenuItem>
                <MenuItem value="backhaul">Backhaul</MenuItem>
                <MenuItem value="major_outage">Major Outage</MenuItem>
                <MenuItem value="vip">VIP</MenuItem>
              </TextField>
              <TextField
                select
                size="small"
                label="Rows"
                value={historyLimit}
                onChange={(event) => setHistoryLimit(Number(event.target.value) || 20)}
                sx={{ width: 110 }}
              >
                {ROW_LIMIT_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>{option}</MenuItem>
                ))}
              </TextField>
              <Button size="small" variant="outlined" startIcon={<RefreshRoundedIcon />} onClick={() => loadHistory(historyFilter, historyLimit)}>
                Refresh history
              </Button>
            </FilterStrip>
          )}
        >
          <Stack spacing={0.9}>
            <Typography variant="body2" color="text.secondary">
              Showing the latest {historyRows.length} rows for the current filter. Test sends also land here once the dispatch worker sends them.
            </Typography>

            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Sent At</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Watcher</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Alert Type</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Entity</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Summary</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {historyRows.length ? historyRows.map((row) => (
                    <TableRow key={row.id} hover>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{fmtDateTime(row.sentAt)}</TableCell>
                      <TableCell>
                        <Chip size="small" label={watcherLabel(row.watcherKey)} variant="outlined" />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.alertType}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{row.entityId || '-'}</TableCell>
                      <TableCell sx={{ minWidth: 320 }}>{compactPayload(row.payload)}</TableCell>
                    </TableRow>
                  )) : (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <Typography variant="body2" color="text.secondary">
                          No sent watcher alerts found yet for this filter.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        </SectionCard>
      ) : null}
    </PageShell>
  )
}
