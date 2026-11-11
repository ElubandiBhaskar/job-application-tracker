# Job Application Tracker

A full-stack app for keeping track of job applications: where you applied, what stage each one is at, and when your interviews are.

**Stack:** Python · Django REST Framework · React (Vite) · PostgreSQL

## What it does

- **Accounts** – register, log in, log out, edit your name, change your password. Login is by email.
- **Private data** – every query is scoped to the logged-in user. Another user's application, company or interview comes back as a 404, never a 403, so IDs can't be probed.
- **Applications** – create, view, edit, delete. Status moves through Wishlist → Applied → Screening → Interviewing → Offer → Accepted / Rejected / Withdrawn.
- **Status tracking** – every status change is written to a timeline, shown on the application's page.
- **Search and filters** – free-text search (title, company, location, source, notes), filter by status and work mode, sort, paginate. The state lives in the URL, so refresh and the back button work.
- **Interviews** – log phone/technical/HR rounds against an application, mark them completed or cancelled.
- **Companies** – managed separately; typing a new company name on the application form creates it for you.
- **Dashboard** – totals, applications per status, applications per month, upcoming interviews, recent activity.

## Project layout

```
job-application-tracker/
├── backend/                 Django project
│   ├── config/              settings, root urls
│   ├── accounts/            custom User (email login), JWT auth endpoints
│   ├── tracker/             Company, JobApplication, StatusHistory, Interview + API
│   └── requirements.txt
├── frontend/                React app (Vite)
│   └── src/
│       ├── api/             axios client with automatic token refresh
│       ├── auth/            AuthContext, protected routes
│       ├── components/      Layout, Modal, Field, Pagination, StatusBadge
│       ├── pages/           one file per screen
│       └── __tests__/       Vitest + Testing Library
├── scripts/smoke_test.py    end-to-end check against a running server
└── docker-compose.yml       PostgreSQL only
```

## Running it

You need Python 3.11+, Node 18+ and PostgreSQL 14+ (or Docker for the database).

### 1. Database

Easiest is Docker:

```bash
docker compose up -d db
```

Or use your own Postgres and create the database:

```sql
CREATE USER jobtracker WITH PASSWORD 'jobtracker' CREATEDB;
CREATE DATABASE jobtracker OWNER jobtracker;
```

(`CREATEDB` is needed because Django's test runner creates a temporary database.)

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

cp .env.example .env               # Windows: copy .env.example .env
python manage.py migrate
python manage.py seed_demo         # optional: demo@example.com / Demo-pass-2026!
python manage.py runserver
```

The API is now on http://localhost:8000. With `DJANGO_DEBUG=False` the app refuses to start unless `DJANGO_SECRET_KEY` is set. That's intentional.

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. In dev, Vite forwards `/api` to Django, so there is nothing to configure.

## Tests

```bash
# backend: 140 tests (runs against PostgreSQL)
cd backend && python manage.py test

# no Postgres around? SQLite works for the tests too
DB_ENGINE=sqlite python manage.py test

# frontend: 51 tests
cd frontend && npm test

# end-to-end against a running server (creates throw-away users)
python scripts/smoke_test.py http://localhost:8000
```

What the backend tests cover: registration rules, login, token refresh/rotation/blacklisting, logout, password change (which revokes other sessions), throttling, ownership isolation on every endpoint, validation, search/filter/ordering/pagination (including stable paging across rows with equal sort values), status history, interview rules, dashboard stats, and database-level constraints.

## API

All endpoints are under `/api/` and need `Authorization: Bearer <access token>` unless noted.

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/register/` | public; returns user + tokens |
| POST | `/auth/login/` | public; returns user + tokens |
| POST | `/auth/refresh/` | public; rotates the refresh token |
| POST | `/auth/logout/` | body `{refresh}`; blacklists it |
| GET/PATCH | `/auth/me/` | profile |
| POST | `/auth/change-password/` | revokes all other sessions, returns fresh tokens |
| GET/POST | `/applications/` | `?search=` `?status=` (repeatable) `?work_mode=` `?company=` `?source=` `?applied_after=` `?applied_before=` `?active=` `?ordering=` `?page=` `?page_size=` |
| GET/PATCH/PUT/DELETE | `/applications/{id}/` | |
| GET | `/applications/{id}/history/` | status timeline |
| GET/POST | `/companies/` | `?search=` `?industry=` |
| GET/PATCH/DELETE | `/companies/{id}/` | 409 if it still has applications |
| GET/POST | `/interviews/` | `?application=` `?status=` `?kind=` `?upcoming=` |
| GET/PATCH/DELETE | `/interviews/{id}/` | |
| GET | `/stats/` | dashboard numbers |

## Design notes

- **Auth:** short-lived access token (30 min) plus a rotating refresh token (7 days). A used refresh token is blacklisted, so a stolen old one is useless. The frontend refreshes transparently on a 401 and shares one refresh between simultaneous requests. A network blip while refreshing does not log you out.
- **Access control:** each viewset builds its queryset from `request.user`, and every foreign key a client can send (`company`, `application`) only accepts rows the user owns.
- **Company names** are unique per user, ignoring case, enforced by a database constraint and a validator. Deleting a company that still has applications is refused rather than silently deleting the applications.
- **Pagination stability:** list ordering always ends with `id` as a tie-breaker and puts empty values last, so rows never repeat or vanish between pages.
- **Login throttle:** 20 requests/minute per client on login, register and refresh (`AUTH_THROTTLE_RATE`). It uses Django's cache, which is per-process by default; behind several workers, configure a shared cache (Redis/Memcached) for a strict limit.

## Production notes

- Set `DJANGO_DEBUG=False`, a real `DJANGO_SECRET_KEY`, `DJANGO_ALLOWED_HOSTS`, and `DJANGO_HTTPS=True` behind TLS.
- `cd frontend && npm run build` produces `frontend/dist/`. Serve it from any static host/Nginx and route `/api` to Django (`gunicorn config.wsgi`). If the API is on another origin, build with `VITE_API_URL` and set `CORS_ALLOWED_ORIGINS`.
- Run `python manage.py createsuperuser` for access to `/admin/`.
- Tokens are kept in `localStorage`. That is simple and works well, but it means an XSS bug would expose them. React escapes output by default and the app renders no raw HTML.
