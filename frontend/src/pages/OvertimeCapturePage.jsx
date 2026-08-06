import { useMemo, useState } from 'react'
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material'
import dayjs from '../lib/dayjs.js'
import api from '../api'
import { FilterStrip, PageShell, SectionCard } from '../components/ui/PageScaffold'

function toIso(dateStr, timeStr) {
  return dayjs(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm').toISOString()
}

export default function OvertimeCapturePage() {
  const [workDate, setWorkDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [startTime, setStartTime] = useState('18:00')
  const [endTime, setEndTime] = useState('20:00')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const minDate = useMemo(() => dayjs().subtract(7, 'day').format('YYYY-MM-DD'), [])
  const maxDate = useMemo(() => dayjs().format('YYYY-MM-DD'), [])
  const canSave = workDate >= minDate && reason.trim().length > 0 && startTime < endTime

  async function submit() {
    setSaving(true)
    setNotice('')
    setError('')
    try {
      await api.post('/overtime/manual', {
        workDate,
        startAt: toIso(workDate, startTime),
        endAt: toIso(workDate, endTime),
        reason,
        notes
      })
      setReason('')
      setNotes('')
      setNotice('Manual overtime submitted successfully')
    } catch (err) {
      setError(err?.response?.data?.error || err?.message || 'Failed to submit overtime')
    } finally {
      setSaving(false)
    }
  }

  return (
    <PageShell
      eyebrow="Staffing and Scheduling"
      title="Overtime Capture"
      description="Log manual overtime quickly for the last seven days, with a cleaner capture flow that makes the rules visible before submit."
      accent="#2563eb"
      stats={[
        {
          label: 'Capture Window',
          value: '7 Days',
          helper: 'Manual overtime can only be captured within the last seven days.',
          accent: '#2563eb'
        },
        {
          label: 'Earliest Date',
          value: minDate,
          helper: 'Oldest date still accepted',
          accent: '#0f766e'
        },
        {
          label: 'Latest Date',
          value: maxDate,
          helper: 'Today is the upper limit',
          accent: '#d97706'
        }
      ]}
    >
      {error ? <Alert severity="error">{error}</Alert> : null}
      {notice ? <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert> : null}

      <SectionCard
        title="Manual Entry"
        subtitle="Use this for genuine manual overtime only. Fixed overtime still belongs in the supervisor generation flow."
        accent="#2563eb"
      >
        <Stack spacing={1}>
          <FilterStrip>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Rule check: the work date must fall between {minDate} and {maxDate}, and the end time must be after the start time.
            </Typography>
          </FilterStrip>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' },
              gap: 1
            }}
          >
            <TextField
              label="Work date"
              type="date"
              value={workDate}
              inputProps={{ min: minDate, max: maxDate }}
              onChange={(event) => setWorkDate(event.target.value)}
            />

            <TextField
              label="Reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />

            <TextField
              label="Start time"
              type="time"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
            />

            <TextField
              label="End time"
              type="time"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
            />

            <TextField
              label="Notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              multiline
              minRows={3}
              sx={{ gridColumn: { xs: 'auto', md: '1 / span 2' } }}
            />
          </Box>

          <Stack direction="row" spacing={0.8} justifyContent="flex-end">
            <Button
              variant="outlined"
              onClick={() => {
                setReason('')
                setNotes('')
              }}
              disabled={saving}
            >
              Clear
            </Button>
            <Button variant="contained" disabled={!canSave || saving} onClick={submit}>
              Submit Overtime
            </Button>
          </Stack>
        </Stack>
      </SectionCard>
    </PageShell>
  )
}
