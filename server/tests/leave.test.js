'use strict';
/** Covers the leave state machine, its business rules and the approval boundary. */
const { connect, close, clear, requireDatabase, getDb } = require('./setup');
const { makeUser, makePolicies, as } = require('./factories');
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
  if (!hasDb) return;
  await clear();
  await makePolicies();
});

/** Next Monday, so a fixture range never accidentally lands on a weekend. */
const nextMonday = (weeksAhead = 1) =>
  dayjs.utc().add(weeksAhead, 'week').startOf('isoWeek').format('YYYY-MM-DD');

const range = (weeksAhead = 1, lengthDays = 2) => ({
  startDate: nextMonday(weeksAhead),
  endDate: dayjs.utc(nextMonday(weeksAhead)).add(lengthDays - 1, 'day').format('YYYY-MM-DD'),
});

describeDb('creating a request', () => {
  it('counts business days and ignores the weekend', async () => {
    const employee = await makeUser({ role: 'employee' });
    const monday = nextMonday();

    const res = await as(employee.token).post('/api/leave').send({
      type: 'annual',
      startDate: monday,
      endDate: dayjs.utc(monday).add(6, 'day').format('YYYY-MM-DD'), // Mon–Sun
      reason: 'Family holiday out of town',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.days).toBe(5); // Sat + Sun excluded
    expect(res.body.data.status).toBe('pending');
  });

  it('rejects a range that overlaps an existing request', async () => {
    const employee = await makeUser({ role: 'employee' });
    const window = range(2, 3);

    await as(employee.token)
      .post('/api/leave')
      .send({ type: 'annual', ...window, reason: 'First booking' })
      .expect(201);

    const res = await as(employee.token)
      .post('/api/leave')
      .send({ type: 'sick', ...window, reason: 'Clashing booking' });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/overlap/i);
  });

  it('refuses a request larger than the remaining balance', async () => {
    const employee = await makeUser({ role: 'employee' });
    await getDb()`
      update leave_balances set entitled = 1, used = 0
      where employee_id = ${employee.employee._id} and type = 'annual'`;

    const res = await as(employee.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(1, 4), reason: 'Long trip abroad' });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/insufficient/i);
  });

  it('stops an employee filing leave for somebody else', async () => {
    const a = await makeUser({ role: 'employee' });
    const b = await makeUser({ role: 'employee' });

    const res = await as(a.token).post('/api/leave').send({
      employee: String(b.employee._id),
      type: 'annual',
      ...range(),
      reason: 'Filing on behalf of a colleague',
    });

    expect(res.status).toBe(403);
  });

  it('rejects an end date before the start date', async () => {
    const employee = await makeUser({ role: 'employee' });
    const res = await as(employee.token).post('/api/leave').send({
      type: 'annual',
      startDate: nextMonday(2),
      endDate: nextMonday(1),
      reason: 'Backwards range should fail',
    });
    expect(res.status).toBe(422);
  });
});

describeDb('the approval boundary', () => {
  it('lets the reporting manager approve and consumes the balance', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(report.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(1, 2), reason: 'Two days off for a family event' })
      .expect(201);

    const decided = await as(manager.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'approved', note: 'Enjoy' });

    expect(decided.status).toBe(200);
    expect(decided.body.data.status).toBe('approved');

    const balance = await as(report.token).get('/api/leave/balance');
    const annual = balance.body.data.find((b) => b.type === 'annual');
    expect(annual.used).toBe(2);
    expect(annual.remaining).toBe(22);

    // Approved days are reflected in attendance so the report does not read them as absences.
    const [{ count: marked }] = await getDb()`
      select count(*)::int from attendance
      where employee_id = ${report.employee._id} and status = 'on_leave'`;
    expect(marked).toBe(2);
  });

  it("refuses a manager acting on another manager's report", async () => {
    const managerA = await makeUser({ role: 'manager' });
    const managerB = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: managerA.employee._id });

    const created = await as(report.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(), reason: 'Out of scope for manager B' })
      .expect(201);

    const res = await as(managerB.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(403);
  });

  it('refuses self-approval even for a manager', async () => {
    const boss = await makeUser({ role: 'manager' });
    await makeUser({ role: 'employee', manager: boss.employee._id });

    const created = await as(boss.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(), reason: 'Manager taking their own leave' })
      .expect(201);

    const res = await as(boss.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(403);
  });

  it('lets an admin approve anyone', async () => {
    const admin = await makeUser({ role: 'admin' });
    const employee = await makeUser({ role: 'employee' });

    const created = await as(employee.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(), reason: 'Admin override path' })
      .expect(201);

    const res = await as(admin.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'approved' });

    expect(res.status).toBe(200);
  });

  it('shows a manager only their own approval queue', async () => {
    const managerA = await makeUser({ role: 'manager' });
    const managerB = await makeUser({ role: 'manager' });
    const reportA = await makeUser({ role: 'employee', manager: managerA.employee._id });
    const reportB = await makeUser({ role: 'employee', manager: managerB.employee._id });

    await as(reportA.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(1), reason: 'Report A time off' });
    await as(reportB.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(2), reason: 'Report B time off' });

    const queue = await as(managerA.token).get('/api/leave/pending');
    expect(queue.body.data).toHaveLength(1);
    expect(String(queue.body.data[0].employee._id)).toBe(String(reportA.employee._id));
  });
});

describeDb('the state machine', () => {
  it('refuses to decide an already-decided request', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(report.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(), reason: 'Only one decision allowed' })
      .expect(201);

    await as(manager.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'approved' })
      .expect(200);

    const second = await as(manager.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'rejected' });

    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/cannot move/i);
  });

  it('records every transition in the history trail', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(report.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(), reason: 'History should capture both steps' })
      .expect(201);

    await as(manager.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'rejected', note: 'Sprint deadline' })
      .expect(200);

    const detail = await as(report.token).get(`/api/leave/${created.body.data._id}`);
    expect(detail.body.data.history).toHaveLength(2);
    expect(detail.body.data.history[1]).toMatchObject({ from: 'pending', to: 'rejected' });
    expect(detail.body.data.decisionNote).toBe('Sprint deadline');
  });

  it('releases the balance when an approved request is cancelled', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(report.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(1, 2), reason: 'Will be cancelled later' })
      .expect(201);

    await as(manager.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'approved' })
      .expect(200);

    await as(report.token).patch(`/api/leave/${created.body.data._id}/cancel`).send({}).expect(200);

    const balance = await as(report.token).get('/api/leave/balance');
    expect(balance.body.data.find((b) => b.type === 'annual').used).toBe(0);

    const [{ count: marked }] = await getDb()`
      select count(*)::int from attendance
      where employee_id = ${report.employee._id} and status = 'on_leave'`;
    expect(marked).toBe(0);
  });

  it('stops a colleague cancelling someone else request', async () => {
    const a = await makeUser({ role: 'employee' });
    const b = await makeUser({ role: 'employee' });

    const created = await as(a.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(), reason: 'Not yours to cancel' })
      .expect(201);

    const res = await as(b.token).patch(`/api/leave/${created.body.data._id}/cancel`).send({});
    expect(res.status).toBe(403);
  });

  it('leaves a rejected request terminal', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const created = await as(report.token)
      .post('/api/leave')
      .send({ type: 'annual', ...range(), reason: 'Rejected then cancelled' })
      .expect(201);

    await as(manager.token)
      .patch(`/api/leave/${created.body.data._id}/decision`)
      .send({ decision: 'rejected' })
      .expect(200);

    const res = await as(report.token).patch(`/api/leave/${created.body.data._id}/cancel`).send({});
    expect(res.status).toBe(409);

    const [stored] = await getDb()`
      select status from leave_requests where id = ${created.body.data._id}`;
    expect(stored.status).toBe('rejected');
  });
});
