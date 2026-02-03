import api from './index'

// Periods
export const listOvertimePeriods = () => api.get('/overtime/periods')
export const createOvertimePeriod = (payload) => api.post('/overtime/periods', payload)

// Public holidays
export const listPublicHolidays = () => api.get('/overtime/holidays')
export const upsertPublicHoliday = (payload) => api.post('/overtime/holidays', payload)

// Entries (fixed + manual)
export const listOvertimeEntries = (params) =>
  api.get('/overtime/entries', { params })

export const createManualOvertimeEntry = (payload) =>
  api.post('/overtime/entries/manual', payload)

// Edit entry (supervisor can edit, flags manager approval if edited)
export const updateOvertimeEntry = (id, payload) =>
  api.patch(`/overtime/entries/${id}`, payload)

// Workflow actions
export const submitOvertimeEntry = (id) =>
  api.post(`/overtime/entries/${id}/submit`)

export const supervisorApproveOvertime = (id) =>
  api.post(`/overtime/entries/${id}/supervisor-approve`)

export const managerApproveOvertime = (id) =>
  api.post(`/overtime/entries/${id}/manager-approve`)

export const rejectOvertime = (id, payload) =>
  api.post(`/overtime/entries/${id}/reject`, payload)

// Signatures
export const getMySignature = () => api.get('/overtime/signature/me')
export const saveMySignature = (payload) => api.put('/overtime/signature/me', payload)

// Export
export const exportOvertimePeriod = (periodId) =>
  api.get(`/overtime/export/${periodId}`, { responseType: 'blob' })
