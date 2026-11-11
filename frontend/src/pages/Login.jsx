import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Field from '../components/Field'
import { parseApiError } from '../utils/format'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return

    const problems = {}
    if (!form.email.trim()) problems.email = 'Enter your email.'
    if (!form.password) problems.password = 'Enter your password.'
    setFieldErrors(problems)
    setError('')
    if (Object.keys(problems).length) return

    setBusy(true)
    try {
      await login(form.email.trim(), form.password)
      navigate(location.state?.from || '/', { replace: true })
    } catch (err) {
      const parsed = parseApiError(err)
      setError(err.response?.status === 401 ? 'Incorrect email or password.' : parsed.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Welcome back</h1>
        <p className="muted">Log in to see your applications.</p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} autoFocus />
        </Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password}>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            value={form.password}
            onChange={set('password')}
          />
        </Field>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>

        <p className="auth-switch">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </div>
  )
}
