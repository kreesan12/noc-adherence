import api from './index'

export async function fetchStockDashboard() {
  const { data } = await api.get('/stock-management/current')
  return data
}

export async function refreshStockDashboard() {
  const { data } = await api.post('/stock-management/refresh')
  return data
}

export async function exportStockTemplateWorkbook() {
  const response = await api.get('/stock-management/export/template', {
    responseType: 'blob'
  })
  return response.data
}

export async function exportLowStockWatchlistWorkbook() {
  const response = await api.get('/stock-management/export/low-stock', {
    responseType: 'blob'
  })
  return response.data
}

export async function exportRegionalWatchlistWorkbook() {
  const response = await api.get('/stock-management/export/regional-watchlist', {
    responseType: 'blob'
  })
  return response.data
}

export async function fetchStockRunRates() {
  const { data } = await api.get('/stock-management/run-rates')
  return data
}

export async function updateStockMatchOverride(id, payload) {
  const { data } = await api.put(`/stock-management/template-items/${id}/match-override`, payload)
  return data
}

export async function updateStockRequiredSpares(id, payload) {
  const { data } = await api.put(`/stock-management/template-items/${id}/required-spares`, payload)
  return data
}

export async function applyStockReviewActions(id, payload) {
  const { data } = await api.post(`/stock-management/template-items/${id}/review-actions`, payload)
  return data
}

export async function createStockTemplateItem(payload) {
  const { data } = await api.post('/stock-management/template-items', payload)
  return data
}

export async function updateStockNotWarehouseAction(payload) {
  const { data } = await api.put('/stock-management/not-wh-actions', payload)
  return data
}

export async function updateStockUnitCost(id, unitCost) {
  const { data } = await api.put(`/stock-management/template-items/${id}/cost`, { unitCost })
  return data
}

export async function deleteStockTemplateItem(id) {
  await api.delete(`/stock-management/template-items/${id}`)
}

export async function fetchStockRedistributionPlan() {
  const { data } = await api.get('/stock-management/redistribution/latest')
  return data
}

export async function generateStockRedistributionPlan() {
  const { data } = await api.post('/stock-management/redistribution/generate')
  return data
}

export async function sendStockRedistributionPlan(runId) {
  const { data } = await api.post(`/stock-management/redistribution/${runId}/send`)
  return data
}

export async function fetchStockDailyReport() {
  const { data } = await api.get('/stock-management/daily-report')
  return data
}

export async function sendStockDailyReport() {
  const { data } = await api.post('/stock-management/daily-report/send')
  return data
}

export async function fetchStockDivisionContacts() {
  const { data } = await api.get('/stock-management/admin/contacts')
  return data
}

export async function createStockDivisionContact(payload) {
  const { data } = await api.post('/stock-management/admin/contacts', payload)
  return data
}

export async function updateStockDivisionContact(id, payload) {
  const { data } = await api.put(`/stock-management/admin/contacts/${id}`, payload)
  return data
}
