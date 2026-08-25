'use strict';
const mongoose = require('mongoose');

const REVIEW_STATUS = ['draft', 'submitted', 'acknowledged'];
const COMPETENCIES = ['delivery', 'quality', 'collaboration', 'ownership', 'communication'];

const scoreSchema = new mongoose.Schema(
  {
    competency: { type: String, enum: COMPETENCIES, required: true },
    score: { type: Number, required: true, min: 1, max: 5 },
  },
  { _id: false }
);

const performanceReviewSchema = new mongoose.Schema(
  {
    employee: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    period: {
      year: { type: Number, required: true, min: 2000 },
      quarter: { type: Number, required: true, min: 1, max: 4 },
    },
    scores: { type: [scoreSchema], default: [] },
    rating: { type: Number, required: true, min: 1, max: 5 },
    strengths: { type: String, trim: true, maxlength: 2000 },
    improvements: { type: String, trim: true, maxlength: 2000 },
    comments: { type: String, trim: true, maxlength: 2000 },
    goals: { type: [String], default: [] },
    status: { type: String, enum: REVIEW_STATUS, default: 'draft', index: true },
    submittedAt: Date,
    employeeComment: { type: String, trim: true, maxlength: 1000 },
    acknowledgedAt: Date,
  },
  { timestamps: true }
);

// One review per employee per review period, whoever the reviewer is.
performanceReviewSchema.index({ employee: 1, 'period.year': 1, 'period.quarter': 1 }, { unique: true });

// pre('validate') rather than pre('save'): Mongoose registers its own validation
// hook first, so a rating derived in a save hook would arrive too late for the
// `required` check on the field.
performanceReviewSchema.pre('validate', function (next) {
  if (this.scores.length) {
    const avg = this.scores.reduce((sum, s) => sum + s.score, 0) / this.scores.length;
    this.rating = Math.round(avg * 10) / 10;
  }
  next();
});

performanceReviewSchema.statics.STATUSES = REVIEW_STATUS;
performanceReviewSchema.statics.COMPETENCIES = COMPETENCIES;

module.exports = mongoose.model('PerformanceReview', performanceReviewSchema);
module.exports.REVIEW_STATUS = REVIEW_STATUS;
module.exports.COMPETENCIES = COMPETENCIES;
