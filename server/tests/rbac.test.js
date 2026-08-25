'use strict';
/**
 * These tests are the executable version of the authorization write-up: they assert
 * that access is decided by the reporting tree on the server, not by what the UI
 * chooses to render.
 */
const { connect, close, clear } = require('./setup');
const { makeUser, makeDepartment, makePolicies, as, request, app } = require('./factories');

beforeAll(connect);
afterAll(close);
beforeEach(clear);

describe('authentication', () => {
  it('rejects a request with no token', async () => {
    const res = await request(app).get('/api/employees');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects a forged token', async () => {
    const res = await request(app).get('/api/employees').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('locks an account after five failed logins', async () => {
    const { employee } = await makeUser({ role: 'employee' });
    for (let i = 0; i < 5; i += 1) {
      await request(app).post('/api/auth/login').send({ email: employee.workEmail, password: 'Wrong@1234' });
    }
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: employee.workEmail, password: 'Password@123' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/locked/i);
  });

  it('revokes live sessions when the account is deactivated', async () => {
    const admin = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'employee' });

    await as(admin.token).patch(`/api/users/${target.user._id}/status`).send({ isActive: false }).expect(200);

    const res = await as(target.token).get('/api/auth/me');
    expect(res.status).toBe(403);
  });
});

describe('role gate (layer 2)', () => {
  it('stops an employee from creating employee records', async () => {
    const { token } = await makeUser({ role: 'employee' });
    const res = await as(token).post('/api/employees').send({
      firstName: 'Ghost',
      lastName: 'Record',
      workEmail: 'ghost@empcore.test',
      jobTitle: 'Intern',
      hireDate: '2026-01-01',
    });
    expect(res.status).toBe(403);
  });

  it('stops a manager from creating employee records', async () => {
    const { token } = await makeUser({ role: 'manager' });
    const res = await as(token).post('/api/employees').send({
      firstName: 'Ghost',
      lastName: 'Record',
      workEmail: 'ghost2@empcore.test',
      jobTitle: 'Intern',
      hireDate: '2026-01-01',
    });
    expect(res.status).toBe(403);
  });

  it('lets an admin create an employee', async () => {
    const { token } = await makeUser({ role: 'admin' });
    const department = await makeDepartment();
    const res = await as(token).post('/api/employees').send({
      firstName: 'New',
      lastName: 'Hire',
      workEmail: 'new.hire@empcore.test',
      jobTitle: 'Engineer',
      hireDate: '2026-02-01',
      department: String(department._id),
    });
    expect(res.status).toBe(201);
    expect(res.body.data.employeeCode).toMatch(/^EMP-\d{4}$/);
  });

  it('refuses self-registration with an elevated role', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'sneaky@empcore.test', password: 'Password@123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.data.user.role).toBe('employee');
  });
});

describe('record-level scope (layer 3)', () => {
  it('limits an employee list to the caller reporting tree', async () => {
    const manager = await makeUser({ role: 'manager' });
    await makeUser({ role: 'employee', manager: manager.employee._id });
    await makeUser({ role: 'employee', manager: manager.employee._id });
    await makeUser({ role: 'employee' }); // someone else's report

    const res = await as(manager.token).get('/api/employees');
    expect(res.status).toBe(200);
    // Two reports plus the manager themselves — the outsider is not visible.
    expect(res.body.data).toHaveLength(3);
  });

  it('blocks a manager reading an employee outside their tree by id', async () => {
    const manager = await makeUser({ role: 'manager' });
    const outsider = await makeUser({ role: 'employee' });

    const res = await as(manager.token).get(`/api/employees/${outsider.employee._id}`);
    expect(res.status).toBe(403);
  });

  it('lets a manager read an indirect report two levels down', async () => {
    const vp = await makeUser({ role: 'manager' });
    const lead = await makeUser({ role: 'manager', manager: vp.employee._id });
    const ic = await makeUser({ role: 'employee', manager: lead.employee._id });

    const res = await as(vp.token).get(`/api/employees/${ic.employee._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe(ic.employee.firstName);
  });

  it('restricts an employee to their own record', async () => {
    const self = await makeUser({ role: 'employee' });
    const other = await makeUser({ role: 'employee' });

    await as(self.token).get(`/api/employees/${self.employee._id}`).expect(200);
    const res = await as(self.token).get(`/api/employees/${other.employee._id}`);
    expect(res.status).toBe(403);
  });
});

describe('field-level redaction', () => {
  it('hides salary from a manager but shows it to the employee and to admins', async () => {
    const admin = await makeUser({ role: 'admin' });
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id, salary: 123456 });

    const asManager = await as(manager.token).get(`/api/employees/${report.employee._id}`);
    expect(asManager.status).toBe(200);
    expect(asManager.body.data.salary).toBeUndefined();

    const asSelf = await as(report.token).get(`/api/employees/${report.employee._id}`);
    expect(asSelf.body.data.salary).toBe(123456);

    const asAdmin = await as(admin.token).get(`/api/employees/${report.employee._id}`);
    expect(asAdmin.body.data.salary).toBe(123456);
  });

  it('ignores fields the caller is not allowed to write', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id, salary: 100000 });

    const res = await as(manager.token)
      .patch(`/api/employees/${report.employee._id}`)
      .send({ jobTitle: 'Senior Engineer', salary: 999999 });

    expect(res.status).toBe(200);
    expect(res.body.ignoredFields).toContain('salary');

    const check = await as(report.token).get(`/api/employees/${report.employee._id}`);
    expect(check.body.data.salary).toBe(100000);
    expect(check.body.data.jobTitle).toBe('Senior Engineer');
  });
});

describe('soft delete', () => {
  it('deactivates instead of deleting and re-points direct reports', async () => {
    const admin = await makeUser({ role: 'admin' });
    const vp = await makeUser({ role: 'manager' });
    const lead = await makeUser({ role: 'manager', manager: vp.employee._id });
    const ic = await makeUser({ role: 'employee', manager: lead.employee._id });

    const res = await as(admin.token).delete(`/api/employees/${lead.employee._id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.reportsReassigned).toBe(1);

    // The IC now reports to the VP, and the departed record still exists.
    const moved = await as(admin.token).get(`/api/employees/${ic.employee._id}`);
    expect(String(moved.body.data.manager._id)).toBe(String(vp.employee._id));

    const archived = await as(admin.token).get(`/api/employees/${lead.employee._id}`);
    expect(archived.status).toBe(200);
    expect(archived.body.data.deletedAt).toBeTruthy();
  });

  it('refuses to let an admin deactivate their own record', async () => {
    const admin = await makeUser({ role: 'admin' });
    const res = await as(admin.token).delete(`/api/employees/${admin.employee._id}`);
    expect(res.status).toBe(400);
  });
});

describe('reporting loops', () => {
  it('rejects a manager reassignment that would create a cycle', async () => {
    const admin = await makeUser({ role: 'admin' });
    const boss = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: boss.employee._id });

    // Making the boss report to their own report would close a loop.
    const res = await as(admin.token)
      .patch(`/api/employees/${boss.employee._id}/manager`)
      .send({ manager: String(report.employee._id) });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/loop/i);
  });
});

describe('search, filter and pagination', () => {
  it('paginates and searches the employee list', async () => {
    const admin = await makeUser({ role: 'admin' });
    await makeUser({ role: 'employee', firstName: 'Zara', lastName: 'Quinn' });
    for (let i = 0; i < 5; i += 1) await makeUser({ role: 'employee' });

    const page = await as(admin.token).get('/api/employees?page=1&limit=3');
    expect(page.body.data).toHaveLength(3);
    expect(page.body.meta.hasNext).toBe(true);
    expect(page.body.meta.total).toBeGreaterThanOrEqual(7);

    const search = await as(admin.token).get('/api/employees?q=Zara');
    expect(search.body.data).toHaveLength(1);
    expect(search.body.data[0].lastName).toBe('Quinn');
  });

  it('treats a regex-special search term as literal text', async () => {
    const admin = await makeUser({ role: 'admin' });
    const res = await as(admin.token).get('/api/employees?q=.*');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});

describe('input hardening', () => {
  it('strips Mongo operators from the request body', async () => {
    await makeUser({ role: 'employee', workEmail: 'victim@empcore.test' });
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(res.status).toBe(422);
  });

  it('rejects a malformed object id', async () => {
    const { token } = await makeUser({ role: 'admin' });
    const res = await as(token).get('/api/employees/not-an-id');
    expect(res.status).toBe(422);
  });
});

describe('dashboard scoping', () => {
  it('counts only the manager team, and the whole org for an admin', async () => {
    await makePolicies();
    const admin = await makeUser({ role: 'admin' });
    const manager = await makeUser({ role: 'manager' });
    await makeUser({ role: 'employee', manager: manager.employee._id });
    await makeUser({ role: 'employee', manager: manager.employee._id });
    await makeUser({ role: 'employee' });

    const managerView = await as(manager.token).get('/api/dashboard');
    expect(managerView.status).toBe(200);
    expect(managerView.body.data.kpis.headcount).toBe(3);
    expect(managerView.body.data.scope).toBe('your team');

    const adminView = await as(admin.token).get('/api/dashboard');
    expect(adminView.body.data.kpis.headcount).toBe(5);
    expect(adminView.body.data.scope).toBe('organisation');
  });

  it('denies the org dashboard to a plain employee', async () => {
    const { token } = await makeUser({ role: 'employee' });
    const res = await as(token).get('/api/dashboard');
    expect(res.status).toBe(403);
  });
});
