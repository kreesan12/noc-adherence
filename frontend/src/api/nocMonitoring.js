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

export async function fetchNocMonitoringTelephonyPulse() {
  const { data } = await api.get('/noc-monitoring/telephony/current')
  return data
}

export async function fetchNocMonitoringTier1PremisesMap({ clusterLimit } = {}) {
  const { data } = await api.get('/noc-monitoring/tier1-premises-map', {
    params: clusterLimit ? { clusterLimit } : undefined
  })
  return data
}
