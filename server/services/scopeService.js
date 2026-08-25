'use strict';
const { Employee } = require('../models');

/**
 * Resolves the set of employee records a manager is allowed to touch.
 *
 * A manager owns their whole reporting sub-tree, not just direct reports, so this
 * walks the self-referencing Employee.manager edge with $graphLookup — one round
 * trip instead of a recursive query per level.
 */
async function getSubordinateIds(managerEmployeeId, { includeSelf = true } = {}) {
  if (!managerEmployeeId) return [];
  const [result] = await Employee.aggregate([
    { $match: { _id: new (require('mongoose').Types.ObjectId)(String(managerEmployeeId)) } },
    {
      $graphLookup: {
        from: 'employees',
        startWith: '$_id',
        connectFromField: '_id',
        connectToField: 'manager',
        as: 'subtree',
        maxDepth: 10,
        restrictSearchWithMatch: { deletedAt: null },
      },
    },
    { $project: { ids: '$subtree._id' } },
  ]);

  const ids = result ? result.ids : [];
  return includeSelf ? [...ids, managerEmployeeId] : ids;
}

/**
 * The single source of truth for "which employees can this principal see?".
 *   admin    -> null  (meaning: no restriction)
 *   manager  -> their reporting sub-tree, including themselves
 *   employee -> just themselves
 */
async function visibleEmployeeIds(user) {
  if (user.role === 'admin') return null;
  if (user.role === 'manager') return getSubordinateIds(user.employee);
  return user.employee ? [user.employee] : [];
}

/** Turn the scope into a Mongo filter fragment for a field holding an employee id. */
async function scopeFilter(user, field = 'employee') {
  const ids = await visibleEmployeeIds(user);
  if (ids === null) return {};
  return { [field]: { $in: ids } };
}

async function canAccessEmployee(user, employeeId) {
  const ids = await visibleEmployeeIds(user);
  if (ids === null) return true;
  return ids.some((id) => String(id) === String(employeeId));
}

/** Approval rights are narrower than visibility: a manager may not approve their own leave. */
async function canApproveFor(user, employeeId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  if (String(user.employee) === String(employeeId)) return false;
  const ids = await getSubordinateIds(user.employee, { includeSelf: false });
  return ids.some((id) => String(id) === String(employeeId));
}

module.exports = { getSubordinateIds, visibleEmployeeIds, scopeFilter, canAccessEmployee, canApproveFor };
