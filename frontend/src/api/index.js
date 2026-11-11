import api from './client'

// Drop empty filter values so we don't send ?status=&search=
const clean = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null))

export const authApi = {
  login: (email, password) => api.post('/auth/login/', { email, password }).then((r) => r.data),
  register: (payload) => api.post('/auth/register/', payload).then((r) => r.data),
  logout: (refresh) => api.post('/auth/logout/', { refresh }),
  me: () => api.get('/auth/me/').then((r) => r.data),
  updateMe: (payload) => api.patch('/auth/me/', payload).then((r) => r.data),
  changePassword: (payload) => api.post('/auth/change-password/', payload).then((r) => r.data),
}

export const applicationsApi = {
  list: (params, signal) =>
    api.get('/applications/', { params: clean(params), signal }).then((r) => r.data),
  get: (id) => api.get(`/applications/${id}/`).then((r) => r.data),
  create: (payload) => api.post('/applications/', payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/applications/${id}/`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/applications/${id}/`),
  history: (id) => api.get(`/applications/${id}/history/`).then((r) => r.data),
}

export const companiesApi = {
  list: (params, signal) =>
    api.get('/companies/', { params: clean(params), signal }).then((r) => r.data),
  create: (payload) => api.post('/companies/', payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/companies/${id}/`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/companies/${id}/`),
}

export const interviewsApi = {
  list: (params) => api.get('/interviews/', { params: clean(params) }).then((r) => r.data),
  create: (payload) => api.post('/interviews/', payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/interviews/${id}/`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/interviews/${id}/`),
}

export const statsApi = {
  get: () => api.get('/stats/').then((r) => r.data),
}
