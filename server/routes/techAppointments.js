// server/routes/techAppointments.js
import { Router } from 'express'
import dayjs from '../utils/dayjs.js'
import { nanoid } from 'nanoid'

export default function techAppointmentsRoutes(prisma) {
  const r = Router()

  function requireTechUser(req) {
    return req.user?.id != null ? String(req.user.id) : null
  }

  r.get('/my', async (req, res) => {
    const technicianId = (req.query.technicianId || '').toString().trim()
    const from = (req.query.from || '').toString().trim()
    const to = (req.query.to || '').toString().trim()

    if (!technicianId) throw new Error('technicianId required')
    if (!from || !to) throw new Error('from and to required')

    const start = dayjs(from).startOf('day').toDate()
    const end = dayjs(to).endOf('day').toDate()

    const appts = await prisma.appointment.findMany({
      where: {
        technicianId,
        appointmentDate: { gte: start, lte: end }
      },
      include: { ticket: true, technician: true },
      orderBy: [{ appointmentDate: 'asc' }, { slotNumber: 'asc' }]
    })

    res.json(appts)
  })

  r.get('/:id', async (req, res) => {
    const id = req.params.id
    const appt = await prisma.appointment.findUnique({
      where: { id },
      include: { ticket: true, technician: true, events: true, assets: true, jobCard: true }
    })
    if (!appt) throw new Error('Appointment not found')
    res.json(appt)
  })

  // Offline safe event ingestion with clientEventId unique
  r.post('/:id/event', async (req, res) => {
    const apptId = req.params.id
    const {
      clientEventId,
      eventType,
      status,
      lat,
      lng,
      payload,
      eventTime
    } = req.body || {}

    if (!clientEventId) throw new Error('clientEventId required')
    if (!eventType) throw new Error('eventType required')

    const actorId = requireTechUser(req)

    const existing = await prisma.appointmentEvent.findUnique({
      where: { clientEventId }
    })
    if (existing) return res.json({ ok: true, deduped: true, event: existing })

    const appt = await prisma.appointment.findUnique({ where: { id: apptId } })
    if (!appt) throw new Error('Appointment not found')

    const mergedPayload = {
      ...(payload || {}),
      ...(eventTime ? { eventTime } : {})
    }

    const createEvent = await prisma.appointmentEvent.create({
      data: {
        id: `evt_${nanoid(12)}`,
        appointmentId: apptId,
        clientEventId,
        eventType,
        actorType: 'TECH',
        actorId,
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        payload: Object.keys(mergedPayload).length ? mergedPayload : null
      }
    })

    // optional status update
    let updated = appt
    if (status) {
      updated = await prisma.appointment.update({
        where: { id: apptId },
        data: {
          status,
          updatedByUserId: actorId,
          ...(eventType === 'STATUS_CHANGED'
            ? {}
            : {
                events: {
                  create: {
                    id: `evt_${nanoid(12)}`,
                    appointmentId: apptId,
                    eventType: 'STATUS_CHANGED',
                    actorType: 'SYSTEM',
                    actorId: actorId,
                    payload: { from: appt.status, to: status, source: 'tech_event' }
                  }
                }
              })
        }
      })
    }

    res.json({ ok: true, event: createEvent, appointment: updated })
  })

  r.post('/:id/photo', async (req, res) => {
    const apptId = req.params.id
    const { clientEventId, dataUrl } = req.body || {}
    if (!clientEventId) throw new Error('clientEventId required')
    if (!dataUrl) throw new Error('dataUrl required')

    const actorId = requireTechUser(req)

    const existing = await prisma.appointmentEvent.findUnique({ where: { clientEventId } })
    if (existing) return res.json({ ok: true, deduped: true })

    const asset = await prisma.appointmentAsset.create({
      data: {
        id: `asset_${nanoid(12)}`,
        appointmentId: apptId,
        assetType: 'PHOTO',
        fileUrl: dataUrl
      }
    })

    await prisma.appointmentEvent.create({
      data: {
        id: `evt_${nanoid(12)}`,
        appointmentId: apptId,
        clientEventId,
        eventType: 'ASSET_UPLOADED',
        actorType: 'TECH',
        actorId,
        payload: { assetId: asset.id, assetType: 'PHOTO' }
      }
    })

    res.json({ ok: true, asset })
  })

  r.post('/:id/signature', async (req, res) => {
    const apptId = req.params.id
    const { clientEventId, dataUrl, signedByName } = req.body || {}
    if (!clientEventId) throw new Error('clientEventId required')
    if (!dataUrl) throw new Error('dataUrl required')

    const actorId = requireTechUser(req)

    const existing = await prisma.appointmentEvent.findUnique({ where: { clientEventId } })
    if (existing) return res.json({ ok: true, deduped: true })

    const asset = await prisma.appointmentAsset.create({
      data: {
        id: `asset_${nanoid(12)}`,
        appointmentId: apptId,
        assetType: 'SIGNATURE',
        fileUrl: dataUrl
      }
    })

    await prisma.jobCard.upsert({
      where: { appointmentId: apptId },
      update: {
        signedByName: signedByName || null,
        signedAt: new Date()
      },
      create: {
        id: `job_${nanoid(12)}`,
        appointmentId: apptId,
        outcome: 'SUCCESSFUL',
        signedByName: signedByName || null,
        signedAt: new Date()
      }
    })

    await prisma.appointmentEvent.create({
      data: {
        id: `evt_${nanoid(12)}`,
        appointmentId: apptId,
        clientEventId,
        eventType: 'ASSET_UPLOADED',
        actorType: 'TECH',
        actorId,
        payload: { assetId: asset.id, assetType: 'SIGNATURE' }
      }
    })

    res.json({ ok: true, asset })
  })

  r.post('/:id/job-card', async (req, res) => {
    const apptId = req.params.id
    const {
      clientEventId,
      outcome,
      reasonCode,
      notes,
      civilsRequired,
      customerRating
    } = req.body || {}

    if (!clientEventId) throw new Error('clientEventId required')
    if (!outcome) throw new Error('outcome required')

    const actorId = requireTechUser(req)

    const existing = await prisma.appointmentEvent.findUnique({ where: { clientEventId } })
    if (existing) return res.json({ ok: true, deduped: true })

    const job = await prisma.jobCard.upsert({
      where: { appointmentId: apptId },
      update: {
        outcome,
        reasonCode: reasonCode || null,
        notes: notes || null,
        civilsRequired: Boolean(civilsRequired),
        customerRating: customerRating != null ? Number(customerRating) : null
      },
      create: {
        id: `job_${nanoid(12)}`,
        appointmentId: apptId,
        outcome,
        reasonCode: reasonCode || null,
        notes: notes || null,
        civilsRequired: Boolean(civilsRequired),
        customerRating: customerRating != null ? Number(customerRating) : null
      }
    })

    await prisma.appointmentEvent.create({
      data: {
        id: `evt_${nanoid(12)}`,
        appointmentId: apptId,
        clientEventId,
        eventType: 'JOB_CARD_SUBMITTED',
        actorType: 'TECH',
        actorId,
        payload: { outcome, civilsRequired: Boolean(civilsRequired) }
      }
    })

    const status =
      outcome === 'SUCCESSFUL' ? 'COMPLETED' :
      Boolean(civilsRequired) ? 'CIVILS_REQUIRED' :
      'UNSUCCESSFUL'

    const updated = await prisma.appointment.update({
      where: { id: apptId },
      data: { status, updatedByUserId: actorId }
    })

    res.json({ ok: true, job, appointment: updated })
  })

  return r
}
