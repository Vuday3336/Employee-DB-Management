'use strict';
/**
 * OpenAPI 3.0 description of the EmpCore API, served at /api/docs (Swagger UI)
 * and /api/openapi.json. The `x-roles` extension on each operation records which
 * roles may call it, mirroring the authorize() guards in routes/index.js.
 */

const bearer = [{ bearerAuth: [] }];

const ok = (schema, description = 'Success') => ({
  description,
  content: { 'application/json': { schema } },
});

const envelope = (dataSchema, withMeta = false) => ({
  type: 'object',
  properties: {
    success: { type: 'boolean', example: true },
    data: dataSchema,
    ...(withMeta ? { meta: { $ref: '#/components/schemas/PageMeta' } } : {}),
  },
});

const listOp = (tag, summary, roles, itemRef, params = []) => ({
  tags: [tag],
  summary,
  security: bearer,
  'x-roles': roles,
  parameters: params,
  responses: {
    200: ok(envelope({ type: 'array', items: { $ref: itemRef } }, true)),
    401: { $ref: '#/components/responses/Unauthorized' },
    403: { $ref: '#/components/responses/Forbidden' },
  },
});

const idPath = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const pageParams = [
  { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 10 } },
];

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'EmpCore API',
    version: '1.0.0',
    description:
      'Role-based employee management API backed by PostgreSQL. Authorization is enforced ' +
      'in three layers: authenticate (identity) → authorize (role) → record-level scope ' +
      'checks resolved from the reporting tree with a recursive CTE. The x-roles field on ' +
      'each operation lists the roles the route accepts.',
  },
  servers: [{ url: 'http://localhost:5000', description: 'Local development' }],
  tags: [
    { name: 'Auth', description: 'Sessions, tokens and passwords' },
    { name: 'Employees', description: 'Employee records, org chart and CSV export' },
    { name: 'Departments', description: 'Department catalogue' },
    { name: 'Attendance', description: 'Check-in/out, calendar and summaries' },
    { name: 'Leave', description: 'Requests, approvals and balances' },
    { name: 'Reviews', description: 'Performance review cycle' },
    { name: 'Dashboard', description: 'Aggregated reporting' },
    { name: 'Admin', description: 'Users, audit trail, policies and holidays' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    responses: {
      Unauthorized: {
        description: 'Missing, invalid or expired access token',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Forbidden: {
        description: 'Authenticated but out of role or out of scope',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      NotFound: {
        description: 'Resource does not exist',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
      Conflict: {
        description: 'Illegal state transition or duplicate record',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string' },
          details: { type: 'array', items: { type: 'object' } },
          requestId: { type: 'string' },
        },
      },
      PageMeta: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          total: { type: 'integer' },
          pages: { type: 'integer' },
          hasNext: { type: 'boolean' },
          hasPrev: { type: 'boolean' },
        },
      },
      Credentials: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email', example: 'admin@empcore.dev' },
          password: { type: 'string', format: 'password', example: 'Admin@123' },
        },
      },
      Session: {
        type: 'object',
        properties: {
          accessToken: { type: 'string' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              email: { type: 'string' },
              role: { type: 'string', enum: ['admin', 'manager', 'employee'] },
              employeeId: { type: 'string', nullable: true },
            },
          },
        },
      },
      Employee: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          employeeCode: { type: 'string', example: 'EMP-0007' },
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          workEmail: { type: 'string', format: 'email' },
          jobTitle: { type: 'string' },
          department: { type: 'object' },
          manager: { type: 'object', nullable: true },
          hireDate: { type: 'string', format: 'date' },
          employmentType: { type: 'string', enum: ['full_time', 'part_time', 'contract', 'intern'] },
          status: {
            type: 'string',
            enum: ['active', 'probation', 'on_leave', 'suspended', 'terminated'],
          },
          salary: {
            type: 'number',
            description: 'Only returned to admins and to the employee themselves',
          },
          deletedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      EmployeeInput: {
        type: 'object',
        required: ['firstName', 'lastName', 'workEmail', 'jobTitle', 'hireDate'],
        properties: {
          firstName: { type: 'string' },
          lastName: { type: 'string' },
          workEmail: { type: 'string', format: 'email' },
          phone: { type: 'string' },
          jobTitle: { type: 'string' },
          department: { type: 'string' },
          manager: { type: 'string', nullable: true },
          hireDate: { type: 'string', format: 'date' },
          employmentType: { type: 'string' },
          salary: { type: 'number' },
          createAccount: { type: 'boolean' },
          accountRole: { type: 'string', enum: ['admin', 'manager', 'employee'] },
          accountPassword: { type: 'string', format: 'password' },
        },
      },
      Attendance: {
        type: 'object',
        properties: {
          _id: { type: 'string', format: 'uuid' },
          employee: { type: 'string' },
          date: { type: 'string', format: 'date' },
          status: {
            type: 'string',
            enum: ['present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'weekend'],
          },
          checkIn: { type: 'string', format: 'date-time', nullable: true },
          checkOut: { type: 'string', format: 'date-time', nullable: true },
          workedMinutes: { type: 'integer' },
        },
      },
      LeaveRequest: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          employee: { type: 'object' },
          type: {
            type: 'string',
            enum: ['annual', 'sick', 'casual', 'unpaid', 'maternity', 'paternity', 'bereavement'],
          },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          days: { type: 'number', description: 'Business days, weekends and holidays excluded' },
          reason: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
          history: { type: 'array', items: { type: 'object' } },
        },
      },
      LeaveInput: {
        type: 'object',
        required: ['type', 'startDate', 'endDate', 'reason'],
        properties: {
          employee: { type: 'string', description: 'Admin/manager only; defaults to the caller' },
          type: { type: 'string' },
          startDate: { type: 'string', format: 'date' },
          endDate: { type: 'string', format: 'date' },
          halfDay: { type: 'boolean' },
          reason: { type: 'string', minLength: 5 },
        },
      },
      Review: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          employee: { type: 'object' },
          reviewer: { type: 'object' },
          period: {
            type: 'object',
            properties: { year: { type: 'integer' }, quarter: { type: 'integer' } },
          },
          scores: { type: 'array', items: { type: 'object' } },
          rating: { type: 'number', minimum: 1, maximum: 5 },
          status: { type: 'string', enum: ['draft', 'submitted', 'acknowledged'] },
        },
      },
      Department: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string' },
          code: { type: 'string' },
          manager: { type: 'object', nullable: true },
          headcount: { type: 'integer' },
        },
      },
    },
  },
  paths: {
    '/api/health': {
      get: {
        tags: ['Auth'],
        summary: 'Liveness probe',
        'x-roles': ['public'],
        responses: { 200: ok({ type: 'object' }) },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Self-registration (always creates an employee-role account)',
        'x-roles': ['public'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
        },
        responses: { 201: ok(envelope({ $ref: '#/components/schemas/Session' })), 409: { $ref: '#/components/responses/Conflict' } },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Sign in and receive an access token plus a refresh cookie',
        'x-roles': ['public'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Credentials' } } },
        },
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Session' })), 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/api/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Rotate the refresh cookie and mint a new access token',
        'x-roles': ['public (requires refresh cookie)'],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Session' })) },
      },
    },
    '/api/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Sign out and revoke every outstanding refresh token',
        'x-roles': ['any'],
        responses: { 200: ok({ type: 'object' }) },
      },
    },
    '/api/auth/me': {
      get: {
        tags: ['Auth'],
        summary: 'Current principal with linked employee record',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ type: 'object' })), 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/api/auth/password': {
      patch: {
        tags: ['Auth'],
        summary: 'Change own password (revokes all sessions)',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok({ type: 'object' }) },
      },
    },
    '/api/employees': {
      get: listOp('Employees', 'List employees within your scope', ['admin', 'manager', 'employee'], '#/components/schemas/Employee', [
        ...pageParams,
        { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search name, email, code or title' },
        { name: 'department', in: 'query', schema: { type: 'string' } },
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'sort', in: 'query', schema: { type: 'string', example: '-hireDate' } },
      ]),
      post: {
        tags: ['Employees'],
        summary: 'Create an employee (optionally with a login account)',
        security: bearer,
        'x-roles': ['admin'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/EmployeeInput' } } },
        },
        responses: {
          201: ok(envelope({ $ref: '#/components/schemas/Employee' })),
          403: { $ref: '#/components/responses/Forbidden' },
        },
      },
    },
    '/api/employees/lookup': {
      get: {
        tags: ['Employees'],
        summary: 'Lightweight id/name list for dropdowns',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
    },
    '/api/employees/org-chart': {
      get: {
        tags: ['Employees'],
        summary: 'Reporting tree built with a recursive CTE',
        description: 'Admins get every root; a manager gets their own sub-tree.',
        security: bearer,
        'x-roles': ['admin', 'manager'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
    },
    '/api/employees/export': {
      get: {
        tags: ['Employees'],
        summary: 'CSV export of the current filter (salary column for admins only)',
        security: bearer,
        'x-roles': ['admin', 'manager'],
        responses: { 200: { description: 'CSV file', content: { 'text/csv': {} } } },
      },
    },
    '/api/employees/{id}': {
      get: {
        tags: ['Employees'],
        summary: 'Employee detail with direct reports',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)', 'employee (self)'],
        parameters: [idPath],
        responses: {
          200: ok(envelope({ $ref: '#/components/schemas/Employee' })),
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
        },
      },
      patch: {
        tags: ['Employees'],
        summary: 'Update an employee (writable fields depend on your role)',
        security: bearer,
        'x-roles': ['admin (all fields)', 'manager (job fields, own tree)', 'employee (own contact details)'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Employee' })) },
      },
      delete: {
        tags: ['Employees'],
        summary: 'Soft-delete an employee and reassign their reports',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [idPath],
        responses: { 200: ok({ type: 'object' }) },
      },
    },
    '/api/employees/{id}/restore': {
      post: {
        tags: ['Employees'],
        summary: 'Undo a soft delete',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Employee' })) },
      },
    },
    '/api/employees/{id}/manager': {
      patch: {
        tags: ['Employees'],
        summary: 'Reassign a reporting manager (rejects reporting loops)',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Employee' })) },
      },
    },
    '/api/employees/{id}/team': {
      get: {
        tags: ['Employees'],
        summary: 'Direct reports of one employee',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ type: 'array', items: { $ref: '#/components/schemas/Employee' } })) },
      },
    },
    '/api/departments': {
      get: listOp('Departments', 'List departments with headcount', ['admin', 'manager', 'employee'], '#/components/schemas/Department'),
      post: {
        tags: ['Departments'],
        summary: 'Create a department',
        security: bearer,
        'x-roles': ['admin'],
        responses: { 201: ok(envelope({ $ref: '#/components/schemas/Department' })) },
      },
    },
    '/api/departments/{id}': {
      get: {
        tags: ['Departments'],
        summary: 'Department detail with its members',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Department' })) },
      },
      patch: {
        tags: ['Departments'],
        summary: 'Update a department',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Department' })) },
      },
      delete: {
        tags: ['Departments'],
        summary: 'Archive a department (refused while staff are assigned)',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [idPath],
        responses: { 200: ok({ type: 'object' }), 409: { $ref: '#/components/responses/Conflict' } },
      },
    },
    '/api/attendance': {
      get: listOp('Attendance', 'Attendance log within your scope', ['admin', 'manager', 'employee'], '#/components/schemas/Attendance', [
        ...pageParams,
        { name: 'employee', in: 'query', schema: { type: 'string' } },
        { name: 'month', in: 'query', schema: { type: 'string', example: '2026-08' } },
      ]),
      put: {
        tags: ['Attendance'],
        summary: 'Manually correct an attendance record (upsert on employee+date)',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree, not self)'],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Attendance' })) },
      },
    },
    '/api/attendance/check-in': {
      post: {
        tags: ['Attendance'],
        summary: 'Check in for today; late is decided server-side',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: {
          201: ok(envelope({ $ref: '#/components/schemas/Attendance' })),
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },
    '/api/attendance/check-out': {
      post: {
        tags: ['Attendance'],
        summary: 'Check out and compute worked minutes',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Attendance' })) },
      },
    },
    '/api/attendance/today': {
      get: {
        tags: ['Attendance'],
        summary: "Today's own record",
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Attendance' })) },
      },
    },
    '/api/attendance/calendar': {
      get: {
        tags: ['Attendance'],
        summary: 'Month grid with weekends and holidays filled in',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)', 'employee (self)'],
        parameters: [{ name: 'month', in: 'query', schema: { type: 'string', example: '2026-08' } }],
        responses: { 200: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/attendance/summary': {
      get: {
        tags: ['Attendance'],
        summary: 'Monthly attendance aggregation for one employee',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)', 'employee (self)'],
        responses: { 200: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/attendance/team-today': {
      get: {
        tags: ['Attendance'],
        summary: 'Live in/out board for your team',
        security: bearer,
        'x-roles': ['admin', 'manager'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
    },
    '/api/leave': {
      get: listOp('Leave', 'List leave requests within your scope', ['admin', 'manager', 'employee'], '#/components/schemas/LeaveRequest', [
        ...pageParams,
        { name: 'status', in: 'query', schema: { type: 'string' } },
        { name: 'scope', in: 'query', schema: { type: 'string', enum: ['mine', 'team', 'all'] } },
      ]),
      post: {
        tags: ['Leave'],
        summary: 'Submit a leave request',
        description:
          'Business days are computed server-side; overlaps, notice periods, consecutive-day caps and balance are all enforced before the request is stored.',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee (self only)'],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LeaveInput' } } },
        },
        responses: {
          201: ok(envelope({ $ref: '#/components/schemas/LeaveRequest' })),
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },
    '/api/leave/pending': {
      get: {
        tags: ['Leave'],
        summary: 'Approval queue for the calling approver',
        security: bearer,
        'x-roles': ['admin', 'manager'],
        responses: { 200: ok(envelope({ type: 'array', items: { $ref: '#/components/schemas/LeaveRequest' } })) },
      },
    },
    '/api/leave/balance': {
      get: {
        tags: ['Leave'],
        summary: 'Remaining entitlement per leave type',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)', 'employee (self)'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
    },
    '/api/leave/calendar': {
      get: {
        tags: ['Leave'],
        summary: 'Who is away in a date window',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
    },
    '/api/leave/{id}': {
      get: {
        tags: ['Leave'],
        summary: 'Leave request detail with its transition history',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)', 'employee (self)'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/LeaveRequest' })) },
      },
    },
    '/api/leave/{id}/decision': {
      patch: {
        tags: ['Leave'],
        summary: 'Approve or reject a pending request',
        description:
          'Guarded three ways: the state machine rejects illegal transitions, only the reporting manager or an admin may decide, and self-approval is refused.',
        security: bearer,
        'x-roles': ['admin', 'manager (direct/indirect reports, never self)'],
        parameters: [idPath],
        responses: {
          200: ok(envelope({ $ref: '#/components/schemas/LeaveRequest' })),
          403: { $ref: '#/components/responses/Forbidden' },
          409: { $ref: '#/components/responses/Conflict' },
        },
      },
    },
    '/api/leave/{id}/cancel': {
      patch: {
        tags: ['Leave'],
        summary: 'Withdraw a request; an approved one releases its balance',
        security: bearer,
        'x-roles': ['admin', 'employee (own request)'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/LeaveRequest' })) },
      },
    },
    '/api/reviews': {
      get: listOp('Reviews', 'List reviews (employees see only submitted ones)', ['admin', 'manager', 'employee'], '#/components/schemas/Review', pageParams),
      post: {
        tags: ['Reviews'],
        summary: 'Create a review (draft or submitted)',
        security: bearer,
        'x-roles': ['admin', 'manager (direct/indirect reports, never self)'],
        responses: { 201: ok(envelope({ $ref: '#/components/schemas/Review' })) },
      },
    },
    '/api/reviews/{id}': {
      get: {
        tags: ['Reviews'],
        summary: 'Review detail',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)', 'employee (self, submitted only)'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Review' })) },
      },
      patch: {
        tags: ['Reviews'],
        summary: 'Edit a review before it is acknowledged',
        security: bearer,
        'x-roles': ['admin', 'manager (author only)'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Review' })) },
      },
      delete: {
        tags: ['Reviews'],
        summary: 'Delete a draft review',
        security: bearer,
        'x-roles': ['admin', 'manager (author only)'],
        parameters: [idPath],
        responses: { 200: ok({ type: 'object' }) },
      },
    },
    '/api/reviews/{id}/acknowledge': {
      post: {
        tags: ['Reviews'],
        summary: 'Acknowledge your own review and add a comment',
        security: bearer,
        'x-roles': ['employee (subject of the review only)'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ $ref: '#/components/schemas/Review' })) },
      },
    },
    '/api/reviews/history/{employeeId}': {
      get: {
        tags: ['Reviews'],
        summary: 'Rating history for one employee',
        security: bearer,
        'x-roles': ['admin', 'manager (own tree)', 'employee (self)'],
        parameters: [{ ...idPath, name: 'employeeId' }],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
    },
    '/api/dashboard': {
      get: {
        tags: ['Dashboard'],
        summary: 'Scoped KPI snapshot built from SQL aggregations',
        description:
          'Every metric is restricted to the caller\'s visible employee set, so a manager sees their team and an admin sees the organisation.',
        security: bearer,
        'x-roles': ['admin', 'manager'],
        responses: { 200: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/dashboard/me': {
      get: {
        tags: ['Dashboard'],
        summary: 'Personal landing panel',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/users': {
      get: listOp('Admin', 'List login accounts', ['admin'], '#/components/schemas/Session', pageParams),
      post: {
        tags: ['Admin'],
        summary: 'Create a login account with any role',
        security: bearer,
        'x-roles': ['admin'],
        responses: { 201: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/users/{id}/role': {
      patch: {
        tags: ['Admin'],
        summary: 'Change a role (revokes the affected sessions)',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/users/{id}/status': {
      patch: {
        tags: ['Admin'],
        summary: 'Enable or disable a login',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [idPath],
        responses: { 200: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/audit': {
      get: {
        tags: ['Admin'],
        summary: 'Read the append-only audit trail',
        security: bearer,
        'x-roles': ['admin'],
        parameters: [
          ...pageParams,
          { name: 'entity', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string', example: 'leave.' } },
          { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['success', 'denied', 'error'] } },
        ],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } }, true)) },
      },
    },
    '/api/leave-policies': {
      get: {
        tags: ['Admin'],
        summary: 'List leave policies',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
      put: {
        tags: ['Admin'],
        summary: 'Create or update a leave policy',
        security: bearer,
        'x-roles': ['admin'],
        responses: { 200: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/holidays': {
      get: {
        tags: ['Admin'],
        summary: 'List public holidays',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
      post: {
        tags: ['Admin'],
        summary: 'Add a public holiday',
        security: bearer,
        'x-roles': ['admin'],
        responses: { 201: ok(envelope({ type: 'object' })) },
      },
    },
    '/api/notifications': {
      get: {
        tags: ['Admin'],
        summary: 'Own notifications (also pushed live over Socket.IO)',
        security: bearer,
        'x-roles': ['admin', 'manager', 'employee'],
        responses: { 200: ok(envelope({ type: 'array', items: { type: 'object' } })) },
      },
    },
  },
};
