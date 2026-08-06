import axios from 'axios'

const DEFAULT_API_BASE_URL = '/api'

function resolveBaseUrl() {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL
  }

  return DEFAULT_API_BASE_URL
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
