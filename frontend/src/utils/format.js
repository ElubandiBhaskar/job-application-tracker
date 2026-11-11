// Small helpers shared by the pages. Nothing React in here so they're easy to test.

export const STATUSES = [
  { value: 'wishlist', label: 'Wishlist' },
  { value: 'applied', label: 'Applied' },
  { value: 'screening', label: 'Screening' },
  { value: 'interviewing', label: 'Interviewing' },
  { value: 'offer', label: 'Offer' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
]

export const WORK_MODES = [
  { value: 'onsite', label: 'On-site' },
  { value: 'hybrid', label: 'Hybrid' },
  { value: 'remote', label: 'Remote' },
]

export const INTERVIEW_KINDS = [
  { value: 'phone', label: 'Phone screen' },
  { value: 'technical', label: 'Technical' },
  { value: 'hr', label: 'HR' },
  { value: 'managerial', label: 'Managerial' },
  { value: 'onsite', label: 'On-site' },
  { value: 'assignment', label: 'Take-home assignment' },
  { value: 'other', label: 'Other' },
]

export const INTERVIEW_STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
]

export function labelFor(list, value) {
  const hit = list.find((item) => item.value === value)
  return hit ? hit.label : value || ''
}

const pad = (n) => String(n).padStart(2, '0')

// Today's date as YYYY-MM-DD in the user's own timezone (not UTC).
export function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// "2026-03-05" -> "5 Mar 2026". Parsed by hand because new Date('2026-03-05')
// is treated as UTC and can show the wrong day west of Greenwich.
export function formatDate(value) {
  if (!value) return '—'
  const [y, m, d] = value.split('-').map(Number)
  if (!y || !m || !d) return value
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// ISO string from the API -> value for <input type="datetime-local"> (local time)
export function toDateTimeInput(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ...and back: the browser's local time -> a proper ISO timestamp with timezone
export function fromDateTimeInput(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function formatSalary(min, max) {
  const fmt = (n) => Number(n).toLocaleString()
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`
  if (min != null) return `from ${fmt(min)}`
  if (max != null) return `up to ${fmt(max)}`
  return '—'
}

export function monthLabel(yyyymm) {
  const [y, m] = yyyymm.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' })
}

// Turns whatever went wrong into { message, fields }.
// DRF sends either {detail: "..."} or {field: ["msg", ...]}.
export function parseApiError(err) {
  if (!err) return { message: 'Something went wrong.', fields: {} }

  if (!err.response) {
    return { message: "Can't reach the server. Check your connection and try again.", fields: {} }
  }

  const { status, data } = err.response

  if (status >= 500) {
    return { message: 'The server hit a problem. Please try again in a moment.', fields: {} }
  }
  if (status === 429) {
    return { message: 'Too many attempts. Please wait a minute and try again.', fields: {} }
  }
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const fields = {}
    let message = ''
    for (const [key, value] of Object.entries(data)) {
      const text = Array.isArray(value) ? value.join(' ') : String(value)
      if (key === 'detail' || key === 'non_field_errors') message = message ? `${message} ${text}` : text
      else fields[key] = text
    }
    if (!message && Object.keys(fields).length) message = 'Please fix the highlighted fields.'
    return { message: message || 'Request failed.', fields }
  }
  return { message: 'Request failed.', fields: {} }
}
