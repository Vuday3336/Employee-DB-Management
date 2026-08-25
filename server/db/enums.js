'use strict';
/**
 * Mirrors of the Postgres enum types. Kept in one place so the Zod validators and
 * the OpenAPI document cannot drift from the database definition.
 */
module.exports = {
  ROLES: ['admin', 'manager', 'employee'],
  EMPLOYEE_STATUS: ['active', 'probation', 'on_leave', 'suspended', 'terminated'],
  EMPLOYMENT_TYPES: ['full_time', 'part_time', 'contract', 'intern'],
  ATTENDANCE_STATUS: ['present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'weekend'],
  LEAVE_TYPES: ['annual', 'sick', 'casual', 'unpaid', 'maternity', 'paternity', 'bereavement'],
  LEAVE_STATUS: ['pending', 'approved', 'rejected', 'cancelled'],
  REVIEW_STATUS: ['draft', 'submitted', 'acknowledged'],
  COMPETENCIES: ['delivery', 'quality', 'collaboration', 'ownership', 'communication'],
  // The leave state machine. A transition absent from this table is a 409.
  LEAVE_TRANSITIONS: {
    pending: ['approved', 'rejected', 'cancelled'],
    approved: ['cancelled'],
    rejected: [],
    cancelled: [],
  },
};
