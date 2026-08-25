'use strict';
const rateLimit = require('express-rate-limit');
const env = require('../config/env');

const base = {
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.isTest,
  message: { success: false, message: 'Too many requests, please slow down' },
};

// Brute-force guard on credential endpoints, keyed per IP.
const authLimiter = rateLimit({ ...base, windowMs: 15 * 60 * 1000, limit: 10 });
const apiLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 300 });
const writeLimiter = rateLimit({ ...base, windowMs: 60 * 1000, limit: 60 });

module.exports = { authLimiter, apiLimiter, writeLimiter };
