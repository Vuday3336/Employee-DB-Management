# How authorization is enforced at the API layer

This is the part of EmpCore worth talking through in an interview. The short version:
**the UI hides nothing that the API would otherwise allow.** Every restriction the
interface appears to apply is re-derived server-side from the reporting tree, and the
test suite proves it by making the forbidden requests directly.

---

## The problem with "is the user logged in?"

A naive CRUD app checks two things: is there a valid token, and does the role match.
That is enough for `POST /employees` (admins only), but it says nothing useful about
`GET /employees/:id`. Two managers both pass a `role === 'manager'` check, yet manager
A must not read manager B's team. The question that actually matters is not *what kind
of user is this*, it is **is this user allowed to touch this specific record**.

EmpCore answers that with three layers, all of which must pass.

```
  request
     │
     ▼
┌──────────────────────┐
│ 1. authenticate()    │  Who are you?      middleware/auth.js
│    verify JWT        │  → 401
│    re-read the user  │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│ 2. authorize(roles)  │  What kind of      middleware/roleCheck.js
│    coarse role gate  │  user are you?
└──────────┬───────────┘  → 403
           ▼
┌──────────────────────┐
│ 3. scope check       │  Which records     services/scopeService.js
│    reporting subtree │  are yours?
│    + field redaction │  → 403 / stripped fields
└──────────┬───────────┘
           ▼
      controller
```

---

## Layer 1 — identity (`middleware/auth.js`)

Verifies the bearer token, then **re-reads the user from the database on every
request** rather than trusting the JWT payload:

```js
const payload = verifyAccessToken(token);
const [user] = await db`
  select id, email, role, employee_id, is_active from users where id = ${payload.sub}::uuid`;
if (!user) throw ApiError.unauthorized('Account no longer exists');
if (!user.is_active) throw ApiError.forbidden('Account is deactivated');
```

That extra read is deliberate. A JWT is a snapshot: if an admin demotes a manager or
disables an account, a token minted a minute earlier still carries `role: "manager"`
and still verifies. Without the re-read, the demotion would not take effect until the
token expired. This costs one indexed lookup and closes a window that is otherwise as
long as the token TTL.

Two mechanisms back it up:

- **`token_version`** on the user row is embedded in every refresh token. Logging
  out, changing a password, changing a role or disabling an account increments it,
  which invalidates every refresh token already in circulation even though their
  signatures remain valid.
- **Access tokens are short-lived (15 min) and held in memory only.** The durable
  credential is an httpOnly, `sameSite` cookie scoped to `/api/auth`, so an XSS payload
  cannot read either one.

---

## Layer 2 — the role gate (`authorize`)

A cheap, declarative filter applied in the router:

```js
employeeRoutes.post('/', authorize('admin'), validate({ body: v.employee.create }), employees.create);
attendanceRoutes.put('/', authorize('admin', 'manager'), …, attendance.upsert);
```

This is sufficient on its own only for routes that address no particular record — the
whole class of user is either allowed or not. On every route with an `:id`, it is
necessary but nowhere near sufficient.

One consequence worth naming: `POST /auth/register` ignores any `role` in the request
body and hard-codes `employee`. Elevated roles come from `POST /users`, which itself
sits behind `authorize('admin')`. If self-registration honoured the submitted role,
every other check in the system would be decorative.

---

## Layer 3 — record-level scope (`services/scopeService.js`)

This is the layer that does the real work. It answers one question — *which employees
can this principal see?* — and everything else is derived from the answer.

A manager owns their whole reporting sub-tree, not just direct reports, so the check
has to walk a self-referencing edge. Postgres does that with a recursive CTE, wrapped
in a function so every caller gets the identical rule:

```sql
create or replace function subordinate_ids(root uuid, max_depth integer default 10)
returns table (id uuid)
language sql stable
set search_path = public, pg_temp
as $$
  with recursive tree as (
    select e.id, 0 as depth
    from employees e
    where e.id = root and e.deleted_at is null
  union all
    select e.id, t.depth + 1
    from employees e
    join tree t on e.manager_id = t.id
    where e.deleted_at is null and t.depth < max_depth
  )
  select tree.id from tree;
$$;
```

The alternative — recursing from the application with one query per level — turns a
single request into N round trips and gets slower as the org grows. Keeping the
traversal in the database means one round trip regardless of depth.

Two details are load-bearing. `deleted_at is null` appears in *both* arms, so a
soft-deleted manager cannot drag their sub-tree back into scope. And `search_path` is
pinned, so the function cannot be tricked into resolving `employees` to another table
by a caller-controlled path.

> This project previously ran on MongoDB, where the same traversal was a `$graphLookup`
> stage. The rule did not change; only its expression did.

That produces the single source of truth:

```js
async function visibleEmployeeIds(user) {
  if (user.role === 'admin')   return null;                    // null = unrestricted
  if (user.role === 'manager') return getSubordinateIds(user.employee);
  return user.employee ? [user.employee] : [];                 // employee: just themselves
}
```

`null` meaning "no restriction" is a small but important distinction from `[]`, which
means "restricted to nothing" — conflating the two would silently grant an unlinked
account full visibility.

Three things consume that scope:

**1. List queries** intersect it with whatever the caller asked for, so a hostile query
string cannot widen the result set:

```js
const visible = await scopeService.visibleEmployeeIds(req.user);

db`where e.deleted_at is null
   ${visible === null ? db`` : db`and e.id = any(${visible}::uuid[])`}
   ${q.department ? db`and e.department_id = ${q.department}` : db``}`;
```

Each fragment is `and`-ed on, so a filter the caller supplies can only ever narrow the
result set, never widen it.

**2. Single-record routes** run `canAccessEmployee` before the controller:

```js
employeeRoutes.get('/:id', validate({ params: v.idParam }), canAccessEmployee('id'), employees.getOne);
```

This is what makes URL-guessing pointless. The link is not in the manager's UI, but the
reason they cannot open it is that the server refuses the id.

**3. Aggregations** apply it inside the `WHERE` clause, not as a post-filter:

```js
const scoped = (ids, column) =>
  ids === null ? db`` : db`and ${db.unsafe(column)} = any(${ids}::uuid[])`;

db`select coalesce(d.name, 'Unassigned') as department, count(*)::int as headcount
   from employees e
   left join departments d on d.id = e.department_id
   where e.deleted_at is null ${scoped(scopeIds, 'e.id')}
   group by d.name`;
```

`GET /dashboard` is therefore the same endpoint for both roles and returns genuinely
different numbers: an admin sees the organisation's headcount, a manager sees their
team's. Filtering after aggregation would have been both slower and wrong — the
manager would have received org-wide totals and then had them subtracted client-side.

---

## Narrower rights than visibility

Being able to *see* a record is not the same as being able to *act* on it, so approval
has its own predicate:

```js
async function canApproveFor(user, employeeId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  if (String(user.employee) === String(employeeId)) return false;   // never yourself
  const ids = await getSubordinateIds(user.employee, { includeSelf: false });
  return ids.some((id) => String(id) === String(employeeId));
}
```

The self-exclusion is the point. A manager appears in their own visibility scope
(they need to see their own record and their own leave), but a system that lets someone
approve their own time off has no approval control at all. The same predicate guards
performance reviews, which is how self-reviews are refused, and attendance corrections
are blocked for a manager's own record for the same reason.

---

## Field-level redaction

Scope is a row-level decision; some columns need their own rule. A manager legitimately
sees their report's job title, department and attendance — but not their pay.

```js
const SENSITIVE_FIELDS = ['salary'];

function redactEmployee(doc, user) {
  const plain = /* … */;
  const isSelfRecord = user.employee && String(plain._id) === String(user.employee);
  if (user.role !== 'admin' && !isSelfRecord) {
    SENSITIVE_FIELDS.forEach((field) => delete plain[field]);
  }
  return plain;
}
```

Redaction happens on the way out of the controller, so it covers the list endpoint, the
detail endpoint and the CSV export from one definition. The export builds its column
list from the same rule — a manager's CSV has no `Salary` header at all, rather than a
blank column.

Writes get the mirror treatment: `PATCH /employees/:id` intersects the submitted keys
with a per-role allow-list, drops the rest, and reports them back as `ignoredFields`.
A manager who posts `{ jobTitle, salary }` gets the title change and a note that salary
was ignored. The client form shows the same subset — but the form is a convenience, and
the allow-list is the enforcement.

---

## Where the workflow rules live

Authorization says *who may act*. The leave state machine says *what act is legal*, and
it lives on the model rather than in the controller:

```js
const LEAVE_TRANSITIONS = {
  pending:   ['approved', 'rejected', 'cancelled'],
  approved:  ['cancelled'],
  rejected:  [],
  cancelled: [],
};

function assertTransition(from, to) {
  if (!(LEAVE_TRANSITIONS[from] || []).includes(to)) {
    throw ApiError.conflict(`Cannot move a ${from} request to ${to}`);
  }
}
```

Because the table is data rather than scattered `if` statements, a second approval of
an already-approved request is a `409` no matter which route reaches it, and every
transition appends a row to `leave_request_history` — so the record carries its own
explanation of how it reached its current state.

The side effects of an approval — the status change, the balance deduction and the
`on_leave` attendance markers — run inside one transaction. On the document database
these were three separate writes that could partially fail; here they cannot.

---

## The audit trail

Every mutating action writes an append-only row: actor, role, action, entity, a
before/after diff, IP, user agent and outcome. Refusals are recorded too:

```js
const canApprove = await scopeService.canApproveFor(req.user, request.employee);
if (!canApprove) {
  await audit.record(req, { action: `leave.${decision}`, entity: 'LeaveRequest',
                            entityId: request._id, outcome: 'denied' });
  throw ApiError.forbidden('Only an admin or the reporting manager can decide this request');
}
```

Logging the denial matters more than logging the success — a run of `denied` rows from
one account is what an attempted privilege escalation looks like from the inside.

Audit writes are deliberately fire-and-forget: a trail failure logs loudly but never
turns a completed HR action into a 500. Nothing in the app updates or deletes these
rows; a TTL index expires them after two years.

---

## Deletion preserves history

`DELETE /employees/:id` does not delete. It sets `deletedAt`, marks the employee
terminated, disables the linked login, and re-points their direct reports at their own
manager so the tree stays connected. Attendance records, leave history and performance
reviews all keep their foreign keys, which is what makes them still queryable in a
report a year later. A hard delete would either orphan those documents or force a
cascade that destroys the very history the system exists to hold.

---

## Proving it

The claims above are executable. `server/tests/` makes the forbidden requests directly,
with no browser in the way:

| Test | Asserts |
|---|---|
| `blocks a manager reading an employee outside their tree by id` | Layer 3 rejects a guessed URL |
| `lets a manager read an indirect report two levels down` | The recursive CTE covers the whole sub-tree, not just direct reports |
| `hides salary from a manager but shows it to the employee and to admins` | Field-level redaction |
| `ignores fields the caller is not allowed to write` | Write allow-list |
| `refuses self-approval even for a manager` | Approval is narrower than visibility |
| `refuses a manager acting on another manager's report` | Approval scope |
| `refuses to decide an already-decided request` | State machine returns 409 |
| `releases the balance when an approved request is cancelled` | Compensating side effects |
| `counts only the manager team, and the whole org for an admin` | Scope inside the aggregation |
| `revokes live sessions when the account is deactivated` | Layer 1 re-read + `token_version` |
| `rejects a manager reassignment that would create a cycle` | Tree integrity |
| `strips operator-style keys from the request body` | `{"email": {"$ne": null}}` cannot bypass login |

```bash
cd server && DATABASE_URL_TEST=postgresql://... npm test
```

The suite runs against a real Postgres rather than an in-memory stand-in — the rules
above are recursive CTEs and table constraints, so a fake would be testing something
other than what ships.

---

## Honest limitations

Worth stating plainly rather than being caught out by:

- **Roles are fixed, not a permission matrix.** Three hard-coded roles cover this
  domain. A real HR product would eventually want per-permission grants
  (`leave.approve`, `salary.read`) assigned to roles, so that "a manager who may see pay
  bands" does not require a new role in an enum.
- **`max_depth` defaults to 10 in `subordinate_ids()`.** Deep enough for any realistic
  org, but it is a cap, and an eleventh level would silently fall out of scope.
- **Scope is recomputed per request.** Correct, and it means a re-org takes effect
  immediately, but it is an aggregation on every scoped call. At real scale it would
  want caching keyed on the employee id with invalidation on manager changes.
- **The audit diff is shallow.** Nested values are compared whole, so the diff records
  that something changed rather than which element.
- **Authorization lives entirely in the API, not in the database.** Row-level security is
  enabled on every table with no policies, which closes Supabase's PostgREST endpoint —
  but it is a wall, not a rule engine. A second service connecting directly with the
  owner role would bypass every check in this document. Expressing the scope rules as
  RLS policies would push them down to the data, at the cost of duplicating logic that
  currently has one home.
