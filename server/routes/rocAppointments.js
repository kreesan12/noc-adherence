// server/routes/rocAppointments.js
import { Router } from 'express'

export default function rocAppointmentsRoutes(prisma) {
  const r = Router()

  r.get('/technicians', async (_req, res) => {
    const techs = await prisma.technician.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    })
    res.json(techs)
  })

  r.get('/tickets', async (_req, res) => {
    const tickets = await prisma.ticket.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200
    })
    res.json(tickets)
  })

  r.post('/tickets', async (req, res) => {
    const {
      externalRef,
      customerName,
      customerPhone,
      address,
      lat,
      lng,
      notes
    } = req.body || {}

    if (!customerName) throw new Error('customerName is required')

    const created = await prisma.ticket.create({
      data: {
        externalRef: externalRef || null,
        customerName,
        customerPhone: customerPhone || null,
        address: address || null,
        lat: typeof lat === 'number' ? lat : null,
        lng: typeof lng === 'number' ? lng : null,
        notes: notes || null
      }
    })

    res.json(created)
  })

  r.get('/appointments', async (req, res) => {
    const { dateFrom, dateTo, technicianId } = req.query || {}

    const where = {}
    if (dateFrom && dateTo) {
      where.appointmentDate = {
        gte: new Date(String(dateFrom)),
        lte: new Date(String(dateTo))
      }
    }
    if (technicianId) where.technicianId = String(technicianId)

    const appts = await prisma.appointment.findMany({
      where,
      include: { ticket: true, technician: true },
      orderBy: [{ appointmentDate: 'asc' }, { slotNumber: 'asc' }]
    })

    res.json(appts)
  })

  r.post('/appointments', async (req, res) => {
    const {
      ticketId,
      technicianId,
      appointmentDate,
      slotNumber,
      windowStartTime,
      windowEndTime
    } = req.body || {}

    if (!ticketId) throw new Error('ticketId is required')
    if (!appointmentDate) throw new Error('appointmentDate is required')

    const appt = await prisma.appointment.create({
      data: {
        ticketId,
        technicianId: technicianId || null,
        appointmentDate: new Date(appointmentDate),
        slotNumber: Number.isInteger(slotNumber) ? slotNumber : null,
        windowStartTime: windowStartTime || null,
        windowEndTime: windowEndTime || null,
        status: 'SCHEDULED',
        createdByUserId: req.user?.id ? String(req.user.id) : null,
        updatedByUserId: req.user?.id ? String(req.user.id) : null,
        events: {
          create: {
            eventType: 'CREATED',
            actorType: 'ROC',
            actorId: req.user?.id ? String(req.user.id) : null,
            payload: { source: 'roc_create' }
          }
        }
      },
      include: { ticket: true, technician: true }
    })

    res.json(appt)
  })

  r.patch('/appointments/:id/move', async (req, res) => {
    const apptId = String(req.params.id)

    const {
      technicianId,
      appointmentDate,
      slotNumber,
      windowStartTime,
      windowEndTime
    } = req.body || {}

    const updated = await prisma.appointment.update({
      where: { id: apptId },
      data: {
        technicianId: technicianId === undefined ? undefined : (technicianId || null),
        appointmentDate: appointmentDate ? new Date(appointmentDate) : undefined,
        slotNumber: slotNumber === undefined ? undefined : (Number.isInteger(slotNumber) ? slotNumber : null),
        windowStartTime: windowStartTime === undefined ? undefined : (windowStartTime || null),
        windowEndTime: windowEndTime === undefined ? undefined : (windowEndTime || null),
        updatedByUserId: req.user?.id ? String(req.user.id) : null,
        events: {
          create: {
            eventType: 'MOVED',
            actorType: 'ROC',
            actorId: req.user?.id ? String(req.user.id) : null,
            payload: { technicianId, appointmentDate, slotNumber, windowStartTime, windowEndTime }
          }
        }
      },
      include: { ticket: true, technician: true }
    })

    res.json(updated)
  })

  return r
}
