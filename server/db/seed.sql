-- EmpCore demo organisation.
--
-- Written as plain SQL so it can be run either through `npm run seed` or directly
-- against the database, and so the whole thing lands in one transaction.
--
-- WARNING: truncates every table first. Never point this at real data.

begin;

create extension if not exists pgcrypto;

truncate audit_logs, notifications, performance_reviews, leave_request_history,
         leave_requests, leave_balances, attendance, holidays, users, employees,
         departments, leave_policies restart identity cascade;

/* ----------------------------- departments ------------------------------ */
insert into departments (name, code, description, cost_center) values
  ('Engineering',       'ENG', 'Product engineering and platform', 'CC-100'),
  ('People Operations', 'HR',  'Hiring, culture and HR services',  'CC-200'),
  ('Finance',           'FIN', 'Accounting, payroll and planning', 'CC-300'),
  ('Sales',             'SLS', 'Revenue and account management',   'CC-400'),
  ('Design',            'DSG', 'Product and brand design',         'CC-500');

/* ---------------------------- leave policies ---------------------------- */
insert into leave_policies (type, label, annual_quota, accrues, max_carry_forward,
                            max_consecutive_days, min_notice_days, is_paid) values
  ('annual',      'Annual Leave',      24, true,  6, 15,  3, true),
  ('sick',        'Sick Leave',        12, true,  0,  7,  0, true),
  ('casual',      'Casual Leave',       8, true,  0,  3,  1, true),
  ('unpaid',      'Unpaid Leave',       0, false, 0, 30,  7, false),
  ('maternity',   'Maternity Leave',   90, false, 0, 90, 30, true),
  ('paternity',   'Paternity Leave',   10, false, 0, 10, 14, true),
  ('bereavement', 'Bereavement Leave',  5, false, 0,  5,  0, true);

/* ------------------------------- holidays ------------------------------- */
insert into holidays (name, date)
select h.name, make_date(extract(year from now())::int, h.m, h.d)
from (values
  ('New Year''s Day', 1, 1), ('Spring Public Holiday', 4, 3), ('Labour Day', 5, 1),
  ('Independence Day', 8, 15), ('Founders Day', 10, 2), ('Winter Holiday', 12, 25)
) as h(name, m, d);

/* ------------------------------ employees ------------------------------- */
-- Inserted with no manager first, then the reporting edges are wired by code so
-- the self-reference does not need a specific insertion order.
insert into employees (employee_code, first_name, last_name, work_email, phone,
                       department_id, job_title, hire_date, salary, location, status)
select
  p.code, p.first, p.last,
  lower(p.first || '.' || p.last || '@empcore.dev'),
  '+1-555-' || lpad((1000 + p.seq)::text, 4, '0'),
  d.id, p.title,
  (now() - ((6 + (p.seq * 7) % 60) || ' months')::interval)::date,
  p.salary,
  (array['Bengaluru','London','Austin','Remote'])[1 + (p.seq % 4)],
  'active'
from (values
  (1,  'EMP-0001', 'Aditi',  'Rao',     'Chief Executive Officer', 'HR',  320000),
  (2,  'EMP-0002', 'Marcus', 'Bell',    'VP of Engineering',       'ENG', 245000),
  (3,  'EMP-0003', 'Priya',  'Nair',    'Head of People',          'HR',  190000),
  (4,  'EMP-0004', 'Daniel', 'Okafor',  'Finance Director',        'FIN', 205000),
  (5,  'EMP-0005', 'Sofia',  'Ramirez', 'Engineering Manager',     'ENG', 178000),
  (6,  'EMP-0006', 'Wei',    'Chen',    'Senior Backend Engineer', 'ENG', 152000),
  (7,  'EMP-0007', 'Liam',   'Murphy',  'Backend Engineer',        'ENG', 118000),
  (8,  'EMP-0008', 'Hana',   'Sato',    'Frontend Engineer',       'ENG', 121000),
  (9,  'EMP-0009', 'Omar',   'Haddad',  'QA Engineer',             'ENG',  98000),
  (10, 'EMP-0010', 'Elena',  'Novak',   'Platform Engineer',       'ENG', 143000),
  (11, 'EMP-0011', 'Grace',  'Adeyemi', 'HR Business Partner',     'HR',   96000),
  (12, 'EMP-0012', 'Tom',    'Baker',   'Recruiter',               'HR',   82000),
  (13, 'EMP-0013', 'Ines',   'Costa',   'Financial Analyst',       'FIN',  94000),
  (14, 'EMP-0014', 'Raj',    'Menon',   'Payroll Specialist',      'FIN',  79000),
  (15, 'EMP-0015', 'Nadia',  'Petrov',  'Sales Director',          'SLS', 186000),
  (16, 'EMP-0016', 'Chris',  'Doyle',   'Account Executive',       'SLS', 104000),
  (17, 'EMP-0017', 'Yuki',   'Tanaka',  'Account Executive',       'SLS', 101000),
  (18, 'EMP-0018', 'Aisha',  'Bello',   'Design Lead',             'DSG', 165000),
  (19, 'EMP-0019', 'Felix',  'Warren',  'Product Designer',        'DSG', 112000),
  (20, 'EMP-0020', 'Maya',   'Iyer',    'UX Researcher',           'DSG', 108000)
) as p(seq, code, first, last, title, dept, salary)
join departments d on d.code = p.dept;

-- Reporting tree: three levels deep, so $graphLookup's replacement has something
-- non-trivial to walk.
update employees e set manager_id = m.id
from (values
  ('EMP-0002','EMP-0001'), ('EMP-0003','EMP-0001'), ('EMP-0004','EMP-0001'),
  ('EMP-0005','EMP-0002'), ('EMP-0006','EMP-0005'), ('EMP-0007','EMP-0005'),
  ('EMP-0008','EMP-0005'), ('EMP-0009','EMP-0005'), ('EMP-0010','EMP-0002'),
  ('EMP-0011','EMP-0003'), ('EMP-0012','EMP-0003'), ('EMP-0013','EMP-0004'),
  ('EMP-0014','EMP-0004'), ('EMP-0015','EMP-0001'), ('EMP-0016','EMP-0015'),
  ('EMP-0017','EMP-0015'), ('EMP-0018','EMP-0001'), ('EMP-0019','EMP-0018'),
  ('EMP-0020','EMP-0018')
) as rel(child, parent)
join employees m on m.employee_code = rel.parent
where e.employee_code = rel.child;

-- Department heads.
update departments d set manager_id = e.id
from (values ('ENG','EMP-0002'), ('HR','EMP-0003'), ('FIN','EMP-0004'),
             ('SLS','EMP-0015'), ('DSG','EMP-0018')) as h(code, emp)
join employees e on e.employee_code = h.emp
where d.code = h.code;

/* -------------------------------- users --------------------------------- */
-- bcrypt via pgcrypto, cost 12 — the same format bcryptjs verifies against.
insert into users (email, password_hash, role, employee_id)
select e.work_email, crypt('Password@123', gen_salt('bf', 12)), r.role::user_role, e.id
from employees e
join (values
  ('EMP-0001','admin'),   ('EMP-0002','manager'), ('EMP-0003','manager'),
  ('EMP-0004','manager'), ('EMP-0005','manager'), ('EMP-0015','manager'),
  ('EMP-0018','manager')
) as r(code, role) on r.code = e.employee_code
union all
select e.work_email, crypt('Password@123', gen_salt('bf', 12)), 'employee', e.id
from employees e
where e.employee_code not in ('EMP-0001','EMP-0002','EMP-0003','EMP-0004',
                              'EMP-0005','EMP-0015','EMP-0018');

/* ---------------------------- leave balances ---------------------------- */
insert into leave_balances (employee_id, type, entitled, used, carried_forward)
select e.id, p.type, p.annual_quota, 0,
       case when p.type = 'annual' then (random() * 4)::int else 0 end
from employees e cross join leave_policies p
where p.is_active;

/* ------------------------------ attendance ------------------------------ */
-- Three months of working days per employee: ~4% absent, ~12% late.
insert into attendance (employee_id, date, status, check_in, check_out, worked_minutes, source)
select
  e.id,
  d::date,
  s.status,
  case when s.status = 'absent' then null else d + s.in_offset end,
  case when s.status = 'absent' then null else d + s.in_offset + interval '8 hours' + (s.extra || ' minutes')::interval end,
  case when s.status = 'absent' then 0 else 480 + s.extra end,
  case when s.status = 'absent' then 'system' else 'self' end
from employees e
cross join generate_series(
  date_trunc('month', now() - interval '3 months')::date,
  (now() - interval '1 day')::date,
  interval '1 day'
) as d
cross join lateral (
  select
    case when r < 0.04 then 'absent' when r < 0.16 then 'late' else 'present' end as status,
    case when r < 0.16 and r >= 0.04
         then interval '9 hours 25 minutes' else interval '8 hours 35 minutes' end as in_offset,
    (random() * 60)::int as extra
  from (select random() as r) rr
) s
where extract(isodow from d) < 6
  and d::date >= e.hire_date
  and not exists (select 1 from holidays h where h.date = d::date);

/* ---------------------------- leave requests ---------------------------- */
-- A spread of past decisions and future pending requests, one per employee so
-- nothing overlaps (which the API would reject anyway).
insert into leave_requests (employee_id, type, start_date, end_date, days, reason, status,
                            approved_by, decided_at, created_at)
select
  e.id,
  t.type::leave_type,
  t.start_date,
  t.start_date + (t.len - 1),
  t.len,
  t.reason,
  t.status::leave_status,
  case when t.status = 'pending' then null else (select id from users where role = 'admin' limit 1) end,
  case when t.status = 'pending' then null else now() - interval '10 days' end,
  now() - interval '20 days'
from employees e
cross join lateral (
  select
    (array['annual','sick','casual'])[1 + (abs(hashtext(e.employee_code)) % 3)] as type,
    -- Future requests stay pending; past ones are already decided.
    case when abs(hashtext(e.employee_code)) % 2 = 0
         then (now() + interval '20 days')::date
         else (now() - interval '25 days')::date end as start_date,
    1 + (abs(hashtext(e.employee_code)) % 3) as len,
    (array['Family function out of town','Medical appointment and recovery',
           'Personal errands','Short vacation with family','Recovering from flu'])
      [1 + (abs(hashtext(e.employee_code)) % 5)] as reason,
    case when abs(hashtext(e.employee_code)) % 2 = 0 then 'pending' else 'approved' end as status
) t;

-- Opening history row for every request, plus the decision where there was one.
insert into leave_request_history (request_id, from_status, to_status, at)
select id, null, 'pending', created_at from leave_requests;

insert into leave_request_history (request_id, from_status, to_status, by_user, note, at)
select id, 'pending', status, approved_by, 'Decided during seeding', decided_at
from leave_requests where status <> 'pending';

-- Approved days consume balance, so the UI numbers add up.
update leave_balances b
set used = b.used + l.days
from leave_requests l
where l.employee_id = b.employee_id and l.type = b.type and l.status = 'approved';

/* --------------------------- performance reviews ------------------------ */
-- One review per employee who has a manager, for the previous two quarters.
insert into performance_reviews (employee_id, reviewer_id, period_year, period_quarter,
                                 scores, rating, strengths, improvements, comments, goals,
                                 status, submitted_at, acknowledged_at)
select
  e.id,
  e.manager_id,
  extract(year from now() - (q.n || ' months')::interval)::int,
  extract(quarter from now() - (q.n || ' months')::interval)::int,
  s.scores,
  s.rating,
  (array['Consistently ships ahead of schedule and unblocks others.',
         'Excellent technical judgement; raises the quality bar in reviews.',
         'Strong ownership — follows problems through to the root cause.'])
    [1 + (abs(hashtext(e.employee_code || q.n::text)) % 3)],
  (array['Could delegate more instead of absorbing every task personally.',
         'Written design docs would help the wider team follow decisions.',
         'Push back sooner when scope grows mid-sprint.'])
    [1 + (abs(hashtext(e.employee_code || q.n::text)) % 3)],
  'Solid contribution this period. Goals carried into the next quarter.',
  array['Lead one cross-team initiative','Mentor a junior teammate'],
  case when q.n = 6 then 'acknowledged' else 'submitted' end::review_status,
  now() - ((q.n - 1) || ' months')::interval,
  case when q.n = 6 then now() - interval '4 months' else null end
from employees e
cross join (values (6), (3)) as q(n)
cross join lateral (
  select
    jsonb_build_array(
      jsonb_build_object('competency','delivery',      'score', 3 + (abs(hashtext(e.employee_code || 'd' || q.n)) % 3)),
      jsonb_build_object('competency','quality',       'score', 3 + (abs(hashtext(e.employee_code || 'q' || q.n)) % 3)),
      jsonb_build_object('competency','collaboration', 'score', 3 + (abs(hashtext(e.employee_code || 'c' || q.n)) % 3)),
      jsonb_build_object('competency','ownership',     'score', 3 + (abs(hashtext(e.employee_code || 'o' || q.n)) % 3)),
      jsonb_build_object('competency','communication', 'score', 3 + (abs(hashtext(e.employee_code || 'm' || q.n)) % 3))
    ) as scores,
    round((
      (3 + (abs(hashtext(e.employee_code || 'd' || q.n)) % 3)) +
      (3 + (abs(hashtext(e.employee_code || 'q' || q.n)) % 3)) +
      (3 + (abs(hashtext(e.employee_code || 'c' || q.n)) % 3)) +
      (3 + (abs(hashtext(e.employee_code || 'o' || q.n)) % 3)) +
      (3 + (abs(hashtext(e.employee_code || 'm' || q.n)) % 3))
    )::numeric / 5, 1) as rating
) s
where e.manager_id is not null;

commit;