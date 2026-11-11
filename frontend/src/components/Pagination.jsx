export default function Pagination({ page, pageSize, count, onChange }) {
  const pages = Math.max(1, Math.ceil(count / pageSize))
  if (pages <= 1) return null

  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, count)

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted">
        {from}–{to} of {count}
      </span>
      <div>
        <button type="button" className="btn btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          ← Previous
        </button>
        <span className="page-indicator">
          Page {page} of {pages}
        </span>
        <button type="button" className="btn btn-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)}>
          Next →
        </button>
      </div>
    </nav>
  )
}
