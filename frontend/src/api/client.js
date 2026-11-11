import axios from 'axios'

const ACCESS_KEY = 'jt_access'
const REFRESH_KEY = 'jt_refresh'

export const BASE_URL = import.meta.env.VITE_API_URL || '/api'

export const tokenStore = {
  get access() {
    return localStorage.getItem(ACCESS_KEY)
  },
  get refresh() {
    return localStorage.getItem(REFRESH_KEY)
  },
  set({ access, refresh }) {
    if (access) localStorage.setItem(ACCESS_KEY, access)
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

const api = axios.create({ baseURL: BASE_URL })

// A bare instance for the refresh call so it can't loop through our own interceptors.
const bare = axios.create({ baseURL: BASE_URL })

// Endpoints where a 401 just means "wrong credentials", not "token expired".
const AUTH_PATHS = ['/auth/login/', '/auth/register/', '/auth/refresh/']

api.interceptors.request.use((config) => {
  const token = tokenStore.access
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// If several requests hit a 401 at the same moment they all wait on one refresh.
let refreshing = null

function refreshTokens() {
  if (!refreshing) {
    const refresh = tokenStore.refresh
    if (!refresh) return Promise.reject(new Error('No refresh token'))

    refreshing = bare
      .post('/auth/refresh/', { refresh })
      .then(({ data }) => {
        tokenStore.set(data)
        return data.access
      })
      .finally(() => {
        refreshing = null
      })
  }
  return refreshing
}

export function forceLogout() {
  tokenStore.clear()
  window.dispatchEvent(new Event('auth:logout'))
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    const status = error.response?.status

    const isAuthCall = AUTH_PATHS.some((p) => original?.url?.includes(p))
    if (status !== 401 || !original || original._retried || isAuthCall) {
      return Promise.reject(error)
    }

    original._retried = true
    try {
      const access = await refreshTokens()
      original.headers.Authorization = `Bearer ${access}`
      return api(original)
    } catch (refreshError) {
      // Only treat it as "session over" when the server actually rejected the refresh token.
      // A network blip shouldn't log somebody out.
      if (refreshError.response?.status === 401 || refreshError.message === 'No refresh token') {
        forceLogout()
      }
      return Promise.reject(error)
    }
  },
)

export default api
