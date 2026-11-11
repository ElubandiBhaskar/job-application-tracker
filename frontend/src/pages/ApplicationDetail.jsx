import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { applicationsApi, interviewsApi } from '../api'
import Field from '../components/Field'
import Modal from '../components/Modal'
import StatusBadge from '../components/StatusBadge'
import {
  INTERVIEW_KINDS,
  INTERVIEW_STATUSES,
  STATUSES,
  WORK_MODES,
  formatDate,
  formatDateTime,
  formatSalary,
  fromDateTimeInput,
  labelFor,
  parseApiError,
  toDateTimeInput,
} from '../utils/format'

export default function ApplicationDetail() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [app, setApp] = useState(null)
  const [interviews, setInterviews] = useState([])
  const [history, setHistory] = useState([])
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const [editing, setEditing] = useState(null) // null | 'new' | interview object

  const loadAll = useCallback(async () => {
    try {
      const [a, i, h] = await Promise.all([
        applicationsApi.get(id),
        interviewsApi.list({ application: id, page_size: 100 }),
        applicationsApi.history(id),
      ])
      setApp(a)
      setInterviews(i.results)
      setHistory(h)
      setLoadError('')
    } catch (err) {
      setLoadError(err.response?.status === 404 ? 'This application doesn’t exist.' : parseApiError(err).message)
    }
  }, [id])

  useEffect(() => {
    setApp(null)
    loadAll()
  }, [loadAll])

  async function changeStatus(e) {
    const next = e.target.value
    if (next === app.status) return
    setStatusBusy(true)
    setActionError('')
    try {
      await applicationsApi.update(id, { status: next })
      await loadAll() // refresh so the timeline and applied date are right
    } catch (err) {
      setActionError(parseApiError(err).message)
    } finally {
      setStatusBusy(false)
    }
  }

  async function deleteApplication() {
    if (!window.confirm(`Delete "${app.job_title}"? Its interviews and history go with it.`)) return
    try {
      await applicationsApi.remove(id)
      navigate('/applications', { replace: true })
    } catch (err) {
      setActionError(parseApiError(err).message)
    }
  }

  async function deleteInterview(interview) {
    if (!window.confirm('Delete this interview?')) return
    try {
      await interviewsApi.remove(interview.id)
      await loadAll()
    } catch (err) {
      setActionError(parseApiError(err).message)
    }
  }

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
  if (!app) return <div className="page-loading">Loading…</div>

  return (
    <div className="page">
      <Link to="/applications" className="back-link">
        ← All applications
      </Link>

      <div className="page-header">
        <div>
          <h1>{app.job_title}</h1>
          <p className="muted">{app.company_name}</p>
        </div>
        <div className="header-actions">
          <Link to={`/applications/${id}/edit`} className="btn btn-ghost">
            Edit
          </Link>
          <button type="button" className="btn btn-ghost danger" onClick={deleteApplication}>
            Delete
          </button>
        </div>
      </div>

      {actionError && (
        <div className="alert alert-error" role="alert">
          {actionError}
        </div>
      )}

      <div className="grid-detail">
        <section className="card">
          <div className="status-row">
            <label htmlFor="status-select">Status</label>
            <StatusBadge status={app.status} />
            <select id="status-select" value={app.status} onChange={changeStatus} disabled={statusBusy}>
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <dl className="facts">
            <dt>Applied</dt>
            <dd>{formatDate(app.applied_date)}</dd>
            <dt>Work mode</dt>
            <dd>{labelFor(WORK_MODES, app.work_mode)}</dd>
            <dt>Location</dt>
            <dd>{app.location || '—'}</dd>
            <dt>Salary</dt>
            <dd>{formatSalary(app.salary_min, app.salary_max)}</dd>
            <dt>Found via</dt>
            <dd>{app.source || '—'}</dd>
            <dt>Posting</dt>
            <dd>
              {app.job_url ? (
                <a href={app.job_url} target="_blank" rel="noopener noreferrer">
                  Open link ↗
                </a>
              ) : (
                '—'
              )}
            </dd>
          </dl>

          {app.notes && (
            <>
              <h3>Notes</h3>
              <p className="notes">{app.notes}</p>
            </>
          )}
        </section>

        <section className="card">
          <h2>Status timeline</h2>
          <ol className="timeline">
            {[...history].reverse().map((h) => (
              <li key={h.id}>
                <StatusBadge status={h.to_status} />
                <span className="muted">
                  {h.from_status ? `from ${labelFor(STATUSES, h.from_status)} · ` : 'added · '}
                  {formatDateTime(h.changed_at)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="card">
        <div className="section-header">
          <h2>Interviews</h2>
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            + Add interview
          </button>
        </div>

        {interviews.length === 0 ? (
          <p className="muted">No interviews logged yet.</p>
        ) : (
          <ul className="list interviews">
            {interviews.map((i) => (
              <li key={i.id}>
                <div>
                  <strong>{labelFor(INTERVIEW_KINDS, i.kind)}</strong>{' '}
                  <span className={`pill pill-${i.status}`}>{labelFor(INTERVIEW_STATUSES, i.status)}</span>
                  <div>{formatDateTime(i.scheduled_at)}</div>
                  {(i.interviewer || i.location) && (
                    <div className="muted">{[i.interviewer, i.location].filter(Boolean).join(' · ')}</div>
                  )}
                  {i.notes && <div className="notes">{i.notes}</div>}
                </div>
                <div className="row-actions">
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(i)}>
                    Edit
                  </button>
                  <button type="button" className="btn btn-ghost danger" onClick={() => deleteInterview(i)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <InterviewModal
          applicationId={app.id}
          interview={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await loadAll()
          }}
        />
      )}
    </div>
  )
}

function InterviewModal({ applicationId, interview, onClose, onSaved }) {
  const [form, setForm] = useState({
    kind: interview?.kind || 'technical',
    status: interview?.status || 'scheduled',
    scheduled_at: toDateTimeInput(interview?.scheduled_at),
    interviewer: interview?.interviewer || '',
    location: interview?.location || '',
    notes: interview?.notes || '',
  })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return

    const when = fromDateTimeInput(form.scheduled_at)
    if (!when) {
      setFieldErrors({ scheduled_at: 'Pick a date and time.' })
      return
    }
    setFieldErrors({})
    setError('')
    setBusy(true)

    const payload = {
      application: applicationId,
      kind: form.kind,
      status: form.status,
      scheduled_at: when,
      interviewer: form.interviewer.trim(),
      location: form.location.trim(),
      notes: form.notes,
    }
    try {
      if (interview) await interviewsApi.update(interview.id, payload)
      else await interviewsApi.create(payload)
      await onSaved()
    } catch (err) {
      const parsed = parseApiError(err)
      setFieldErrors(parsed.fields)
      setError(parsed.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={interview ? 'Edit interview' : 'Add interview'} onClose={onClose}>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <div className="row-2">
          <Field label="Type" htmlFor="iv-kind" error={fieldErrors.kind}>
            <select id="iv-kind" value={form.kind} onChange={set('kind')}>
              {INTERVIEW_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status" htmlFor="iv-status" error={fieldErrors.status}>
            <select id="iv-status" value={form.status} onChange={set('status')}>
              {INTERVIEW_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Date and time *" htmlFor="iv-when" error={fieldErrors.scheduled_at}>
          <input id="iv-when" type="datetime-local" value={form.scheduled_at} onChange={set('scheduled_at')} />
        </Field>
        <div className="row-2">
          <Field label="Interviewer" htmlFor="iv-who" error={fieldErrors.interviewer}>
            <input id="iv-who" value={form.interviewer} onChange={set('interviewer')} maxLength={150} />
          </Field>
          <Field label="Location / link" htmlFor="iv-where" error={fieldErrors.location}>
            <input id="iv-where" value={form.location} onChange={set('location')} maxLength={200} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="iv-notes" error={fieldErrors.notes}>
          <textarea id="iv-notes" rows={3} value={form.notes} onChange={set('notes')} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save interview'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
