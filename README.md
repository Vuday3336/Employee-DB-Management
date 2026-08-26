# EmpCore

A role-based employee management system for HR teams and managers — employee records,
attendance, a leave approval workflow, and performance reviews. Built as a real
internal tool rather than a CRUD tutorial.

The interesting part is not the CRUD. It is that **authorization is enforced at the API
layer, per record, against the live reporting tree** — so a manager cannot reach another
manager's team by typing a different id in the URL. That design is written up in
**[docs/rbac.md](./docs/rbac.md)**.

```
Node 18+  ·  PostgreSQL (Supabase)  ·  React 18  ·  Express 4  ·  Tailwind 4
```

**Live:** [empcore.vercel.app](https://empcore.vercel.app)

> **On the database.** This started on MongoDB and moved to Postgres. The data is
> relational throughout — employees, departments, foreign keys everywhere — so
> Postgres models it more directly. The MongoDB implementation is preserved on the
> [`mongodb`](https://github.com/Vuday3336/Employee-DB-Management/tree/mongodb)
> branch, and the migration commit explains each translation.

---

## Quick start

```bash
git clone https://github.com/Vuday3336/Employee-DB-Management.git
cd Employee-DB-Management
```

**1. Database.** Create a free project at [supabase.com](https://supabase.com) (or run
any Postgres 14+), then apply the schema:

```bash
psql "$DATABASE_URL" -f server/db/schema.sql
```

Or paste `server/db/schema.sql` into the Supabase SQL editor. It is idempotent, so
re-running is safe.

**2. API**

```bash
cd server
npm install
cp .env.example .env        # then set DATABASE_URL
npm run seed                # 20 employees, 3 months of attendance, leave, reviews
npm run dev                 # http://localhost:5000
```

**3. Web client** (second terminal)

```bash
cd client
npm install
npm run dev                 # http://localhost:5173  ← open this
```

Vite proxies `/api` and `/socket.io` to port 5000, so the browser stays same-origin and
the refresh cookie behaves as it would in production. If port 5000 is taken, set `PORT`
in `server/.env` and start the client with `API_PROXY=http://localhost:<port> npm run dev`.

### Demo accounts

All seeded accounts use the password `Password@123`. Sign in as each to see the same
screens resolve to different data.

| Role | Email | What you get |
|---|---|---|
| **Admin** | `aditi.rao@empcore.dev` | The whole organisation, user management, the audit trail |
| **Manager** | `sofia.ramirez@empcore.dev` | Only their 4 reports — approvals, reviews, team attendance |
| **Employee** | `wei.chen@empcore.dev` | Their own profile, attendance, leave and review history |

> Sign in as the manager, take an employee id the admin can see but they cannot, and
> open `/employees/<that-id>`. The API returns `403` — the restriction is not a hidden
> link.

---

## What it does

### Authentication
- JWT access tokens (15 min, **in memory only**) plus an httpOnly refresh cookie scoped
  to `/api/auth`, so an XSS payload can read neither.
- Refresh-token rotation with a `token_version` counter — logging out, changing a
  password, changing a role or disabling an account kills every outstanding token.
- The user row is re-read on every request, so a demotion takes effect immediately
  rather than at token expiry.
- Account lockout after five failed attempts; bcrypt at cost 12.

### Employees
- Full CRUD with **soft delete** — deactivating preserves attendance, leave and review
  history, disables the login, and re-points direct reports at the departing manager's
  own manager. Restorable by an admin.
- Search, multi-field filtering, allow-listed sorting and pagination.
- Field-level access control: `salary` is returned to admins and to the employee
  themselves, and stripped for everyone else — including from the CSV export's headers.
- Per-role write allow-lists; ignored fields are reported back rather than silently
  dropped.
- Manager reassignment with **cycle detection**, so the reporting tree stays a tree.

### Attendance
- Check-in / check-out with server-side late detection against a configurable start of
  day; a sub-four-hour day is downgraded to a half day automatically.
- Month calendar with weekends and company holidays pre-filled.
- Manager corrections, upserted on `(employee_id, date)` — and **a manager cannot edit
  their own attendance**.
- Monthly aggregation: rate, present / late / absent split, hours logged.

### Leave
- A state machine (`pending → approved | rejected | cancelled`) checked on every
  transition, so an illegal move is a `409` from whichever route reaches it.
- Business-day counting that excludes weekends and holidays; overlap detection; notice
  periods, consecutive-day caps and balance checks from the policy table.
- Approving deducts balance and writes `on_leave` attendance markers **in one
  transaction**; cancelling an approved request releases both.
- **Self-approval is refused** even for a manager — visibility and approval rights are
  deliberately different predicates.
- Every transition is appended to `leave_request_history`.

### Performance reviews
- Competency scores (1–5 across five dimensions) with the overall rating derived as
  their mean, server-side.
- Draft → submitted → acknowledged. A draft is invisible to its subject; an
  acknowledged review is locked to everyone, including its author.
- One review per employee per quarter, enforced by a unique constraint.

### Dashboard and reporting
- SQL aggregations — `GROUP BY` with filtered aggregates, `DISTINCT ON` for
  latest-per-employee, `to_char` bucketing for trends.
- The scope is applied **inside the WHERE clause**, so the same endpoint returns the
  organisation's numbers to an admin and the team's numbers to a manager.

---

## Beyond the brief

| Feature | Why it earns its place |
|---|---|
| **Interactive org chart** | A `WITH RECURSIVE` CTE walks the self-referencing `manager_id` edge to any depth in one query — the alternative is N queries, one per level. It is the same traversal that powers every scope check. |
| **Append-only audit trail** | Actor, action, before/after diff, IP and outcome for every mutating request. **Refused attempts are recorded too** — a run of `denied` rows is what privilege escalation looks like from the inside. |
| **RLS lockdown** | Supabase publishes every table through PostgREST using an anon key that ships to the browser. RLS is enabled with no policies so that path is closed and the Express API stays the only way in. |
| **Real-time notifications** | Socket.IO authenticated with the same JWT; each socket joins a private room keyed by user id. *(Not active on the Vercel deployment — see below.)* |
| **Scheduled jobs** | Auto-marks missing attendance as absent, accrues leave monthly against policy caps, nudges approvers on stale requests. The two that must not silently stop — the daily attendance close-out and data retention — also run as `pg_cron` jobs in Postgres, so they survive a serverless host with no scheduler. |
| **Real transactions** | Creating an employee (record + opening balances + login) and approving leave (status + balance + attendance markers) are atomic. |
| **Leave policy engine** | Quotas, accrual, carry-forward, notice periods and paid/unpaid handling are rows, not constants. |
| **CSV export** | Employees and attendance, honouring the caller's scope *and* field-level redaction. Cells are escaped against spreadsheet formula injection. |
| **OpenAPI 3 + Swagger UI** | Served at `/api/docs`, with an `x-roles` extension on every operation mirroring the route guards. |
| **Injection hardening** | Every query is a parameterised tagged template. Operator-style keys are stripped from input, and ids are UUID-validated before reaching the query layer. |
| **Dark mode, toasts, code-split routes** | Theme persisted per browser; every async view has explicit loading, empty and error states. |

---

## Testing

```bash
cd server
DATABASE_URL_TEST=postgresql://... npm test
```

The suite needs a **real Postgres**, not an in-memory stand-in: the rules it verifies
are recursive CTEs and table constraints, so faking the database would test something
other than what runs. Point `DATABASE_URL_TEST` at a throwaway database — the suite
builds it from `db/schema.sql` and truncates between tests. Without that variable the
suites skip with a visible message rather than failing confusingly.

> **Do not** point it at a database holding real data. The suite truncates every table.

What it covers:

```
tests/rbac.test.js        identity, role gate, record scope, redaction, soft delete, cycles
tests/leave.test.js       business-day maths, overlap, balances, the state machine, approvals
tests/attendance.test.js  check-in/out rules, corrections, monthly aggregation, the cron job
tests/review.test.js      draft visibility, acknowledgement, edit locking, the org chart
```

Representative cases:

- `blocks a manager reading an employee outside their tree by id`
- `lets a manager read an indirect report two levels down`
- `hides salary from a manager but shows it to the employee and to admins`
- `refuses self-approval even for a manager`
- `refuses to decide an already-decided request`
- `releases the balance when an approved request is cancelled`
- `counts only the manager team, and the whole org for an admin`

---

## Deployment

The client is on Vercel. The API is a Vercel serverless function, which carries one
honest trade-off:

> **Socket.IO live notifications and the `node-cron` jobs do not run on Vercel.** Both
> need a process that outlives a request. Everything else — auth, CRUD, dashboards, the
> org chart, the whole authorization chain — works.
>
> The two jobs that matter most run as **`pg_cron` schedules inside Postgres**
> (`server/db/scheduled_jobs.sql`), so the daily attendance close-out and the audit/
> notification retention happen regardless of where the API lives. Deploy to Render,
> Railway, Fly or any container host (`Dockerfile` and `render.yaml` are included) to
> get live notifications and the remaining reminders back.

Full walkthrough, including the two settings that silently break auth if they disagree,
in **[docs/deployment.md](./docs/deployment.md)**.

---

## Documentation

| Document | Contents |
|---|---|
| **[docs/build-report.md](./docs/build-report.md)** | The record of the project: stack decisions, the migration, three production bugs and how they were found, what is verified and what is not |
| **[docs/rbac.md](./docs/rbac.md)** | How authorization is enforced at the API layer — the three-layer chain, recursive scope resolution, field redaction, and honest limitations |
| **[docs/api_endpoints.md](./docs/api_endpoints.md)** | Every endpoint with required roles, query parameters, status codes and examples |
| **[docs/er_diagram.md](./docs/er_diagram.md)** | Schema relationships, the reasoning behind each modelling decision, and the index list |
| **[docs/deployment.md](./docs/deployment.md)** | Supabase + Vercel/Render, and why the API cannot go serverless without losing features |
| `/api/docs` | Swagger UI against the running server |

---

## Repository layout

```
├── client/                      React 18 + Vite + Tailwind 4
│   └── src/
│       ├── pages/               One file per route (lazy-loaded)
│       ├── components/          ui.jsx primitives, RouteGuards.jsx
│       ├── context/             AuthContext (session), UIContext (toasts, sockets, theme)
│       ├── layouts/             AppLayout — role-aware navigation
│       ├── hooks/               useFetch with a stale-response guard, useDebounced
│       └── lib/                 axios client with refresh-on-401, formatters
├── server/
│   ├── db/                      schema.sql · seed.sql · shapes.js (SQL→JSON) · enums.js
│   ├── controllers/             Request handling and business rules
│   ├── routes/                  Route table with the role guards attached
│   ├── middleware/              auth.js · roleCheck.js · validate.js · sanitize.js · errorHandler.js
│   ├── services/                scopeService (recursive CTE) · leaveService · reportService
│   │                            tokenService · auditService · notificationService · realtime
│   ├── jobs/                    node-cron: auto-absent, leave accrual, approval reminders
│   ├── validators/              Zod schemas
│   ├── api/index.js             Vercel serverless entry
│   ├── docs/openapi.js          OpenAPI 3 specification
│   ├── tests/                   Jest + Supertest against a real Postgres
│   └── server.js                Long-running entry (Socket.IO + cron)
├── docs/
├── render.yaml
└── README.md
```

---

## Configuration

`server/.env` — see `.env.example` for the full list.

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string. Use Supabase's **transaction pooler** (port 6543) for serverless |
| `JWT_ACCESS_SECRET` | **Must be replaced in production** — startup refuses a `dev-` value when `NODE_ENV=production` |
| `JWT_REFRESH_SECRET` | A different long random string |
| `CLIENT_ORIGIN` | CORS allow-list (comma-separated) |
| `COOKIE_SAMESITE` | `none` when client and API are on different domains; `lax` when they share one |
| `WORK_DAY_START` | Check-ins after this UTC time are recorded as late |
| `ENABLE_CRON` | Scheduled jobs. Always off on Vercel |

---

## Known limitations

- **Roles are a fixed enum, not a permission matrix.** "A manager who may see pay bands"
  would need a new role rather than a grant.
- **Scope is recomputed on every request.** Correct, and a re-org takes effect
  immediately, but it is a recursive query per scoped call. At scale it would want
  caching invalidated on manager changes.
- **`subordinate_ids()` is capped at depth 10.** Deep enough for any realistic org, but
  an eleventh level would silently fall outside scope.
- **Dates are handled in UTC throughout.** Unambiguous, but a multi-region deployment
  would need per-employee timezones for check-in times.
- **The audit diff is shallow.** Nested values are compared whole.
- **No email delivery.** Notifications are in-app only.
- **The demo accounts are public.** `npm run seed` gives twenty accounts the same
  password and the login page lists three, including the admin. Remove that panel from
  `client/src/pages/Login.jsx` before this holds anything real.

---

## License

MIT
