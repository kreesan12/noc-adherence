import axios from 'axios'
const api = axios.create({ baseURL:'https://noc-adherence-api-69d04051b9ed.herokuapp.com/api' })
export const setToken = t => api.defaults.headers.common.Authorization = `Bearer ${t}`
export default api
