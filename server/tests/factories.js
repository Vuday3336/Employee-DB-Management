'use strict';
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../app');
const { getDb } = require('./setup');

const PASSWORD = 'Password@123';
// A single pre-computed hash: bcrypt at cost 12 is deliberately slow, and hashing
// it once per fixture would dominate the suite's runtime.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

let counter = 0;

async function makeDepartment(overrides = {}) {
  const db = getDb();
  counter += 1;
  const [row] = await db`
    insert into departments (name, code)
    values (${overrides.name || `Engineering ${counter}`}, ${overrides.code || `EN${counter}`})
    returning *`;
  return { ...row, _id: row.id };
}

async function makePolicies() {
  const db = getDb();
  return db`
    insert into leave_policies (type, label, annual_quota, max_consecutive_days, min_notice_days, is_paid)
    values ('annual', 'Annual Leave', 24, 15, 0, true),
           ('sick',   'Sick Leave',   12,  7, 0, true),
           ('unpaid', 'Unpaid Leave',  0, 30, 0, false)
    on conflict (type) do nothing
    returning *`;
}

/** Creates an employee plus its login account, and returns both with an access token. */
async function makeUser({ role = 'employee', manager = null, department = null, ...rest } = {}) {
  const db = getDb();
  counter += 1;

  const [employee] = await db`
    insert into employees (employee_code, first_name, last_name, work_email, job_title,
                           hire_date, salary, department_id, manager_id)
    values (${`EMP-${String(counter).padStart(4, '0')}`},
            ${rest.firstName || `User${counter}`},
            ${rest.lastName || 'Test'},
            ${rest.workEmail || `user${counter}@empcore.test`},
            ${rest.jobTitle || 'Engineer'},
            ${rest.hireDate || '2023-01-15'},
            ${rest.salary ?? 100000},
            ${department},
            ${manager})
    returning *`;

  await db`
    insert into leave_balances (employee_id, type, entitled, used, carried_forward)
    values (${employee.id}, 'annual', 24, 0, 0), (${employee.id}, 'sick', 12, 0, 0)
    on conflict (employee_id, type) do nothing`;

  const [user] = await db`
    insert into users (email, password_hash, role, employee_id)
    values (${employee.work_email}, ${PASSWORD_HASH}, ${role}, ${employee.id})
    returning *`;

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: employee.work_email, password: PASSWORD });

  if (res.status !== 200) {
    throw new Error(`fixture login failed: ${res.status} ${JSON.stringify(res.body)}`);
  }

  // The API exposes these as `_id` and camelCase, so mirror that on the fixture
  // to keep the assertions reading the same as the responses they check.
  return {
    employee: {
      ...employee,
      _id: employee.id,
      workEmail: employee.work_email,
      firstName: employee.first_name,
      lastName: employee.last_name,
    },
    user: { ...user, _id: user.id },
    token: res.body.data.accessToken,
  };
}

const as = (token) => ({
  get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
  patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  put: (url) => request(app).put(url).set('Authorization', `Bearer ${token}`),
  delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
});

module.exports = { app, request, makeUser, makeDepartment, makePolicies, as, PASSWORD };
