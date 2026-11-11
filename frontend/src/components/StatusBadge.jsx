import { STATUSES, labelFor } from '../utils/format'

export default function StatusBadge({ status, labels = STATUSES }) {
  return <span className={`badge badge-${status}`}>{labelFor(labels, status)}</span>
}
