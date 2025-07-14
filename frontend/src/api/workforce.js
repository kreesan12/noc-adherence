import api from './index'       // same axios instance used elsewhere

export const listTeams             = () => api.get('/teams')
export const createTeam            = (name) => api.post('/teams', { name })

export const listEngagements       = (params) => api.get('/engagements', { params })
export const createEngagement      = (data)   => api.post('/engagements', data)
export const terminateEngagement   = (id, b)  => api.patch(`/engagements/${id}/terminate`, b)

export const listVacancies         = (open=true) =>
  api.get('/vacancies', { params: { open } })

export const headcountReport       = (from, to) =>
  api.get('/reports/headcount', { params: { from, to } })
