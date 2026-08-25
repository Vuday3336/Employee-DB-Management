-- EmpCore schema, in version control.
--
-- This is the same DDL applied to Supabase (as three migrations); kept here so the
-- database can be recreated from the repository, and so the test suite can build a
-- throwaway database from scratch.
--
-- Safe to re-run: types, tables and indexes are created only if absent.

create extension if not exists citext;

do $types$ begin
  create type user_role         as enum ('admin','manager','employee');
  create type employee_status   as enum ('active','probation','on_leave','suspended','terminated');
  create type employment_type   as enum ('full_time','part_time','contract','intern');
  create type attendance_status as enum ('present','absent','late','half_day','on_leave','holiday','weekend');
  create type leave_type        as enum ('annual','sick','casual','unpaid','maternity','paternity','bereavement');
  create type leave_status      as enum ('pending','approved','rejected','cancelled');
  create type review_status     as enum ('draft','submitted','acknowledged');
  create type audit_outcome     as enum ('success','denied','error');
exception when duplicate_object then null; end $types$;

create table if not exists departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  code         text not null unique,
  description  text,
  manager_id   uuid,
  cost_center  text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists employees (
  id              uuid primary key default gen_random_uuid(),
  employee_code   text not null unique,
  first_name      text not null,
  last_name       text not null,
  work_email      citext not null unique,
  phone           text,
  department_id   uuid references departments(id) on delete set null,
  job_title       text not null,
  -- Self-reference: the reporting tree, walked by subordinate_ids().
  manager_id      uuid references employees(id) on delete set null,
  hire_date       date not null,
  employment_type employment_type not null default 'full_time',
  status          employee_status not null default 'active',
  salary          numeric(12,2) not null default 0,
  location        text,
  avatar_url      text,
  terminated_at   timestamptz,
  -- Soft delete: attendance, leave and review history outlive the record.
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint employee_not_own_manager check (manager_id is null or manager_id <> id)
);

do $fk$ begin
  alter table departments add constraint departments_manager_fk
    foreign key (manager_id) references employees(id) on delete set null;
exception when duplicate_object then null; end $fk$;

create table if not exists users (
  id                    uuid primary key default gen_random_uuid(),
  email                 citext not null unique,
  password_hash         text not null,
  role                  user_role not null default 'employee',
  employee_id           uuid unique references employees(id) on delete set null,
  is_active             boolean not null default true,
  last_login_at         timestamptz,
  -- Bumped on logout / password change / role change to kill live refresh tokens.
  token_version         integer not null default 0,
  failed_login_attempts integer not null default 0,
  locked_until          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table if not exists leave_policies (
  type                 leave_type primary key,
  label                text not null,
  annual_quota         numeric(6,2) not null default 0,
  accrues              boolean not null default true,
  max_carry_forward    numeric(6,2) not null default 0,
  max_consecutive_days integer not null default 30,
  min_notice_days      integer not null default 0,
  requires_attachment  boolean not null default false,
  is_paid              boolean not null default true,
  is_active            boolean not null default true
);

create table if not exists leave_balances (
  id              uuid primary key default gen_random_uuid(),
  employee_id     uuid not null references employees(id) on delete cascade,
  type            leave_type not null,
  entitled        numeric(6,2) not null default 0,
  used            numeric(6,2) not null default 0,
  carried_forward numeric(6,2) not null default 0,
  unique (employee_id, type)
);

create table if not exists holidays (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  date        date not null unique,
  region      text not null default 'ALL',
  is_optional boolean not null default false
);

create table if not exists attendance (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id) on delete cascade,
  date           date not null,
  status         attendance_status not null,
  check_in       timestamptz,
  check_out      timestamptz,
  worked_minutes integer not null default 0,
  notes          text,
  source         text not null default 'self',
  recorded_by    uuid references users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- One row per employee per day, enforced by the database not the app.
  unique (employee_id, date),
  constraint attendance_checkout_after_checkin
    check (check_out is null or check_in is null or check_out > check_in)
);

create table if not exists leave_requests (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references employees(id) on delete cascade,
  type           leave_type not null,
  start_date     date not null,
  end_date       date not null,
  days           numeric(5,1) not null,
  half_day       boolean not null default false,
  reason         text not null,
  status         leave_status not null default 'pending',
  approved_by    uuid references users(id) on delete set null,
  decided_at     timestamptz,
  decision_note  text,
  attachment_url text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint leave_dates_ordered check (end_date >= start_date)
);

create table if not exists leave_request_history (
  id          bigserial primary key,
  request_id  uuid not null references leave_requests(id) on delete cascade,
  from_status leave_status,
  to_status   leave_status not null,
  by_user     uuid references users(id) on delete set null,
  note        text,
  at          timestamptz not null default now()
);

create table if not exists performance_reviews (
  id               uuid primary key default gen_random_uuid(),
  employee_id      uuid not null references employees(id) on delete cascade,
  reviewer_id      uuid not null references employees(id) on delete cascade,
  period_year      integer not null check (period_year between 2000 and 2100),
  period_quarter   integer not null check (period_quarter between 1 and 4),
  scores           jsonb not null default '[]'::jsonb,
  rating           numeric(3,1) not null check (rating between 1 and 5),
  strengths        text,
  improvements     text,
  comments         text,
  goals            text[] not null default '{}',
  status           review_status not null default 'draft',
  submitted_at     timestamptz,
  employee_comment text,
  acknowledged_at  timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- One review per employee per period, whoever writes it.
  unique (employee_id, period_year, period_quarter),
  constraint review_not_self check (employee_id <> reviewer_id)
);

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  type       text not null,
  title      text not null,
  message    text not null,
  link       text,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id          bigserial primary key,
  actor_id    uuid references users(id) on delete set null,
  actor_email text,
  actor_role  text,
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  changes     jsonb,
  ip          text,
  user_agent  text,
  outcome     audit_outcome not null default 'success',
  created_at  timestamptz not null default now()
);

/* -------------------------------- indexes ------------------------------- */

create index if not exists employees_manager_idx      on employees (manager_id);
create index if not exists employees_dept_status_idx  on employees (department_id, status, deleted_at);
create index if not exists employees_deleted_idx      on employees (deleted_at);
create index if not exists users_employee_idx         on users (employee_id);
create index if not exists users_role_idx             on users (role);
create index if not exists attendance_date_status_idx on attendance (date, status);
create index if not exists attendance_employee_idx    on attendance (employee_id, date desc);
create index if not exists leave_employee_range_idx   on leave_requests (employee_id, start_date, end_date);
create index if not exists leave_status_created_idx   on leave_requests (status, created_at desc);
create index if not exists leave_history_request_idx  on leave_request_history (request_id, at);
create index if not exists reviews_employee_idx       on performance_reviews (employee_id, period_year desc, period_quarter desc);
create index if not exists reviews_status_idx         on performance_reviews (status);
create index if not exists notifications_user_idx     on notifications (user_id, read_at, created_at desc);
create index if not exists audit_created_idx          on audit_logs (created_at desc);
create index if not exists audit_entity_idx           on audit_logs (entity, action);
create index if not exists leave_balances_emp_idx     on leave_balances (employee_id);

/* ------------------------------- functions ------------------------------ */

/*
 * The Postgres replacement for MongoDB's $graphLookup.
 *
 * Walks the self-referencing employees.manager_id edge downward from `root` and
 * returns the whole reporting sub-tree, including the root. This is the single
 * source of truth for "which employees may this manager touch?" — every scope
 * check in the API resolves through it.
 *
 * Depth is capped so a cycle (which the app also guards against on write) is
 * survivable rather than infinite. search_path is pinned so the function cannot
 * be hijacked by a caller-controlled path resolving `employees` elsewhere.
 */
create or replace function subordinate_ids(root uuid, max_depth integer default 10)
returns table (id uuid)
language sql
stable
set search_path = public, pg_temp
as $fn$
  with recursive tree as (
    select e.id, 0 as depth
    from employees e
    where e.id = root and e.deleted_at is null
  union all
    select e.id, t.depth + 1
    from employees e
    join tree t on e.manager_id = t.id
    where e.deleted_at is null and t.depth < max_depth
  )
  select tree.id from tree;
$fn$;

create or replace function touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['employees','users','departments','attendance',
                           'leave_requests','performance_reviews']
  loop
    execute format('drop trigger if exists %I_touch on %I', t, t);
    execute format('create trigger %I_touch before update on %I
                    for each row execute function touch_updated_at()', t, t);
  end loop;
end $trg$;

/* ---------------------------- PostgREST lockdown ------------------------ */

/*
 * Supabase publishes every table in `public` through PostgREST, reachable with the
 * anon key that ships to the browser. EmpCore does its authorization in the Express
 * API (role gate + reporting-tree scope + field redaction), so PostgREST must not be
 * an alternative way in — otherwise anyone could read salaries directly and bypass
 * every check.
 *
 * RLS enabled with no policies denies anon and authenticated outright. The API
 * connects as the table owner, which bypasses RLS, so it is unaffected.
 */
do $rls$
declare t text;
begin
  foreach t in array array['departments','employees','users','leave_policies','leave_balances',
                           'holidays','attendance','leave_requests','leave_request_history',
                           'performance_reviews','notifications','audit_logs']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $rls$;
