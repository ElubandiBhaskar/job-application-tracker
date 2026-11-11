import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Applications from '../pages/Applications'
import ApplicationForm from '../pages/ApplicationForm'
import { makeApp, renderWithRouter } from './helpers'

vi.mock('../api', () => ({
  applicationsApi: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), history: vi.fn() },
  companiesApi: { list: vi.fn() },
}))
import { applicationsApi, companiesApi } from '../api'

const page = (results, count = results.length) => ({ count, next: null, previous: null, results })
const lastListParams = () => applicationsApi.list.mock.calls.at(-1)[0]

beforeEach(() => {
  vi.resetAllMocks()
  companiesApi.list.mockResolvedValue(page([{ id: 10, name: 'Acme' }, { id: 11, name: 'Globex' }]))
})

describe('applications list', () => {
  it('renders the rows', async () => {
    applicationsApi.list.mockResolvedValue(
      page([makeApp(), makeApp({ id: 2, job_title: 'Data Engineer', company_name: 'Globex', status: 'offer' })]),
    )
    renderWithRouter(<Applications />, { route: '/applications' })
    expect(await screen.findByText('Python Developer')).toBeInTheDocument()
    expect(screen.getByText('Data Engineer')).toBeInTheDocument()
    // the word also exists in the status dropdown, so look inside the table only
    expect(within(screen.getByRole('table')).getByText('Offer')).toBeInTheDocument()
  })

  it('shows a first-run empty state', async () => {
    applicationsApi.list.mockResolvedValue(page([]))
    renderWithRouter(<Applications />, { route: '/applications' })
    expect(await screen.findByText(/no applications yet/i)).toBeInTheDocument()
  })

  it('searches after a short pause and puts the term in the URL', async () => {
    applicationsApi.list.mockResolvedValue(page([makeApp()]))
    renderWithRouter(<Applications />, { route: '/applications' })
    await screen.findByText('Python Developer')

    await userEvent.type(screen.getByLabelText(/search applications/i), 'python')

    await waitFor(() => expect(lastListParams().search).toBe('python'))
    expect(screen.getByTestId('location')).toHaveTextContent('search=python')
    // it should not have fired a request per keystroke
    const searches = applicationsApi.list.mock.calls.map((c) => c[0].search).filter(Boolean)
    expect(searches.every((s) => s === 'python')).toBe(true)
  })

  it('filters by status and goes back to page 1', async () => {
    applicationsApi.list.mockResolvedValue(page([makeApp()], 25))
    renderWithRouter(<Applications />, { route: '/applications?page=3' })
    await screen.findByText('Python Developer')

    await userEvent.selectOptions(screen.getByLabelText(/filter by status/i), 'interviewing')

    await waitFor(() => expect(lastListParams()).toMatchObject({ status: 'interviewing', page: 1 }))
  })

  it('reads filters from the URL on load', async () => {
    applicationsApi.list.mockResolvedValue(page([makeApp()]))
    renderWithRouter(<Applications />, { route: '/applications?status=offer&search=acme&work_mode=remote' })
    await screen.findByText('Python Developer')
    expect(lastListParams()).toMatchObject({ status: 'offer', search: 'acme', work_mode: 'remote' })
    expect(screen.getByLabelText(/search applications/i)).toHaveValue('acme')
  })

  it('shows a "no matches" message and can clear the filters', async () => {
    applicationsApi.list.mockResolvedValue(page([]))
    renderWithRouter(<Applications />, { route: '/applications?status=offer' })
    expect(await screen.findByText(/no matches/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /clear filters/i }))
    await waitFor(() => expect(lastListParams().status).toBeFalsy())
  })

  it('pages forward', async () => {
    applicationsApi.list.mockResolvedValue(page([makeApp()], 23))
    renderWithRouter(<Applications />, { route: '/applications' })
    await screen.findByText('Python Developer')
    expect(screen.getByText(/page 1 of 3/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /next/i }))

    await waitFor(() => expect(lastListParams().page).toBe(2))
  })

  it('steps back a page if the current one no longer exists', async () => {
    applicationsApi.list
      .mockRejectedValueOnce({ response: { status: 404, data: { detail: 'Invalid page.' } } })
      .mockResolvedValue(page([makeApp()], 11))
    renderWithRouter(<Applications />, { route: '/applications?page=2' })
    expect(await screen.findByText('Python Developer')).toBeInTheDocument()
    expect(lastListParams().page).toBe(1)
  })

  it('deletes after confirmation and reloads', async () => {
    applicationsApi.list.mockResolvedValue(page([makeApp()]))
    applicationsApi.remove.mockResolvedValue({})
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderWithRouter(<Applications />, { route: '/applications' })
    await screen.findByText('Python Developer')

    await userEvent.click(screen.getByRole('button', { name: /delete/i }))

    await waitFor(() => expect(applicationsApi.remove).toHaveBeenCalledWith(1))
    await waitFor(() => expect(applicationsApi.list.mock.calls.length).toBeGreaterThan(1))
  })

  it('does nothing when the delete is cancelled', async () => {
    applicationsApi.list.mockResolvedValue(page([makeApp()]))
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderWithRouter(<Applications />, { route: '/applications' })
    await screen.findByText('Python Developer')
    await userEvent.click(screen.getByRole('button', { name: /delete/i }))
    expect(applicationsApi.remove).not.toHaveBeenCalled()
  })

  it('shows an error with a retry button when loading fails', async () => {
    applicationsApi.list.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(page([makeApp()]))
    renderWithRouter(<Applications />, { route: '/applications' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/can't reach the server/i)
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText('Python Developer')).toBeInTheDocument()
  })
})

describe('application form', () => {
  const route = { route: '/applications/new', path: '/applications/new' }

  it('requires a title and a company', async () => {
    renderWithRouter(<ApplicationForm />, route)
    await userEvent.click(await screen.findByRole('button', { name: /add application/i }))
    expect(screen.getByText(/enter the job title/i)).toBeInTheDocument()
    expect(screen.getByText(/enter the company name/i)).toBeInTheDocument()
    expect(applicationsApi.create).not.toHaveBeenCalled()
  })

  it('rejects a salary range where min is above max', async () => {
    renderWithRouter(<ApplicationForm />, route)
    await userEvent.type(await screen.findByLabelText(/job title/i), 'Dev')
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme')
    await userEvent.type(screen.getByLabelText(/salary min/i), '90000')
    await userEvent.type(screen.getByLabelText(/salary max/i), '50000')
    await userEvent.click(screen.getByRole('button', { name: /add application/i }))
    expect(screen.getByText(/can’t be lower than the minimum/i)).toBeInTheDocument()
    expect(applicationsApi.create).not.toHaveBeenCalled()
  })

  it('sends empty numbers and dates as null and lands on the new application', async () => {
    applicationsApi.create.mockResolvedValue(makeApp({ id: 42 }))
    renderWithRouter(<ApplicationForm />, route)
    await userEvent.type(await screen.findByLabelText(/job title/i), '  Python Developer ')
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme')
    await userEvent.clear(screen.getByLabelText(/applied on/i))
    await userEvent.click(screen.getByRole('button', { name: /add application/i }))

    await waitFor(() => expect(applicationsApi.create).toHaveBeenCalledTimes(1))
    expect(applicationsApi.create.mock.calls[0][0]).toMatchObject({
      job_title: 'Python Developer',
      company_name: 'Acme',
      status: 'applied',
      salary_min: null,
      salary_max: null,
      applied_date: null,
    })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/applications/42'))
  })

  it('shows server field errors and lets the user retry', async () => {
    applicationsApi.create.mockRejectedValue({
      response: { status: 400, data: { job_url: ['Enter a valid URL.'] } },
    })
    renderWithRouter(<ApplicationForm />, route)
    await userEvent.type(await screen.findByLabelText(/job title/i), 'Dev')
    await userEvent.type(screen.getByLabelText(/company/i), 'Acme')
    await userEvent.click(screen.getByRole('button', { name: /add application/i }))
    expect(await screen.findByText(/enter a valid url/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add application/i })).toBeEnabled()
  })

  it('pre-fills the form when editing and saves only through update', async () => {
    applicationsApi.get.mockResolvedValue(makeApp({ id: 7, job_title: 'Existing role', salary_min: 100, salary_max: 200 }))
    applicationsApi.update.mockResolvedValue(makeApp({ id: 7 }))
    renderWithRouter(<ApplicationForm />, { route: '/applications/7/edit', path: '/applications/:id/edit' })

    expect(await screen.findByDisplayValue('Existing role')).toBeInTheDocument()
    expect(screen.getByLabelText(/salary min/i)).toHaveValue(100)

    await userEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(applicationsApi.update).toHaveBeenCalledWith('7', expect.objectContaining({ job_title: 'Existing role', salary_min: 100 })))
    expect(applicationsApi.create).not.toHaveBeenCalled()
  })

  it('handles an application that does not exist', async () => {
    applicationsApi.get.mockRejectedValue({ response: { status: 404, data: {} } })
    renderWithRouter(<ApplicationForm />, { route: '/applications/99/edit', path: '/applications/:id/edit' })
    expect(await screen.findByRole('alert')).toHaveTextContent(/doesn’t exist/i)
  })

  it('offers existing companies as suggestions', async () => {
    renderWithRouter(<ApplicationForm />, route)
    await screen.findByLabelText(/job title/i)
    await waitFor(() => expect(document.querySelectorAll('#company-options option')).toHaveLength(2))
    const values = [...document.querySelectorAll('#company-options option')].map((o) => o.value)
    expect(values).toEqual(['Acme', 'Globex'])
  })
})
