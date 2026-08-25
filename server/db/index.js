'use strict';
/**
 * Postgres access layer.
 *
 * Queries are written as tagged templates — `sql`${value}`` interpolates as a bound
 * parameter, never as string concatenation, so user input cannot alter the query.
 *
 * The connection targets Supabase's transaction pooler in production because the API
 * runs as serverless functions: each invocation would otherwise open its own direct
 * connection and exhaust the server's limit under any real traffic. pgbouncer in
 * transaction mode cannot reuse prepared statements, hence `prepare: false`.
 */
const postgres = require('postgres');
const env = require('../config/env');
const logger = require('../utils/logger');

let sql = null;

function connect(url = env.DATABASE_URL) {
  if (sql) return sql;
  if (!url) throw new Error('DATABASE_URL is not set');

  const pooled = /pooler\.supabase\.com/.test(url) || /[?&]pgbouncer=true/.test(url);

  sql = postgres(url, {
    max: env.isServerless ? 1 : 10,
    idle_timeout: env.isServerless ? 20 : 0,
    connect_timeout: 15,
    prepare: !pooled,
    ssl: /supabase|amazonaws|render/.test(url) ? { rejectUnauthorized: false } : undefined,
    onnotice: () => {},
    transform: { undefined: null },
  });

  return sql;
}

/** Lazily-initialised handle so `require`ing this module never opens a socket. */
const db = new Proxy(function () {}, {
  apply(_target, _thisArg, args) {
    return connect()(...args);
  },
  get(_target, prop) {
    const client = connect();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

async function healthCheck() {
  const [row] = await db`select 1 as ok`;
  return row.ok === 1;
}

async function disconnect() {
  if (!sql) return;
  await sql.end({ timeout: 5 });
  sql = null;
}

async function init() {
  await healthCheck();
  const host = (env.DATABASE_URL.match(/@([^/:]+)/) || [])[1] || 'unknown';
  logger.info(`Postgres connected: ${host}`);
}

module.exports = { db, connect, disconnect, init, healthCheck };
