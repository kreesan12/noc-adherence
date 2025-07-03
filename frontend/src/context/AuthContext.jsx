import { createContext, useContext, useState, useEffect } from 'react'
import api, { setToken } from '../api'

const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider ({ children }) {
  const [user, setUser] = useState(null)

  // re-hydrate on refresh
  useEffect(() => {
    const saved = localStorage.getItem('token')
    if (saved) {
      setToken(saved)
      api.get('/me')
        .then(r => setUser(r.data))
        .catch(() => localStorage.removeItem('token'))
    }
  }, [])

  async function login (email, password) {
    const { data } = await api.post('/login', { email, password })
    setToken(data.token)
    localStorage.setItem('token', data.token)
    const me = await api.get('/me')
    setUser(me.data)
  }

  function logout () {
    localStorage.removeItem('token')
    setUser(null)
  }

  return (
    <AuthCtx.Provider value={{ user, login, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}
