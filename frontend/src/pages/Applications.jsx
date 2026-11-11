import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { applicationsApi } from '../api'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { STATUSES, WORK_MODES, formatDate, labelFor, parseApiError } from '../utils/format'

const PAGE_SIZE = 10

const SORT_OPTIONS = [
  { value: '-updated_at', label: 'Recently updated' },
  { value: '-applied_date', label: 'Applied: newest first' },
  { value: 'applied_date', label: 'Applied: oldest first' },
  { value: 'company__name', label: 'Company A–Z' },
  { value: 'job_title', label: 'Job title A–Z' },
]

export default function Applications() {
  // Filters live in the URL so refresh / back button / shared links all behave.
  const [params, setParams] = useSearchParams()
  const search = params.get('search') || ''
  const status = params.get('status') || ''
  const workMode = params.get('work_mode') || ''
  const ordering = params.get('ordering') || '-updated_at'
  const page = Math.max(1, Number(params.get('page')) || 1)

  // The search box keeps its own text so typing feels instant; the URL updates after a pause.
  const [searchText, setSearchText] = useState(search)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [deletingId, setDeletingId] = useState(null)
  const lastSearchInUrl = useRef(search)

  const update = useCallback(
    (changes, { keepPage = false } = {}) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          for (const [k, v] of Object.entries(changes)) {
            if (v === '' || v == null) next.delete(k)
            else next.set(k, v)
          }
          if (!keepPage) next.delete('page')
          return next
        },
        { replace: true },
      )
    },
    [setParams],
  )

  // debounce the search box
  useEffect(() => {
    const trimmed = searchText.trim()
    if (trimmed === search) return undefined
    const t = setTimeout(() => {
      lastSearchInUrl.current = trimmed
      update({ search: trimmed })
    }, 300)
    return () => clearTimeout(t)
  }, [searchText, search, update])

  // if the URL changed from outside (back button, nav link), reflect it in the box
  useEffect(() => {
    if (search !== lastSearchInUrl.current) {
      lastSearchInUrl.current = search
      setSearchText(search)
    }
  }, [search])

  // fetch whenever the query changes; AbortController drops stale responses
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    applicationsApi
      .list({ search, status, work_mode: workMode, ordering, page, page_size: PAGE_SIZE }, controller.signal)
      .then((res) => {
        setData(res)
        setLoading(false)
      })
      .catch((err) => {
        if (err.code === 'ERR_CANCELED') return
        // landed on a page that no longer exists (e.g. after deleting the last row of the last page)
        if (err.response?.status === 404 && page > 1) {
          update({ page: page - 1 }, { keepPage: true })
          return
        }
        setError(parseApiError(err).message)
        setLoading(false)
      })
    return () => controller.abort()
  }, [search, status, workMode, ordering, page, reloadKey, update])

  async function handleDelete(app) {
    if (!window.confirm(`Delete "${app.job_title}" at ${app.company_name}? This also removes its interviews.`)) return
    setDeletingId(app.id)
    try {
      await applicationsApi.remove(app.id)
      setReloadKey((k) => k + 1)
    } catch (err) {
      setError(parseApiError(err).message)
    } finally {
      setDeletingId(null)
    }
  }

  const hasFilters = Boolean(search || status || workMode)
  const rows = data?.results || []

  return (
    <div className="page">
      <div className="page-header">
        <h1>Applications</h1>
        <Link to="/applications/new" className="btn btn-primary">
          + New application
        </Link>
      </div>

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search title, company, notes…"
          aria-label="Search applications"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <select aria-label="Filter by status" value={status} onChange={(e) => update({ status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by work mode" value={workMode} onChange={(e) => update({ work_mode: e.target.value })}>
          <option value="">Any work mode</option>
          {WORK_MODES.map((w) => (
            <option key={w.value} value={w.value}>
              {w.label}
            </option>
          ))}
        </select>
        <select aria-label="Sort by" value={ordering} onChange={(e) => update({ ordering: e.target.value })}>
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setSearchText('')
              lastSearchInUrl.current = ''
              setParams({}, { replace: true })
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}{' '}
          <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
            Try again
          </button>
        </div>
      )}

      {!data && loading ? (
        <div className="page-loading">Loading…</div>
      ) : rows.length === 0 && !error ? (
        <div className="empty-state">
          {hasFilters ? (
            <>
              <h2>No matches</h2>
              <p className="muted">Nothing fits those filters. Try loosening them.</p>
            </>
          ) : (
            <>
              <h2>No applications yet</h2>
              <p className="muted">Track the first job you’ve applied to.</p>
              <Link to="/applications/new" className="btn btn-primary">
                Add application
              </Link>
            </>
          )}
        </div>
      ) : (
        <div className={`card table-card ${loading ? 'is-loading' : ''}`}>
          <table className="table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Status</th>
                <th>Work mode</th>
                <th>Applied</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((app) => (
                <tr key={app.id}>
                  <td data-label="Role">
                    <Link to={`/applications/${app.id}`} className="row-title">
                      {app.job_title}
                    </Link>
                    <div className="muted">
                      {app.company_name}
                      {app.location ? ` · ${app.location}` : ''}
                    </div>
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={app.status} />
                  </td>
                  <td data-label="Work mode">{labelFor(WORK_MODES, app.work_mode)}</td>
                  <td data-label="Applied">{formatDate(app.applied_date)}</td>
                  <td className="row-actions">
                    <Link to={`/applications/${app.id}/edit`} className="btn btn-ghost">
                      Edit
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost danger"
                      disabled={deletingId === app.id}
                      onClick={() => handleDelete(app)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} count={data?.count || 0} onChange={(p) => update({ page: p }, { keepPage: true })} />
        </div>
      )}
    </div>
  )
}
