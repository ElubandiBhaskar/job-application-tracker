import { act, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'
import { ProtectedRoute, PublicOnlyRoute } from '../auth/ProtectedRoute'
import { tokenStore } from '../api/client'
import Login from '../pages/Login'
import Register from '../pages/Register'
import { ROUTER_FUTURE, sampleUser } from './helpers'

vi.mock('../api', () => ({
  authApi: {
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
    updateMe: vi.fn(),
    changePassword: vi.fn(),
  },
}))
import { authApi } from '../api'

function renderApp(route = '/login') {
  return render(
    <MemoryRouter initialEntries={[route]} future={ROUTER_FUTURE}>
      <AuthProvider>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<div>Dashboard page</div>} />
            <Route path="/applications" element={<div>Applications page</div>} />
          </Route>
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('login', () => {
  it('asks for both fields and does not call the API when empty', async () => {
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: /log in/i }))
    expect(screen.getByText(/enter your email/i)).toBeInTheDocument()
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument()
    expect(authApi.login).not.toHaveBeenCalled()
  })

  it('logs in, stores the tokens and lands on the dashboard', async () => {
    authApi.login.mockResolvedValue({ access: 'A', refresh: 'R', user: sampleUser })
    renderApp()

    await userEvent.type(await screen.findByLabelText(/email/i), '  alice@example.com ')
    await userEvent.type(screen.getByLabelText(/password/i), 'Sup3r-secret-pw')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
    expect(authApi.login).toHaveBeenCalledWith('alice@example.com', 'Sup3r-secret-pw')
    expect(tokenStore.access).toBe('A')
    expect(tokenStore.refresh).toBe('R')
  })

  it('shows a clear message for wrong credentials and stays on the page', async () => {
    authApi.login.mockRejectedValue({ response: { status: 401, data: { detail: 'No active account' } } })
    renderApp()

    await userEvent.type(await screen.findByLabelText(/email/i), 'alice@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/incorrect email or password/i)
    expect(tokenStore.access).toBeNull()
    // and the button is usable again
    expect(screen.getByRole('button', { name: /log in/i })).toBeEnabled()
  })

  it('shows the throttle message after too many attempts', async () => {
    authApi.login.mockRejectedValue({ response: { status: 429, data: {} } })
    renderApp()
    await userEvent.type(await screen.findByLabelText(/email/i), 'a@b.co')
    await userEvent.type(screen.getByLabelText(/password/i), 'x')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i)
  })

  it('ignores a second click while the request is in flight', async () => {
    let resolve
    authApi.login.mockReturnValue(new Promise((r) => (resolve = r)))
    renderApp()
    await userEvent.type(await screen.findByLabelText(/email/i), 'alice@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'Sup3r-secret-pw')
    const button = screen.getByRole('button', { name: /log in/i })
    await userEvent.click(button)
    await userEvent.click(screen.getByRole('button', { name: /logging in/i }))
    expect(authApi.login).toHaveBeenCalledTimes(1)
    resolve({ access: 'A', refresh: 'R', user: sampleUser })
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
  })
})

describe('register', () => {
  async function fill({ password = 'Sup3r-secret-pw', confirm = 'Sup3r-secret-pw', email = 'new@example.com' } = {}) {
    await userEvent.type(await screen.findByLabelText(/first name/i), 'Nina')
    await userEvent.type(screen.getByLabelText(/^email/i), email)
    await userEvent.type(screen.getByLabelText(/^password/i), password)
    await userEvent.type(screen.getByLabelText(/confirm password/i), confirm)
  }

  it('validates the form before calling the API', async () => {
    renderApp('/register')
    await fill({ password: 'short', confirm: 'different', email: 'not-an-email' })
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(screen.getByText(/doesn’t look right/i)).toBeInTheDocument()
    expect(screen.getByText(/at least 8 characters\.$/i)).toBeInTheDocument()
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument()
    expect(authApi.register).not.toHaveBeenCalled()
  })

  it('creates the account and signs the user straight in', async () => {
    authApi.register.mockResolvedValue({ access: 'A', refresh: 'R', user: sampleUser })
    renderApp('/register')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
    expect(authApi.register).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new@example.com', first_name: 'Nina', password: 'Sup3r-secret-pw' }),
    )
    expect(tokenStore.access).toBe('A')
  })

  it('shows server-side errors next to the right field', async () => {
    authApi.register.mockRejectedValue({
      response: { status: 400, data: { email: ['An account with this email already exists.'] } },
    })
    renderApp('/register')
    await fill()
    await userEvent.click(screen.getByRole('button', { name: /create account/i }))
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create account/i })).toBeEnabled()
  })
})

describe('route protection', () => {
  it('sends logged-out visitors to the login page', async () => {
    renderApp('/applications')
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(screen.queryByText('Applications page')).not.toBeInTheDocument()
  })

  it('after login, returns to the page the visitor originally asked for (not the dashboard)', async () => {
    authApi.login.mockResolvedValue({ access: 'A', refresh: 'R', user: sampleUser })
    renderApp('/applications')
    await userEvent.type(await screen.findByLabelText(/email/i), 'alice@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'Sup3r-secret-pw')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))
    expect(await screen.findByText('Applications page')).toBeInTheDocument()
    expect(screen.queryByText('Dashboard page')).not.toBeInTheDocument()
  })

  it('lets a returning user straight in using the saved token', async () => {
    tokenStore.set({ access: 'A', refresh: 'R' })
    authApi.me.mockResolvedValue(sampleUser)
    renderApp('/applications')
    expect(await screen.findByText('Applications page')).toBeInTheDocument()
  })

  it('drops back to login when the saved token turns out to be dead', async () => {
    tokenStore.set({ access: 'old', refresh: 'old' })
    authApi.me.mockRejectedValue({ response: { status: 401 } })
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    await waitFor(() => expect(tokenStore.access).toBeNull())
  })

  it('keeps the saved token if the server is just unreachable', async () => {
    tokenStore.set({ access: 'A', refresh: 'R' })
    authApi.me.mockRejectedValue(new Error('Network Error'))
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
    expect(tokenStore.refresh).toBe('R')
  })

  it('redirects a logged-in user away from the login page', async () => {
    tokenStore.set({ access: 'A', refresh: 'R' })
    authApi.me.mockResolvedValue(sampleUser)
    renderApp('/login')
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
  })

  it('reacts to the session being killed elsewhere (auth:logout event)', async () => {
    tokenStore.set({ access: 'A', refresh: 'R' })
    authApi.me.mockResolvedValue(sampleUser)
    renderApp('/')
    expect(await screen.findByText('Dashboard page')).toBeInTheDocument()
    act(() => {
      window.dispatchEvent(new Event('auth:logout'))
    })
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument()
  })
})
