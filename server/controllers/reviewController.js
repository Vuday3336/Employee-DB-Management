'use strict';
const { PerformanceReview, Employee } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');
const scopeService = require('../services/scopeService');
const notify = require('../services/notificationService');
const { parsePagination, buildMeta } = require('../utils/query');

const POPULATE = [
  { path: 'employee', select: 'firstName lastName employeeCode jobTitle avatarUrl' },
  { path: 'reviewer', select: 'firstName lastName jobTitle' },
];

/**
 * POST /api/reviews
 * Only an admin or the employee's own manager may open a review, and nobody may
 * review themselves. A draft stays private to the reviewer until it is submitted.
 */
const create = asyncHandler(async (req, res) => {
  const { employee: employeeId, status = 'draft', ...payload } = req.body;

  const canReview = await scopeService.canApproveFor(req.user, employeeId);
  if (!canReview) throw ApiError.forbidden('Only an admin or the reporting manager can review this employee');

  const employee = await Employee.findById(employeeId).lean();
  if (!employee || employee.deletedAt) throw ApiError.notFound('Employee not found');

  const reviewer = req.user.employee;
  if (!reviewer) throw ApiError.badRequest('Your account is not linked to an employee record');

  const duplicate = await PerformanceReview.findOne({
    employee: employeeId,
    'period.year': payload.period.year,
    'period.quarter': payload.period.quarter,
  }).lean();
  if (duplicate) {
    throw ApiError.conflict(
      `A review already exists for Q${payload.period.quarter} ${payload.period.year}`
    );
  }

  const review = await PerformanceReview.create({
    ...payload,
    employee: employeeId,
    reviewer,
    status,
    submittedAt: status === 'submitted' ? new Date() : undefined,
  });

  if (status === 'submitted') {
    await notify.notifyEmployee(employeeId, {
      type: 'review_submitted',
      title: 'Your performance review is ready',
      message: `Your Q${review.period.quarter} ${review.period.year} review has been shared with you.`,
      link: `/reviews/${review._id}`,
    });
  }

  await audit.record(req, {
    action: 'review.create',
    entity: 'PerformanceReview',
    entityId: review._id,
    after: review.toObject(),
  });

  res.status(201).json({ success: true, data: await review.populate(POPULATE) });
});

/**
 * GET /api/reviews
 * Employees only ever see their own submitted reviews — never a draft that their
 * manager is still writing.
 */
const list = asyncHandler(async (req, res) => {
  const query = req.validatedQuery || req.query;
  const { page, limit, skip } = parsePagination(query);

  const filter = {};
  if (req.user.role === 'employee' || query.scope === 'mine') {
    filter.employee = req.user.employee;
    filter.status = { $in: ['submitted', 'acknowledged'] };
  } else if (query.employee) {
    const allowed = await scopeService.canAccessEmployee(req.user, query.employee);
    if (!allowed) throw ApiError.forbidden('This employee is outside your scope');
    filter.employee = query.employee;
  } else {
    Object.assign(filter, await scopeService.scopeFilter(req.user, 'employee'));
  }

  if (query.status && req.user.role !== 'employee') filter.status = query.status;
  if (query.year) filter['period.year'] = query.year;
  if (query.quarter) filter['period.quarter'] = query.quarter;

  const [items, total] = await Promise.all([
    PerformanceReview.find(filter)
      .populate(POPULATE)
      .sort({ 'period.year': -1, 'period.quarter': -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    PerformanceReview.countDocuments(filter),
  ]);

  res.json({ success: true, data: items, meta: buildMeta({ page, limit, total }) });
});

/** GET /api/reviews/:id */
const getOne = asyncHandler(async (req, res) => {
  const review = await PerformanceReview.findById(req.params.id).populate(POPULATE).lean();
  if (!review) throw ApiError.notFound('Review not found');

  const employeeId = review.employee?._id || review.employee;
  const isSubject = String(employeeId) === String(req.user.employee);
  const isAuthor = String(review.reviewer?._id || review.reviewer) === String(req.user.employee);

  if (isSubject && review.status === 'draft' && !isAuthor) {
    throw ApiError.forbidden('This review has not been shared yet');
  }
  if (!isSubject) {
    const allowed = await scopeService.canAccessEmployee(req.user, employeeId);
    if (!allowed) throw ApiError.forbidden('This review is outside your scope');
  }

  res.json({ success: true, data: review });
});

/** PATCH /api/reviews/:id — only the author (or an admin) may edit, and only before acknowledgement. */
const update = asyncHandler(async (req, res) => {
  const review = await PerformanceReview.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');

  const isAuthor = String(review.reviewer) === String(req.user.employee);
  if (!isAuthor && req.user.role !== 'admin') {
    throw ApiError.forbidden('Only the reviewer who wrote this can edit it');
  }
  if (review.status === 'acknowledged') {
    throw ApiError.conflict('An acknowledged review is locked');
  }

  const before = review.toObject();
  const wasDraft = review.status === 'draft';
  Object.entries(req.body).forEach(([key, value]) => {
    review[key] = value;
  });
  if (wasDraft && review.status === 'submitted') review.submittedAt = new Date();
  await review.save();

  if (wasDraft && review.status === 'submitted') {
    await notify.notifyEmployee(review.employee, {
      type: 'review_submitted',
      title: 'Your performance review is ready',
      message: `Your Q${review.period.quarter} ${review.period.year} review has been shared with you.`,
      link: `/reviews/${review._id}`,
    });
  }

  await audit.record(req, {
    action: 'review.update',
    entity: 'PerformanceReview',
    entityId: review._id,
    before,
    after: review.toObject(),
  });

  res.json({ success: true, data: await review.populate(POPULATE) });
});

/** POST /api/reviews/:id/acknowledge — the closing step, available only to the subject. */
const acknowledge = asyncHandler(async (req, res) => {
  const review = await PerformanceReview.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');

  if (String(review.employee) !== String(req.user.employee)) {
    throw ApiError.forbidden('Only the employee being reviewed can acknowledge it');
  }
  if (review.status !== 'submitted') {
    throw ApiError.conflict(`A ${review.status} review cannot be acknowledged`);
  }

  review.status = 'acknowledged';
  review.acknowledgedAt = new Date();
  review.employeeComment = req.body.employeeComment;
  await review.save();

  await notify.notifyEmployee(review.reviewer, {
    type: 'review_acknowledged',
    title: 'Review acknowledged',
    message: `Q${review.period.quarter} ${review.period.year} review was acknowledged.`,
    link: `/reviews/${review._id}`,
  });

  await audit.record(req, {
    action: 'review.acknowledge',
    entity: 'PerformanceReview',
    entityId: review._id,
  });

  res.json({ success: true, data: await review.populate(POPULATE) });
});

/** DELETE /api/reviews/:id — drafts only, admin or author. */
const remove = asyncHandler(async (req, res) => {
  const review = await PerformanceReview.findById(req.params.id);
  if (!review) throw ApiError.notFound('Review not found');

  const isAuthor = String(review.reviewer) === String(req.user.employee);
  if (!isAuthor && req.user.role !== 'admin') throw ApiError.forbidden('Not your review');
  if (review.status !== 'draft') throw ApiError.conflict('Only a draft can be deleted');

  await review.deleteOne();
  await audit.record(req, {
    action: 'review.delete',
    entity: 'PerformanceReview',
    entityId: review._id,
    before: review.toObject(),
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

  const rows = await PerformanceReview.find({
    employee: employeeId,
    status: { $in: ['submitted', 'acknowledged'] },
  })
    .select('period rating scores status acknowledgedAt')
    .sort({ 'period.year': 1, 'period.quarter': 1 })
    .lean();

  res.json({
    success: true,
    data: rows.map((r) => ({
      _id: r._id,
      label: `Q${r.period.quarter} ${r.period.year}`,
      rating: r.rating,
      scores: r.scores,
      status: r.status,
    })),
  });
});

module.exports = { create, list, getOne, update, acknowledge, remove, history };
