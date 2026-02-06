import { useEffect, useMemo, useState } from 'react'
import {
  Box, Paper, Typography, FormControl, InputLabel, Select, MenuItem,
  TextField, Button, Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemText, Divider, Alert
} from '@mui/material'
import dayjs from 'dayjs'
import {
  listTechnicians, searchTickets, listAppointments,
  createAppointment, moveAppointment, suggestSlot, routeSummary
} from '../api/rocAppointments'

const SLOTS = [
  { n: 1, label: 'Slot 1', start: '08:00', end: '10:00' },
  { n: 2, label: 'Slot 2', start: '10:00', end: '12:00' },
  { n: 3, label: 'Slot 3', start: '12:00', end: '14:00' },
  { n: 4, label: 'Slot 4', start: '14:00', end: '16:00' },
  { n: 5, label: 'Slot 5', start: '16:00', end: '18:00' }
]

export default function RocAppointmentsPage() {
  const [techs, setTechs] = useState([])
  const [techId, setTechId] = useState('')
  const [date, setDate] = useState(dayjs().format('YYYY-MM-DD'))
  const [appts, setAppts] = useState([])
  const [loading, setLoading] = useState(false)

  const [createOpen, setCreateOpen] = useState(false)
  const [ticketSearch, setTicketSearch] = useState('')
  const [ticketResults, setTicketResults] = useState([])
  const [pickedTicket, setPickedTicket] = useState(null)
  const [suggested, setSuggested] = useState(null)
  const [route, setRoute] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    listTechnicians().then(r => {
      setTechs(r.data)
      if (r.data.length) setTechId(r.data[0].id)
    })
  }, [])

  async function load() {
    if (!techId) return
    setLoading(true)
    setError('')
    try {
      const from = date
      const to = date
      const r = await listAppointments({ from, to, technicianId: techId })
      setAppts(r.data)
      const rr = await routeSummary({ technicianId: techId, date })
      setRoute(rr.data)
    } catch (e) {
      setError(e?.response?.data?.error || e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [techId, date])

  const apptBySlot = useMemo(() => {
    const m = {}
    for (const a of appts) {
      if (a.slotNumber) m[a.slotNumber] = a
    }
    return m
  }, [appts])

  async function doTicketSearch() {
    const r = await searchTickets(ticketSearch)
    setTicketResults(r.data)
  }

  async function computeSuggestion(ticketId) {
    const r = await suggestSlot({ technicianId: techId, date, ticketId })
    setSuggested(r.data)
  }

  async function createInSlot(slotNumber) {
    if (!pickedTicket) return
    const win = SLOTS.find(s => s.n === slotNumber)
    const payload = {
      ticketId: pickedTicket.id,
      technicianId: techId,
      appointmentDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
      slotNumber,
      windowStartTime: win.start,
      windowEndTime: win.end
    }
    await createAppointment(payload)
    setCreateOpen(false)
    setPickedTicket(null)
    setTicketResults([])
    setTicketSearch('')
    setSuggested(null)
    await load()
  }

  async function moveSlot(fromSlot, toSlot) {
    const a = apptBySlot[fromSlot]
    if (!a) return
    await moveAppointment(a.id, {
      technicianId: techId,
      appointmentDate: new Date(`${date}T00:00:00.000Z`).toISOString(),
      slotNumber: toSlot
    })
    await load()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h4" gutterBottom>ROC Appointments</Typography>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <FormControl sx={{ minWidth: 220 }}>
            <InputLabel>Technician</InputLabel>
            <Select value={techId} label="Technician" onChange={e => setTechId(e.target.value)}>
              {techs.map(t => (
                <MenuItem key={t.id} value={t.id}>
                  {t.name} {t.region ? `(${t.region})` : ''}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Date"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            InputLabelProps={{ shrink: true }}
          />

          <Button variant="contained" onClick={() => setCreateOpen(true)} disabled={!techId}>
            Add appointment
          </Button>

          <Button variant="outlined" onClick={load} disabled={loading}>
            Refresh
          </Button>
        </Box>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 2 }}>
        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Day view</Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 1 }}>
            {SLOTS.map(s => {
              const a = apptBySlot[s.n]
              return (
                <Paper
                  key={s.n}
                  variant="outlined"
                  sx={{ p: 1, minHeight: 160, cursor: 'pointer' }}
                  onClick={() => !a && setCreateOpen(true)}
                >
                  <Typography variant="subtitle2">{s.label}</Typography>
                  <Typography variant="caption">{s.start} to {s.end}</Typography>
                  <Divider sx={{ my: 1 }} />

                  {!a ? (
                    <Typography variant="body2" sx={{ opacity: 0.7 }}>
                      Empty. Use Add appointment
                    </Typography>
                  ) : (
                    <>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {a.ticket?.externalRef || a.ticketId}
                      </Typography>
                      <Typography variant="body2">
                        {a.ticket?.customerName || ''}
                      </Typography>
                      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                        {a.ticket?.address || ''}
                      </Typography>

                      <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                        {SLOTS.filter(x => x.n !== s.n && !apptBySlot[x.n]).map(x => (
                          <Button
                            key={x.n}
                            size="small"
                            variant="outlined"
                            onClick={e => { e.stopPropagation(); moveSlot(s.n, x.n) }}
                          >
                            Move to {x.n}
                          </Button>
                        ))}
                      </Box>
                    </>
                  )}
                </Paper>
              )
            })}
          </Box>
        </Paper>

        <Paper sx={{ p: 2 }}>
          <Typography variant="h6" gutterBottom>Route summary</Typography>
          {!route ? (
            <Typography variant="body2" sx={{ opacity: 0.7 }}>No summary yet</Typography>
          ) : (
            <>
              <Typography variant="body2">
                Total travel minutes: {Math.round(route.totals?.totalMinutes || 0)}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Total km: {Math.round(route.totals?.totalKm || 0)}
              </Typography>

              <Divider sx={{ my: 1 }} />

              <List dense>
                {(route.legs || []).map((l, idx) => (
                  <ListItem key={idx} disableGutters>
                    <ListItemText
                      primary={`${l.to}  ${l.externalRef || ''}`}
                      secondary={`~${l.minutes ?? '-'} min, ~${l.km ? l.km.toFixed(1) : '-'} km`}
                    />
                  </ListItem>
                ))}
              </List>
            </>
          )}
        </Paper>
      </Box>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Create appointment</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', mt: 1 }}>
            <TextField
              label="Search ticket"
              value={ticketSearch}
              onChange={e => setTicketSearch(e.target.value)}
              size="small"
              sx={{ flex: 1, minWidth: 260 }}
            />
            <Button variant="outlined" onClick={doTicketSearch}>Search</Button>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mt: 2 }}>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2">Results</Typography>
              <List dense>
                {ticketResults.map(t => (
                  <ListItem
                    key={t.id}
                    disableGutters
                    sx={{ cursor: 'pointer', p: 1, borderRadius: 1, '&:hover': { bgcolor: 'rgba(0,0,0,0.04)' } }}
                    onClick={() => { setPickedTicket(t); computeSuggestion(t.id) }}
                  >
                    <ListItemText
                      primary={t.externalRef || t.id}
                      secondary={`${t.customerName || ''}  ${t.address || ''}`}
                    />
                  </ListItem>
                ))}
              </List>
            </Paper>

            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="subtitle2">Suggestion</Typography>
              {!pickedTicket ? (
                <Typography variant="body2" sx={{ opacity: 0.7, mt: 1 }}>
                  Select a ticket to get suggested slot
                </Typography>
              ) : (
                <>
                  <Typography variant="body2" sx={{ mt: 1 }}>
                    Ticket: <b>{pickedTicket.externalRef || pickedTicket.id}</b>
                  </Typography>

                  {suggested?.recommendedSlotNumber ? (
                    <>
                      <Typography variant="body2" sx={{ mt: 1 }}>
                        Recommended slot: <b>{suggested.recommendedSlotNumber}</b>
                      </Typography>
                      <Divider sx={{ my: 1 }} />
                      <List dense>
                        {suggested.rankedSlots.slice(0, 5).map((s, idx) => (
                          <ListItem key={idx} disableGutters>
                            <ListItemText
                              primary={`Slot ${s.slotNumber}`}
                              secondary={`Score ~${s.score} min. Between ${s.insertBetween.before ?? 'start'} and ${s.insertBetween.after ?? 'end'}`}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </>
                  ) : (
                    <Typography variant="body2" sx={{ opacity: 0.7, mt: 1 }}>
                      No suggestion available
                    </Typography>
                  )}
                </>
              )}
            </Paper>
          </Box>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2">Choose slot</Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
            {SLOTS.map(s => (
              <Button
                key={s.n}
                variant="contained"
                disabled={!pickedTicket || Boolean(apptBySlot[s.n])}
                onClick={() => createInSlot(s.n)}
              >
                Slot {s.n}
              </Button>
            ))}
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setCreateOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
