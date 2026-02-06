// frontend/src/api/rocAppointments.js
import api from '../api'

export function listTechnicians() {
  return api.get('/roc-appointments/technicians')
}

export function listTestTickets() {
  return api.get('/roc-appointments/tickets')
}

export function listAppointments({ dateFrom, dateTo, technicianId }) {
  const params = { dateFrom, dateTo }
  if (technicianId) params.technicianId = technicianId
  return api.get('/roc-appointments/appointments', { params })
}

export function createAppointment(payload) {
  return api.post('/roc-appointments/appointments', payload)
}

export function moveAppointment(id, payload) {
  return api.patch(`/roc-appointments/appointments/${id}/move`, payload)
}

export function createTestTicket(payload) {
  return api.post('/roc-appointments/tickets', payload)
}
