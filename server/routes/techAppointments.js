// server/routes/techAppointments.js
import { Router } from 'express'
import { nanoid } from 'nanoid'

export default function techAppointmentsRoutes(prisma) {
  const r = Router()

  r.get('/me/appointments', async (req, res) => {
    const techId = String(req.user?.id || '')
    if (!techId) return res.status(401).json({ error: 'missing tech token' })

    const from = req.query.from ? new Date(String(req.query.from)) : new Date()
    const to = req.query.to ? new Date(String(req.query.to)) : new Date()

    const appts = await prisma.appointment.findMany({
      where: {
        technicianId: techId,
        appointmentDate: { gte: from, lte: to }
      },
      include: { ticket: true },
      orderBy: [{ appointmentDate: 'asc' }, { slotNumber: 'asc' }]
    })

    res.json(appts)
  })

  r.post('/appointments/:id/events', async (req, res) => {
    const techId = String(req.user?.id || '')
    if (!techId) return res.status(401).json({ error: 'missing tech token' })

    const apptId = String(req.params.id)
    const {
      clientEventId,
      eventType,
      status,
      lat,
      lng,
      payload,
      eventTime
    } = req.body || {}

    if (!clientEventId) throw new Error('clientEventId is required')
    if (!eventType) throw new Error('eventType is required')

    try {
      const created = await prisma.appointmentEvent.create({
        data: {
          id: `evt_${nanoid(12)}`,
          appointmentId: apptId,
          eventType,
          actorType: 'TECH',
          actorId: techId,
          clientEventId: String(clientEventId),
          eventTime: eventTime ? new Date(eventTime) : new Date(),
          lat: typeof lat === 'number' ? lat : null,
          lng: typeof lng === 'number' ? lng : null,
          payload: payload ?? null
        }
      })

      if (eventType === 'STATUS_CHANGED' && status) {
        await prisma.appointment.update({
          where: { id: apptId },
          data: { status }
        })
      }

      res.json({ ok: true, event: created })
    } catch (e) {
      if (String(e?.code) === 'P2002') {
        return res.json({ ok: true, duplicate: true })
      }
      console.error(e)
      res.status(400).json({ error: 'failed to create event' })
    }
  })

  r.post('/appointments/:id/job-card', async (req, res) => {
    const techId = String(req.user?.id || '')
    if (!techId) return res.status(401).json({ error: 'missing tech token' })

    const apptId = String(req.params.id)
    const {
      outcome,
      reasonCode,
      notes,
      civilsRequired,
      signedByName,
      signedAt,
      customerRating
    } = req.body || {}

    if (!outcome) throw new Error('outcome is required')

    const job = await prisma.jobCard.upsert({
      where: { appointmentId: apptId },
      create: {
        id: `job_${nanoid(12)}`,
        appointmentId: apptId,
        outcome,
        reasonCode: reasonCode || null,
        notes: notes || null,
        civilsRequired: !!civilsRequired,
        signedByName: signedByName || null,
        signedAt: signedAt ? new Date(signedAt) : null,
        customerRating: Number.isInteger(customerRating) ? customerRating : null
      },
      update: {
        outcome,
        reasonCode: reasonCode || null,
        notes: notes || null,
        civilsRequired: !!civilsRequired,
        signedByName: signedByName || null,
        signedAt: signedAt ? new Date(signedAt) : null,
        customerRating: Number.isInteger(customerRating) ? customerRating : null
      }
    })

    await prisma.appointmentEvent.create({
      data: {
        id: `job_${nanoid(12)}`,
        appointmentId: apptId,
        eventType: 'JOB_CARD_SUBMITTED',
        actorType: 'TECH',
        actorId: techId,
        payload: {
          outcome,
          reasonCode,
          notes,
          civilsRequired,
          signedByName,
          signedAt,
          customerRating
        }
      }
    })

    await prisma.appointment.update({
      where: { id: apptId },
      data: {
        status: outcome === 'SUCCESSFUL' ? 'COMPLETED' : 'UNSUCCESSFUL'
      }
    })

    res.json({ ok: true, job })
  })

  return r
}
