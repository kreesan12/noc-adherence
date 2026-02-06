// server/routes/rocAppointments.js
import { Router } from 'express'
import dayjs from '../utils/dayjs.js'
import { nanoid } from 'nanoid'
import crypto from "crypto"

/* ------------------------------------------------------------------
   Helpers
------------------------------------------------------------------- */

function toDateOnlyRange(dateStr) {
  const start = dayjs(dateStr).startOf('day').toDate()
  const end = dayjs(dateStr).endOf('day').toDate()
  return { start, end }
}

function parseISODate(d) {
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) throw new Error('Invalid appointmentDate')
  return dt
}

function haversineKm(aLat, aLng, bLat, bLng) {
  if ([aLat, aLng, bLat, bLng].some(v => v == null)) return null
  const R = 6371
  const toRad = x => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLng - aLng)
  const lat1 = toRad(aLat)
  const lat2 = toRad(bLat)
  const s =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
  return R * c
}

function estimateTravelMinutes(km, region = 'DEFAULT') {
  if (km == null) return null
  const speedKmh =
    region === 'CPT' ? 40 :
    region === 'JHB' ? 45 :
    42
  return Math.max(1, Math.round((km / speedKmh) * 60))
}

function slotWindow(slotNumber) {
  const windows = {
    1: { start: '08:00', end: '10:00' },
    2: { start: '10:00', end: '12:00' },
    3: { start: '12:00', end: '14:00' },
    4: { start: '14:00', end: '16:00' },
    5: { start: '16:00', end: '18:00' }
  }
  return windows[slotNumber] || null
}

// Simple in memory limiter (ok for small scale). Replace with Redis later if needed.
const rateBucket = new Map()
function rateLimit(req, limit = 30, windowMs = 60_000) {
  const key = req.ip || "unknown"
  const now = Date.now()
  const item = rateBucket.get(key) || { count: 0, resetAt: now + windowMs }
  if (now > item.resetAt) {
    item.count = 0
    item.resetAt = now + windowMs
  }
  item.count += 1
  rateBucket.set(key, item)
  return item.count <= limit
}

function toBool(v, def = false) {
  if (v === undefined || v === null || v === "") return def
  const s = String(v).toLowerCase()
  return s === "1" || s === "true" || s === "yes"
}

async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`
  const r = await fetch(url, {
    headers: {
      "User-Agent": "FrogfootROC/1.0 (support@yourdomain.co.za)",
      "Accept-Language": "en"
    }
  })
  if (!r.ok) return null
  const data = await r.json()
  if (!Array.isArray(data) || !data.length) return null
  const row = data[0]
  const lat = Number(row.lat)
  const lng = Number(row.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  return { lat, lng }
}

function normalizeSearch(search) {
  return search.trim()
}

/* ------------------------------------------------------------------
   Router
------------------------------------------------------------------- */

export default function rocAppointmentsRoutes(prisma) {
  const r = Router()

  /* --------------------------------------------------------------
     GET technicians
     /api/roc-appointments/technicians
  --------------------------------------------------------------- */
  r.get('/technicians', async (_req, res) => {
    const techs = await prisma.technician.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' }
    })
    res.json(techs)
  })

  /* --------------------------------------------------------------
     GET tickets
     /api/roc-appointments/tickets?search=TEST
     Optional:
       unassignedOnly=1   (default true)
       includeAssigned=1  (include assignedTo info)
       geocode=1          (attempt geocode + persist lat/lng if missing)
  --------------------------------------------------------------- */
  r.get("/tickets", async (req, res) => {
    try {
      if (!rateLimit(req)) {
        return res.status(429).json({ error: "Too many requests. Please try again shortly." })
      }

      const raw = (req.query.search || "").toString()
      const search = normalizeSearch(raw)
      const unassignedOnly = toBool(req.query.unassignedOnly, true)
      const includeAssigned = toBool(req.query.includeAssigned, false)
      const doGeocode = toBool(req.query.geocode, false)

      const textWhere = search
        ? {
            OR: [
              { externalRef: { contains: search, mode: "insensitive" } },
              { customerName: { contains: search, mode: "insensitive" } },
              { customerPhone: { contains: search, mode: "insensitive" } },
              { address: { contains: search, mode: "insensitive" } }
            ]
          }
        : {}

      const assignWhere = unassignedOnly
        ? { appointments: { none: {} } }
        : {}

      const where = { ...textWhere, ...assignWhere }

      const include = includeAssigned
        ? {
            appointments: {
              take: 1,
              orderBy: [{ appointmentDate: "desc" }, { createdAt: "desc" }],
              include: { technician: { select: { id: true, name: true } } }
            }
          }
        : undefined

      const tickets = await prisma.ticket.findMany({
        where,
        take: 50,
        orderBy: [{ updatedAt: "desc" }],
        include
      })

      let finalTickets = tickets

      if (doGeocode) {
        finalTickets = await Promise.all(
          tickets.map(async (t) => {
            if (t.lat != null && t.lng != null) return t
            if (!t.address) return t

            crypto.createHash("md5").update(t.address).digest("hex")

            const geo = await geocodeAddress(t.address)
            if (!geo) return t

            const updated = await prisma.ticket.update({
              where: { id: t.id },
              data: { lat: geo.lat, lng: geo.lng }
            })

            return { ...t, lat: updated.lat, lng: updated.lng }
          })
        )
      }

      const shaped = finalTickets.map(t => {
        if (!includeAssigned) return t
        const appt = Array.isArray(t.appointments) ? t.appointments[0] : null
        const assignedTo = appt
          ? {
              techId: appt.technicianId,
              techName: appt.technician?.name || "",
              date: appt.appointmentDate ? dayjs(appt.appointmentDate).format("YYYY-MM-DD") : null,
              slotNumber: appt.slotNumber || null
            }
          : null

        const { appointments, ...rest } = t
        return { ...rest, assignedTo }
      })

      res.json(shaped)
    } catch (e) {
      console.error(e)
      res.status(500).json({ error: e?.message || "Failed to search tickets" })
    }
  })

  /* --------------------------------------------------------------
     GET appointments by date range
     /api/roc-appointments/appointments?from=YYYY-MM-DD&to=YYYY-MM-DD&technicianId=...
  --------------------------------------------------------------- */
  r.get('/appointments', async (req, res) => {
    const from = (req.query.from || '').toString()
    const to = (req.query.to || '').toString()
    const technicianId = (req.query.technicianId || '').toString().trim()

    if (!from || !to) throw new Error('from and to are required')

    const start = dayjs(from).startOf('day').toDate()
    const end = dayjs(to).endOf('day').toDate()

    const where = {
      appointmentDate: { gte: start, lte: end },
      ...(technicianId ? { technicianId } : {})
    }

    const appts = await prisma.appointment.findMany({
      where,
      include: { ticket: true, technician: true },
      orderBy: [{ appointmentDate: 'asc' }, { slotNumber: 'asc' }]
    })

    res.json(appts)
  })

  /* --------------------------------------------------------------
     POST create appointment
     /api/roc-appointments/appointments
  --------------------------------------------------------------- */
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

    const dt = parseISODate(appointmentDate)
    const slot = slotNumber != null ? Number(slotNumber) : null

    const slotWin = slot ? slotWindow(slot) : null
    const winStart = windowStartTime || slotWin?.start || null
    const winEnd = windowEndTime || slotWin?.end || null

    if (technicianId && slot) {
      const { start, end } = toDateOnlyRange(dayjs(dt).format('YYYY-MM-DD'))
      const existing = await prisma.appointment.findFirst({
        where: {
          technicianId,
          appointmentDate: { gte: start, lte: end },
          slotNumber: slot
        }
      })
      if (existing) throw new Error('Slot already occupied for this technician')
    }

    const actorId = req.user?.id != null ? String(req.user.id) : null

    const appt = await prisma.appointment.create({
      data: {
        id: `appt_${nanoid(12)}`,
        ticketId,
        technicianId: technicianId || null,
        appointmentDate: dt,
        slotNumber: slot,
        windowStartTime: winStart,
        windowEndTime: winEnd,
        status: technicianId ? 'SCHEDULED' : 'UNASSIGNED',
        createdByUserId: actorId,
        updatedByUserId: actorId,
        events: {
          create: {
            id: `evt_${nanoid(12)}`,
            eventType: 'CREATED',
            actorType: 'ROC',
            actorId,
            payload: { source: 'roc_create' }
          }
        }
      },
      include: { ticket: true, technician: true }
    })

    res.json(appt)
  })

  /* --------------------------------------------------------------
     PATCH move appointment
     /api/roc-appointments/appointments/:id/move
     body: { technicianId, appointmentDate, slotNumber }
  --------------------------------------------------------------- */
  r.patch('/appointments/:id/move', async (req, res) => {
    const id = req.params.id
    const { technicianId, appointmentDate, slotNumber } = req.body || {}

    const appt = await prisma.appointment.findUnique({ where: { id } })
    if (!appt) throw new Error('Appointment not found')

    const dt = appointmentDate ? parseISODate(appointmentDate) : appt.appointmentDate
    const slot = slotNumber != null ? Number(slotNumber) : appt.slotNumber

    if (technicianId && slot) {
      const dayStr = dayjs(dt).format('YYYY-MM-DD')
      const { start, end } = toDateOnlyRange(dayStr)

      const clash = await prisma.appointment.findFirst({
        where: {
          id: { not: id },
          technicianId,
          appointmentDate: { gte: start, lte: end },
          slotNumber: slot
        }
      })
      if (clash) throw new Error('Slot already occupied for this technician')
    }

    const slotWin = slot ? slotWindow(slot) : null
    const actorId = req.user?.id != null ? String(req.user.id) : null

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        technicianId: technicianId || null,
        appointmentDate: dt,
        slotNumber: slot,
        windowStartTime: slotWin?.start || appt.windowStartTime,
        windowEndTime: slotWin?.end || appt.windowEndTime,
        status: technicianId ? appt.status : 'UNASSIGNED',
        updatedByUserId: actorId,
        events: {
          create: {
            id: `evt_${nanoid(12)}`,
            eventType: 'MOVED',
            actorType: 'ROC',
            actorId,
            payload: {
              from: {
                technicianId: appt.technicianId,
                appointmentDate: appt.appointmentDate,
                slotNumber: appt.slotNumber
              },
              to: {
                technicianId,
                appointmentDate: dt,
                slotNumber: slot
              }
            }
          }
        }
      },
      include: { ticket: true, technician: true }
    })

    res.json(updated)
  })

  /* --------------------------------------------------------------
     POST swap appointments
     /api/roc-appointments/appointments/swap
  --------------------------------------------------------------- */
  r.post('/appointments/swap', async (req, res) => {
    const { appointmentIdA, appointmentIdB } = req.body || {}
    if (!appointmentIdA || !appointmentIdB) throw new Error('appointmentIdA and appointmentIdB required')

    const a = await prisma.appointment.findUnique({ where: { id: appointmentIdA } })
    const b = await prisma.appointment.findUnique({ where: { id: appointmentIdB } })
    if (!a || !b) throw new Error('Appointments not found')

    const actorId = req.user?.id != null ? String(req.user.id) : null

    const result = await prisma.$transaction(async tx => {
      const aNew = await tx.appointment.update({
        where: { id: a.id },
        data: {
          technicianId: b.technicianId,
          appointmentDate: b.appointmentDate,
          slotNumber: b.slotNumber,
          updatedByUserId: actorId,
          events: {
            create: {
              id: `evt_${nanoid(12)}`,
              eventType: 'MOVED',
              actorType: 'ROC',
              actorId,
              payload: { source: 'swap', with: b.id }
            }
          }
        }
      })
      const bNew = await tx.appointment.update({
        where: { id: b.id },
        data: {
          technicianId: a.technicianId,
          appointmentDate: a.appointmentDate,
          slotNumber: a.slotNumber,
          updatedByUserId: actorId,
          events: {
            create: {
              id: `evt_${nanoid(12)}`,
              eventType: 'MOVED',
              actorType: 'ROC',
              actorId,
              payload: { source: 'swap', with: a.id }
            }
          }
        }
      })
      return { aNew, bNew }
    })

    res.json(result)
  })

  /* --------------------------------------------------------------
     GET suggested slot
     /api/roc-appointments/suggest-slot?technicianId=...&date=YYYY-MM-DD&ticketId=...
  --------------------------------------------------------------- */
  r.get('/suggest-slot', async (req, res) => {
    const technicianId = (req.query.technicianId || '').toString().trim()
    const date = (req.query.date || '').toString().trim()
    const ticketId = (req.query.ticketId || '').toString().trim()

    if (!technicianId || !date || !ticketId) throw new Error('technicianId, date, ticketId required')

    const tech = await prisma.technician.findUnique({ where: { id: technicianId } })
    if (!tech) throw new Error('Technician not found')

    const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } })
    if (!ticket) throw new Error('Ticket not found')

    const { start, end } = toDateOnlyRange(date)

    const existing = await prisma.appointment.findMany({
      where: { technicianId, appointmentDate: { gte: start, lte: end } },
      include: { ticket: true },
      orderBy: [{ slotNumber: 'asc' }]
    })

    const taken = new Set(existing.map(a => a.slotNumber).filter(Boolean))
    const openSlots = [1, 2, 3, 4, 5].filter(s => !taken.has(s))

    const points = existing
      .filter(a => a.ticket?.lat != null && a.ticket?.lng != null && a.slotNumber != null)
      .map(a => ({
        slotNumber: a.slotNumber,
        lat: a.ticket.lat,
        lng: a.ticket.lng
      }))
      .sort((x, y) => x.slotNumber - y.slotNumber)

    function neighborSlots(slot) {
      const left = [...points].reverse().find(p => p.slotNumber < slot) || null
      const right = points.find(p => p.slotNumber > slot) || null
      return { left, right }
    }

    const ranked = openSlots.map(slot => {
      const { left, right } = neighborSlots(slot)

      const baseLat = left?.lat ?? tech.homeLat
      const baseLng = left?.lng ?? tech.homeLng

      const kmA = haversineKm(baseLat, baseLng, ticket.lat, ticket.lng)
      const minA = estimateTravelMinutes(kmA, tech.region || 'DEFAULT')

      const kmB = right ? haversineKm(ticket.lat, ticket.lng, right.lat, right.lng) : null
      const minB = right ? estimateTravelMinutes(kmB, tech.region || 'DEFAULT') : null

      const addMins = (minA || 0) + (minB || 0)

      return {
        slotNumber: slot,
        insertBetween: {
          before: left?.slotNumber ?? null,
          after: right?.slotNumber ?? null
        },
        travel: {
          fromPrevKm: kmA,
          fromPrevMinutes: minA,
          toNextKm: kmB,
          toNextMinutes: minB
        },
        score: addMins
      }
    })

    ranked.sort((a, b) => a.score - b.score)

    res.json({
      recommendedSlotNumber: ranked[0]?.slotNumber ?? null,
      rankedSlots: ranked
    })
  })

  /* --------------------------------------------------------------
     GET route summary per tech and date
     /api/roc-appointments/route-summary?technicianId=...&date=YYYY-MM-DD

     ✅ UPDATED:
       Adds liveLocation from latest appointmentEvent that includes lat/lng
       for any appointment belonging to this tech for that date.
  --------------------------------------------------------------- */
  r.get('/route-summary', async (req, res) => {
    const technicianId = (req.query.technicianId || '').toString().trim()
    const date = (req.query.date || '').toString().trim()
    if (!technicianId || !date) throw new Error('technicianId and date required')

    const tech = await prisma.technician.findUnique({ where: { id: technicianId } })
    if (!tech) throw new Error('Technician not found')

    const { start, end } = toDateOnlyRange(date)

    const appts = await prisma.appointment.findMany({
      where: { technicianId, appointmentDate: { gte: start, lte: end } },
      include: { ticket: true },
      orderBy: [{ slotNumber: 'asc' }]
    })

    // ✅ Find latest live location for this tech on this day:
    // We look at appointment events for today's appointments that have lat/lng.
    const apptIds = appts.map(a => a.id)
    let liveLocation = null

    if (apptIds.length) {
      const latestEvent = await prisma.appointmentEvent.findFirst({
        where: {
          appointmentId: { in: apptIds },
          lat: { not: null },
          lng: { not: null }
        },
        orderBy: { createdAt: 'desc' }
      })

      if (latestEvent) {
        liveLocation = {
          lat: latestEvent.lat,
          lng: latestEvent.lng,
          updatedAt: latestEvent.createdAt,
          appointmentId: latestEvent.appointmentId,
          sourceEventType: latestEvent.eventType
        }
      }
    }

    const legs = []
    let prev = { lat: tech.homeLat, lng: tech.homeLng, label: 'Home' }
    let totalMinutes = 0
    let totalKm = 0

    for (const a of appts) {
      const t = a.ticket
      const km = haversineKm(prev.lat, prev.lng, t?.lat, t?.lng)
      const mins = estimateTravelMinutes(km, tech.region || 'DEFAULT')
      legs.push({
        from: prev.label,
        to: `Slot ${a.slotNumber ?? ''}`,
        appointmentId: a.id,
        slotNumber: a.slotNumber ?? null,
        status: a.status ?? null,
        ticketId: a.ticketId,
        externalRef: t?.externalRef ?? null,
        address: t?.address ?? null,
        km,
        minutes: mins
      })
      if (km != null) totalKm += km
      if (mins != null) totalMinutes += mins
      prev = { lat: t?.lat, lng: t?.lng, label: `Slot ${a.slotNumber ?? ''}` }
    }

    res.json({
      technicianId,
      date,
      liveLocation,
      legs,
      totals: {
        totalKm,
        totalMinutes
      }
    })
  })

  return r
}
