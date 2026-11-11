import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import Field from '../components/Field'
import { parseApiError } from '../utils/format'

export default function Account() {
  const { user, updateProfile, changePassword } = useAuth()

  return (
    <div className="page narrow">
      <div className="page-header">
        <h1>Account</h1>
      </div>
      <ProfileForm user={user} onSave={updateProfile} />
      <PasswordForm onSubmit={changePassword} />
    </div>
  )
}

function ProfileForm({ user, onSave }) {
  const [form, setForm] = useState({ first_name: user.first_name, last_name: user.last_name || '' })
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.first_name.trim()) {
      setFieldErrors({ first_name: 'Enter your first name.' })
      return
    }
    setBusy(true)
    setError('')
    setFieldErrors({})
    try {
      await onSave({ first_name: form.first_name.trim(), last_name: form.last_name.trim() })
      setSaved(true)
    } catch (err) {
      const parsed = parseApiError(err)
      setError(parsed.message)
      setFieldErrors(parsed.fields)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2>Profile</h2>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {saved && (
        <div className="alert alert-success" role="status">
          Profile saved.
        </div>
      )}
      <Field label="Email" htmlFor="acc-email" hint="Your email is your login and can’t be changed here.">
        <input id="acc-email" value={user.email} disabled readOnly />
      </Field>
      <div className="row-2">
        <Field label="First name" htmlFor="acc-first" error={fieldErrors.first_name}>
          <input id="acc-first" value={form.first_name} onChange={set('first_name')} />
        </Field>
        <Field label="Last name" htmlFor="acc-last" error={fieldErrors.last_name}>
          <input id="acc-last" value={form.last_name} onChange={set('last_name')} />
        </Field>
      </div>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save profile'}
        </button>
      </div>
    </form>
  )
}

const EMPTY_PW = { current_password: '', new_password: '', new_password_confirm: '' }

function PasswordForm({ onSubmit }) {
  const [form, setForm] = useState(EMPTY_PW)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => {
    setDone(false)
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return

    const p = {}
    if (!form.current_password) p.current_password = 'Enter your current password.'
    if (form.new_password.length < 8) p.new_password = 'Use at least 8 characters.'
    if (form.new_password_confirm !== form.new_password) p.new_password_confirm = 'Passwords do not match.'
    setFieldErrors(p)
    setError('')
    setDone(false)
    if (Object.keys(p).length) return

    setBusy(true)
    try {
      await onSubmit(form)
      setForm(EMPTY_PW)
      setDone(true)
    } catch (err) {
      const parsed = parseApiError(err)
      setFieldErrors(parsed.fields)
      setError(parsed.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2>Change password</h2>
      <p className="muted">You’ll stay logged in here; other devices will be logged out.</p>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {done && (
        <div className="alert alert-success" role="status">
          Password changed.
        </div>
      )}
      <Field label="Current password" htmlFor="pw-current" error={fieldErrors.current_password}>
        <input id="pw-current" type="password" autoComplete="current-password" value={form.current_password} onChange={set('current_password')} />
      </Field>
      <Field label="New password" htmlFor="pw-new" error={fieldErrors.new_password}>
        <input id="pw-new" type="password" autoComplete="new-password" value={form.new_password} onChange={set('new_password')} />
      </Field>
      <Field label="Confirm new password" htmlFor="pw-confirm" error={fieldErrors.new_password_confirm}>
        <input id="pw-confirm" type="password" autoComplete="new-password" value={form.new_password_confirm} onChange={set('new_password_confirm')} />
      </Field>
      <div className="form-actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </div>
    </form>
  )
}
