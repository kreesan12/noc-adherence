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

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return window.btoa(binary)
}

export async function importMinimumStockRequirementsWorkbook(file) {
  const buffer = await file.arrayBuffer()
  const payload = {
    fileName: file.name || 'minimum-stock.xlsx',
    fileDataBase64: arrayBufferToBase64(buffer)
  }
  const { data } = await api.post('/stock-management/import-minimum-requirements', payload)
  return data
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
