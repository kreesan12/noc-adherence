import api from './index'

export async function fetchNocMonitoringSnapshot({ historyHours } = {}) {
  const { data } = await api.get('/noc-monitoring/current', {
    params: historyHours ? { historyHours } : undefined
  })
  return data
}

export async function refreshNocMonitoringSnapshot({ historyHours } = {}) {
  const { data } = await api.post('/noc-monitoring/refresh', null, {
    params: historyHours ? { historyHours } : undefined
  })
  return data
}
