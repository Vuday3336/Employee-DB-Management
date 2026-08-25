'use strict';
const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    description: { type: String, trim: true, maxlength: 500 },
    manager: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    costCenter: { type: String, trim: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

departmentSchema.virtual('headcount', {
  ref: 'Employee',
  localField: '_id',
  foreignField: 'department',
  count: true,
  match: { deletedAt: null, status: { $ne: 'terminated' } },
});

module.exports = mongoose.model('Department', departmentSchema);
