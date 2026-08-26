# EmpCore — build report

What was built, how it is put together, what went wrong in production and how it was
found. Written as the record of the project rather than as its documentation — for
the reference material, see [rbac.md](./rbac.md), [api_endpoints.md](./api_endpoints.md),
[er_diagram.md](./er_diagram.md) and [deployment.md](./deployment.md).

| | |
|---|---|
| **App** | https://empcore.vercel.app |
| **API** | https://empcore-api.vercel.app · [Swagger](https://empcore-api.vercel.app/api/docs) |
| **Repo** | https://github.com/Vuday3336/Employee-DB-Management |
| **Size** | 116 files · ~13,950 lines · 25 commits |
| **Surface** | 52 HTTP endpoints · 12 tables · 8 enum types · 4 database functions |

---

## 1. What it is

An internal HR tool for a company that has outgrown a spreadsheet. Three kinds of user
share one application and see genuinely different things:

| Role | Sees |
|---|---|
| **Admin** | The whole organisation, user management, the audit trail |
| **Manager** | Their own reporting sub-tree — approvals, reviews, team attendance |
| **Employee** | Their own profile, attendance, leave and review history |

It covers employee records, attendance, a leave approval workflow, performance reviews,
and a reporting dashboard.

The part worth defending in a technical conversation is not the CRUD. It is that
**authorization is decided per record, on the server, against the live reporting tree** —
so a manager who types another manager's employee id into the URL gets a `403`, not a
hidden link.

---

## 2. Stack and why

| Layer | Choice | Why this one |
|---|---|---|
| Runtime | Node 18+ / Express 4 | Plain, well-understood HTTP layer; no framework magic hiding the authorization chain |
| Database | PostgreSQL (Supabase) | The data is relational throughout — employees, departments, foreign keys everywhere |
| Driver | `postgres` (porsager) | Tagged templates parameterise by default; no ORM between the code and the SQL that matters |
| Validation | Zod | Parsed output *replaces* the request body, so controllers never see unvalidated keys |
| Auth | `jsonwebtoken` + `bcryptjs` | Short-lived access token in memory, refresh token in an httpOnly cookie |
| Client | React 18 + Vite 5 | Route-level code splitting; fast dev loop |
| Styling | Tailwind 4 | Token-driven, so the dark theme is one class swap rather than per-component conditionals |
| Charts | Recharts | Composable, and renders acceptably in both themes |
| Docs | OpenAPI 3 + Swagger UI | Served live at `/api/docs`, with `x-roles` mirroring the route guards |
| Tests | Jest + Supertest | Exercises the real HTTP surface, not mocked controllers |

Also in use: `helmet`, `express-rate-limit`, `compression`, `cookie-parser`, `morgan`,
`dayjs`, `socket.io`, `node-cron`, `multer`, `axios`, `react-router-dom`, `lucide-react`.

Postgres extensions: `pgcrypto` (bcrypt hashing in the seed), `citext` (case-insensitive
email), `pg_cron` (scheduled jobs that survive a serverless host).

---

## 3. How authorization works

Three layers, all of which must pass. This is the spine of the project.

```
request
   │
   ▼  authenticate()          middleware/auth.js
   │  Verify the JWT, then re-read the user row. A token is a snapshot;
   │  re-reading means a demotion takes effect now, not at token expiry.
   │  → 401
   ▼  authorize(...roles)     middleware/roleCheck.js
   │  Coarse gate. "Is this class of user allowed on this route at all?"
   │  Sufficient alone only for routes that address no particular record.
   │  → 403
   ▼  scope check             services/scopeService.js
   │  "Is this user allowed to touch THIS record?" Resolved from the
   │  reporting tree, plus field-level redaction on the way out.
   │  → 403 / stripped fields
   ▼
controller
```

### The reporting tree

A manager owns their whole sub-tree, not just direct reports. That is a graph walk, and
it happens in the database:

```sql
create or replace function subordinate_ids(root uuid, max_depth integer default 10)
returns table (id uuid) language sql stable
set search_path = public, pg_temp
as $$
  with recursive tree as (
    select e.id, 0 as depth from employees e
    where e.id = root and e.deleted_at is null
  union all
    select e.id, t.depth + 1 from employees e
    join tree t on e.manager_id = t.id
    where e.deleted_at is null and t.depth < max_depth
  )
  select tree.id from tree;
$$;
```

`deleted_at is null` appears in **both** arms, so a soft-deleted manager cannot drag their
sub-tree back into scope. `search_path` is pinned so the function cannot be tricked into
resolving `employees` elsewhere.

Everything derives from one answer:

```js
async function visibleEmployeeIds(user) {
  if (user.role === 'admin')   return null;                     // null = unrestricted
  if (user.role === 'manager') return getSubordinateIds(user.employee);
  return user.employee ? [user.employee] : [];
}
```

`null` meaning "no restriction" is deliberately distinct from `[]`, "restricted to
nothing" — conflating them would silently grant an unlinked account full visibility.

Three consumers: list queries `and` the scope onto the WHERE clause so a caller-supplied
filter can only narrow; single-record routes check the id before the controller runs; and
aggregations apply it **inside** the WHERE clause, which is why `GET /dashboard` is one
endpoint returning 20 to an admin and 5 to a manager.

### Rights narrower than visibility

A manager appears in their own scope — they must see their own record. But approving your
own leave would make approval meaningless, so acting has its own predicate:

```js
if (String(user.employee) === String(employeeId)) return false;   // never yourself
```

The same predicate guards performance reviews (no self-reviews) and attendance
corrections (a manager cannot edit their own).

### Field-level redaction

Scope is row-level; salary needs its own rule. A manager legitimately sees a report's job
title and attendance, but not their pay. Redaction happens on the way out of the
controller, so one definition covers the list endpoint, the detail endpoint **and** the
CSV export — where a manager's file has no `Salary` header at all, rather than a blank
column.

---

## 4. Data model

Twelve tables. The full DDL is in [`server/db/schema.sql`](../server/db/schema.sql).

| Table | Note |
|---|---|
| `employees` | Self-referencing `manager_id` — the reporting tree |
| `users` | Separate from employees: different lifecycles, and no `password_hash` on list queries |
| `departments` | `manager_id` back to employees |
| `attendance` | **Unique `(employee_id, date)`** — one row per person per day, enforced by the database |
| `leave_requests` | Status is a state machine; every move appends to history |
| `leave_request_history` | Append-only transition trail |
| `leave_balances` | Child table — queried and updated independently |
| `performance_reviews` | **Unique `(employee_id, period_year, period_quarter)`**; `scores` stays as `jsonb` |
| `leave_policies` | Quotas, accrual, notice, caps — configuration, not constants |
| `holidays` | Feeds the business-day calculation |
| `notifications`, `audit_logs` | Retention handled by `pg_cron` |

Constraints doing real work rather than living only in application code:

| Constraint | Rule |
|---|---|
| `employee_not_own_manager` | An employee cannot report to themselves |
| `review_not_self` | An employee cannot review themselves |
| `leave_dates_ordered` | `end_date >= start_date` |
| `attendance_checkout_after_checkin` | Check-out must be after check-in |

Cycles further up the tree (A → B → A) cannot be a single-row check, so those are caught
in the application before the write, and `subordinate_ids()` caps its depth so an
undetected cycle degrades rather than hangs.

### Row-level security

Supabase publishes every table through PostgREST using an anon key that ships to the
browser. EmpCore does its authorization in the API, so that path had to be closed: **RLS
is enabled with no policies** on all twelve tables, which denies `anon` and
`authenticated` outright. The API connects as the table owner and bypasses RLS.

The `rls_enabled_no_policy` advisories Supabase reports are therefore the intended state,
not a to-do.

---

## 5. How it was built

The project ran in five phases, and the commit history follows them.

**Phase 1 — MongoDB implementation (commits 1–12).** Schema, three-layer authorization,
all five feature areas, the React client, and the documentation. `$graphLookup` walked the
reporting tree. 65 Jest tests against an in-memory MongoDB, all passing.

**Phase 2 — first deployment (13–14).** Three bugs surfaced that only appear once client
and API are on different domains: a hardcoded relative `/api` path, a `SameSite=Strict`
refresh cookie the browser refuses to send cross-site, and a `clearCookie` that did not
mirror the attributes the cookie was set with.

**Phase 3 — migration to Postgres (15–17).** The storage changed; the HTTP contract did
not. Column aliases in `db/shapes.js` return the same JSON the Mongo implementation did —
`_id`, camelCase, nested `department`/`manager` objects — so the already-deployed client
needed no changes.

| MongoDB | Postgres |
|---|---|
| `$graphLookup` | `WITH RECURSIVE` in `subordinate_ids()` |
| Aggregation pipelines | `GROUP BY` with filtered aggregates, `DISTINCT ON` |
| Embedded `leaveBalances`, `history` | Child tables — queried independently |
| Embedded `scores` | `jsonb` — always read and written whole |
| Compound unique indexes | Unique constraints |
| TTL indexes | `pg_cron` scheduled deletes |
| Multi-step writes | Real transactions |

**Phase 4 — production debugging (18–24).** Three failures that only appear in the
deployed environment. Documented in section 6.

**Phase 5 — verification and hardening (25).** A guard so the test suite refuses to run
against the application's own database.

---

## 6. Three production bugs

None of these reproduce locally. All three were found by reading logs and measuring.

### 6.1 `GET /employees` returned a SQL syntax error

**Symptom** — `syntax error at or near "where"` on every list and export request.

**Cause** — `listWhere()` was `async` and returned a bare `where …` fragment. A
`postgres` query object is a *thenable*, so `await` on the async function executed the
fragment as a standalone statement instead of splicing it into the outer query.

**Fix** — the fragment builder is synchronous; the caller awaits the scope lookup, which
is the only genuinely async part. The footgun is documented in `db/index.js`.

### 6.2 Every query paid ~400ms

**Symptom** — single-query endpoints took ~800ms; the dashboard exceeded the function
timeout.

**Cause** — the Vercel function defaulted to a US region while Supabase runs in
`ap-south-1`. Every round trip crossed half the planet.

**Fix** — pinned the function to `bom1`. The employee list went **1172ms → 67ms**.

### 6.3 The admin dashboard hung until the function timed out

**Symptom** — 504 after 30 seconds. It worked for managers and failed for admins, with no
error and no slow query on the database side.

**How it was found** — per-step timing logs, which showed it stalling on the third query:

```
[dashboard] headcount 3ms
[dashboard] attendanceRate 22ms
Vercel Runtime Timeout Error: Task timed out after 30 seconds
```

The third step was the first to issue two queries through `Promise.all`.

**Cause** — the pool is capped at one connection on serverless (many concurrent lambdas
each holding several connections is exactly what exhausts a pooler). Concurrent queries
never ran in parallel; they contended for the single connection and stopped making
progress.

**Fix** — all eleven `Promise.all`-over-queries sites became sequential awaits. At ~10ms a
query the cost is a few milliseconds. The dashboard went **30s timeout → 622ms**.

> A first hypothesis — that empty `db\`\`` fragments were the cause — was wrong. Replacing
> them with an inert `and true` fragment did not fix it. That change was kept anyway,
> because an empty template is a genuinely confusing way to express "no filter".

---

## 7. What is verified, and what is not

**66 end-to-end checks pass against the live production API** — not localhost. They cover
authentication and lockout, scope at every role, field redaction, the role gate, dashboard
aggregation, the org chart, the full leave workflow including balance release on
cancellation, approval queues, attendance rules, review visibility, CSV export, and input
hardening.

Confirmed separately in a browser against the deployed app: the manager sees exactly five
employees with no salary column, the org chart shows her sub-tree only, and **the session
survives a full page navigation** — the cross-domain refresh cookie working, which was the
likeliest thing to break in a split-domain deploy.

**The Jest suite has not been executed.** It is written and ported to Postgres, but
running it needs a throwaway database (`DATABASE_URL_TEST`) that was never available
during the build. The code is verified by the production checks above; the suite itself is
not. Run it before claiming a passing test count:

```bash
cd server
DATABASE_URL_TEST="postgresql://..." npm test
```

---

## 8. Deployment

```
empcore.vercel.app          empcore-api.vercel.app         Supabase (ap-south-1)
   React SPA         ──▶      Express on Vercel      ──▶      PostgreSQL
   root: client/             root: server/, bom1              12 tables, RLS on
   VITE_API_URL              transaction pooler :6543         2 pg_cron jobs
```

Two settings must agree or authentication fails in ways that look mysterious:
`CLIENT_ORIGIN` on the API must match the client's origin exactly, and `COOKIE_SAMESITE`
must be `none` while the two are on different domains.

**The accepted trade-off.** Socket.IO and `node-cron` need a process that outlives a
request, which serverless does not have. The two jobs that must not silently stop — the
daily attendance close-out and audit/notification retention — run as `pg_cron` schedules
inside Postgres instead, so they work regardless of where the API lives. Live notification
badges do not update in real time on this deployment; moving the API to Render, Railway or
any container host restores them with no code change (`render.yaml` and a `Dockerfile` are
committed).

---

## 9. Still open

- **The Jest suite has never been run.** See section 7.
- **Live notifications are off** on the Vercel deployment. See section 8.
- **The demo accounts are public.** Twenty seeded accounts share `Password@123` and the
  login page lists three, including the admin. Deliberate for a portfolio demo; remove
  the panel in `client/src/pages/Login.jsx` before this holds anything real.
- **Roles are a fixed enum, not a permission matrix.** "A manager who may see pay bands"
  would need a new role rather than a grant.
- **Scope is recomputed per request.** Correct, and a re-org takes effect immediately, but
  it is a recursive query per scoped call. At scale it wants caching invalidated on
  manager changes.
- **Authorization lives in the API, not the database.** RLS is a wall, not a rule engine.
  A second service connecting with the owner role would bypass every check described here.

---

## 10. The MongoDB version

Preserved on the [`mongodb` branch](https://github.com/Vuday3336/Employee-DB-Management/tree/mongodb).
It is a complete, working implementation with 65 passing tests, and it is the version that
demonstrates MongoDB aggregation and `$graphLookup`. Worth keeping for that reason.
