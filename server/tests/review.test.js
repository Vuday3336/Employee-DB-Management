'use strict';
/** Performance review visibility, the draft/submit/acknowledge cycle and the org chart. */
const { connect, close, clear, requireDatabase, getDb } = require('./setup');
const { makeUser, as } = require('./factories');
const { dayjs } = require('../utils/dates');

const hasDb = requireDatabase();
const describeDb = hasDb ? describe : describe.skip;

beforeAll(async () => {
  if (hasDb) await connect();
});
afterAll(async () => {
  if (hasDb) await close();
});
beforeEach(async () => {
  if (hasDb) await clear();
});

const period = { year: dayjs.utc().year(), quarter: dayjs.utc().quarter() };
const scores = [
  { competency: 'delivery', score: 4 },
  { competency: 'quality', score: 5 },
  { competency: 'collaboration', score: 4 },
];

describeDb('creating reviews', () => {
  it('lets a manager review a direct report and averages the scores', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const res = await as(manager.token).post('/api/reviews').send({
      employee: String(report.employee._id),
      period,
      scores,
      strengths: 'Ships reliably and mentors others.',
      status: 'submitted',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBeCloseTo(4.3, 1);
    expect(res.body.data.status).toBe('submitted');
  });

  it('refuses a manager reviewing someone outside their tree', async () => {
    const manager = await makeUser({ role: 'manager' });
    const outsider = await makeUser({ role: 'employee' });

    const res = await as(manager.token)
      .post('/api/reviews')
      .send({ employee: String(outsider.employee._id), period, scores });

    expect(res.status).toBe(403);
  });

  it('refuses a self-review', async () => {
    const manager = await makeUser({ role: 'manager' });
    const res = await as(manager.token)
      .post('/api/reviews')
      .send({ employee: String(manager.employee._id), period, scores });
    expect(res.status).toBe(403);
  });

  it('refuses an employee creating reviews at all', async () => {
    const a = await makeUser({ role: 'employee' });
    const b = await makeUser({ role: 'employee' });
    const res = await as(a.token)
      .post('/api/reviews')
      .send({ employee: String(b.employee._id), period, scores });
    expect(res.status).toBe(403);
  });

  it('refuses a duplicate review for the same period', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });
    const payload = { employee: String(report.employee._id), period, scores };

    await as(manager.token).post('/api/reviews').send(payload).expect(201);
    const res = await as(manager.token).post('/api/reviews').send(payload);
    expect(res.status).toBe(409);
  });
});

describeDb('draft visibility', () => {
  it('hides a draft from the employee until it is submitted', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(manager.token)
      .post('/api/reviews')
      .send({ employee: String(report.employee._id), period, scores, status: 'draft' })
      .expect(201);

    const hidden = await as(report.token).get(`/api/reviews/${created.body.data._id}`);
    expect(hidden.status).toBe(403);

    const listed = await as(report.token).get('/api/reviews');
    expect(listed.body.data).toHaveLength(0);

    await as(manager.token)
      .patch(`/api/reviews/${created.body.data._id}`)
      .send({ status: 'submitted' })
      .expect(200);

    const visible = await as(report.token).get(`/api/reviews/${created.body.data._id}`);
    expect(visible.status).toBe(200);
  });
});

describeDb('the acknowledge step', () => {
  it('lets only the subject acknowledge, and locks the review afterwards', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });
    const other = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(manager.token)
      .post('/api/reviews')
      .send({ employee: String(report.employee._id), period, scores, status: 'submitted' })
      .expect(201);
    const id = created.body.data._id;

    const wrongPerson = await as(other.token)
      .post(`/api/reviews/${id}/acknowledge`)
      .send({ employeeComment: 'Not mine' });
    expect(wrongPerson.status).toBe(403);

    const ok = await as(report.token)
      .post(`/api/reviews/${id}/acknowledge`)
      .send({ employeeComment: 'Thanks, agreed on the goals.' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('acknowledged');

    // Locked: even the author cannot edit it now.
    const edit = await as(manager.token).patch(`/api/reviews/${id}`).send({ comments: 'Rewriting' });
    expect(edit.status).toBe(409);
  });

  it('refuses to acknowledge a draft', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(manager.token)
      .post('/api/reviews')
      .send({ employee: String(report.employee._id), period, scores, status: 'draft' })
      .expect(201);

    const res = await as(report.token).post(`/api/reviews/${created.body.data._id}/acknowledge`).send({});
    expect(res.status).toBe(409); // the subject is right, but a draft is not acknowledgeable
    expect(res.body.message).toMatch(/draft/i);
  });
});

describeDb('editing and deleting', () => {
  it("stops one manager editing another manager's review", async () => {
    const admin = await makeUser({ role: 'admin' });
    const managerA = await makeUser({ role: 'manager' });
    const managerB = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: managerA.employee._id });

    const created = await as(managerA.token)
      .post('/api/reviews')
      .send({ employee: String(report.employee._id), period, scores, status: 'draft' })
      .expect(201);

    const res = await as(managerB.token)
      .patch(`/api/reviews/${created.body.data._id}`)
      .send({ comments: 'Meddling' });
    expect(res.status).toBe(403);

    // An admin may still step in.
    const override = await as(admin.token)
      .patch(`/api/reviews/${created.body.data._id}`)
      .send({ comments: 'Corrected by HR' });
    expect(override.status).toBe(200);
  });

  it('only allows a draft to be deleted', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(manager.token)
      .post('/api/reviews')
      .send({ employee: String(report.employee._id), period, scores, status: 'submitted' })
      .expect(201);

    const res = await as(manager.token).delete(`/api/reviews/${created.body.data._id}`);
    expect(res.status).toBe(409);
  });
});

describeDb('org chart', () => {
  it('builds a nested tree from the manager edge', async () => {
    const admin = await makeUser({ role: 'admin' }); // root, no manager
    const vp = await makeUser({ role: 'manager', manager: admin.employee._id });
    const lead = await makeUser({ role: 'manager', manager: vp.employee._id });
    await makeUser({ role: 'employee', manager: lead.employee._id });
    await makeUser({ role: 'employee', manager: lead.employee._id });

    const res = await as(admin.token).get('/api/employees/org-chart');
    expect(res.status).toBe(200);

    const root = res.body.data.find((n) => n._id === String(admin.employee._id));
    expect(root.reports).toHaveLength(1);
    expect(root.reports[0].reports[0].reports).toHaveLength(2);
  });

  it('gives a manager only their own sub-tree', async () => {
    const admin = await makeUser({ role: 'admin' });
    const vp = await makeUser({ role: 'manager', manager: admin.employee._id });
    await makeUser({ role: 'employee', manager: vp.employee._id });
    await makeUser({ role: 'employee', manager: admin.employee._id }); // sibling branch

    const res = await as(vp.token).get('/api/employees/org-chart');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]._id).toBe(String(vp.employee._id));
    expect(res.body.data[0].reports).toHaveLength(1);
  });

  it('denies the org chart to a plain employee', async () => {
    const { token } = await makeUser({ role: 'employee' });
    const res = await as(token).get('/api/employees/org-chart');
    expect(res.status).toBe(403);
  });
});
