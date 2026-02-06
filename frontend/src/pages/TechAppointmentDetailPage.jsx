import { useEffect, useState } from 'react'
import { Box, Paper, Typography, Button, TextField, Alert, Divider } from '@mui/material'
import { useParams } from 'react-router-dom'
import { getAppointment, submitJobCard } from '../api/techAppointments'
import { enqueueTechEvent, flushQueue, getQueue } from '../utils/offlineQueue'

export default function TechAppointmentDetailPage() {
  const { id } = useParams()
  const [appt, setAppt] = useState(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState('')
  const [queueCount, setQueueCount] = useState(0)

  async function load() {
    const r = await getAppointment(id)
    setAppt(r.data)
    setQueueCount(getQueue().length)
  }

  useEffect(() => { load() }, [id])

  async function fire(eventType, status, payload) {
    const item = enqueueTechEvent({
      appointmentId: id,
      eventType,
      status,
      payload
    })
    setQueueCount(getQueue().length)
    setMsg(`Queued: ${eventType}${status ? ` and status ${status}` : ''}`)
    await flushQueue().catch(() => {})
    setQueueCount(getQueue().length)
    await load()
    return item
  }

  async function doJobCard(outcome) {
    // job card uses its own endpoint, but we still keep it offline safe by queueing a TECH_MESSAGE and letting job card be online only for now
    await submitJobCard(id, {
      clientEventId: `cev_job_${Date.now()}`,
      outcome,
      notes: note,
      civilsRequired: false,
      customerRating: null
    })
    setMsg('Job card submitted')
    await load()
  }

  if (!appt) return <Box sx={{ p: 2 }}>Loading</Box>

  const t = appt.ticket || {}

  return (
    <Box sx={{ p: 2, maxWidth: 720, mx: 'auto' }}>
      <Typography variant="h5" gutterBottom>Appointment</Typography>

      {msg && <Alert sx={{ mb: 2 }} severity="info">{msg}</Alert>}
      <Alert sx={{ mb: 2 }} severity={navigator.onLine ? 'success' : 'warning'}>
        Online: {String(navigator.onLine)}. Queue: {queueCount}
      </Alert>

      <Paper sx={{ p: 2, mb: 2 }}>
        <Typography variant="body1" sx={{ fontWeight: 700 }}>
          {t.externalRef || appt.ticketId}
        </Typography>
        <Typography variant="body2">{t.customerName || ''}</Typography>
        <Typography variant="body2">{t.customerPhone || ''}</Typography>
        <Typography variant="body2" sx={{ mt: 1 }}>{t.address || ''}</Typography>
        <Typography variant="caption">
          GPS: {t.lat ?? '-'}, {t.lng ?? '-'}
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button variant="contained" onClick={() => fire('STATUS_CHANGED', 'EN_ROUTE', { note: 'Start appointment' })}>
            Start
          </Button>
          <Button variant="contained" onClick={() => fire('STATUS_CHANGED', 'ARRIVED', { note: 'Arrived at site' })}>
            Arrived
          </Button>
          <Button variant="outlined" onClick={() => fire('ASSISTANCE_REQUESTED', null, { note: 'Need assistance' })}>
            Assistance
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 2 }}>
        <Typography variant="h6" gutterBottom>Close out</Typography>
        <TextField
          label="Notes"
          value={note}
          onChange={e => setNote(e.target.value)}
          fullWidth
          multiline
          minRows={3}
        />

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 2 }}>
          <Button variant="contained" onClick={() => doJobCard('SUCCESSFUL')}>
            Complete successful
          </Button>
          <Button variant="contained" color="error" onClick={() => doJobCard('UNSUCCESSFUL')}>
            Complete unsuccessful
          </Button>
        </Box>
      </Paper>
    </Box>
  )
}
