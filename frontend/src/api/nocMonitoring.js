import api from './index'

export async function fetchNocMonitoringSnapshot() {
  const { data } = await api.get('/noc-monitoring/current')
  return data
}

export async function refreshNocMonitoringSnapshot() {
  const { data } = await api.post('/noc-monitoring/refresh')
  return data
}
