import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { statsApi } from '../api'
import StatusBadge from '../components/StatusBadge'
import {
  INTERVIEW_KINDS,
  STATUSES,
  formatDate,
  formatDateTime,
  labelFor,
  monthLabel,
  parseApiError,
} from '../utils/format'

export default function Dashboard() {
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setError('')
    statsApi
      .get()
      .then((data) => !cancelled && setStats(data))
      .catch((err) => !cancelled && setError(parseApiError(err).message))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        {error}{' '}
        <button type="button" className="link-btn" onClick={() => setReloadKey((k) => k + 1)}>
          Try again
        </button>
      </div>
    )
  }
  if (!stats) return <div className="page-loading">Loading…</div>

  const maxMonth = Math.max(1, ...stats.monthly.map((m) => m.count))

  return (
    <div className="page">
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link to="/applications/new" className="btn btn-primary">
          + New application
        </Link>
      </div>

      {stats.total === 0 ? (
        <div className="empty-state">
          <h2>No applications yet</h2>
          <p className="muted">Add your first one and this page will start filling up.</p>
          <Link to="/applications/new" className="btn btn-primary">
            Add application
          </Link>
        </div>
      ) : (
        <>
          <div className="stat-grid">
            <Stat label="Total applications" value={stats.total} />
            <Stat label="Still active" value={stats.active} />
            <Stat label="Upcoming interviews" value={stats.upcoming_interview_count} />
            <Stat label="Offers" value={stats.offers} />
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>By status</h2>
              <ul className="bars">
                {STATUSES.map(({ value, label }) => {
                  const n = stats.by_status[value] ?? 0
                  return (
                    <li key={value}>
                      <Link to={`/applications?status=${value}`} className="bar-label">
                        {label}
                      </Link>
                      <div className="bar-track" aria-hidden="true">
                        <div className={`bar-fill badge-${value}`} style={{ width: `${(n / stats.total) * 100}%` }} />
                      </div>
                      <span className="bar-count">{n}</span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="card">
              <h2>Applications per month</h2>
              <div className="columns" role="img" aria-label="Applications per month">
                {stats.monthly.map((m) => (
                  <div className="column" key={m.month} title={`${m.month}: ${m.count}`}>
                    <span className="column-count">{m.count}</span>
                    <div className="column-bar" style={{ height: `${(m.count / maxMonth) * 100}%` }} />
                    <span className="column-label">{monthLabel(m.month)}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid-2">
            <section className="card">
              <h2>Upcoming interviews</h2>
              {stats.upcoming_interviews.length === 0 ? (
                <p className="muted">Nothing scheduled.</p>
              ) : (
                <ul className="list">
                  {stats.upcoming_interviews.map((i) => (
                    <li key={i.id}>
                      <Link to={`/applications/${i.application}`}>
                        <strong>{i.application_title}</strong>
                      </Link>
                      <span className="muted">
                        {i.company_name} · {labelFor(INTERVIEW_KINDS, i.kind)}
                      </span>
                      <span>{formatDateTime(i.scheduled_at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card">
              <h2>Recently added</h2>
              <ul className="list">
                {stats.recent_applications.map((a) => (
                  <li key={a.id}>
                    <Link to={`/applications/${a.id}`}>
                      <strong>{a.job_title}</strong>
                    </Link>
                    <span className="muted">
                      {a.company_name} · {formatDate(a.applied_date)}
                    </span>
                    <StatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}
