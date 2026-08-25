'use strict';
const { AuditLog } = require('../models');
const logger = require('../utils/logger');

/** Shallow before/after diff so the trail stores what changed, not whole documents. */
function diff(before = {}, after = {}) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (['updatedAt', 'createdAt', '__v', '_id'].includes(key)) continue;
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}

/**
 * Audit writes are deliberately fire-and-forget: a trail failure must never turn a
 * successful HR action into a 500. Failures are logged loudly instead.
 */
async function record(req, { action, entity, entityId, before, after, outcome = 'success', actor }) {
  try {
    // Login and registration run before authenticate(), so the actor is passed in
    // explicitly there rather than read off req.user.
    const principal = actor || req.user;
    await AuditLog.create({
      actor: principal?._id,
      actorEmail: principal?.email,
      actorRole: principal?.role,
      action,
      entity,
      entityId,
      changes: before || after ? diff(before, after) : undefined,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      outcome,
    });
  } catch (err) {
    logger.error('Failed to write audit log', err.message);
  }
}

module.exports = { record, diff };
