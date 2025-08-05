import api from './index'

export const listManagers  = ()        => api.get('/managers')
export const addManager    = payload   => api.post('/managers', payload)
export const deleteManager = id        => api.delete(`/managers/${id}`)
