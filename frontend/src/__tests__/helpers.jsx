import { render } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthContext'

export const ROUTER_FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true }

// Shows the current URL so tests can assert on navigation.
export function LocationProbe() {
  const loc = useLocation()
  return <div data-testid="location">{loc.pathname + loc.search}</div>
}

export function renderWithRouter(ui, { route = '/', path = '*', withAuth = false } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[route]} future={ROUTER_FUTURE}>
      <Routes>
        <Route
          path={path}
          element={
            <>
              {ui}
              <LocationProbe />
            </>
          }
        />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  )
  return render(withAuth ? <AuthProvider>{tree}</AuthProvider> : tree)
}

export const sampleUser = { id: 1, email: 'alice@example.com', first_name: 'Alice', last_name: '' }

export function makeApp(overrides = {}) {
  return {
    id: 1,
    company: 10,
    company_name: 'Acme',
    job_title: 'Python Developer',
    job_url: '',
    location: 'Hyderabad',
    work_mode: 'remote',
    status: 'applied',
    source: '',
    salary_min: null,
    salary_max: null,
    applied_date: '2026-03-05',
    notes: '',
    interview_count: 0,
    ...overrides,
  }
}
