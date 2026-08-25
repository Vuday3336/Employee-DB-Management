# EmpCore API reference

Base URL: `http://localhost:5000/api`
Interactive docs: `GET /api/docs` (Swagger UI) · Raw spec: `GET /api/openapi.json`

All responses share one envelope:

```jsonc
// success
{ "success": true, "data": { /* … */ }, "meta": { /* list endpoints only */ } }

// failure
{ "success": false, "message": "Human readable reason", "details": [], "requestId": "uuid" }
```

Authentication is `Authorization: Bearer <accessToken>`. The refresh token is an
httpOnly cookie scoped to `/api/auth`, never readable from JavaScript.

**Reading the Roles column**

| Notation | Meaning |
|---|---|
| `admin` | Any admin account |
| `manager*` | Manager, **restricted to their own reporting sub-tree** (checked per record) |
| `employee*` | Employee, **restricted to their own record** |
| `public` | No token required |

An asterisk always means a record-level check runs in addition to the role gate. See
[`rbac.md`](./rbac.md) for how that check is implemented.

---

## Auth

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `POST` | `/auth/register` | public | Self-registration. **Always** creates an `employee` account — a `role` in the body is ignored. |
| `POST` | `/auth/login` | public | Returns an access token and sets the refresh cookie. Locks the account for 15 min after 5 failed attempts. |
| `POST` | `/auth/refresh` | public (refresh cookie) | Rotates the cookie and mints a new access token. Rejects tokens issued before a logout or password change. |
| `POST` | `/auth/logout` | any | Increments `token_version`, killing every outstanding refresh token. |
| `GET` | `/auth/me` | any | Current principal with the linked employee record. |
| `PATCH` | `/auth/password` | any | Changes own password and revokes all sessions. |

<details>
<summary>Example — login</summary>

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "aditi.rao@empcore.dev", "password": "Password@123" }
```
```jsonc
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOi…",
    "user": { "id": "…", "email": "aditi.rao@empcore.dev", "role": "admin", "employeeId": "…" }
  }
}
```
</details>

---

## Employees

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/employees` | admin, manager\*, employee\* | Search, filter, sort, paginate. Query: `q`, `department`, `status`, `employmentType`, `manager`, `page`, `limit`, `sort`, `includeDeleted` (admin). |
| `POST` | `/employees` | admin | Creates the record, auto-assigns `EMP-nnnn`, seeds leave balances from policy, and optionally provisions a login. |
| `GET` | `/employees/lookup` | admin, manager\*, employee\* | Lightweight `{_id, name, jobTitle}` list for dropdowns. |
| `GET` | `/employees/org-chart` | admin, manager\* | Reporting tree built with a recursive CTE. Managers get their own sub-tree. |
| `GET` | `/employees/export` | admin, manager\* | CSV of the current filter. The `Salary` column is present **only** for admins. |
| `GET` | `/employees/:id` | admin, manager\*, employee\* | Detail plus direct reports and the linked account. |
| `PATCH` | `/employees/:id` | admin, manager\*, employee\* | Writable fields depend on role — see below. |
| `PATCH` | `/employees/:id/manager` | admin | Reassign the reporting line. Rejects reporting cycles. |
| `DELETE` | `/employees/:id` | admin | **Soft delete.** Flags the record, disables the login, re-points reports to the departing manager's manager. |
| `POST` | `/employees/:id/restore` | admin | Undoes a soft delete. |
| `GET` | `/employees/:id/team` | admin, manager\* | Direct reports of one employee. |

**Writable fields by role on `PATCH /employees/:id`**

| Role | Fields |
|---|---|
| admin | Everything, including `salary` and `department` |
| manager (a report) | `jobTitle`, `status`, `employmentType`, `location`, `phone`, `avatarUrl` |
| manager (self) / employee (self) | `phone`, `location`, `avatarUrl` |

Fields outside the allowance are dropped and echoed back in `ignoredFields`; if
*nothing* is writable the request is a `403`.

<details>
<summary>Example — filtered, paginated list</summary>

```http
GET /api/employees?q=chen&department=<id>&status=active&sort=-hireDate&page=1&limit=10
Authorization: Bearer <token>
```
```jsonc
{
  "success": true,
  "data": [ { "_id": "…", "employeeCode": "EMP-0006", "firstName": "Wei", "…": "…" } ],
  "meta": { "page": 1, "limit": 10, "total": 1, "pages": 1, "hasNext": false, "hasPrev": false }
}
```
</details>

---

## Departments

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/departments` | any | List with live headcount (excludes soft-deleted records). |
| `GET` | `/departments/:id` | any | Detail with member list. |
| `POST` | `/departments` | admin | Create. |
| `PATCH` | `/departments/:id` | admin | Update. |
| `DELETE` | `/departments/:id` | admin | Archives it. `409` while employees are still assigned. |

---

## Attendance

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `POST` | `/attendance/check-in` | any | Idempotent per day. `late` is decided server-side against `WORK_DAY_START`. |
| `POST` | `/attendance/check-out` | any | Computes `workedMinutes`; under 4 hours becomes `half_day`. |
| `GET` | `/attendance/today` | any | The caller's record for today. |
| `GET` | `/attendance` | admin, manager\*, employee\* | Log. Query: `employee`, `from`, `to`, `month`, `status`, `page`, `limit`. |
| `GET` | `/attendance/calendar` | admin, manager\*, employee\* | A full month of day cells with weekends and holidays filled in. |
| `GET` | `/attendance/summary` | admin, manager\*, employee\* | Monthly aggregation for one employee. |
| `GET` | `/attendance/team-today` | admin, manager\* | Live in/out board. |
| `GET` | `/attendance/export` | admin, manager\* | CSV of the current filter. |
| `PUT` | `/attendance` | admin, manager\* | Manual correction, upserted on `(employee, date)`. **A manager may not edit their own attendance**; an admin may. |

Attendance statuses: `present`, `late`, `half_day`, `absent`, `on_leave`, `holiday`, `weekend`.

Manual corrections upsert on `(employee_id, date)`, which is a unique constraint — a
retry or double-submit cannot create two conflicting rows for one day.

---

## Leave

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `POST` | `/leave` | any (self); admin/manager\* on behalf of others | Validates overlap, notice period, consecutive-day cap and balance before storing. |
| `GET` | `/leave` | admin, manager\*, employee\* | Query: `status`, `type`, `from`, `to`, `scope` (`mine`/`team`/`all`), `page`, `limit`, `sort`. |
| `GET` | `/leave/pending` | admin, manager\* | The approver's queue. A manager's own requests never appear in it. |
| `GET` | `/leave/balance` | admin, manager\*, employee\* | Entitled / carried / used / remaining per type. |
| `GET` | `/leave/calendar` | any | Who is away in a date window, within scope. |
| `GET` | `/leave/:id` | admin, manager\*, employee\* | Detail with the full transition history. |
| `PATCH` | `/leave/:id/decision` | admin, manager\* | Approve or reject. **Self-approval is refused.** |
| `PATCH` | `/leave/:id/cancel` | admin, requester | Withdraws it; an approved request releases its balance and clears the attendance markers. |

**State machine**

```
                 ┌─────────► approved ──────┐
   (new) ──► pending                         ├──► cancelled
                 ├─────────► rejected  (terminal)
                 └─────────► cancelled
```

Any transition outside this diagram returns `409` — including a second decision on
an already-decided request.

<details>
<summary>Example — approving</summary>

```http
PATCH /api/leave/<id>/decision
Authorization: Bearer <manager token>

{ "decision": "approved", "note": "Enjoy your break" }
```

Side effects, all inside **one transaction**: `days` deducted from the employee's
balance (paid types only), covered working days upserted as `on_leave` attendance, and
a row appended to `leave_request_history`. A notification and an `leave.approved` audit
row follow.
</details>

---

## Performance reviews

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/reviews` | admin, manager\*, employee\* | Employees see only `submitted`/`acknowledged` reviews of themselves. |
| `POST` | `/reviews` | admin, manager\* | One review per employee per period. **Self-review is refused.** `rating` is the mean of the competency scores. |
| `GET` | `/reviews/:id` | admin, manager\*, employee\* | A draft is invisible to its subject. |
| `PATCH` | `/reviews/:id` | admin, review author | Locked once `acknowledged` (`409`). |
| `POST` | `/reviews/:id/acknowledge` | **subject only** | Closes the cycle and adds the employee's comment. |
| `DELETE` | `/reviews/:id` | admin, review author | Drafts only. |
| `GET` | `/reviews/history/:employeeId` | admin, manager\*, employee\* | Rating trend. |

Competencies: `delivery`, `quality`, `collaboration`, `ownership`, `communication` (1–5 each).

---

## Dashboard

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/dashboard` | admin, manager\* | KPI snapshot from parallel aggregation pipelines, scoped to the caller's visible employees. |
| `GET` | `/dashboard/me` | any | Personal panel: today's attendance, balances, upcoming leave, latest review. |

`GET /dashboard` returns `headcountByDepartment`, `attendance`, `leave`,
`attendanceTrend`, `hiringTrend`, `performance` and `stalePendingApprovals`.
The same request from a manager and an admin returns different numbers — the scope
is applied inside the `WHERE` clause, not filtered afterwards.

---

## Administration

| Method | Endpoint | Roles | Description |
|---|---|---|---|
| `GET` | `/users` | admin | List login accounts. |
| `POST` | `/users` | admin | **The only route that can mint a manager or admin account.** |
| `PATCH` | `/users/:id/role` | admin | Change role; revokes that user's sessions. Cannot target yourself. |
| `PATCH` | `/users/:id/status` | admin | Enable/disable a login; disabling revokes sessions. |
| `GET` | `/audit` | admin | Append-only trail. Query: `entity`, `action` (prefix), `actor`, `outcome`, `page`, `limit`. |
| `GET` | `/leave-policies` | any | Policy catalogue. |
| `PUT` | `/leave-policies` | admin | Upsert a policy by `type`. |
| `GET` | `/holidays` | any | Holidays (`?year=`). |
| `POST` | `/holidays` | admin | Add a holiday. |
| `DELETE` | `/holidays/:id` | admin | Remove a holiday. |
| `GET` | `/notifications` | any | Own notifications, also pushed live over Socket.IO. |
| `PATCH` | `/notifications/:id/read` | any | Mark one read. |
| `PATCH` | `/notifications/read-all` | any | Mark all read. |
| `GET` | `/health` | public | Liveness probe. |

---

## Status codes

| Code | When |
|---|---|
| `200` / `201` | Success |
| `400` | Business-rule violation (insufficient balance, notice too short, reporting loop), or a malformed id |
| `401` | Missing, invalid or expired access token |
| `403` | Authenticated, but out of role **or** out of scope |
| `404` | Record does not exist |
| `409` | Illegal state transition or duplicate record |
| `422` | Schema validation failed — see `details[]`. Ids must be UUIDs |
| `429` | Rate limited (10 auth attempts / 15 min, 60 writes / min, 300 reads / min) |

---

## Real-time events (Socket.IO)

Connect with the same access token:

```js
const socket = io('http://localhost:5000', { auth: { token: accessToken } });
socket.on('notification', (payload) => { /* … */ });
```

Each socket joins a private room keyed by user id, so a notification reaches exactly
one recipient. Events are emitted when a leave request is filed, when it is decided,
and when a review is shared or acknowledged.
