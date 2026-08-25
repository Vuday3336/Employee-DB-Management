'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const ROLES = ['admin', 'manager', 'employee'];

const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email address'],
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, default: 'employee', index: true },
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true },
    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,
    // Bumped on logout / password change so every outstanding refresh token dies.
    tokenVersion: { type: Number, default: 0 },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: Date,
  },
  { timestamps: true }
);

userSchema.virtual('isLocked').get(function () {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
});

userSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
  this.tokenVersion += 1;
};

userSchema.methods.verifyPassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    delete ret.__v;
    return ret;
  },
});

userSchema.statics.ROLES = ROLES;

module.exports = mongoose.model('User', userSchema);
module.exports.ROLES = ROLES;
