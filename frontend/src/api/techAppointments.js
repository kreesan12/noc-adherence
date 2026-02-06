import api from '../api'

function techHeaders() {
  const t = localStorage.getItem('techToken') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export function listMyAppointments({ technicianId, from, to }) {
  return api.get('/tech-appointments/my', { params: { technicianId, from, to }, headers: techHeaders() })
}

export function getAppointment(id) {
  return api.get(`/tech-appointments/${id}`, { headers: techHeaders() })
}

export function postTechEvent(id, body) {
  return api.post(`/tech-appointments/${id}/event`, body, { headers: techHeaders() })
}

export function uploadPhoto(id, body) {
  return api.post(`/tech-appointments/${id}/photo`, body, { headers: techHeaders() })
}

export function uploadSignature(id, body) {
  return api.post(`/tech-appointments/${id}/signature`, body, { headers: techHeaders() })
}

export function submitJobCard(id, body) {
  return api.post(`/tech-appointments/${id}/job-card`, body, { headers: techHeaders() })
}
