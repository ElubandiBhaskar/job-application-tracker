import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="empty-state">
      <h2>Page not found</h2>
      <p className="muted">That address doesn’t lead anywhere.</p>
      <Link to="/" className="btn btn-primary">
        Back to dashboard
      </Link>
    </div>
  )
}
