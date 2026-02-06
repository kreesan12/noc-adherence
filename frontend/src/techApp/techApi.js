// frontend/src/techApp/techApi.js
const API_BASE = '' // same origin, because your frontend calls /api already

function getToken() {
  return localStorage.getItem('techToken') || ''
}

function authHeaders() {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function techLogin({ phone, pin }) {
  const r = await fetch(`${API_BASE}/api/tech/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, pin })
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function fetchMyAppointments({ from, to }) {
  const qs = new URLSearchParams({ from, to })
  const r = await fetch(`${API_BASE}/api/tech/me/appointments?${qs.toString()}`, {
    headers: { ...authHeaders() }
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}

export async function postAppointmentEvent({ appointmentId, body }) {
  const r = await fetch(`${API_BASE}/api/tech/appointments/${appointmentId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(body)
  })
  if (!r.ok) throw new Error(await r.text())
  return r.json()
}
