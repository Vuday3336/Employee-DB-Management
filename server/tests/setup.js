'use strict';
process.env.NODE_ENV = 'test';
process.env.ENABLE_CRON = 'false';
process.env.JWT_ACCESS_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

const fs = require('fs');
const path = require('path');

/**
 * The suite needs a real Postgres — the authorization rules it verifies are
 * expressed as recursive CTEs and constraints, so an in-memory fake would be
 * testing something other than what runs in production.
 *
 * Point DATABASE_URL_TEST at a throwaway database (a local Postgres, or a second
 * Supabase project). It is created from db/schema.sql on first run and truncated
 * between tests. It must NOT be the database holding real data — the suite
 * truncates every table.
 */
const TEST_URL = process.env.DATABASE_URL_TEST;

if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

let db;
let disconnect;

const available = Boolean(TEST_URL);

async function connect() {
  ({ db, disconnect } = require('../db'));
  const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await db.unsafe(schema);
}

async function close() {
  if (disconnect) await disconnect();
}

/** Wipe between tests; `restart identity` keeps sequences predictable. */
async function clear() {
  await db.unsafe(`
    truncate audit_logs, notifications, performance_reviews, leave_request_history,
             leave_requests, leave_balances, attendance, holidays, users, employees,
             departments, leave_policies restart identity cascade`);
}

/**
 * Jest has no first-class "skip this whole file", so each suite calls this and
 * bails with a visible message rather than failing confusingly on a missing
 * connection string.
 */
function requireDatabase() {
  if (!available) {
    // eslint-disable-next-line no-console
    console.warn(
      '\n  SKIPPED: set DATABASE_URL_TEST to a throwaway Postgres database to run this suite.\n'
    );
  }
  return available;
}

module.exports = { connect, close, clear, requireDatabase, available, getDb: () => db };
