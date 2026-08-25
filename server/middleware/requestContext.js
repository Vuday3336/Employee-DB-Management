'use strict';
const crypto = require('crypto');

/** Correlation id echoed on every response and stamped into audit rows and logs. */
module.exports = (req, res, next) => {
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
