'use strict';
const { db } = require('../db');
const logger = require('../utils/logger');

const SKIP = new Set(['updatedAt', 'createdAt', 'updated_at', 'created_at', 'id', '_id']);

/** Shallow before/after diff so the trail stores what changed, not whole rows. */
function diff(before = {}, after = {}) {
  const changes = {};
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  for (const key of keys) {
    if (SKIP.has(key)) continue;
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}

/**
 * Audit writes are deliberately fire-and-forget: a trail failure must never turn a
 * successful HR action into a 500. Failures are logged loudly instead.
 *
 * Denials are recorded as well as successes — a run of `denied` rows from one
 * account is what an attempted privilege escalation looks like from the inside.
 */
async function record(req, { action, entity, entityId, before, after, outcome = 'success', actor }) {
  try {
    // Login and registration run before authenticate(), so the actor is passed
    // in explicitly there rather than read off req.user.
    const principal = actor || req.user;
    const changes = before || after ? diff(before, after) : null;

    await db`
      insert into audit_logs (actor_id, actor_email, actor_role, action, entity, entity_id, changes, ip, user_agent, outcome)
      values (
        ${principal?.id || principal?._id || null},
        ${principal?.email || null},
        ${principal?.role || null},
        ${action},
        ${entity},
        ${entityId || null},
        ${changes ? JSON.stringify(changes) : null}::jsonb,
        ${req.ip || null},
        ${req.headers?.['user-agent'] || null},
        ${outcome}
      )`;
  } catch (err) {
    logger.error('Failed to write audit log:', err.message);
  }
}

module.exports = { record, diff };
