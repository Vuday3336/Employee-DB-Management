'use strict';
const express = require('express');
const { authenticate } = require('../middleware/auth');
const { authorize, canAccessEmployee } = require('../middleware/roleCheck');
const validate = require('../middleware/validate');
const { authLimiter, writeLimiter } = require('../middleware/rateLimiter');
const v = require('../validators');

const auth = require('../controllers/authController');
const employees = require('../controllers/employeeController');
const departments = require('../controllers/departmentController');
const attendance = require('../controllers/attendanceController');
const leave = require('../controllers/leaveController');
const reviews = require('../controllers/reviewController');
const dashboard = require('../controllers/dashboardController');
const admin = require('../controllers/adminController');

const router = express.Router();

/* ================================ auth ================================== */

const authRoutes = express.Router();
authRoutes.post('/register', authLimiter, validate({ body: v.auth.register }), auth.register);
authRoutes.post('/login', authLimiter, validate({ body: v.auth.login }), auth.login);
authRoutes.post('/refresh', auth.refresh);
authRoutes.post('/logout', auth.logout);
authRoutes.get('/me', authenticate, auth.me);
authRoutes.patch(
  '/password',
  authenticate,
  authLimiter,
  validate({ body: v.auth.changePassword }),
  auth.changePassword
);
router.use('/auth', authRoutes);

/* ============================== employees =============================== */
/*
 * Every route below is authenticated. The role gate says which *kind* of user may
 * call the route; the controller then re-checks the specific record against the
 * caller's reporting scope. Both layers are required — neither is sufficient alone.
 */

const employeeRoutes = express.Router();
employeeRoutes.use(authenticate);

// Static paths must be declared before '/:id' so they are not swallowed by it.
employeeRoutes.get('/lookup', employees.lookup);
employeeRoutes.get('/org-chart', authorize('admin', 'manager'), employees.orgChart);
employeeRoutes.get('/export', authorize('admin', 'manager'), employees.exportCsv);

employeeRoutes.get('/', validate({ query: v.employee.query }), employees.list);
employeeRoutes.post(
  '/',
  authorize('admin'),
  writeLimiter,
  validate({ body: v.employee.create }),
  employees.create
);
// canAccessEmployee is the record-level gate: it resolves the caller's reporting
// sub-tree server-side and refuses ids outside it, so guessing a URL gains nothing.
employeeRoutes.get('/:id', validate({ params: v.idParam }), canAccessEmployee('id'), employees.getOne);
employeeRoutes.get('/:id/team', validate({ params: v.idParam }), canAccessEmployee('id'), employees.team);
employeeRoutes.patch(
  '/:id',
  writeLimiter,
  validate({ params: v.idParam, body: v.employee.update }),
  canAccessEmployee('id'),
  employees.update
);
employeeRoutes.patch('/:id/manager', authorize('admin'), validate({ params: v.idParam }), employees.assignManager);
employeeRoutes.delete('/:id', authorize('admin'), validate({ params: v.idParam }), employees.deactivate);
employeeRoutes.post('/:id/restore', authorize('admin'), validate({ params: v.idParam }), employees.restore);
router.use('/employees', employeeRoutes);

/* ============================= departments ============================== */

const departmentRoutes = express.Router();
departmentRoutes.use(authenticate);
departmentRoutes.get('/', departments.list);
departmentRoutes.get('/:id', validate({ params: v.idParam }), departments.getOne);
departmentRoutes.post('/', authorize('admin'), validate({ body: v.department.create }), departments.create);
departmentRoutes.patch(
  '/:id',
  authorize('admin'),
  validate({ params: v.idParam, body: v.department.update }),
  departments.update
);
departmentRoutes.delete('/:id', authorize('admin'), validate({ params: v.idParam }), departments.archive);
router.use('/departments', departmentRoutes);

/* ============================== attendance ============================== */

const attendanceRoutes = express.Router();
attendanceRoutes.use(authenticate);
attendanceRoutes.get('/today', attendance.today);
attendanceRoutes.get('/calendar', attendance.calendar);
attendanceRoutes.get('/summary', attendance.summary);
attendanceRoutes.get('/team-today', authorize('admin', 'manager'), attendance.teamToday);
attendanceRoutes.get('/export', authorize('admin', 'manager'), attendance.exportCsv);
attendanceRoutes.get('/', validate({ query: v.attendance.query }), attendance.list);
attendanceRoutes.post('/check-in', writeLimiter, validate({ body: v.attendance.checkIn }), attendance.checkIn);
attendanceRoutes.post('/check-out', writeLimiter, validate({ body: v.attendance.checkOut }), attendance.checkOut);
// Manual corrections are a manager/admin power, never self-service.
attendanceRoutes.put(
  '/',
  authorize('admin', 'manager'),
  validate({ body: v.attendance.upsert }),
  attendance.upsert
);
router.use('/attendance', attendanceRoutes);

/* ================================ leave ================================= */

const leaveRoutes = express.Router();
leaveRoutes.use(authenticate);
leaveRoutes.get('/balance', leave.balance);
leaveRoutes.get('/calendar', leave.calendar);
leaveRoutes.get('/pending', authorize('admin', 'manager'), leave.pending);
leaveRoutes.get('/', validate({ query: v.leave.query }), leave.list);
leaveRoutes.post('/', writeLimiter, validate({ body: v.leave.create }), leave.create);
leaveRoutes.get('/:id', validate({ params: v.idParam }), leave.getOne);
leaveRoutes.patch(
  '/:id/decision',
  authorize('admin', 'manager'),
  validate({ params: v.idParam, body: v.leave.decide }),
  leave.decide
);
leaveRoutes.patch('/:id/cancel', validate({ params: v.idParam }), leave.cancel);
router.use('/leave', leaveRoutes);

/* =============================== reviews ================================ */

const reviewRoutes = express.Router();
reviewRoutes.use(authenticate);
reviewRoutes.get('/', validate({ query: v.review.query }), reviews.list);
reviewRoutes.post(
  '/',
  authorize('admin', 'manager'),
  writeLimiter,
  validate({ body: v.review.create }),
  reviews.create
);
reviewRoutes.get('/history/:employeeId', reviews.history);
reviewRoutes.get('/:id', validate({ params: v.idParam }), reviews.getOne);
reviewRoutes.patch(
  '/:id',
  authorize('admin', 'manager'),
  validate({ params: v.idParam, body: v.review.update }),
  reviews.update
);
// Acknowledgement belongs to the subject of the review, so no role gate here —
// the controller checks that the caller *is* the reviewed employee.
reviewRoutes.post(
  '/:id/acknowledge',
  validate({ params: v.idParam, body: v.review.acknowledge }),
  reviews.acknowledge
);
reviewRoutes.delete('/:id', authorize('admin', 'manager'), validate({ params: v.idParam }), reviews.remove);
router.use('/reviews', reviewRoutes);

/* ============================== dashboard =============================== */

const dashboardRoutes = express.Router();
dashboardRoutes.use(authenticate);
dashboardRoutes.get('/', authorize('admin', 'manager'), dashboard.overview);
dashboardRoutes.get('/me', dashboard.myOverview);
router.use('/dashboard', dashboardRoutes);

/* ========================== admin & platform ============================ */

const userRoutes = express.Router();
userRoutes.use(authenticate, authorize('admin'));
userRoutes.get('/', admin.listUsers);
userRoutes.post('/', validate({ body: v.auth.register }), admin.createUser);
userRoutes.patch('/:id/role', validate({ params: v.idParam }), admin.updateUserRole);
userRoutes.patch('/:id/status', validate({ params: v.idParam }), admin.setUserStatus);
router.use('/users', userRoutes);

const auditRoutes = express.Router();
auditRoutes.use(authenticate, authorize('admin'));
auditRoutes.get('/', admin.listAudit);
router.use('/audit', auditRoutes);

const policyRoutes = express.Router();
policyRoutes.use(authenticate);
policyRoutes.get('/', admin.listPolicies);
policyRoutes.put('/', authorize('admin'), validate({ body: v.policy.leavePolicy }), admin.upsertPolicy);
router.use('/leave-policies', policyRoutes);

const holidayRoutes = express.Router();
holidayRoutes.use(authenticate);
holidayRoutes.get('/', admin.listHolidays);
holidayRoutes.post('/', authorize('admin'), validate({ body: v.policy.holiday }), admin.createHoliday);
holidayRoutes.delete('/:id', authorize('admin'), validate({ params: v.idParam }), admin.deleteHoliday);
router.use('/holidays', holidayRoutes);

const notificationRoutes = express.Router();
notificationRoutes.use(authenticate);
notificationRoutes.get('/', admin.listNotifications);
notificationRoutes.patch('/read-all', admin.markAllNotificationsRead);
notificationRoutes.patch('/:id/read', validate({ params: v.idParam }), admin.markNotificationRead);
router.use('/notifications', notificationRoutes);

module.exports = router;
