import api from '../api'

export function listMyAppointments({ technicianId, from, to }) {
  return api.get('/tech-appointments/my', { params: { technicianId, from, to } })
}

export function getAppointment(id) {
  return api.get(`/tech-appointments/${id}`)
}

export function postTechEvent(id, body) {
  return api.post(`/tech-appointments/${id}/event`, body)
}

export function uploadPhoto(id, body) {
  return api.post(`/tech-appointments/${id}/photo`, body)
}

export function uploadSignature(id, body) {
  return api.post(`/tech-appointments/${id}/signature`, body)
}

export function submitJobCard(id, body) {
  return api.post(`/tech-appointments/${id}/job-card`, body)
}
