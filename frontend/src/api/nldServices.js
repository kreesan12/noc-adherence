// frontend/src/api/nldServices.js
import api from '../api'

export const updateNldService = (id, payload) =>
  api.patch(`/engineering/nld-services/${id}`, payload)

export const createNldService = (payload) =>
  api.post('/engineering/nld-services', payload)

export const listNldServices = (params) =>
  api.get('/engineering/nld-services', { params })
