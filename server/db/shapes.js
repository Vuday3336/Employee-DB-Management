'use strict';
/**
 * Column fragments that alias Postgres' snake_case into the exact JSON shape the
 * API already returned when this ran on MongoDB — `_id`, `firstName`, nested
 * `department` objects and so on.
 *
 * Keeping the wire format identical means the deployed client needed no changes
 * when the storage moved from MongoDB to Postgres, and the OpenAPI document stays
 * accurate. These strings are compile-time constants, never user input.
 */

const EMPLOYEE_BASE = `
  e.id                                  as "_id",
  e.employee_code                       as "employeeCode",
  e.first_name                          as "firstName",
  e.last_name                           as "lastName",
  e.first_name || ' ' || e.last_name    as "fullName",
  e.work_email                          as "workEmail",
  e.phone                               as "phone",
  e.job_title                           as "jobTitle",
  e.hire_date                           as "hireDate",
  e.employment_type                     as "employmentType",
  e.status                              as "status",
  e.salary::float8                      as "salary",
  e.location                            as "location",
  e.avatar_url                          as "avatarUrl",
  e.terminated_at                       as "terminatedAt",
  e.deleted_at                          as "deletedAt",
  e.created_at                          as "createdAt"
`;

/** Employee row plus its department and manager as nested objects. */
const EMPLOYEE_FULL = `
  ${EMPLOYEE_BASE},
  case when d.id is null then null else
    json_build_object('_id', d.id, 'name', d.name, 'code', d.code) end as "department",
  case when m.id is null then null else
    json_build_object(
      '_id', m.id,
      'firstName', m.first_name,
      'lastName', m.last_name,
      'jobTitle', m.job_title,
      'employeeCode', m.employee_code
    ) end as "manager"
`;

const EMPLOYEE_JOINS = `
  left join departments d on d.id = e.department_id
  left join employees   m on m.id = e.manager_id
`;

/** Compact employee object for embedding inside another record. */
const employeeMini = (alias) => `
  case when ${alias}.id is null then null else
    json_build_object(
      '_id', ${alias}.id,
      'firstName', ${alias}.first_name,
      'lastName', ${alias}.last_name,
      'fullName', ${alias}.first_name || ' ' || ${alias}.last_name,
      'jobTitle', ${alias}.job_title,
      'employeeCode', ${alias}.employee_code,
      'avatarUrl', ${alias}.avatar_url
    ) end
`;

const ATTENDANCE_COLS = `
  a.id             as "_id",
  a.employee_id    as "employee",
  a.date           as "date",
  a.status         as "status",
  a.check_in       as "checkIn",
  a.check_out      as "checkOut",
  a.worked_minutes as "workedMinutes",
  a.notes          as "notes",
  a.source         as "source"
`;

const LEAVE_COLS = `
  l.id             as "_id",
  l.type           as "type",
  l.start_date     as "startDate",
  l.end_date       as "endDate",
  l.days::float8   as "days",
  l.half_day       as "halfDay",
  l.reason         as "reason",
  l.status         as "status",
  l.decided_at     as "decidedAt",
  l.decision_note  as "decisionNote",
  l.attachment_url as "attachmentUrl",
  l.created_at     as "createdAt"
`;

/** The transition trail, oldest first, as an array of objects. */
const LEAVE_HISTORY = `
  coalesce((
    select json_agg(json_build_object(
      'from', h.from_status, 'to', h.to_status, 'note', h.note, 'at', h.at
    ) order by h.at, h.id)
    from leave_request_history h where h.request_id = l.id
  ), '[]'::json) as "history"
`;

const REVIEW_COLS = `
  r.id                as "_id",
  json_build_object('year', r.period_year, 'quarter', r.period_quarter) as "period",
  r.scores            as "scores",
  r.rating::float8    as "rating",
  r.strengths         as "strengths",
  r.improvements      as "improvements",
  r.comments          as "comments",
  r.goals             as "goals",
  r.status            as "status",
  r.submitted_at      as "submittedAt",
  r.employee_comment  as "employeeComment",
  r.acknowledged_at   as "acknowledgedAt",
  r.created_at        as "createdAt"
`;

const USER_COLS = `
  u.id            as "_id",
  u.email         as "email",
  u.role          as "role",
  u.employee_id   as "employee",
  u.is_active     as "isActive",
  u.last_login_at as "lastLoginAt",
  u.created_at    as "createdAt"
`;

module.exports = {
  EMPLOYEE_BASE,
  EMPLOYEE_FULL,
  EMPLOYEE_JOINS,
  employeeMini,
  ATTENDANCE_COLS,
  LEAVE_COLS,
  LEAVE_HISTORY,
  REVIEW_COLS,
  USER_COLS,
};
