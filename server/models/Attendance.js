'use strict';
const mongoose = require('mongoose');

const ATTENDANCE_STATUS = ['present', 'absent', 'late', 'half_day', 'on_leave', 'holiday', 'weekend'];

const attendanceSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    // Always normalised to UTC midnight so one employee has at most one row per day.
    date: { type: Date, required: true, index: true },
    status: { type: String, enum: ATTENDANCE_STATUS, required: true },
    checkIn: Date,
    checkOut: Date,
    workedMinutes: { type: Number, default: 0, min: 0 },
    notes: { type: String, trim: true, maxlength: 300 },
    source: { type: String, enum: ['self', 'manager', 'admin', 'system'], default: 'self' },
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

attendanceSchema.index({ employee: 1, date: 1 }, { unique: true });
attendanceSchema.index({ date: 1, status: 1 });

attendanceSchema.pre('save', function (next) {
  if (this.checkIn && this.checkOut) {
    if (this.checkOut <= this.checkIn) return next(new Error('checkOut must be after checkIn'));
    this.workedMinutes = Math.round((this.checkOut - this.checkIn) / 60000);
  }
  next();
});

attendanceSchema.statics.STATUSES = ATTENDANCE_STATUS;

module.exports = mongoose.model('Attendance', attendanceSchema);
module.exports.ATTENDANCE_STATUS = ATTENDANCE_STATUS;
