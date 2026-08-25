'use strict';
const mongoose = require('mongoose');

const EMPLOYEE_STATUS = ['active', 'probation', 'on_leave', 'suspended', 'terminated'];
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern'];

const leaveBalanceSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    entitled: { type: Number, default: 0, min: 0 },
    used: { type: Number, default: 0, min: 0 },
    carriedForward: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const employeeSchema = new mongoose.Schema(
  {
    employeeCode: { type: String, required: true, unique: true, uppercase: true, trim: true },
    firstName: { type: String, required: [true, 'First name is required'], trim: true },
    lastName: { type: String, required: [true, 'Last name is required'], trim: true },
    workEmail: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    phone: { type: String, trim: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', index: true },
    jobTitle: { type: String, required: true, trim: true },
    // Self-referencing edge: powers the $graphLookup org chart and manager scoping.
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    hireDate: { type: Date, required: true },
    employmentType: { type: String, enum: EMPLOYMENT_TYPES, default: 'full_time' },
    status: { type: String, enum: EMPLOYEE_STATUS, default: 'active', index: true },
    // Sensitive: stripped by the field-level guard for anyone but admin/self.
    salary: { type: Number, min: 0, default: 0 },
    location: { type: String, trim: true },
    avatarUrl: { type: String, trim: true },
    leaveBalances: { type: [leaveBalanceSchema], default: [] },
    terminatedAt: Date,
    // Soft delete — history (attendance, reviews, leave) must survive deactivation.
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

employeeSchema.index({ firstName: 'text', lastName: 'text', workEmail: 'text', jobTitle: 'text', employeeCode: 'text' });
employeeSchema.index({ department: 1, status: 1, deletedAt: 1 });

employeeSchema.virtual('fullName').get(function () {
  return `${this.firstName} ${this.lastName}`.trim();
});

employeeSchema.virtual('tenureMonths').get(function () {
  if (!this.hireDate) return 0;
  const ms = Date.now() - new Date(this.hireDate).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44)));
});

employeeSchema.methods.remainingLeave = function (type) {
  const bucket = this.leaveBalances.find((b) => b.type === type);
  if (!bucket) return 0;
  return bucket.entitled + bucket.carriedForward - bucket.used;
};

employeeSchema.statics.STATUSES = EMPLOYEE_STATUS;
employeeSchema.statics.EMPLOYMENT_TYPES = EMPLOYMENT_TYPES;

module.exports = mongoose.model('Employee', employeeSchema);
module.exports.EMPLOYEE_STATUS = EMPLOYEE_STATUS;
module.exports.EMPLOYMENT_TYPES = EMPLOYMENT_TYPES;
