'use strict';
/**
 * Seeds a demo organisation: departments, policies, holidays, a three-level
 * reporting tree, three months of attendance, leave requests in every state and
 * a round of performance reviews.
 *
 *   npm run seed            # wipes the collections first
 *   npm run seed -- --keep  # adds to whatever is already there
 */
const mongoose = require('mongoose');
const { connectDB, disconnectDB } = require('../config/db');
const {
  User,
  Employee,
  Department,
  Attendance,
  LeaveRequest,
  PerformanceReview,
  Holiday,
  LeavePolicy,
  Notification,
  AuditLog,
} = require('../models');
const logger = require('./logger');
const { startOfDay, isWeekend, eachDay, dayjs } = require('./dates');

const DEMO_PASSWORD = 'Password@123';

const DEPARTMENTS = [
  { name: 'Engineering', code: 'ENG', description: 'Product engineering and platform', costCenter: 'CC-100' },
  { name: 'People Operations', code: 'HR', description: 'Hiring, culture and HR services', costCenter: 'CC-200' },
  { name: 'Finance', code: 'FIN', description: 'Accounting, payroll and planning', costCenter: 'CC-300' },
  { name: 'Sales', code: 'SLS', description: 'Revenue and account management', costCenter: 'CC-400' },
  { name: 'Design', code: 'DSG', description: 'Product and brand design', costCenter: 'CC-500' },
];

const POLICIES = [
  { type: 'annual', label: 'Annual Leave', annualQuota: 24, maxCarryForward: 6, maxConsecutiveDays: 15, minNoticeDays: 3 },
  { type: 'sick', label: 'Sick Leave', annualQuota: 12, maxConsecutiveDays: 7, minNoticeDays: 0 },
  { type: 'casual', label: 'Casual Leave', annualQuota: 8, maxConsecutiveDays: 3, minNoticeDays: 1 },
  { type: 'unpaid', label: 'Unpaid Leave', annualQuota: 0, accrues: false, isPaid: false, maxConsecutiveDays: 30, minNoticeDays: 7 },
  { type: 'maternity', label: 'Maternity Leave', annualQuota: 90, accrues: false, maxConsecutiveDays: 90, minNoticeDays: 30 },
  { type: 'paternity', label: 'Paternity Leave', annualQuota: 10, accrues: false, maxConsecutiveDays: 10, minNoticeDays: 14 },
  { type: 'bereavement', label: 'Bereavement Leave', annualQuota: 5, accrues: false, maxConsecutiveDays: 5, minNoticeDays: 0 },
];

const year = dayjs.utc().year();
const HOLIDAYS = [
  { name: "New Year's Day", date: `${year}-01-01` },
  { name: 'Spring Public Holiday', date: `${year}-04-03` },
  { name: 'Labour Day', date: `${year}-05-01` },
  { name: 'Independence Day', date: `${year}-08-15` },
  { name: 'Founders Day', date: `${year}-10-02` },
  { name: 'Winter Holiday', date: `${year}-12-25` },
];

/* firstName, lastName, title, deptCode, managerIndex (null = top), role, salary */
const PEOPLE = [
  ['Aditi', 'Rao', 'Chief Executive Officer', 'HR', null, 'admin', 320000],
  ['Marcus', 'Bell', 'VP of Engineering', 'ENG', 0, 'manager', 245000],
  ['Priya', 'Nair', 'Head of People', 'HR', 0, 'manager', 190000],
  ['Daniel', 'Okafor', 'Finance Director', 'FIN', 0, 'manager', 205000],
  ['Sofia', 'Ramirez', 'Engineering Manager', 'ENG', 1, 'manager', 178000],
  ['Wei', 'Chen', 'Senior Backend Engineer', 'ENG', 4, 'employee', 152000],
  ['Liam', 'Murphy', 'Backend Engineer', 'ENG', 4, 'employee', 118000],
  ['Hana', 'Sato', 'Frontend Engineer', 'ENG', 4, 'employee', 121000],
  ['Omar', 'Haddad', 'QA Engineer', 'ENG', 4, 'employee', 98000],
  ['Elena', 'Novak', 'Platform Engineer', 'ENG', 1, 'employee', 143000],
  ['Grace', 'Adeyemi', 'HR Business Partner', 'HR', 2, 'employee', 96000],
  ['Tom', 'Baker', 'Recruiter', 'HR', 2, 'employee', 82000],
  ['Ines', 'Costa', 'Financial Analyst', 'FIN', 3, 'employee', 94000],
  ['Raj', 'Menon', 'Payroll Specialist', 'FIN', 3, 'employee', 79000],
  ['Nadia', 'Petrov', 'Sales Director', 'SLS', 0, 'manager', 186000],
  ['Chris', 'Doyle', 'Account Executive', 'SLS', 14, 'employee', 104000],
  ['Yuki', 'Tanaka', 'Account Executive', 'SLS', 14, 'employee', 101000],
  ['Aisha', 'Bello', 'Design Lead', 'DSG', 0, 'manager', 165000],
  ['Felix', 'Warren', 'Product Designer', 'DSG', 17, 'employee', 112000],
  ['Maya', 'Iyer', 'UX Researcher', 'DSG', 17, 'employee', 108000],
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const chance = (p) => Math.random() < p;

async function wipe() {
  await Promise.all([
    User.deleteMany({}),
    Employee.deleteMany({}),
    Department.deleteMany({}),
    Attendance.deleteMany({}),
    LeaveRequest.deleteMany({}),
    PerformanceReview.deleteMany({}),
    Holiday.deleteMany({}),
    LeavePolicy.deleteMany({}),
    Notification.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  logger.info('Cleared existing collections');
}

async function seedAttendance(employees, holidays) {
  const holidayKeys = new Set(holidays.map((h) => dayjs.utc(h.date).format('YYYY-MM-DD')));
  const from = dayjs.utc().subtract(3, 'month').startOf('month').toDate();
  const to = dayjs.utc().subtract(1, 'day').toDate();
  const days = eachDay(from, to).filter(
    (d) => !isWeekend(d) && !holidayKeys.has(dayjs.utc(d).format('YYYY-MM-DD'))
  );

  const rows = [];
  for (const employee of employees) {
    for (const date of days) {
      if (dayjs.utc(date).isBefore(dayjs.utc(employee.hireDate))) continue;

      // ~4% absent, ~12% late, the rest present.
      const roll = Math.random();
      const status = roll < 0.04 ? 'absent' : roll < 0.16 ? 'late' : 'present';

      if (status === 'absent') {
        rows.push({ employee: employee._id, date, status, source: 'system', workedMinutes: 0 });
        continue;
      }

      const startHour = status === 'late' ? 9 : 8;
      const startMinute = status === 'late' ? 25 + Math.floor(Math.random() * 50) : 30 + Math.floor(Math.random() * 40);
      const checkIn = dayjs.utc(date).hour(startHour).minute(startMinute).toDate();
      const checkOut = dayjs.utc(checkIn).add(8, 'hour').add(Math.floor(Math.random() * 70), 'minute').toDate();

      rows.push({
        employee: employee._id,
        date,
        status,
        checkIn,
        checkOut,
        workedMinutes: Math.round((checkOut - checkIn) / 60000),
        source: 'self',
      });
    }
  }

  await Attendance.insertMany(rows, { ordered: false });
  return rows.length;
}

async function seedLeave(employees, admin) {
  const types = ['annual', 'sick', 'casual'];
  const reasons = [
    'Family function out of town',
    'Medical appointment and recovery',
    'Personal errands',
    'Short vacation with family',
    'Recovering from flu',
    'Moving apartments',
  ];

  const requests = [];
  for (const employee of employees) {
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i += 1) {
      const offset = Math.floor(Math.random() * 90) - 45; // past and future
      let start = dayjs.utc().add(offset, 'day').startOf('day');
      while (isWeekend(start.toDate())) start = start.add(1, 'day');
      let end = start.add(Math.floor(Math.random() * 3), 'day');
      while (isWeekend(end.toDate())) end = end.add(1, 'day');

      const days = eachDay(start.toDate(), end.toDate()).filter((d) => !isWeekend(d)).length;
      if (!days) continue;

      // Future requests stay pending; past ones are already decided.
      const isFuture = start.isAfter(dayjs.utc());
      const status = isFuture ? (chance(0.6) ? 'pending' : 'approved') : chance(0.8) ? 'approved' : 'rejected';

      requests.push({
        employee: employee._id,
        type: pick(types),
        startDate: start.toDate(),
        endDate: end.toDate(),
        days,
        reason: pick(reasons),
        status,
        approvedBy: status === 'pending' ? undefined : admin._id,
        decidedAt: status === 'pending' ? undefined : start.subtract(2, 'day').toDate(),
        history: [{ from: null, to: 'pending', at: start.subtract(5, 'day').toDate() }].concat(
          status === 'pending' ? [] : [{ from: 'pending', to: status, by: admin._id, at: start.subtract(2, 'day').toDate() }]
        ),
      });
    }
  }

  // Overlaps would violate the business rules the API enforces, so drop them here too.
  const seen = new Map();
  const clean = requests.filter((r) => {
    const key = String(r.employee);
    const ranges = seen.get(key) || [];
    if (ranges.some(([s, e]) => r.startDate <= e && r.endDate >= s)) return false;
    ranges.push([r.startDate, r.endDate]);
    seen.set(key, ranges);
    return true;
  });

  const created = await LeaveRequest.insertMany(clean, { ordered: false });

  // Reflect approved days in the balances so the UI numbers add up.
  for (const request of created.filter((r) => r.status === 'approved')) {
    await Employee.updateOne(
      { _id: request.employee, 'leaveBalances.type': request.type },
      { $inc: { 'leaveBalances.$.used': request.days } }
    );
  }

  return created.length;
}

async function seedReviews(employees, byManager) {
  const strengths = [
    'Consistently ships ahead of schedule and unblocks others.',
    'Excellent technical judgement; raises the quality bar in reviews.',
    'Strong ownership — follows problems through to the root cause.',
    'Communicates trade-offs clearly to non-technical stakeholders.',
  ];
  const improvements = [
    'Could delegate more instead of absorbing every task personally.',
    'Written design docs would help the wider team follow decisions.',
    'Spread knowledge earlier to reduce single points of failure.',
    'Push back sooner when scope grows mid-sprint.',
  ];
  const competencies = ['delivery', 'quality', 'collaboration', 'ownership', 'communication'];

  const now = dayjs.utc();
  const periods = [
    { year: now.subtract(6, 'month').year(), quarter: now.subtract(6, 'month').quarter() },
    { year: now.subtract(3, 'month').year(), quarter: now.subtract(3, 'month').quarter() },
  ];

  const rows = [];
  for (const employee of employees) {
    const reviewerId = byManager.get(String(employee._id));
    if (!reviewerId) continue;
    for (const period of periods) {
      rows.push({
        employee: employee._id,
        reviewer: reviewerId,
        period,
        scores: competencies.map((competency) => ({
          competency,
          score: 3 + Math.round(Math.random() * 2),
        })),
        rating: 4,
        strengths: pick(strengths),
        improvements: pick(improvements),
        comments: 'Solid contribution this period. Goals carried into the next quarter.',
        goals: ['Lead one cross-team initiative', 'Mentor a junior teammate'],
        status: chance(0.5) ? 'acknowledged' : 'submitted',
        submittedAt: now.subtract(1, 'month').toDate(),
        acknowledgedAt: chance(0.5) ? now.subtract(3, 'week').toDate() : undefined,
      });
    }
  }

  // The pre-save hook recomputes rating from scores, so save individually.
  let created = 0;
  for (const row of rows) {
    try {
      await PerformanceReview.create(row);
      created += 1;
    } catch {
      /* duplicate period — skip */
    }
  }
  return created;
}

async function run() {
  const keep = process.argv.includes('--keep');
  await connectDB();
  if (!keep) await wipe();

  const departments = await Department.insertMany(DEPARTMENTS);
  const deptByCode = new Map(departments.map((d) => [d.code, d._id]));
  logger.info(`Seeded ${departments.length} departments`);

  const policies = await LeavePolicy.insertMany(POLICIES);
  await Holiday.insertMany(HOLIDAYS.map((h) => ({ ...h, date: startOfDay(h.date) })));
  logger.info(`Seeded ${policies.length} leave policies and ${HOLIDAYS.length} holidays`);

  // Employees first with no manager, then wire the tree once every id exists.
  const employees = [];
  for (let i = 0; i < PEOPLE.length; i += 1) {
    const [firstName, lastName, jobTitle, deptCode, , , salary] = PEOPLE[i];
    const employee = await Employee.create({
      employeeCode: `EMP-${String(i + 1).padStart(4, '0')}`,
      firstName,
      lastName,
      workEmail: `${firstName}.${lastName}`.toLowerCase() + '@empcore.dev',
      phone: `+1-555-${String(1000 + i).padStart(4, '0')}`,
      department: deptByCode.get(deptCode),
      jobTitle,
      hireDate: dayjs.utc().subtract(6 + Math.floor(Math.random() * 60), 'month').toDate(),
      employmentType: 'full_time',
      status: 'active',
      salary,
      location: pick(['Bengaluru', 'London', 'Austin', 'Remote']),
      leaveBalances: policies.map((p) => ({
        type: p.type,
        entitled: p.annualQuota,
        used: 0,
        carriedForward: p.type === 'annual' ? Math.floor(Math.random() * 4) : 0,
      })),
    });
    employees.push(employee);
  }

  for (let i = 0; i < PEOPLE.length; i += 1) {
    const managerIndex = PEOPLE[i][4];
    if (managerIndex !== null) {
      employees[i].manager = employees[managerIndex]._id;
      await employees[i].save();
    }
  }
  logger.info(`Seeded ${employees.length} employees`);

  // Department heads.
  await Promise.all([
    Department.updateOne({ code: 'ENG' }, { manager: employees[1]._id }),
    Department.updateOne({ code: 'HR' }, { manager: employees[2]._id }),
    Department.updateOne({ code: 'FIN' }, { manager: employees[3]._id }),
    Department.updateOne({ code: 'SLS' }, { manager: employees[14]._id }),
    Department.updateOne({ code: 'DSG' }, { manager: employees[17]._id }),
  ]);

  // Login accounts.
  for (let i = 0; i < PEOPLE.length; i += 1) {
    const role = PEOPLE[i][5];
    const user = new User({ email: employees[i].workEmail, role, employee: employees[i]._id });
    await user.setPassword(DEMO_PASSWORD);
    await user.save();
  }
  const adminUser = await User.findOne({ role: 'admin' });
  logger.info(`Seeded ${PEOPLE.length} login accounts`);

  const attendanceRows = await seedAttendance(employees, HOLIDAYS.map((h) => ({ date: h.date })));
  logger.info(`Seeded ${attendanceRows} attendance records`);

  const leaveCount = await seedLeave(employees, adminUser);
  logger.info(`Seeded ${leaveCount} leave requests`);

  const managerOf = new Map(
    employees.filter((e) => e.manager).map((e) => [String(e._id), e.manager])
  );
  const reviewCount = await seedReviews(employees, managerOf);
  logger.info(`Seeded ${reviewCount} performance reviews`);

  logger.info('');
  logger.info('=== Demo accounts (password: ' + DEMO_PASSWORD + ') ===');
  logger.info(`  admin    ${employees[0].workEmail}`);
  logger.info(`  manager  ${employees[4].workEmail}   (Engineering Manager, 4 reports)`);
  logger.info(`  employee ${employees[5].workEmail}`);
  logger.info('');

  await disconnectDB();
  await mongoose.disconnect().catch(() => {});
}

run().catch(async (err) => {
  logger.error('Seed failed:', err);
  await disconnectDB().catch(() => {});
  process.exit(1);
});
