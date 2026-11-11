import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { applicationsApi, companiesApi } from '../api'
import Field from '../components/Field'
import { STATUSES, WORK_MODES, parseApiError, todayLocal } from '../utils/format'

const EMPTY = {
  job_title: '',
  company_name: '',
  status: 'applied',
  work_mode: 'onsite',
  location: '',
  source: '',
  job_url: '',
  salary_min: '',
  salary_max: '',
  applied_date: todayLocal(),
  notes: '',
}

// API object -> form strings
function toForm(app) {
  return {
    job_title: app.job_title,
    company_name: app.company_name,
    status: app.status,
    work_mode: app.work_mode,
    location: app.location || '',
    source: app.source || '',
    job_url: app.job_url || '',
    salary_min: app.salary_min ?? '',
    salary_max: app.salary_max ?? '',
    applied_date: app.applied_date || '',
    notes: app.notes || '',
  }
}

// form strings -> API payload (empty numbers/dates must be null, not "")
function toPayload(form) {
  return {
    job_title: form.job_title.trim(),
    company_name: form.company_name.trim(),
    status: form.status,
    work_mode: form.work_mode,
    location: form.location.trim(),
    source: form.source.trim(),
    job_url: form.job_url.trim(),
    salary_min: form.salary_min === '' ? null : Number(form.salary_min),
    salary_max: form.salary_max === '' ? null : Number(form.salary_max),
    applied_date: form.applied_date || null,
    notes: form.notes,
  }
}

export default function ApplicationForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [form, setForm] = useState(EMPTY)
  const [companies, setCompanies] = useState([])
  const [loading, setLoading] = useState(isEdit)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    // existing company names for the suggestions list
    companiesApi
      .list({ page_size: 100, ordering: 'name' })
      .then((res) => !cancelled && setCompanies(res.results))
      .catch(() => {}) // suggestions are a nicety, the form works without them

    if (isEdit) {
      applicationsApi
        .get(id)
        .then((app) => {
          if (cancelled) return
          setForm(toForm(app))
          setLoading(false)
        })
        .catch((err) => {
          if (cancelled) return
          setLoadError(err.response?.status === 404 ? 'This application doesn’t exist.' : parseApiError(err).message)
          setLoading(false)
        })
    }
    return () => {
      cancelled = true
    }
  }, [id, isEdit])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  function validate() {
    const p = {}
    if (!form.job_title.trim()) p.job_title = 'Enter the job title.'
    if (!form.company_name.trim()) p.company_name = 'Enter the company name.'
    const min = form.salary_min === '' ? null : Number(form.salary_min)
    const max = form.salary_max === '' ? null : Number(form.salary_max)
    if (min != null && (!Number.isInteger(min) || min < 0)) p.salary_min = 'Use a whole number, 0 or more.'
    if (max != null && (!Number.isInteger(max) || max < 0)) p.salary_max = 'Use a whole number, 0 or more.'
    if (!p.salary_min && !p.salary_max && min != null && max != null && min > max) {
      p.salary_max = 'Maximum can’t be lower than the minimum.'
    }
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
      const saved = isEdit
        ? await applicationsApi.update(id, toPayload(form))
        : await applicationsApi.create(toPayload(form))
      navigate(`/applications/${saved.id}`, { replace: true })
    } catch (err) {
      const parsed = parseApiError(err)
      setFieldErrors(parsed.fields)
      setError(parsed.message)
      setBusy(false)
    }
  }

  if (loading) return <div className="page-loading">Loading…</div>
  if (loadError) {
    return (
      <div className="page">
        <div className="alert alert-error" role="alert">
          {loadError}
        </div>
        <Link to="/applications" className="btn btn-ghost">
          ← Back to applications
        </Link>
      </div>
    )
  }

  return (
    <div className="page narrow">
      <div className="page-header">
        <h1>{isEdit ? 'Edit application' : 'New application'}</h1>
      </div>

      <form className="card form" onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="row-2">
          <Field label="Job title *" htmlFor="job_title" error={fieldErrors.job_title}>
            <input id="job_title" value={form.job_title} onChange={set('job_title')} maxLength={200} autoFocus />
          </Field>
          <Field
            label="Company *"
            htmlFor="company_name"
            error={fieldErrors.company_name || fieldErrors.company}
            hint="Pick an existing company or type a new one."
          >
            <input id="company_name" list="company-options" value={form.company_name} onChange={set('company_name')} maxLength={150} />
            <datalist id="company-options">
              {companies.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </Field>
        </div>

        <div className="row-3">
          <Field label="Status" htmlFor="status" error={fieldErrors.status}>
            <select id="status" value={form.status} onChange={set('status')}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Work mode" htmlFor="work_mode" error={fieldErrors.work_mode}>
            <select id="work_mode" value={form.work_mode} onChange={set('work_mode')}>
              {WORK_MODES.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Applied on" htmlFor="applied_date" error={fieldErrors.applied_date}>
            <input id="applied_date" type="date" value={form.applied_date} onChange={set('applied_date')} />
          </Field>
        </div>

        <div className="row-2">
          <Field label="Location" htmlFor="location" error={fieldErrors.location}>
            <input id="location" value={form.location} onChange={set('location')} maxLength={150} />
          </Field>
          <Field label="Found via" htmlFor="source" error={fieldErrors.source} hint="LinkedIn, referral, company site…">
            <input id="source" value={form.source} onChange={set('source')} maxLength={100} />
          </Field>
        </div>

        <Field label="Job posting URL" htmlFor="job_url" error={fieldErrors.job_url}>
          <input id="job_url" type="url" inputMode="url" placeholder="https://" value={form.job_url} onChange={set('job_url')} />
        </Field>

        <div className="row-2">
          <Field label="Salary min" htmlFor="salary_min" error={fieldErrors.salary_min}>
            <input id="salary_min" type="number" min="0" step="1" value={form.salary_min} onChange={set('salary_min')} />
          </Field>
          <Field label="Salary max" htmlFor="salary_max" error={fieldErrors.salary_max}>
            <input id="salary_max" type="number" min="0" step="1" value={form.salary_max} onChange={set('salary_max')} />
          </Field>
        </div>

        <Field label="Notes" htmlFor="notes" error={fieldErrors.notes}>
          <textarea id="notes" rows={4} value={form.notes} onChange={set('notes')} />
        </Field>

        <div className="form-actions">
          <Link to={isEdit ? `/applications/${id}` : '/applications'} className="btn btn-ghost">
            Cancel
          </Link>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Add application'}
          </button>
        </div>
      </form>
    </div>
  )
}
