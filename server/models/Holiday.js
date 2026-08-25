'use strict';
const mongoose = require('mongoose');

const holidaySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    date: { type: Date, required: true, unique: true },
    region: { type: String, default: 'ALL', uppercase: true, trim: true },
    isOptional: { type: Boolean, default: false },
  },
  { timestamps: true }
);

holidaySchema.index({ date: 1, region: 1 });

module.exports = mongoose.model('Holiday', holidaySchema);
