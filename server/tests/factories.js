'use strict';
const request = require('supertest');
const app = require('../app');
const { User, Employee, Department, LeavePolicy } = require('../models');

const PASSWORD = 'Password@123';

async function makeDepartment(overrides = {}) {
  return Department.create({ name: 'Engineering', code: 'ENG', ...overrides });
}

async function makePolicies() {
  return LeavePolicy.insertMany([
    { type: 'annual', label: 'Annual Leave', annualQuota: 24, maxConsecutiveDays: 15, minNoticeDays: 0 },
    { type: 'sick', label: 'Sick Leave', annualQuota: 12, maxConsecutiveDays: 7, minNoticeDays: 0 },
    { type: 'unpaid', label: 'Unpaid Leave', annualQuota: 0, isPaid: false, accrues: false, minNoticeDays: 0 },
  ]);
}

let counter = 0;

/** Creates an Employee plus its login account and returns both with an access token. */
async function makeUser({ role = 'employee', manager = null, department = null, ...rest } = {}) {
  counter += 1;
  const employee = await Employee.create({
    employeeCode: `EMP-${String(counter).padStart(4, '0')}`,
    firstName: rest.firstName || `User${counter}`,
    lastName: rest.lastName || 'Test',
    workEmail: rest.workEmail || `user${counter}@empcore.test`,
    jobTitle: rest.jobTitle || 'Engineer',
    hireDate: rest.hireDate || new Date('2023-01-15'),
    salary: rest.salary ?? 100000,
    department,
    manager,
    leaveBalances: [
      { type: 'annual', entitled: 24, used: 0, carriedForward: 0 },
      { type: 'sick', entitled: 12, used: 0, carriedForward: 0 },
    ],
  });

  const user = new User({ email: employee.workEmail, role, employee: employee._id });
  await user.setPassword(PASSWORD);
  await user.save();

  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: employee.workEmail, password: PASSWORD });

  return { employee, user, token: res.body.data.accessToken };
}

const as = (token) => ({
  get: (url) => request(app).get(url).set('Authorization', `Bearer ${token}`),
  post: (url) => request(app).post(url).set('Authorization', `Bearer ${token}`),
  patch: (url) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  put: (url) => request(app).put(url).set('Authorization', `Bearer ${token}`),
  delete: (url) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
});

module.exports = { app, request, makeUser, makeDepartment, makePolicies, as, PASSWORD };
