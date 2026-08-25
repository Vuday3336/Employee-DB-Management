'use strict';
const { Department, Employee } = require('../models');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const audit = require('../services/auditService');

/** GET /api/departments — with live headcount. */
const list = asyncHandler(async (req, res) => {
  const filter = req.query.includeInactive === 'true' ? {} : { isActive: true };
  const departments = await Department.find(filter)
    .populate('manager', 'firstName lastName jobTitle')
    .populate('headcount')
    .sort({ name: 1 })
    .lean();
  res.json({ success: true, data: departments });
});

/** GET /api/departments/:id */
const getOne = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id)
    .populate('manager', 'firstName lastName jobTitle')
    .lean();
  if (!department) throw ApiError.notFound('Department not found');

  const employees = await Employee.find({ department: department._id, deletedAt: null })
    .select('firstName lastName jobTitle employeeCode status avatarUrl')
    .sort({ firstName: 1 })
    .lean();

  res.json({ success: true, data: { ...department, employees, headcount: employees.length } });
});

/** POST /api/departments — admin only. */
const create = asyncHandler(async (req, res) => {
  if (req.body.manager) {
    const manager = await Employee.findById(req.body.manager).lean();
    if (!manager) throw ApiError.badRequest('Manager does not exist');
  }
  const department = await Department.create(req.body);
  await audit.record(req, {
    action: 'department.create',
    entity: 'Department',
    entityId: department._id,
    after: department.toObject(),
  });
  res.status(201).json({ success: true, data: department });
});

/** PATCH /api/departments/:id — admin only. */
const update = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found');

  const before = department.toObject();
  Object.assign(department, req.body);
  await department.save();

  await audit.record(req, {
    action: 'department.update',
    entity: 'Department',
    entityId: department._id,
    before,
    after: department.toObject(),
  });
  res.json({ success: true, data: department });
});

/**
 * DELETE /api/departments/:id
 * Archived rather than removed, and refused outright while people are still
 * assigned to it — otherwise those employee records would point at nothing.
 */
const archive = asyncHandler(async (req, res) => {
  const department = await Department.findById(req.params.id);
  if (!department) throw ApiError.notFound('Department not found');

  const staff = await Employee.countDocuments({ department: department._id, deletedAt: null });
  if (staff > 0) {
    throw ApiError.conflict(`Reassign the ${staff} employee(s) in this department first`);
  }

  department.isActive = false;
  await department.save();
  await audit.record(req, { action: 'department.archive', entity: 'Department', entityId: department._id });
  res.json({ success: true, message: 'Department archived' });
});

module.exports = { list, getOne, create, update, archive };
