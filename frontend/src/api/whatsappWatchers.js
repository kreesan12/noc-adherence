import api from './index'

export function getWhatsAppWatcherConfig() {
  return api.get('/admin/whatsapp-watchers')
}

export function saveWhatsAppWatcherConfig(config) {
  return api.put('/admin/whatsapp-watchers', { config })
}

export function getWhatsAppWatcherHistory({ watcherKey = '', limit = 50 } = {}) {
  return api.get('/admin/whatsapp-watchers/history', {
    params: {
      watcherKey,
      limit
    }
  })
}
