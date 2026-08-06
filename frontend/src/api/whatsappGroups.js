import api from './index'

export function getWhatsAppGroups({ q = '', limit = 100 } = {}) {
  return api.get('/admin/whatsapp-groups', {
    params: { q, limit }
  })
}
