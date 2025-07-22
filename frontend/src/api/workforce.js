import api from './index'       // same axios instance used elsewhere

export const listTeams             = () => api.get('/teams')
export const createTeam            = (name) => api.post('/teams', { name })

export const listAgents = () => api.get('/agents')

export const listEngagements       = (params) => api.get('/engagements', { params })
export const createEngagement      = (data)   => api.post('/engagements', data)
export const terminateEngagement   = (id, b)  => api.patch(`/engagements/${id}/terminate`, b)

export const listVacancies    = params =>
  api.get('/vacancies', { params })

export const updateVacancy    = (id, data) =>
  api.patch(`/vacancies/${id}`, data)

export const downloadReqDoc   = id =>
  api.get(`/vacancies/${id}/requisition`, { responseType:'blob' })

export const headcountReport  = (from, to, gran='month') =>
  api.get('/reports/headcount', { params:{ from, to, gran } })

export const createVacancy = payload =>
  api.post('/vacancies', payload)

