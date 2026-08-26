'use strict';
const { db, noFilter } = require('../db');
const { REVIEW_COLS, employeeMini } = require('../db/shapes');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const scopeService = require('../services/scopeService');
const notify = require('../services/notificationService');
const { parsePagination, buildMeta } = require('../utils/query');

const SELECT = `
  ${REVIEW_COLS},
  ${employeeMini('e')} as "employee",
  ${employeeMini('rv')} as "reviewer"
`;
const JOINS = `
  join employees e  on e.id  = r.employee_id
  join employees rv on rv.id = r.reviewer_id
`;

const fetchOne = async (id) =>
  (await db`select ${db.unsafe(SELECT)} from performance_reviews r ${db.unsafe(JOINS)}
            where r.id = ${id}`)[0] || null;

/** Overall rating is the mean of the competency scores — derived, never client-supplied. */
const meanRating = (scores) =>
  scores?.length
    ? Math.round((scores.reduce((sum, s) => sum + Number(s.score), 0) / scores.length) * 10) / 10
    : null;

/**
 * POST /api/reviews
 * Only an admin or the employee's own manager may open a review, and nobody may
 * review themselves. A draft stays private to the reviewer until it is submitted.
 */
const create = asyncHandler(async (req, res) => {
  const { employee: employeeId, status = 'draft', period, scores, ...rest } = req.body;

  const canReview = await scopeService.canApproveFor(req.user, employeeId);
  if (!canReview) {
    throw ApiError.forbidden('Only an admin or the reporting manager can review this employee');
  }

  const [employee] = await db`select id from employees where id = ${employeeId} and deleted_at is null`;
  if (!employee) throw ApiError.notFound('Employee not found');
  if (!req.user.employee) throw ApiError.badRequest('Your account is not linked to an employee record');

  const [duplicate] = await db`
    select id from performance_reviews
    where employee_id = ${employeeId} and period_year = ${period.year} and period_quarter = ${period.quarter}`;
  if (duplicate) {
    throw ApiError.conflict(`A review already exists for Q${period.quarter} ${period.year}`);
  }

  const [row] = await db`
    insert into performance_reviews
      (employee_id, reviewer_id, period_year, period_quarter, scores, rating,
       strengths, improvements, comments, goals, status, submitted_at)
    values (${employeeId}, ${req.user.employee}, ${period.year}, ${period.quarter},
            ${JSON.stringify(scores)}::jsonb, ${meanRating(scores)},
            ${rest.strengths || null}, ${rest.improvements || null}, ${rest.comments || null},
            ${rest.goals || []}, ${status}, ${status === 'submitted' ? new Date() : null})
    returning id`;

  if (status === 'submitted') {
    await notify.notifyEmployee(employeeId, {
      type: 'review_submitted',
      title: 'Your performance review is ready',
      message: `Your Q${period.quarter} ${period.year} review has been shared with you.`,
      link: `/reviews/${row.id}`,
    });
  }

  await audit.record(req, {
    action: 'review.create',
    entity: 'PerformanceReview',
    entityId: row.id,
    after: { employee: employeeId, period, status, rating: meanRating(scores) },
  });

  res.status(201).json({ success: true, data: await fetchOne(row.id) });
});

/**
 * GET /api/reviews
 * Employees only ever see their own submitted reviews — never a draft their
 * manager is still writing.
 */
const list = asyncHandler(async (req, res) => {
  const q = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(q);

  let scopeClause;
  let statusClause = noFilter();

  if (req.user.role === 'employee' || q.scope === 'mine') {
    scopeClause = db`and r.employee_id = ${req.user.employee}`;
    statusClause = db`and r.status in ('submitted','acknowledged')`;
  } else if (q.employee) {
    const allowed = await scopeService.canAccessEmployee(req.user, q.employee);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
    scopeClause = db`and r.employee_id = ${q.employee}`;
  } else {
    const visible = await scopeService.visibleEmployeeIds(req.user);
    scopeClause = visible === null ? noFilter() : db`and r.employee_id = any(${visible}::uuid[])`;
  }

  if (q.status && req.user.role !== 'employee') statusClause = db`and r.status = ${q.status}`;

  const where = db`
    where true ${scopeClause} ${statusClause}
      ${q.year ? db`and r.period_year = ${q.year}` : noFilter()}
      ${q.quarter ? db`and r.period_quarter = ${q.quarter}` : noFilter()}`;

  const items = await db`select ${db.unsafe(SELECT)} from performance_reviews r ${db.unsafe(JOINS)} ${where}
       order by r.period_year desc, r.period_quarter desc limit ${limit} offset ${skip}`;
  const [{ count }] = await db`select count(*)::int from performance_reviews r ${where}`;

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total: count }) });
});

/** GET /api/reviews/:id */
const getOne = asyncHandler(async (req, res) => {
  const review = await fetchOne(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');

  const isSubject = String(review.employee._id) === String(req.user.employee);
  const isAuthor = String(review.reviewer._id) === String(req.user.employee);

  if (isSubject && review.status === 'draft' && !isAuthor) {
    throw ApiError.forbidden('This review has not been shared yet');
  }
  if (!isSubject) {
    const allowed = await scopeService.canAccessEmployee(req.user, review.employee._id);
    if (!allowed) throw ApiError.forbidden('This review is outside your scope');
  }

  res.json({ success: true, data: review });
});

/** PATCH /api/reviews/:id — author or admin only, and only before acknowledgement. */
const update = asyncHandler(async (req, res) => {
  const [review] = await db`select * from performance_reviews where id = ${req.params.id}`;
  if (!review) throw ApiError.notFound('Review not found');

  const isAuthor = String(review.reviewer_id) === String(req.user.employee);
  if (!isAuthor && req.user.role !== 'admin') {
    throw ApiError.forbidden('Only the reviewer who wrote this can edit it');
  }
  if (review.status === 'acknowledged') throw ApiError.conflict('An acknowledged review is locked');

  const patch = {};
  if (req.body.scores) {
    patch.scores = JSON.stringify(req.body.scores);
    patch.rating = meanRating(req.body.scores);
  }
  ['strengths', 'improvements', 'comments'].forEach((f) => {
    if (req.body[f] !== undefined) patch[f] = req.body[f];
  });
  if (req.body.goals !== undefined) patch.goals = req.body.goals;
  if (req.body.period) {
    patch.period_year = req.body.period.year;
    patch.period_quarter = req.body.period.quarter;
  }

  const wasDraft = review.status === 'draft';
  const nowSubmitted = wasDraft && req.body.status === 'submitted';
  if (req.body.status) patch.status = req.body.status;
  if (nowSubmitted) patch.submitted_at = new Date();

  if (!Object.keys(patch).length) throw ApiError.badRequest('No fields to update');
  await db`update performance_reviews set ${db(patch)} where id = ${review.id}`;

  if (nowSubmitted) {
    await notify.notifyEmployee(review.employee_id, {
      type: 'review_submitted',
      title: 'Your performance review is ready',
      message: `Your Q${review.period_quarter} ${review.period_year} review has been shared with you.`,
      link: `/reviews/${review.id}`,
    });
  }

  await audit.record(req, {
    action: 'review.update',
    entity: 'PerformanceReview',
    entityId: review.id,
    before: { status: review.status, rating: Number(review.rating) },
    after: { status: patch.status || review.status, rating: patch.rating ?? Number(review.rating) },
  });

  res.json({ success: true, data: await fetchOne(review.id) });
});

/** POST /api/reviews/:id/acknowledge — the closing step, available only to the subject. */
const acknowledge = asyncHandler(async (req, res) => {
  const [review] = await db`select * from performance_reviews where id = ${req.params.id}`;
  if (!review) throw ApiError.notFound('Review not found');

  if (String(review.employee_id) !== String(req.user.employee)) {
    throw ApiError.forbidden('Only the employee being reviewed can acknowledge it');
  }
  if (review.status !== 'submitted') {
    throw ApiError.conflict(`A ${review.status} review cannot be acknowledged`);
  }

  await db`
    update performance_reviews
    set status = 'acknowledged', acknowledged_at = now(), employee_comment = ${req.body.employeeComment || null}
    where id = ${review.id}`;

  await notify.notifyEmployee(review.reviewer_id, {
    type: 'review_acknowledged',
    title: 'Review acknowledged',
    message: `Q${review.period_quarter} ${review.period_year} review was acknowledged.`,
    link: `/reviews/${review.id}`,
  });

  await audit.record(req, {
    action: 'review.acknowledge',
    entity: 'PerformanceReview',
    entityId: review.id,
  });

  res.json({ success: true, data: await fetchOne(review.id) });
});

/** DELETE /api/reviews/:id — drafts only, admin or author. */
const remove = asyncHandler(async (req, res) => {
  const [review] = await db`select * from performance_reviews where id = ${req.params.id}`;
  if (!review) throw ApiError.notFound('Review not found');

  const isAuthor = String(review.reviewer_id) === String(req.user.employee);
  if (!isAuthor && req.user.role !== 'admin') throw ApiError.forbidden('Not your review');
  if (review.status !== 'draft') throw ApiError.conflict('Only a draft can be deleted');

  await db`delete from performance_reviews where id = ${review.id}`;
  await audit.record(req, {
    action: 'review.delete',
    entity: 'PerformanceReview',
    entityId: review.id,
    before: { status: review.status },
  });

  res.json({ success: true, message: 'Draft deleted' });
});

/** GET /api/reviews/history/:employeeId — rating trend for one person. */
const history = asyncHandler(async (req, res) => {
  const employeeId = req.params.employeeId;
  const isSubject = String(employeeId) === String(req.user.employee);
  if (!isSubject) {
    const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
  }

  const data = await db`
    select r.id as "_id",
           'Q' || r.period_quarter || ' ' || r.period_year as label,
           r.rating::float8 as rating, r.scores, r.status
    from performance_reviews r
    where r.employee_id = ${employeeId} and r.status in ('submitted','acknowledged')
    order by r.period_year, r.period_quarter`;

  res.json({ success: true, data });
});

module.exports = { create, list, getOne, update, acknowledge, remove, history };
