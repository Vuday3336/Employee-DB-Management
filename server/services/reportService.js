'use strict';
const { db, noFilter } = require('../db');
const { dayjs } = require('../utils/dates');

/**
 * Reporting queries. Every one takes the caller's visible-employee scope and
 * applies it inside the WHERE clause, not as a filter over the results — so a
 * manager's "headcount" is genuinely their team's, computed in the database.
 *
 * `scopeIds === null` means unrestricted (admin).
 */
const scoped = (ids, column) => (ids === null ? noFilter() : db`and ${db.unsafe(column)} = any(${ids}::uuid[])`);

const monthStart = (d) => dayjs.utc(d).startOf('month').format('YYYY-MM-DD');
const monthEnd = (d) => dayjs.utc(d).endOf('month').format('YYYY-MM-DD');

/** Headcount per department, with the average tenure of each team. */
async function headcountByDepartment(scopeIds) {
  return db`
    select
      d.id                                   as "departmentId",
      coalesce(d.name, 'Unassigned')         as "department",
      d.code                                 as "code",
      count(*)::int                          as "headcount",
      round(avg(extract(epoch from (now() - e.hire_date)) / 2629746)::numeric, 1)::float8 as "avgTenureMonths"
    from employees e
    left join departments d on d.id = e.department_id
    where e.deleted_at is null and e.status <> 'terminated'
      ${scoped(scopeIds, 'e.id')}
    group by d.id, d.name, d.code
    order by count(*) desc`;
}

/** Attendance rate for a month: present + late + half-day credit over working days. */
async function attendanceRate(scopeIds, month = new Date()) {
  const [row] = await db`
    select
      count(*)::int                                                              as "total",
      count(*) filter (where a.status in ('present','late'))::int                as "present",
      count(*) filter (where a.status = 'late')::int                             as "late",
      count(*) filter (where a.status = 'absent')::int                           as "absent",
      count(*) filter (where a.status = 'on_leave')::int                         as "onLeave",
      count(*) filter (where a.status = 'half_day')::int                         as "halfDays",
      round((sum(a.worked_minutes)::numeric / greatest(count(*),1) / 60), 1)::float8 as "avgHours",
      round(
        (count(*) filter (where a.status in ('present','late'))
          + 0.5 * count(*) filter (where a.status = 'half_day'))::numeric
        * 100 / greatest(count(*), 1), 1)::float8                                as "rate"
    from attendance a
    where a.date between ${monthStart(month)} and ${monthEnd(month)}
      and a.status not in ('weekend','holiday')
      ${scoped(scopeIds, 'a.employee_id')}`;

  return row?.total
    ? row
    : { total: 0, present: 0, late: 0, absent: 0, onLeave: 0, halfDays: 0, rate: 0, avgHours: 0 };
}

/** Leave grouped by status, plus a by-type breakdown of approved days. */
async function leaveBreakdown(scopeIds) {
  const [byStatus, byType] = await Promise.all([
    db`
      select l.status, count(*)::int as count, sum(l.days)::float8 as days
      from leave_requests l
      where true ${scoped(scopeIds, 'l.employee_id')}
      group by l.status`,
    db`
      select l.type, count(*)::int as count, sum(l.days)::float8 as days
      from leave_requests l
      where l.status = 'approved' ${scoped(scopeIds, 'l.employee_id')}
      group by l.type
      order by sum(l.days) desc`,
  ]);

  const pending = byStatus.find((s) => s.status === 'pending')?.count || 0;
  return { byStatus, byType, pending };
}

/** Monthly attendance trend for the dashboard chart. */
async function attendanceTrend(scopeIds, months = 6) {
  const from = dayjs.utc().subtract(months - 1, 'month').startOf('month').format('YYYY-MM-DD');
  return db`
    select
      to_char(a.date, 'YYYY-MM')                                    as "month",
      count(*)::int                                                 as "total",
      count(*) filter (where a.status in ('present','late'))::int   as "present",
      count(*) filter (where a.status = 'absent')::int              as "absent",
      count(*) filter (where a.status = 'late')::int                as "late",
      round(count(*) filter (where a.status in ('present','late'))::numeric
            * 100 / greatest(count(*),1), 1)::float8                as "rate"
    from attendance a
    where a.date >= ${from} and a.status not in ('weekend','holiday')
      ${scoped(scopeIds, 'a.employee_id')}
    group by to_char(a.date, 'YYYY-MM')
    order by 1`;
}

/** Hires per month over the last N months. */
async function hiringTrend(scopeIds, months = 12) {
  const from = dayjs.utc().subtract(months - 1, 'month').startOf('month').format('YYYY-MM-DD');
  return db`
    select to_char(e.hire_date, 'YYYY-MM') as "month", count(*)::int as "hires"
    from employees e
    where e.hire_date >= ${from} and e.deleted_at is null
      ${scoped(scopeIds, 'e.id')}
    group by to_char(e.hire_date, 'YYYY-MM')
    order by 1`;
}

/** Average latest rating per department. */
async function performanceByDepartment(scopeIds) {
  return db`
    with latest as (
      select distinct on (r.employee_id) r.employee_id, r.rating
      from performance_reviews r
      where r.status in ('submitted','acknowledged')
        ${scoped(scopeIds, 'r.employee_id')}
      order by r.employee_id, r.period_year desc, r.period_quarter desc
    )
    select
      coalesce(d.name, 'Unassigned')             as "department",
      round(avg(latest.rating), 2)::float8       as "avgRating",
      count(*)::int                              as "reviewed"
    from latest
    join employees e on e.id = latest.employee_id
    left join departments d on d.id = e.department_id
    group by d.name
    order by avg(latest.rating) desc`;
}

/** Per-employee monthly attendance summary. */
async function monthlyAttendanceSummary(employeeId, month = new Date()) {
  const breakdown = await db`
    select a.status, count(*)::int as count, round(sum(a.worked_minutes)::numeric / 60, 1)::float8 as hours
    from attendance a
    where a.employee_id = ${employeeId}
      and a.date between ${monthStart(month)} and ${monthEnd(month)}
    group by a.status
    order by count(*) desc`;

  const totals = breakdown.reduce(
    (acc, row) => {
      if (!['weekend', 'holiday'].includes(row.status)) acc.workingDays += row.count;
      if (['present', 'late'].includes(row.status)) acc.presentDays += row.count;
      if (row.status === 'late') acc.lateDays += row.count;
      if (row.status === 'absent') acc.absentDays += row.count;
      acc.hours += row.hours;
      return acc;
    },
    { workingDays: 0, presentDays: 0, lateDays: 0, absentDays: 0, hours: 0 }
  );

  return {
    month: dayjs.utc(month).format('YYYY-MM'),
    breakdown,
    ...totals,
    hours: Math.round(totals.hours * 10) / 10,
    rate: totals.workingDays ? Math.round((totals.presentDays / totals.workingDays) * 1000) / 10 : 0,
  };
}

/** Requests that have been waiting on an approver for more than three days. */
async function stalePendingApprovals(scopeIds) {
  return db`
    select
      l.id                                                    as "_id",
      l.type, l.days::float8 as days, l.start_date            as "startDate",
      floor(extract(epoch from (now() - l.created_at)) / 86400)::int as "waitingDays",
      e.first_name || ' ' || e.last_name                      as "employeeName"
    from leave_requests l
    join employees e on e.id = l.employee_id
    where l.status = 'pending' and l.created_at <= now() - interval '3 days'
      ${scoped(scopeIds, 'l.employee_id')}
    order by l.created_at
    limit 10`;
}

/**
 * Org chart. The recursive walk happens in Postgres via subordinate_ids(); the
 * flat rows are assembled into a tree here.
 */
async function orgChart(rootEmployeeId = null) {
  const rows = rootEmployeeId
    ? await db`
        select e.id as "_id", e.first_name || ' ' || e.last_name as name,
               e.job_title as "jobTitle", e.avatar_url as "avatarUrl", e.manager_id as "managerId"
        from employees e
        where e.id in (select id from subordinate_ids(${rootEmployeeId}::uuid))`
    : await db`
        select e.id as "_id", e.first_name || ' ' || e.last_name as name,
               e.job_title as "jobTitle", e.avatar_url as "avatarUrl", e.manager_id as "managerId"
        from employees e
        where e.deleted_at is null`;

  const index = new Map();
  rows.forEach((r) =>
    index.set(String(r._id), {
      _id: String(r._id),
      name: r.name,
      jobTitle: r.jobTitle,
      avatarUrl: r.avatarUrl,
      managerId: r.managerId ? String(r.managerId) : null,
      reports: [],
    })
  );

  const roots = [];
  for (const node of index.values()) {
    const parent = node.managerId ? index.get(node.managerId) : null;
    // A node whose manager is outside the returned set is a root of this view.
    if (parent) parent.reports.push(node);
    else roots.push(node);
  }
  return roots;
}

module.exports = {
  headcountByDepartment,
  attendanceRate,
  leaveBreakdown,
  attendanceTrend,
  hiringTrend,
  performanceByDepartment,
  monthlyAttendanceSummary,
  stalePendingApprovals,
  orgChart,
};
