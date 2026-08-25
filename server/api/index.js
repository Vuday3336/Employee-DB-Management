'use strict';
/**
 * Vercel serverless entry point.
 *
 * Vercel invokes an exported request handler; an Express app is one. server.js is
 * deliberately not used here — it creates an HTTP server, attaches Socket.IO and
 * starts the cron scheduler, none of which survive in a function that is torn down
 * between requests. See docs/deployment.md for what that trade costs.
 */
module.exports = require('../app');
