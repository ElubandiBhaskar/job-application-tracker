import {
  formatDate,
  formatSalary,
  fromDateTimeInput,
  labelFor,
  parseApiError,
  STATUSES,
  todayLocal,
  toDateTimeInput,
} from '../utils/format'

describe('parseApiError', () => {
  it('reports an unreachable server when there is no response', () => {
    const { message } = parseApiError(new Error('Network Error'))
    expect(message).toMatch(/can't reach the server/i)
  })

  it('uses the detail message from DRF', () => {
    const err = { response: { status: 409, data: { detail: 'Acme still has 1 application.' } } }
    expect(parseApiError(err)).toEqual({ message: 'Acme still has 1 application.', fields: {} })
  })

  it('splits field errors out and joins multiple messages', () => {
    const err = {
      response: { status: 400, data: { email: ['Already used.'], password: ['Too short.', 'Too common.'] } },
    }
    const { message, fields } = parseApiError(err)
    expect(fields).toEqual({ email: 'Already used.', password: 'Too short. Too common.' })
    expect(message).toMatch(/fix the highlighted fields/i)
  })

  it('gives a friendly message for 429 and 5xx', () => {
    expect(parseApiError({ response: { status: 429, data: {} } }).message).toMatch(/too many attempts/i)
    expect(parseApiError({ response: { status: 500, data: '<html>boom</html>' } }).message).toMatch(/server hit a problem/i)
  })

  it('does not blow up on odd payloads', () => {
    expect(parseApiError({ response: { status: 400, data: 'nope' } }).message).toBe('Request failed.')
    expect(parseApiError(undefined).message).toBeTruthy()
  })
})

describe('dates', () => {
  it('formats a plain date without shifting the day', () => {
    expect(formatDate('2026-03-05')).toMatch(/5/)
    expect(formatDate('2026-03-05')).toMatch(/2026/)
    expect(formatDate(null)).toBe('—')
  })

  it('todayLocal is YYYY-MM-DD', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('round-trips datetime-local values through ISO', () => {
    const local = '2026-05-20T14:30'
    const iso = fromDateTimeInput(local)
    expect(iso).toMatch(/Z$/)
    expect(toDateTimeInput(iso)).toBe(local)
  })

  it('handles empty / invalid datetime input', () => {
    expect(fromDateTimeInput('')).toBeNull()
    expect(fromDateTimeInput('garbage')).toBeNull()
    expect(toDateTimeInput(null)).toBe('')
  })
})

describe('misc helpers', () => {
  it('labelFor falls back to the raw value', () => {
    expect(labelFor(STATUSES, 'interviewing')).toBe('Interviewing')
    expect(labelFor(STATUSES, 'mystery')).toBe('mystery')
  })

  it('formatSalary covers every combination', () => {
    expect(formatSalary(null, null)).toBe('—')
    expect(formatSalary(50000, 50000)).toBe(Number(50000).toLocaleString())
    expect(formatSalary(50000, null)).toMatch(/^from/)
    expect(formatSalary(null, 90000)).toMatch(/^up to/)
    expect(formatSalary(1000, 2000)).toMatch(/–/)
    expect(formatSalary(0, 0)).toBe('0')
  })
})
