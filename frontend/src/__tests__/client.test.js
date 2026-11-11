import axios from 'axios'

// Fake network: the axios adapter is swapped *before* client.js is imported,
// so both the main instance and the refresh instance use it.
function setup(handler) {
  const calls = []
  axios.defaults.adapter = async (config) => {
    const body = config.data ? JSON.parse(config.data) : undefined
    calls.push({ url: config.url, method: config.method, auth: config.headers.Authorization, body })
    const result = await handler({ url: config.url, method: config.method, auth: config.headers.Authorization, body })
    if (result instanceof Error) throw result
    const response = { data: result.data ?? {}, status: result.status, statusText: '', headers: {}, config, request: {} }
    if (result.status >= 400) {
      const err = new axios.AxiosError('failed', 'ERR_BAD_REQUEST', config, {}, response)
      throw err
    }
    return response
  }
  return calls
}

async function load() {
  vi.resetModules()
  return import('../api/client')
}

afterEach(() => {
  delete axios.defaults.adapter
})

describe('api client', () => {
  it('sends the access token on every request', async () => {
    const calls = setup(() => ({ status: 200, data: { ok: true } }))
    const { default: api, tokenStore } = await load()
    tokenStore.set({ access: 'A1', refresh: 'R1' })
    await api.get('/applications/')
    expect(calls[0].auth).toBe('Bearer A1')
  })

  it('refreshes once on 401, retries the request and keeps the rotated tokens', async () => {
    const calls = setup(({ url, auth }) => {
      if (url === '/auth/refresh/') return { status: 200, data: { access: 'A2', refresh: 'R2' } }
      return auth === 'Bearer A2' ? { status: 200, data: { ok: 1 } } : { status: 401 }
    })
    const { default: api, tokenStore } = await load()
    tokenStore.set({ access: 'A1', refresh: 'R1' })

    const res = await api.get('/applications/')

    expect(res.data).toEqual({ ok: 1 })
    expect(calls.map((c) => c.url)).toEqual(['/applications/', '/auth/refresh/', '/applications/'])
    expect(calls[1].body).toEqual({ refresh: 'R1' })
    expect(tokenStore.access).toBe('A2')
    expect(tokenStore.refresh).toBe('R2') // refresh tokens rotate, so the new one must be stored
  })

  it('shares a single refresh between simultaneous 401s', async () => {
    const calls = setup(async ({ url, auth }) => {
      if (url === '/auth/refresh/') {
        await new Promise((r) => setTimeout(r, 20))
        return { status: 200, data: { access: 'A2', refresh: 'R2' } }
      }
      return auth === 'Bearer A2' ? { status: 200 } : { status: 401 }
    })
    const { default: api, tokenStore } = await load()
    tokenStore.set({ access: 'A1', refresh: 'R1' })

    await Promise.all([api.get('/a/'), api.get('/b/'), api.get('/c/')])

    expect(calls.filter((c) => c.url === '/auth/refresh/')).toHaveLength(1)
  })

  it('logs out when the refresh token is rejected', async () => {
    setup(({ url }) => (url === '/auth/refresh/' ? { status: 401 } : { status: 401 }))
    const { default: api, tokenStore } = await load()
    tokenStore.set({ access: 'A1', refresh: 'R1' })
    const onLogout = vi.fn()
    window.addEventListener('auth:logout', onLogout)

    await expect(api.get('/applications/')).rejects.toBeTruthy()

    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(tokenStore.access).toBeNull()
    expect(tokenStore.refresh).toBeNull()
    window.removeEventListener('auth:logout', onLogout)
  })

  it('does not log out on a network failure while refreshing', async () => {
    setup(({ url }) => (url === '/auth/refresh/' ? new Error('Network Error') : { status: 401 }))
    const { default: api, tokenStore } = await load()
    tokenStore.set({ access: 'A1', refresh: 'R1' })
    const onLogout = vi.fn()
    window.addEventListener('auth:logout', onLogout)

    await expect(api.get('/applications/')).rejects.toBeTruthy()

    expect(onLogout).not.toHaveBeenCalled()
    expect(tokenStore.refresh).toBe('R1')
    window.removeEventListener('auth:logout', onLogout)
  })

  it('does not try to refresh when login itself returns 401', async () => {
    const calls = setup(() => ({ status: 401, data: { detail: 'bad credentials' } }))
    const { default: api, tokenStore } = await load()
    tokenStore.set({ access: 'A1', refresh: 'R1' })

    await expect(api.post('/auth/login/', { email: 'x', password: 'y' })).rejects.toBeTruthy()

    expect(calls).toHaveLength(1)
    expect(tokenStore.refresh).toBe('R1')
  })

  it('logs out straight away when there is no refresh token', async () => {
    const calls = setup(() => ({ status: 401 }))
    const { default: api } = await load()
    const onLogout = vi.fn()
    window.addEventListener('auth:logout', onLogout)

    await expect(api.get('/applications/')).rejects.toBeTruthy()

    expect(calls).toHaveLength(1)
    expect(onLogout).toHaveBeenCalled()
    window.removeEventListener('auth:logout', onLogout)
  })

  it('only retries a request once', async () => {
    const calls = setup(({ url }) =>
      url === '/auth/refresh/' ? { status: 200, data: { access: 'A2', refresh: 'R2' } } : { status: 401 },
    )
    const { default: api, tokenStore } = await load()
    tokenStore.set({ access: 'A1', refresh: 'R1' })

    await expect(api.get('/applications/')).rejects.toBeTruthy()

    expect(calls.filter((c) => c.url === '/applications/')).toHaveLength(2)
    expect(calls.filter((c) => c.url === '/auth/refresh/')).toHaveLength(1)
  })
})
