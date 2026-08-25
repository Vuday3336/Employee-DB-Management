/*
 * Database-side scheduled jobs (Supabase / any Postgres with pg_cron).
 *
 * Why these live in the database rather than in jobs/index.js:
 *
 * The API is deployed as serverless functions, which have no process that outlives a
 * request — so node-cron never fires there. Retention and the daily attendance
 * close-out are exactly the kind of work that must not silently stop because the
 * host has no scheduler. Running them in Postgres makes them independent of where
 * (or whether) the API is running.
 *
 * jobs/index.js keeps the same logic for deployments that *do* have a long-running
 * process. Both are idempotent, so a deployment running both is harmless: the unique
 * index on (employee_id, date) collapses duplicate absence rows, and the purges are
 * plain deletes over a time window.
 *
 * Apply separately from schema.sql — pg_cron is not present on every Postgres, and
 * the test database does not need it.
 */

create extension if not exists pg_cron with schema extensions;

/*
 * MongoDB expired the audit trail and notifications with TTL indexes. Postgres has no
 * equivalent, so retention is a scheduled delete.
 */
create or replace function purge_expired_records()
returns void
language sql
security definer
set search_path = public, pg_temp
as $fn$
  delete from audit_logs    where created_at < now() - interval '2 years';
  delete from notifications where created_at < now() - interval '90 days';
$fn$;

/*
 * Closes out the previous working day: anyone active with no attendance row is marked
 * absent, so the monthly rate is not inflated by missing records. Mirrors
 * markMissingAsAbsent() in jobs/index.js.
 */
create or replace function mark_missing_attendance(for_date date default (current_date - 1))
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  inserted integer;
begin
  -- Weekends and company holidays are not working days.
  if extract(isodow from for_date) >= 6 then return 0; end if;
  if exists (select 1 from holidays where date = for_date) then return 0; end if;

  insert into attendance (employee_id, date, status, source, notes)
  select e.id, for_date, 'absent', 'system', 'Auto-marked: no check-in recorded'
  from employees e
  where e.deleted_at is null
    and e.status in ('active','probation')
    and not exists (
      select 1 from attendance a where a.employee_id = e.id and a.date = for_date
    )
  on conflict (employee_id, date) do nothing;

  get diagnostics inserted = row_count;
  return inserted;
end;
$fn$;

-- Re-running this file should not stack duplicate schedules.
select cron.unschedule('empcore-purge-expired') where exists
  (select 1 from cron.job where jobname = 'empcore-purge-expired');
select cron.unschedule('empcore-mark-absent') where exists
  (select 1 from cron.job where jobname = 'empcore-mark-absent');

select cron.schedule('empcore-mark-absent',   '0 2 * * *',  $job$select mark_missing_attendance()$job$);
select cron.schedule('empcore-purge-expired', '15 3 * * *', $job$select purge_expired_records()$job$);

-- Inspect with:  select jobname, schedule, active from cron.job;
-- History with:  select * from cron.job_run_details order by start_time desc limit 20;
