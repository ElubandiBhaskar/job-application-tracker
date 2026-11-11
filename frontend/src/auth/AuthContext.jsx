import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi } from '../api'
import { tokenStore } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  // true while we're checking a saved token on first load, so we don't flash the login page
  const [booting, setBooting] = useState(() => Boolean(tokenStore.access || tokenStore.refresh))

  useEffect(() => {
    if (!booting) return undefined
    let cancelled = false
    authApi
      .me()
      .then((me) => !cancelled && setUser(me))
      .catch((err) => {
        // 401 is already handled by the interceptor (it refreshes or logs out).
        // For anything else (server down) keep the tokens so a reload can recover.
        if (err.response?.status === 401) tokenStore.clear()
      })
      .finally(() => !cancelled && setBooting(false))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The API client fires this when the refresh token is rejected.
  useEffect(() => {
    const onLogout = () => setUser(null)
    window.addEventListener('auth:logout', onLogout)
    return () => window.removeEventListener('auth:logout', onLogout)
  }, [])

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password)
    tokenStore.set(data)
    setUser(data.user)
    return data.user
  }, [])

  const register = useCallback(async (payload) => {
    const data = await authApi.register(payload)
    tokenStore.set(data)
    setUser(data.user)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    const refresh = tokenStore.refresh
    try {
      if (refresh) await authApi.logout(refresh)
    } catch {
      // if the server can't be reached we still log out locally
    }
    tokenStore.clear()
    setUser(null)
  }, [])

  const updateProfile = useCallback(async (payload) => {
    const me = await authApi.updateMe(payload)
    setUser(me)
    return me
  }, [])

  const changePassword = useCallback(async (payload) => {
    const tokens = await authApi.changePassword(payload)
    tokenStore.set(tokens) // old refresh tokens were revoked server-side, keep the new pair
  }, [])

  const value = useMemo(
    () => ({ user, booting, login, register, logout, updateProfile, changePassword }),
    [user, booting, login, register, logout, updateProfile, changePassword],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
