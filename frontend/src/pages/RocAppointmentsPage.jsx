// frontend/src/pages/RocAppointmentsPage.jsx
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Box, Paper, Typography, Divider, Button, MenuItem, Select,
  FormControl, InputLabel, TextField, Chip, Stack
} from '@mui/material'
import { LocalizationProvider, DatePicker } from '@mui/x-date-pickers'
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs'
import dayjs from 'dayjs'

import FullCalendar from '@fullcalendar/react'
import resourceTimelinePlugin from '@fullcalendar/resource-timeline'
import interactionPlugin from '@fullcalendar/interaction'

import {
  listTechnicians,
  listTestTickets,
  listAppointments,
  createAppointment,
  moveAppointment
} from '../api/rocAppointments'

const SLOT_WINDOWS = [
  { slot: 1, label: 'Slot 1', start: '08:00', end: '10:00' },
  { slot: 2, label: 'Slot 2', start: '10:00', end: '12:00' },
  { slot: 3, label: 'Slot 3', start: '12:00', end: '14:00' },
  { slot: 4, label: 'Slot 4', start: '14:00', end: '16:00' },
  { slot: 5, label: 'Slot 5', start: '16:00', end: '18:00' }
]

function slotForTime(hhmm) {
  let slot = 1
  for (const s of SLOT_WINDOWS) {
    if (hhmm >= s.start && hhmm < s.end) slot = s.slot
  }
  return slot
}

export default function RocAppointmentsPage() {
  const calRef = useRef(null)

  const [techs, setTechs] = useState([])
  const [tickets, setTickets] = useState([])
  const [appts, setAppts] = useState([])

  const [day, setDay] = useState(dayjs().startOf('day'))
  const [filterTechId, setFilterTechId] = useState('')
  const [loading, setLoading] = useState(false)

  async function loadAll() {
    setLoading(true)
    try {
      const [t1, t2] = await Promise.all([listTechnicians(), listTestTickets()])
      setTechs(t1.data || [])
      setTickets(t2.data || [])
    } finally {
      setLoading(false)
    }
  }

  async function loadSchedule() {
    setLoading(true)
    try {
      const from = day.startOf('day').toISOString()
      const to = day.add(6, 'day').endOf('day').toISOString()

      const res = await listAppointments({
        dateFrom: from,
        dateTo: to,
        technicianId: filterTechId || undefined
      })
      setAppts(res.data || [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  useEffect(() => {
    loadSchedule()
  }, [day, filterTechId])

  const resources = useMemo(() => (
    techs.map(t => ({
      id: t.id,
      title: `${t.name}${t.region ? ` | ${t.region}` : ''}${t.area ? ` | ${t.area}` : ''}`
    }))
  ), [techs])

  const events = useMemo(() => {
    return appts
      .filter(a => a.technicianId) // Phase 1: hide unassigned; we will add an unassigned lane later
      .map(a => {
        const dateIso = dayjs(a.appointmentDate).format('YYYY-MM-DD')
        const slot = a.slotNumber || 1
        const w = SLOT_WINDOWS.find(x => x.slot === slot) || SLOT_WINDOWS[0]
        const start = new Date(`${dateIso}T${w.start}:00`)
        const end = new Date(`${dateIso}T${w.end}:00`)

        return {
          id: a.id,
          resourceId: a.technicianId,
          start,
          end,
          title: `${a.ticket?.customerName || 'Customer'} | ${a.ticket?.externalRef || 'Ticket'}`,
          extendedProps: { appt: a }
        }
      })
  }, [appts])

  async function quickCreate(ticketId, technicianId, slotNumber) {
    const w = SLOT_WINDOWS.find(s => s.slot === slotNumber) || SLOT_WINDOWS[0]
    await createAppointment({
      ticketId,
      technicianId,
      appointmentDate: day.toISOString(),
      slotNumber,
      windowStartTime: w.start,
      windowEndTime: w.end
    })
    await loadSchedule()
  }

  async function onEventDrop(info) {
    const apptId = info.event.id

    const resource = info.event.getResources()?.[0]
    const newTechId = resource?.id || null

    const newDateIso = dayjs(info.event.start).startOf('day').toISOString()
    const hhmm = dayjs(info.event.start).format('HH:mm')
    const newSlot = slotForTime(hhmm)

    const w = SLOT_WINDOWS.find(s => s.slot === newSlot) || SLOT_WINDOWS[0]

    await moveAppointment(apptId, {
      technicianId: newTechId,
      appointmentDate: newDateIso,
      slotNumber: newSlot,
      windowStartTime: w.start,
      windowEndTime: w.end
    })

    await loadSchedule()
  }

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)' }}>
        {/* Left panel */}
        <Paper variant="outlined" sx={{ width: 380, p: 2, mr: 2, overflow: 'auto' }}>
          <Typography variant="h5" sx={{ fontWeight: 800 }}>
            ROC Appointments
          </Typography>

          <Divider sx={{ my: 2 }} />

          <DatePicker
            label="Start day"
            value={day}
            onChange={d => d && setDay(d.startOf('day'))}
            slotProps={{ textField: { size: 'small', fullWidth: true } }}
          />

          <FormControl size="small" fullWidth sx={{ mt: 2 }}>
            <InputLabel>Technician filter</InputLabel>
            <Select
              value={filterTechId}
              label="Technician filter"
              onChange={e => setFilterTechId(e.target.value)}
            >
              <MenuItem value="">All technicians</MenuItem>
              {techs.map(t => (
                <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
            {SLOT_WINDOWS.map(s => (
              <Chip key={s.slot} label={`${s.label} ${s.start} to ${s.end}`} size="small" />
            ))}
          </Stack>

          <Divider sx={{ my: 2 }} />

          <Typography variant="h6" sx={{ mb: 1 }}>
            Test tickets
          </Typography>

          {tickets.slice(0, 50).map(t => (
            <Paper key={t.id} variant="outlined" sx={{ p: 1.5, mb: 1.2, borderRadius: 2 }}>
              <Typography sx={{ fontWeight: 800 }}>{t.customerName}</Typography>
              <Typography variant="body2" sx={{ opacity: 0.85 }}>
                {t.externalRef || 'No ref'} | {t.address || 'No address'}
              </Typography>

              <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                <Button
                  size="small"
                  variant="contained"
                  disabled={loading || techs.length === 0}
                  onClick={() => quickCreate(t.id, techs[0].id, 1)}
                >
                  Assign slot 1
                </Button>

                <Button
                  size="small"
                  variant="outlined"
                  disabled={loading || techs.length === 0}
                  onClick={() => quickCreate(t.id, techs[0].id, 3)}
                >
                  Assign slot 3
                </Button>
              </Box>
            </Paper>
          ))}
        </Paper>

        {/* Calendar */}
        <Paper variant="outlined" sx={{ flex: 1, p: 1.5 }}>
          <FullCalendar
            ref={calRef}
            plugins={[resourceTimelinePlugin, interactionPlugin]}
            initialView="resourceTimelineDay"
            height="100%"
            editable
            resourceAreaWidth={320}
            resources={resources}
            events={events}
            eventDrop={onEventDrop}
            slotMinTime="08:00:00"
            slotMaxTime="18:00:00"
            slotDuration="00:30:00"
            nowIndicator
          />
        </Paper>
      </Box>
    </LocalizationProvider>
  )
}
