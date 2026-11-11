import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function ProtectedRoute() {
  const { user, booting } = useAuth()
  const location = useLocation()

  if (booting) return <div className="page-loading">Loading…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <Outlet />
}

// Login / register pages: if you're already signed in, go to the dashboard instead.
// The moment login succeeds `user` is set and this route re-renders, so it has to honour the
// page the visitor originally asked for (passed along in location.state.from) or it would win
// the race against the login page's own redirect and always dump people on the dashboard.
export function PublicOnlyRoute() {
  const { user, booting } = useAuth()
  const location = useLocation()
  if (booting) return <div className="page-loading">Loading…</div>
  if (user) return <Navigate to={location.state?.from || '/'} replace />
  return <Outlet />
}
