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
const user = await User.findById(payload.sub).lean();
if (!user) throw ApiError.unauthorized('Account no longer exists');
if (!user.isActive) throw ApiError.forbidden('Account is deactivated');
```

That extra read is deliberate. A JWT is a snapshot: if an admin demotes a manager or
disables an account, a token minted a minute earlier still carries `role: "manager"`
and still verifies. Without the re-read, the demotion would not take effect until the
token expired. This costs one indexed lookup and closes a window that is otherwise as
long as the token TTL.

Two mechanisms back it up:

- **`tokenVersion`** on the user document is embedded in every refresh token. Logging
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
has to walk a self-referencing edge. MongoDB does that in one round trip:

```js
// Employee.manager → Employee._id, walked to arbitrary depth
{ $graphLookup: {
    from: 'employees',
    startWith: '$_id',
    connectFromField: '_id',
    connectToField: 'manager',
    as: 'subtree',
    maxDepth: 10,
    restrictSearchWithMatch: { deletedAt: null },
} }
```

The alternative — recursing from the application with one query per level — turns a
single request into N round trips and gets slower as the org grows. `$graphLookup`
keeps the traversal next to the data.

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
if (visible !== null) filter._id = { $in: visible };
if (query.department) filter.department = query.department;   // narrows, never widens
```

**2. Single-record routes** run `canAccessEmployee` before the controller:

```js
employeeRoutes.get('/:id', validate({ params: v.idParam }), canAccessEmployee('id'), employees.getOne);
```

This is what makes URL-guessing pointless. The link is not in the manager's UI, but the
reason they cannot open it is that the server refuses the id.

**3. Aggregations** apply it inside the pipeline's `$match`, not as a post-filter:

```js
const scopeMatch = (ids, field = '_id') => (ids === null ? {} : { [field]: { $in: ids.map(oid) } });

Employee.aggregate([
  { $match: { deletedAt: null, ...scopeMatch(scopeIds) } },
  { $group: { _id: '$department', headcount: { $sum: 1 } } },
]);
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
const TRANSITIONS = {
  pending:   ['approved', 'rejected', 'cancelled'],
  approved:  ['cancelled'],
  rejected:  [],
  cancelled: [],
};

leaveRequestSchema.methods.transition = function (to, { by, note } = {}) {
  if (!this.canTransition(to)) {
    const err = new Error(`Cannot move a ${this.status} request to ${to}`);
    err.statusCode = 409;
    throw err;
  }
  this.history.push({ from: this.status, to, by, note });
  this.status = to;
  // …
};
```

Because the table is data on the schema, a second approval of an already-approved
request is a `409` no matter which route reaches it, and every transition appends to an
immutable `history` array — so the record carries its own explanation of how it reached
its current state.

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
| `lets a manager read an indirect report two levels down` | `$graphLookup` covers the whole sub-tree, not just direct reports |
| `hides salary from a manager but shows it to the employee and to admins` | Field-level redaction |
| `ignores fields the caller is not allowed to write` | Write allow-list |
| `refuses self-approval even for a manager` | Approval is narrower than visibility |
| `refuses a manager acting on another manager's report` | Approval scope |
| `refuses to decide an already-decided request` | State machine returns 409 |
| `releases the balance when an approved request is cancelled` | Compensating side effects |
| `counts only the manager team, and the whole org for an admin` | Scope inside the aggregation |
| `revokes live sessions when the account is deactivated` | Layer 1 re-read + `tokenVersion` |
| `rejects a manager reassignment that would create a cycle` | Tree integrity |
| `strips Mongo operators from the request body` | `{"email": {"$ne": null}}` cannot bypass login |

```bash
cd server && npm test
```

65 tests, run against an in-memory MongoDB — no external database required.

---

## Honest limitations

Worth stating plainly rather than being caught out by:

- **Roles are fixed, not a permission matrix.** Three hard-coded roles cover this
  domain. A real HR product would eventually want per-permission grants
  (`leave.approve`, `salary.read`) assigned to roles, so that "a manager who may see pay
  bands" does not require a new role in an enum.
- **`maxDepth: 10` on the graph traversal.** Deep enough for any realistic org, but it
  is a cap, and an eleventh level would silently fall out of scope.
- **Scope is recomputed per request.** Correct, and it means a re-org takes effect
  immediately, but it is an aggregation on every scoped call. At real scale it would
  want caching keyed on the employee id with invalidation on manager changes.
- **The audit diff is shallow.** Nested arrays such as leave `history` are compared
  whole, so the diff records that the array changed rather than which element was added.
