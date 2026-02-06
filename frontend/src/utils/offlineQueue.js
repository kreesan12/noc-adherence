import { nanoid } from 'nanoid'
import { postTechEvent } from '../api/techAppointments'

const KEY = 'tech_event_queue_v1'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}
function save(items) {
  localStorage.setItem(KEY, JSON.stringify(items))
}

export function enqueueTechEvent({ appointmentId, eventType, status, lat, lng, payload }) {
  const item = {
    id: nanoid(10),
    clientEventId: `cev_${nanoid(14)}`,
    appointmentId,
    eventType,
    status: status || null,
    lat: lat ?? null,
    lng: lng ?? null,
    payload: payload || null,
    createdAt: new Date().toISOString()
  }
  const q = load()
  q.push(item)
  save(q)
  return item
}

export function getQueue() {
  return load()
}

export async function flushQueue({ onProgress } = {}) {
  const q = load()
  if (!q.length) return { ok: true, sent: 0 }

  const remaining = []
  let sent = 0

  for (const item of q) {
    try {
      await postTechEvent(item.appointmentId, {
        clientEventId: item.clientEventId,
        eventType: item.eventType,
        status: item.status,
        lat: item.lat,
        lng: item.lng,
        payload: item.payload
      })
      sent += 1
      if (onProgress) onProgress({ sent, left: q.length - sent })
    } catch (err) {
      remaining.push(item)
    }
  }

  save(remaining)
  return { ok: true, sent, remaining: remaining.length }
}

export function startAutoFlush() {
  async function attempt() {
    if (!navigator.onLine) return
    await flushQueue().catch(() => {})
  }

  window.addEventListener('online', attempt)
  setInterval(attempt, 15000)
  attempt()
}
