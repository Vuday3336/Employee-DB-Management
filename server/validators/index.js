'use strict';
const { z } = require('zod');
const {
  ROLES,
  EMPLOYEE_STATUS,
  EMPLOYMENT_TYPES,
  ATTENDANCE_STATUS,
  LEAVE_TYPES,
  COMPETENCIES,
} = require('../db/enums');

// Postgres identifiers are UUIDs; the shape check keeps a malformed id out of the
// query layer entirely rather than surfacing as a cast error.
const objectId = z.string().uuid('Invalid id');
const isoDate = z.coerce.date({ invalid_type_error: 'Invalid date' });

const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-z]/, 'Password needs a lowercase letter')
  .regex(/[A-Z]/, 'Password needs an uppercase letter')
  .regex(/[0-9]/, 'Password needs a number');

const idParam = z.object({ id: objectId });

/* ------------------------------- auth ---------------------------------- */

const login = z.object({
  email: z.string().email().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

const register = z.object({
  email: z.string().email().toLowerCase(),
  password,
  role: z.enum(ROLES).default('employee'),
  employee: objectId.optional(),
});

const changePassword = z.object({
  currentPassword: z.string().min(1),
  newPassword: password,
});

/* ----------------------------- employees -------------------------------- */

const employeeBase = {
  firstName: z.string().min(1).max(60).trim(),
  lastName: z.string().min(1).max(60).trim(),
  workEmail: z.string().email().toLowerCase(),
  phone: z.string().max(30).optional(),
  department: objectId.optional().nullable(),
  jobTitle: z.string().min(2).max(100).trim(),
  manager: objectId.optional().nullable(),
  hireDate: isoDate,
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  status: z.enum(EMPLOYEE_STATUS).optional(),
  salary: z.number().min(0).optional(),
  location: z.string().max(100).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
};

const createEmployee = z.object({
  ...employeeBase,
  employeeCode: z.string().min(2).max(20).toUpperCase().optional(),
  // Optionally provision a login account alongside the employee record.
  createAccount: z.boolean().optional(),
  accountRole: z.enum(ROLES).optional(),
  accountPassword: password.optional(),
});

const updateEmployee = z
  .object(employeeBase)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'No fields to update');

const employeeQuery = z.object({
  q: z.string().max(120).optional(),
  department: objectId.optional(),
  status: z.enum(EMPLOYEE_STATUS).optional(),
  employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
  manager: objectId.optional(),
  includeDeleted: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().max(80).optional(),
});

/* ---------------------------- departments ------------------------------- */

const createDepartment = z.object({
  name: z.string().min(2).max(80).trim(),
  code: z.string().min(2).max(10).toUpperCase().trim(),
  description: z.string().max(500).optional(),
  manager: objectId.optional().nullable(),
  costCenter: z.string().max(30).optional(),
});

const updateDepartment = createDepartment.partial().refine(
  (v) => Object.keys(v).length > 0,
  'No fields to update'
);

/* ----------------------------- attendance ------------------------------- */

const checkIn = z.object({
  employee: objectId.optional(),
  at: isoDate.optional(),
  notes: z.string().max(300).optional(),
});

const checkOut = z.object({
  employee: objectId.optional(),
  at: isoDate.optional(),
});

const upsertAttendance = z.object({
  employee: objectId,
  date: isoDate,
  status: z.enum(ATTENDANCE_STATUS),
  checkIn: isoDate.optional().nullable(),
  checkOut: isoDate.optional().nullable(),
  notes: z.string().max(300).optional(),
});

const attendanceQuery = z.object({
  employee: objectId.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  status: z.enum(ATTENDANCE_STATUS).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/* ------------------------------- leave ---------------------------------- */

const createLeave = z
  .object({
    employee: objectId.optional(),
    type: z.enum(LEAVE_TYPES),
    startDate: isoDate,
    endDate: isoDate,
    halfDay: z.boolean().optional(),
    reason: z.string().min(5).max(500).trim(),
    attachmentUrl: z.string().url().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'endDate cannot be before startDate',
    path: ['endDate'],
  });

const decideLeave = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().max(500).optional(),
});

const leaveQuery = z.object({
  employee: objectId.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
  type: z.enum(LEAVE_TYPES).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  scope: z.enum(['mine', 'team', 'all']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  sort: z.string().max(80).optional(),
});

/* ------------------------------ reviews --------------------------------- */

const createReview = z.object({
  employee: objectId,
  period: z.object({
    year: z.coerce.number().int().min(2000).max(2100),
    quarter: z.coerce.number().int().min(1).max(4),
  }),
  scores: z
    .array(z.object({ competency: z.enum(COMPETENCIES), score: z.number().min(1).max(5) }))
    .min(1, 'At least one competency score is required'),
  strengths: z.string().max(2000).optional(),
  improvements: z.string().max(2000).optional(),
  comments: z.string().max(2000).optional(),
  goals: z.array(z.string().max(200)).max(10).optional(),
  status: z.enum(['draft', 'submitted']).optional(),
});

const updateReview = createReview.partial().omit({ employee: true });

const acknowledgeReview = z.object({ employeeComment: z.string().max(1000).optional() });

const reviewQuery = z.object({
  employee: objectId.optional(),
  year: z.coerce.number().int().optional(),
  quarter: z.coerce.number().int().min(1).max(4).optional(),
  status: z.enum(['draft', 'submitted', 'acknowledged']).optional(),
  scope: z.enum(['mine', 'team', 'all']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/* ------------------------------ policies -------------------------------- */

const leavePolicy = z.object({
  type: z.enum(LEAVE_TYPES),
  label: z.string().min(2).max(60),
  annualQuota: z.number().min(0).max(365),
  accrues: z.boolean().optional(),
  maxCarryForward: z.number().min(0).max(60).optional(),
  maxConsecutiveDays: z.number().min(1).max(180).optional(),
  minNoticeDays: z.number().min(0).max(90).optional(),
  requiresAttachment: z.boolean().optional(),
  isPaid: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

const holiday = z.object({
  name: z.string().min(2).max(80),
  date: isoDate,
  region: z.string().max(10).optional(),
  isOptional: z.boolean().optional(),
});

module.exports = {
  idParam,
  auth: { login, register, changePassword },
  employee: { create: createEmployee, update: updateEmployee, query: employeeQuery },
  department: { create: createDepartment, update: updateDepartment },
  attendance: { checkIn, checkOut, upsert: upsertAttendance, query: attendanceQuery },
  leave: { create: createLeave, decide: decideLeave, query: leaveQuery },
  review: { create: createReview, update: updateReview, acknowledge: acknowledgeReview, query: reviewQuery },
  policy: { leavePolicy, holiday },
};
