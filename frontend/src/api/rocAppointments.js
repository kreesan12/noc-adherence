// frontend/src/api/rocAppointments.js
import api from '../api'

export function listTechnicians() {
  return api.get('/roc-appointments/technicians')
}

export function searchTickets(search) {
  return api.get('/roc-appointments/tickets', { params: { search } })
}

export function listAppointments({ from, to, technicianId }) {
  return api.get('/roc-appointments/appointments', {
    params: { from, to, technicianId: technicianId || '' }
  })
}

export function createAppointment(payload) {
  return api.post('/roc-appointments/appointments', payload)
}

export function moveAppointment(id, payload) {
  return api.patch(`/roc-appointments/appointments/${id}/move`, payload)
}

export function swapAppointments(appointmentIdA, appointmentIdB) {
  return api.post('/roc-appointments/appointments/swap', { appointmentIdA, appointmentIdB })
}

export function suggestSlot({ technicianId, date, ticketId }) {
  return api.get('/roc-appointments/suggest-slot', { params: { technicianId, date, ticketId } })
}

export function routeSummary({ technicianId, date }) {
  return api.get('/roc-appointments/route-summary', { params: { technicianId, date } })
}
