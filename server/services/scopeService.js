'use strict';
const { db } = require('../db');

/**
 * Resolves the set of employee records a principal is allowed to touch.
 *
 * A manager owns their whole reporting sub-tree, not just direct reports. On
 * Postgres that is a recursive CTE, wrapped in the `subordinate_ids()` function so
 * the traversal lives next to the data and every caller gets the identical rule.
 * (The MongoDB implementation of this project used $graphLookup for the same job.)
 */
async function getSubordinateIds(managerEmployeeId, { includeSelf = true } = {}) {
  if (!managerEmployeeId) return [];
  const rows = await db`select id from subordinate_ids(${managerEmployeeId}::uuid)`;
  const ids = rows.map((r) => r.id);
  return includeSelf ? ids : ids.filter((id) => String(id) !== String(managerEmployeeId));
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

async function canAccessEmployee(user, employeeId) {
  const ids = await visibleEmployeeIds(user);
  if (ids === null) return true;
  return ids.some((id) => String(id) === String(employeeId));
}

/**
 * Approval rights are narrower than visibility: a manager appears in their own
 * scope (they must see their own record), but must never approve their own leave
 * or write their own review.
 */
async function canApproveFor(user, employeeId) {
  if (user.role === 'admin') return true;
  if (user.role !== 'manager') return false;
  if (String(user.employee) === String(employeeId)) return false;
  const ids = await getSubordinateIds(user.employee, { includeSelf: false });
  return ids.some((id) => String(id) === String(employeeId));
}

module.exports = { getSubordinateIds, visibleEmployeeIds, canAccessEmployee, canApproveFor };
