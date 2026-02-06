// frontend/src/api/techAppointments.js
import api from '../api'

function techHeaders() {
  const t = localStorage.getItem('techToken') || ''
  return t ? { Authorization: `Bearer ${t}` } : {}
}

export function listMyAppointments({ technicianId, from, to }) {
  return api.get('/tech/my', {
    params: { technicianId, from, to },
    headers: techHeaders()
  })
}

export function getAppointment(id) {
  return api.get(`/tech/${id}`, { headers: techHeaders() })
}

export function postTechEvent(id, body) {
  return api.post(`/tech/${id}/event`, body, { headers: techHeaders() })
}

export function uploadPhoto(id, body) {
  return api.post(`/tech/${id}/photo`, body, { headers: techHeaders() })
}

export function uploadSignature(id, body) {
  return api.post(`/tech/${id}/signature`, body, { headers: techHeaders() })
}

export function submitJobCard(id, body) {
  return api.post(`/tech/${id}/job-card`, body, { headers: techHeaders() })
}
