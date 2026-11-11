import { Route, Routes } from 'react-router-dom'
import { ProtectedRoute, PublicOnlyRoute } from './auth/ProtectedRoute'
import Layout from './components/Layout'
import Account from './pages/Account'
import ApplicationDetail from './pages/ApplicationDetail'
import ApplicationForm from './pages/ApplicationForm'
import Applications from './pages/Applications'
import Companies from './pages/Companies'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import NotFound from './pages/NotFound'
import Register from './pages/Register'

export default function App() {
  return (
    <Routes>
      <Route element={<PublicOnlyRoute />}>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
      </Route>

      <Route element={<ProtectedRoute />}>
        <Route element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="applications" element={<Applications />} />
          <Route path="applications/new" element={<ApplicationForm />} />
          <Route path="applications/:id" element={<ApplicationDetail />} />
          <Route path="applications/:id/edit" element={<ApplicationForm />} />
          <Route path="companies" element={<Companies />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  )
}
