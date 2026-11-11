import { useCallback, useEffect, useState } from 'react'
import { companiesApi } from '../api'
import Field from '../components/Field'
import Modal from '../components/Modal'
import Pagination from '../components/Pagination'
import { parseApiError } from '../utils/format'

const PAGE_SIZE = 10

export default function Companies() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // debounced version of search
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(null) // null | 'new' | company

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()
    setError('')
    companiesApi
      .list({ search: query, page, page_size: PAGE_SIZE }, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.code === 'ERR_CANCELED') return
        if (err.response?.status === 404 && page > 1) {
          setPage(page - 1)
          return
        }
        setError(parseApiError(err).message)
      })
    return () => controller.abort()
  }, [query, page, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  async function handleDelete(company) {
    if (!window.confirm(`Delete ${company.name}?`)) return
    setError('')
    try {
      await companiesApi.remove(company.id)
      reload()
    } catch (err) {
      setError(parseApiError(err).message) // e.g. "still has 2 applications"
    }
  }

  const rows = data?.results || []

  return (
    <div className="page">
      <div className="page-header">
        <h1>Companies</h1>
        <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
          + New company
        </button>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search companies…"
          aria-label="Search companies"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {!data && !error ? (
        <div className="page-loading">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <h2>{query ? 'No matches' : 'No companies yet'}</h2>
          <p className="muted">
            {query ? 'Try a different search.' : 'Companies are added automatically when you add an application, or you can add one here.'}
          </p>
        </div>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Industry</th>
                <th>Location</th>
                <th>Applications</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td data-label="Company">
                    <span className="row-title">{c.name}</span>
                    {c.website && (
                      <div>
                        <a href={c.website} target="_blank" rel="noopener noreferrer" className="muted">
                          {c.website.replace(/^https?:\/\//, '')}
                        </a>
                      </div>
                    )}
                  </td>
                  <td data-label="Industry">{c.industry || '—'}</td>
                  <td data-label="Location">{c.location || '—'}</td>
                  <td data-label="Applications">{c.application_count}</td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => setEditing(c)}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-ghost danger" onClick={() => handleDelete(c)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data.count} onChange={setPage} />
        </div>
      )}

      {editing && (
        <CompanyModal
          company={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
    </div>
  )
}

function CompanyModal({ company, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: company?.name || '',
    website: company?.website || '',
    industry: company?.industry || '',
    location: company?.location || '',
    notes: company?.notes || '',
  })
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return
    if (!form.name.trim()) {
      setFieldErrors({ name: 'Enter the company name.' })
      return
    }
    setFieldErrors({})
    setError('')
    setBusy(true)
    try {
      const payload = { ...form, name: form.name.trim(), website: form.website.trim() }
      if (company) await companiesApi.update(company.id, payload)
      else await companiesApi.create(payload)
      onSaved()
    } catch (err) {
      const parsed = parseApiError(err)
      setFieldErrors(parsed.fields)
      setError(parsed.message)
      setBusy(false)
    }
  }

  return (
    <Modal title={company ? 'Edit company' : 'New company'} onClose={onClose}>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        <Field label="Name *" htmlFor="co-name" error={fieldErrors.name}>
          <input id="co-name" value={form.name} onChange={set('name')} maxLength={150} autoFocus />
        </Field>
        <Field label="Website" htmlFor="co-site" error={fieldErrors.website}>
          <input id="co-site" type="url" inputMode="url" placeholder="https://" value={form.website} onChange={set('website')} />
        </Field>
        <div className="row-2">
          <Field label="Industry" htmlFor="co-industry" error={fieldErrors.industry}>
            <input id="co-industry" value={form.industry} onChange={set('industry')} maxLength={100} />
          </Field>
          <Field label="Location" htmlFor="co-location" error={fieldErrors.location}>
            <input id="co-location" value={form.location} onChange={set('location')} maxLength={150} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="co-notes" error={fieldErrors.notes}>
          <textarea id="co-notes" rows={3} value={form.notes} onChange={set('notes')} />
        </Field>
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
