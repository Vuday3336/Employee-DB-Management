'use strict';
const mongoose = require('mongoose');

const LEAVE_TYPES = ['annual', 'sick', 'casual', 'unpaid', 'maternity', 'paternity', 'bereavement'];
const LEAVE_STATUS = ['pending', 'approved', 'rejected', 'cancelled'];

// Explicit state machine. Every transition in the app funnels through canTransition()
// so an approved request can never silently flip back to pending.
const TRANSITIONS = {
  pending: ['approved', 'rejected', 'cancelled'],
  approved: ['cancelled'],
  rejected: [],
  cancelled: [],
};

const historySchema = new mongoose.Schema(
  {
    from: String,
    to: String,
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    note: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false }
);

const leaveRequestSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    type: { type: String, enum: LEAVE_TYPES, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    // Business days only — weekends and company holidays are excluded at creation time.
    days: { type: Number, required: true, min: 0.5 },
    halfDay: { type: Boolean, default: false },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: LEAVE_STATUS, default: 'pending', index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    decidedAt: Date,
    decisionNote: { type: String, trim: true, maxlength: 500 },
    attachmentUrl: String,
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

leaveRequestSchema.index({ employee: 1, startDate: 1, endDate: 1 });
leaveRequestSchema.index({ status: 1, createdAt: -1 });

leaveRequestSchema.pre('validate', function (next) {
  if (this.startDate && this.endDate && this.endDate < this.startDate) {
    return next(new Error('endDate cannot be before startDate'));
  }
  next();
});

leaveRequestSchema.methods.canTransition = function (to) {
  return (TRANSITIONS[this.status] || []).includes(to);
};

leaveRequestSchema.methods.transition = function (to, { by, note } = {}) {
  if (!this.canTransition(to)) {
    const err = new Error(`Cannot move a ${this.status} request to ${to}`);
    err.statusCode = 409;
    throw err;
  }
  this.history.push({ from: this.status, to, by, note });
  this.status = to;
  if (to === 'approved' || to === 'rejected') {
    this.approvedBy = by;
    this.decidedAt = new Date();
    this.decisionNote = note;
  }
  return this;
};

leaveRequestSchema.statics.TYPES = LEAVE_TYPES;
leaveRequestSchema.statics.STATUSES = LEAVE_STATUS;
leaveRequestSchema.statics.TRANSITIONS = TRANSITIONS;

module.exports = mongoose.model('LeaveRequest', leaveRequestSchema);
module.exports.LEAVE_TYPES = LEAVE_TYPES;
module.exports.LEAVE_STATUS = LEAVE_STATUS;
