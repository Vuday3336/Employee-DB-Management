'use strict';
const mongoose = require('mongoose');
const { LEAVE_TYPES } = require('./LeaveRequest');

const leavePolicySchema = new mongoose.Schema(
  {
    type: { type: String, enum: LEAVE_TYPES, required: true, unique: true },
    label: { type: String, required: true },
    annualQuota: { type: Number, required: true, min: 0 },
    // Monthly accrual is quota/12 by default; the cron job in jobs/ applies it.
    accrues: { type: Boolean, default: true },
    maxCarryForward: { type: Number, default: 0, min: 0 },
    maxConsecutiveDays: { type: Number, default: 30, min: 1 },
    minNoticeDays: { type: Number, default: 0, min: 0 },
    requiresAttachment: { type: Boolean, default: false },
    isPaid: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeavePolicy', leavePolicySchema);
