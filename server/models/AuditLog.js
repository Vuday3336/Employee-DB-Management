'use strict';
const mongoose = require('mongoose');

// Append-only trail. Writes happen through services/audit.js; nothing updates or
// deletes these documents, and the TTL index is the only thing that removes them.
const auditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    actorEmail: String,
    actorRole: String,
    action: { type: String, required: true, index: true },
    entity: { type: String, required: true, index: true },
    entityId: { type: mongoose.Schema.Types.ObjectId },
    changes: { type: mongoose.Schema.Types.Mixed },
    ip: String,
    userAgent: String,
    outcome: { type: String, enum: ['success', 'denied', 'error'], default: 'success' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
// Retain two years of trail, then let MongoDB expire it.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 730 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
