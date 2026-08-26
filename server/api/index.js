'use strict';
/**
 * Vercel serverless entry point.
 *
 * Vercel invokes an exported request handler; an Express app is one. server.js is
 * deliberately not used here — it creates an HTTP server, attaches Socket.IO and
 * starts the cron scheduler, none of which survive in a function that is torn down
 * between requests. See docs/deployment.md for what that trade costs.
 *
 * vercel.json pins the function to bom1 (Mumbai) to sit next to the Supabase
 * project. Running it in the US default put ~400ms of round trip on every single
 * query, which the dashboard — a dozen of them — turned into a timeout. Move the
 * region if you move the database.
 */
module.exports = require('../app');
