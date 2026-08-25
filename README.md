# EmpCore

A role-based employee management system for HR teams and managers — employee records,
attendance, a leave approval workflow, and performance reviews. Built on the MERN
stack as a real internal tool rather than a CRUD tutorial.

The interesting part is not the CRUD. It is that **authorization is enforced at the API
layer, per record, against the live reporting tree** — so a manager cannot reach another
manager's team by typing a different id in the URL, and the test suite proves it by
making exactly that request. That design is written up in
**[docs/rbac.md](./docs/rbac.md)**.

```
Node 18+   ·   MongoDB 6+   ·   React 18   ·   Express 4   ·   Tailwind 4
```

**Live:** [empcore.vercel.app](https://empcore.vercel.app) — the client is deployed;
point `VITE_API_URL` at a running API to sign in. See
[docs/deployment.md](./docs/deployment.md).

---

## Quick start

```bash
git clone <your-repo-url> && cd EmpCore
```

You need **three terminals** — a database, the API, and the web client.

**1. Database** — see [Database options](#database-options) below if you already have
MongoDB running or prefer a hosted cluster.

```bash
cd server
npm install
cp .env.example .env
npm run db                # local MongoDB on 27017, no system install needed
```

**2. API** (second terminal)

```bash
cd server
npm run seed              # 20 employees, 3 months of attendance, leave, reviews
npm run dev               # http://localhost:5000
```

**3. Web client** (third terminal)

```bash
cd client
npm install
npm run dev               # http://localhost:5173  ← open this
```

Open **http://localhost:5173** and sign in with one of the demo accounts below.

### Database options

`npm run db` is the zero-install path: it reuses the real `mongod` binary that the
test tooling already downloads, and stores data in `server/.mongo-data/` so it
survives restarts. It is a development convenience, not a production setup.

If you would rather use a proper database, skip `npm run db` and point
`MONGO_URI` in `server/.env` at it:

| Option | `MONGO_URI` |
|---|---|
| **MongoDB Atlas** (free tier, hosted) | `mongodb+srv://<user>:<pass>@<cluster>.mongodb.net/empcore` |
| **MongoDB Community Server** (installed locally) | `mongodb://127.0.0.1:27017/empcore` |
| **Docker** — `docker run -d -p 27017:27017 mongo:7` | `mongodb://127.0.0.1:27017/empcore` |

Vite proxies `/api` and `/socket.io` to port 5000, so the browser stays same-origin
and the refresh cookie behaves exactly as it would in production. If port 5000 or 5173
is already taken on your machine, set `PORT` in `server/.env` and start the client with
`API_PROXY=http://localhost:<your-port> npm run dev`.

### Demo accounts

All seeded accounts use the password `Password@123`. Sign in as each to see the same
screens resolve to different data.

| Role | Email | What you get |
|---|---|---|
| **Admin** | `aditi.rao@empcore.dev` | The whole organisation, user management, the audit trail |
| **Manager** | `sofia.ramirez@empcore.dev` | Only their 4 reports — approvals, reviews, team attendance |
| **Employee** | `wei.chen@empcore.dev` | Their own profile, attendance, leave and review history |

> Try signing in as the manager, copying an employee id the admin can see but they
> cannot, and opening `/employees/<that-id>`. The API returns `403` — the restriction is
> not a hidden link.

---

## What it does

### Authentication
- JWT access tokens (15 min, **in memory only**) plus an httpOnly refresh cookie scoped
  to `/api/auth`, so an XSS payload can read neither.
- Refresh-token rotation with a `tokenVersion` counter — logging out, changing a
  password, changing a role or disabling an account kills every outstanding token.
- The user document is re-read on every request, so a demotion takes effect immediately
  rather than at token expiry.
- Account lockout after five failed attempts; bcrypt at cost 12.

### Employees
- Full CRUD with **soft delete** — deactivating preserves attendance, leave and review
  history, disables the login, and re-points direct reports at the departing manager's
  own manager. Restorable by an admin.
- Search, multi-field filtering, allow-listed sorting and pagination on the list.
- Field-level access control: `salary` is returned to admins and to the employee
  themselves, and stripped for everyone else — including from the CSV export's headers.
- Per-role write allow-lists; ignored fields are reported back rather than silently
  dropped.
- Manager reassignment with **cycle detection**, so the reporting tree stays a tree.

### Attendance
- Check-in / check-out with server-side late detection against a configurable start of
  day; a sub-four-hour day is downgraded to a half day automatically.
- Month calendar with weekends and company holidays pre-filled, so an empty cell never
  has to be guessed at.
- Manager corrections, upserted on `(employee, date)` — and **a manager cannot edit
  their own attendance**.
- Monthly aggregation: rate, present / late / absent split, hours logged.

### Leave
- A real state machine (`pending → approved | rejected | cancelled`) defined as data on
  the schema, so an illegal transition is a `409` from any route that reaches it.
- Business-day counting that excludes weekends and holidays; overlap detection; notice
  periods, consecutive-day caps and balance checks from the policy catalogue.
- Approving deducts balance and writes `on_leave` attendance markers; cancelling an
  approved request releases both.
- **Self-approval is refused** even for a manager — visibility and approval rights are
  deliberately different predicates.
- Every transition is appended to an immutable `history` array on the request.

### Performance reviews
- Competency scores (1–5 across five dimensions) with the overall rating derived as
  their mean.
- Draft → submitted → acknowledged. A draft is invisible to its subject; an
  acknowledged review is locked to everyone, including its author.
- One review per employee per quarter, enforced by a unique compound index.
- Employees get a read-only history with a rating trend.

### Dashboard and reporting
- MongoDB aggregation pipelines (`$match`, `$group`, `$lookup`, `$graphLookup`,
  `$dateToString`) for headcount by department, attendance rate and trend, leave
  breakdown, hiring trend and average rating by department.
- The scope is applied **inside** the `$match` stage, so the same endpoint returns the
  organisation's numbers to an admin and the team's numbers to a manager.

---

## Beyond the brief

Features added on top of the core requirements, and the reason each is there:

| Feature | Why it earns its place |
|---|---|
| **Interactive org chart** | One `$graphLookup` walks the self-referencing manager edge to any depth — the alternative is N queries, one per level. It is also the same traversal that powers every scope check. |
| **Append-only audit trail** | Actor, action, before/after diff, IP and outcome for every mutating request. **Refused attempts are recorded too** — a run of `denied` rows is what privilege escalation looks like from the inside. TTL-expired after two years. |
| **Real-time notifications** | Socket.IO authenticated with the same JWT; each socket joins a private room keyed by user id, so a notification reaches exactly one recipient without broadcasting. |
| **Scheduled jobs** | Auto-marks yesterday's missing attendance as absent (skipping weekends and holidays), accrues leave monthly against policy caps, and nudges approvers on requests older than three days. |
| **Leave policy engine** | Quotas, accrual, carry-forward, notice periods and paid/unpaid handling are configuration rows, not hard-coded constants. |
| **Holiday calendar** | Feeds the business-day calculation and the auto-absent job from one place. |
| **CSV export** | Employees and attendance, honouring the caller's scope *and* field-level redaction. Cells are escaped against spreadsheet formula injection. |
| **OpenAPI 3 + Swagger UI** | Served live at `/api/docs`, with an `x-roles` extension on every operation mirroring the route guards. |
| **Account lockout & rate limiting** | 10 auth attempts / 15 min per IP, 60 writes / min, 300 reads / min. |
| **NoSQL injection hardening** | Mongo operator keys are stripped from every body, param and query, so `{"email": {"$ne": null}}` cannot turn a login into a match-anything query. |
| **Zod validation** | Parsed output *replaces* the raw input, so controllers only ever see coerced, stripped values. |
| **Dark mode, toasts, skeletons** | Theme toggle persisted per browser; every async view has explicit loading, empty and error states. |
| **Code-split routes** | Each page is a lazy chunk — the initial bundle stays small even with charts in the tree. |

---

## Testing

```bash
cd server && npm test
```

**65 tests, all passing**, run against an in-memory MongoDB — no external database
needed. They are the executable form of the authorization write-up:

```
tests/rbac.test.js        identity, role gate, record scope, redaction, soft delete, cycles
tests/leave.test.js       business-day maths, overlap, balances, the state machine, approval boundary
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
- `revokes live sessions when the account is deactivated`
- `strips Mongo operators from the request body`

---

## Documentation

| Document | Contents |
|---|---|
| **[docs/rbac.md](./docs/rbac.md)** | How authorization is enforced at the API layer — the three-layer chain, `$graphLookup` scope resolution, field redaction, the state machine, and honest limitations |
| **[docs/api_endpoints.md](./docs/api_endpoints.md)** | Every endpoint with its required roles, query parameters, status codes and examples |
| **[docs/er_diagram.md](./docs/er_diagram.md)** | Schema relationships, the reasoning behind each modelling decision, and the index list |
| **[docs/er_diagram.svg](./docs/er_diagram.svg)** | The ER diagram itself — scalable, theme-aware, selectable text |
| **[docs/deployment.md](./docs/deployment.md)** | Deploying to Atlas + Render/Vercel, and why the API cannot go serverless |
| `/api/docs` | Swagger UI against the running server |

---

## Repository layout

```
EmpCore/
├── client/                      React 18 + Vite + Tailwind 4
│   └── src/
│       ├── pages/               One file per route (lazy-loaded)
│       ├── components/          ui.jsx primitives, RouteGuards.jsx
│       ├── context/             AuthContext (session), UIContext (toasts, sockets, theme)
│       ├── layouts/             AppLayout — role-aware navigation
│       ├── hooks/               useFetch with a stale-response guard, useDebounced
│       └── lib/                 axios client with refresh-on-401, formatters
├── server/
│   ├── models/                  10 Mongoose schemas
│   ├── controllers/             Request handling and business rules
│   ├── routes/                  Route table with the role guards attached
│   ├── middleware/              auth.js · roleCheck.js · validate.js · sanitize.js · errorHandler.js
│   ├── services/                scopeService ($graphLookup) · leaveService · reportService
│   │                            tokenService · auditService · notificationService · realtime
│   ├── jobs/                    node-cron: auto-absent, leave accrual, approval reminders
│   ├── validators/              Zod schemas
│   ├── utils/                   dates · csv · query · ApiError · logger · seed
│   ├── docs/openapi.js          OpenAPI 3 specification
│   ├── tests/                   Jest + Supertest + mongodb-memory-server
│   └── server.js
├── docs/
│   ├── rbac.md                  ← the strongest interview talking point
│   ├── api_endpoints.md
│   ├── er_diagram.md
│   └── er_diagram.svg
└── README.md
```

---

## Configuration

`server/.env` — see `.env.example` for the full list.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | API port |
| `MONGO_URI` | `mongodb://127.0.0.1:27017/empcore` | Database |
| `JWT_ACCESS_SECRET` | dev value | **Must be replaced in production** — startup refuses a `dev-` secret when `NODE_ENV=production` |
| `JWT_REFRESH_SECRET` | dev value | Same |
| `ACCESS_TOKEN_TTL` | `15m` | Access token lifetime |
| `REFRESH_TOKEN_TTL` | `7d` | Refresh cookie lifetime |
| `CLIENT_ORIGIN` | `http://localhost:5173` | CORS allow-list (comma-separated) |
| `WORK_DAY_START` | `09:15` | Check-ins after this UTC time are recorded as late |
| `ENABLE_CRON` | `true` | Set `false` to disable the scheduled jobs |

---

## npm scripts

**server**

| Script | Does |
|---|---|
| `npm run db` | Local MongoDB on 27017 with no system install (data in `server/.mongo-data/`) |
| `npm run dev` | nodemon with reload |
| `npm start` | Production start |
| `npm run seed` | Wipe and seed the demo organisation (`-- --keep` to append) |
| `npm test` | Jest against an in-memory MongoDB |

**client**

| Script | Does |
|---|---|
| `npm run dev` | Vite dev server with the API proxy |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the built bundle |

---

## Known limitations

Stated plainly rather than discovered later:

- **Roles are a fixed enum, not a permission matrix.** Three roles cover this domain,
  but "a manager who may see pay bands" would need a new role rather than a grant. A
  production system would want per-permission assignment.
- **Scope is recomputed on every request.** Correct, and it means a re-org takes effect
  immediately — but it is an aggregation per scoped call. At real scale it would want
  caching keyed on employee id, invalidated when a manager changes.
- **`$graphLookup` is capped at `maxDepth: 10`.** Deep enough for any realistic org
  chart, but an eleventh level would silently fall outside scope.
- **Dates are handled in UTC throughout.** Correct and unambiguous, but a genuinely
  multi-region deployment would need per-employee timezones for check-in times.
- **The audit diff is shallow.** Nested arrays such as leave `history` are compared as
  whole values, so the diff shows that the array changed rather than which element was
  appended.
- **No email delivery.** Notifications are in-app and real-time; wiring an SMTP
  transport into `notificationService` is the obvious next step.

---

## License

MIT
