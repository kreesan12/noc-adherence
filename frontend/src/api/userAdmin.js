import api from './index'

export function listUsers() {
  return api.get('/admin/users')
}

export function createUser(payload) {
  return api.post('/admin/users', payload)
}

export function updateUser(kind, id, payload) {
  return api.patch(`/admin/users/${kind}/${id}`, payload)
}

export function resetUserPassword(kind, id) {
  return api.post(`/admin/users/${kind}/${id}/reset-password`)
}

export function deleteUser(kind, id) {
  return api.delete(`/admin/users/${kind}/${id}`)
}
