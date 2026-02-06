// frontend/src/techApp/sync.js
import { listQueuedEvents, removeQueuedEvent, bumpRetry } from './offlineQueue'
import { postAppointmentEvent } from './techApi'

export async function flushQueue() {
  const queued = await listQueuedEvents()
  for (const q of queued) {
    try {
      await postAppointmentEvent({
        appointmentId: q.appointmentId,
        body: {
          clientEventId: q.clientEventId,
          eventType: q.eventType,
          status: q.status,
          lat: q.lat,
          lng: q.lng,
          payload: q.payload,
          eventTime: q.eventTime
        }
      })
      await removeQueuedEvent(q.id)
    } catch (e) {
      await bumpRetry(q.id, String(e?.message || e))
      break
    }
  }
}
