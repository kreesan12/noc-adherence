import axios from 'axios'

const PROD_API_BASE_URL = 'https://154-65-108-106.sslip.io/api'

function resolveBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }

  if (import.meta.env.DEV) {
    return '/api'
  }

  return PROD_API_BASE_URL
}

const api = axios.create({ baseURL: resolveBaseUrl() })

export const setToken = (token) => {
  if (token) {
    api.defaults.headers.common.Authorization = `Bearer ${token}`
    return
  }

  delete api.defaults.headers.common.Authorization
}

export default api
