'use strict';
/** Attendance check-in/out rules, manual overrides and the monthly aggregation. */
const { connect, close, clear, requireDatabase, getDb } = require('./setup');
const { makeUser, as } = require('./factories');
const { dayjs } = require('../utils/dates');
const { markMissingAsAbsent } = require('../jobs');

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

const todayAt = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return dayjs.utc().startOf('day').hour(h).minute(m).toISOString();
};

describeDb('check-in and check-out', () => {
  it('marks an early arrival present and a late one late', async () => {
    const early = await makeUser({ role: 'employee' });
    const late = await makeUser({ role: 'employee' });

    const a = await as(early.token).post('/api/attendance/check-in').send({ at: todayAt('08:45') });
    expect(a.status).toBe(201);
    expect(a.body.data.status).toBe('present');

    const b = await as(late.token).post('/api/attendance/check-in').send({ at: todayAt('10:05') });
    expect(b.body.data.status).toBe('late');
  });

  it('refuses a second check-in on the same day', async () => {
    const { token } = await makeUser({ role: 'employee' });
    await as(token).post('/api/attendance/check-in').send({ at: todayAt('09:00') }).expect(201);
    const res = await as(token).post('/api/attendance/check-in').send({ at: todayAt('09:30') });
    expect(res.status).toBe(409);
  });

  it('computes worked minutes on check-out', async () => {
    const { token } = await makeUser({ role: 'employee' });
    await as(token).post('/api/attendance/check-in').send({ at: todayAt('09:00') }).expect(201);

    const res = await as(token).post('/api/attendance/check-out').send({ at: todayAt('17:30') });
    expect(res.status).toBe(200);
    expect(res.body.data.workedMinutes).toBe(510);
  });

  it('downgrades a very short day to half_day', async () => {
    const { token } = await makeUser({ role: 'employee' });
    await as(token).post('/api/attendance/check-in').send({ at: todayAt('09:00') }).expect(201);
    const res = await as(token).post('/api/attendance/check-out').send({ at: todayAt('11:30') });
    expect(res.body.data.status).toBe('half_day');
  });

  it('refuses a check-out with no check-in', async () => {
    const { token } = await makeUser({ role: 'employee' });
    const res = await as(token).post('/api/attendance/check-out').send({ at: todayAt('17:00') });
    expect(res.status).toBe(400);
  });
});

describeDb('manual corrections', () => {
  it('lets a manager correct a report record but not their own', async () => {
    const manager = await makeUser({ role: 'manager' });
    const report = await makeUser({ role: 'employee', manager: manager.employee._id });

    const ok = await as(manager.token).put('/api/attendance').send({
      employee: String(report.employee._id),
      date: dayjs.utc().format('YYYY-MM-DD'),
      status: 'present',
      checkIn: todayAt('09:00'),
      checkOut: todayAt('18:00'),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.workedMinutes).toBe(540);

    const self = await as(manager.token).put('/api/attendance').send({
      employee: String(manager.employee._id),
      date: dayjs.utc().format('YYYY-MM-DD'),
      status: 'present',
    });
    expect(self.status).toBe(403);
  });

  it('blocks a manager correcting someone outside their tree', async () => {
    const manager = await makeUser({ role: 'manager' });
    const outsider = await makeUser({ role: 'employee' });

    const res = await as(manager.token).put('/api/attendance').send({
      employee: String(outsider.employee._id),
      date: dayjs.utc().format('YYYY-MM-DD'),
      status: 'present',
    });
    expect(res.status).toBe(403);
  });

  it('blocks an employee from hand-editing attendance', async () => {
    const { token, employee } = await makeUser({ role: 'employee' });
    const res = await as(token).put('/api/attendance').send({
      employee: String(employee._id),
      date: dayjs.utc().format('YYYY-MM-DD'),
      status: 'present',
    });
    expect(res.status).toBe(403);
  });

  it('upserts rather than duplicating a corrected day', async () => {
    const admin = await makeUser({ role: 'admin' });
    const employee = await makeUser({ role: 'employee' });
    const date = dayjs.utc().format('YYYY-MM-DD');

    await as(admin.token)
      .put('/api/attendance')
      .send({ employee: String(employee.employee._id), date, status: 'absent' })
      .expect(200);
    await as(admin.token)
      .put('/api/attendance')
      .send({ employee: String(employee.employee._id), date, status: 'present' })
      .expect(200);

    const [{ count }] = await getDb()`
      select count(*)::int from attendance where employee_id = ${employee.employee._id}`;
    expect(count).toBe(1);
  });
});

describeDb('calendar and summary', () => {
  it('returns a full month of cells with weekends filled in', async () => {
    const { token } = await makeUser({ role: 'employee' });
    const month = dayjs.utc().format('YYYY-MM');

    const res = await as(token).get(`/api/attendance/calendar?month=${month}`);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toHaveLength(dayjs.utc().daysInMonth());
    expect(res.body.data.days.some((d) => d.status === 'weekend')).toBe(true);
  });

  it('aggregates a monthly attendance rate', async () => {
    const admin = await makeUser({ role: 'admin' });
    const employee = await makeUser({ role: 'employee' });

    // Four present days and one absent inside the current month.
    const base = dayjs.utc().startOf('month');
    const dates = [0, 1, 2, 3, 4].map((i) => base.add(i, 'day').format('YYYY-MM-DD'));
    await getDb()`
      insert into attendance (employee_id, date, status, worked_minutes)
      select ${employee.employee._id}, d::date,
             case when d::date = ${dates[4]}::date then 'absent' else 'present' end::attendance_status,
             case when d::date = ${dates[4]}::date then 0 else 480 end
      from unnest(${dates}::date[]) as d`;

    const res = await as(admin.token).get(
      `/api/attendance/summary?employee=${employee.employee._id}&month=${base.format('YYYY-MM')}`
    );
    expect(res.status).toBe(200);
    expect(res.body.data.workingDays).toBe(5);
    expect(res.body.data.presentDays).toBe(4);
    expect(res.body.data.rate).toBe(80);
  });

  it('stops an employee reading a colleague calendar', async () => {
    const a = await makeUser({ role: 'employee' });
    const b = await makeUser({ role: 'employee' });
    const res = await as(a.token).get(`/api/attendance/calendar?employee=${b.employee._id}`);
    expect(res.status).toBe(403);
  });
});

describeDb('the auto-absent job', () => {
  it('marks employees with no record absent, and leaves existing rows alone', async () => {
    const present = await makeUser({ role: 'employee' });
    await makeUser({ role: 'employee' });
    await makeUser({ role: 'employee' });

    // Pick a weekday that is definitely not a weekend or a seeded holiday.
    let target = dayjs.utc().subtract(1, 'day');
    while ([0, 6].includes(target.day())) target = target.subtract(1, 'day');

    await getDb()`
      insert into attendance (employee_id, date, status, worked_minutes)
      values (${present.employee._id}, ${target.format('YYYY-MM-DD')}, 'present', 480)`;

    const result = await markMissingAsAbsent(target.toDate());
    expect(result.absent).toBe(2);

    const [stillPresent] = await getDb()`
      select status from attendance
      where employee_id = ${present.employee._id} and date = ${target.format('YYYY-MM-DD')}`;
    expect(stillPresent.status).toBe('present');
  });

  it('skips weekends', async () => {
    await makeUser({ role: 'employee' });
    const saturday = dayjs.utc().startOf('isoWeek').add(5, 'day'); // Sat of this ISO week
    const result = await markMissingAsAbsent(saturday.toDate());
    expect(result.skipped).toBe('weekend');
  });
});
