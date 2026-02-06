import api from '../api'

export function techLogin({ phone, pin }) {
  return api.post('/tech/login', { phone, pin })
}
