import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import Field from '../components/Field'
import { parseApiError } from '../utils/format'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    password: '',
    password_confirm: '',
  })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function validate() {
    const p = {}
    if (!form.first_name.trim()) p.first_name = 'Enter your first name.'
    if (!form.email.trim()) p.email = 'Enter your email.'
    else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) p.email = 'That email address doesn’t look right.'
    if (form.password.length < 8) p.password = 'Use at least 8 characters.'
    if (form.password_confirm !== form.password) p.password_confirm = 'Passwords do not match.'
    return p
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return

    const problems = validate()
    setFieldErrors(problems)
    setError('')
    if (Object.keys(problems).length) return

    setBusy(true)
    try {
      await register({ ...form, email: form.email.trim(), first_name: form.first_name.trim() })
      navigate('/', { replace: true })
    } catch (err) {
      const parsed = parseApiError(err)
      setFieldErrors(parsed.fields)
      setError(parsed.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit} noValidate>
        <h1>Create your account</h1>
        <p className="muted">Start tracking every application in one place.</p>

        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="row-2">
          <Field label="First name" htmlFor="first_name" error={fieldErrors.first_name}>
            <input id="first_name" autoComplete="given-name" value={form.first_name} onChange={set('first_name')} autoFocus />
          </Field>
          <Field label="Last name (optional)" htmlFor="last_name" error={fieldErrors.last_name}>
            <input id="last_name" autoComplete="family-name" value={form.last_name} onChange={set('last_name')} />
          </Field>
        </div>
        <Field label="Email" htmlFor="email" error={fieldErrors.email}>
          <input id="email" type="email" autoComplete="email" value={form.email} onChange={set('email')} />
        </Field>
        <Field label="Password" htmlFor="password" error={fieldErrors.password} hint="At least 8 characters, not too common.">
          <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} />
        </Field>
        <Field label="Confirm password" htmlFor="password_confirm" error={fieldErrors.password_confirm}>
          <input
            id="password_confirm"
            type="password"
            autoComplete="new-password"
            value={form.password_confirm}
            onChange={set('password_confirm')}
          />
        </Field>

        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  )
}
