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
