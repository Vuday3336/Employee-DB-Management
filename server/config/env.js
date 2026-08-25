'use strict';
require('dotenv').config();

const required = (key, fallback) => {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT || 5000),
  DATABASE_URL: required('DATABASE_URL', ''),
  JWT_ACCESS_SECRET: required('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
  JWT_REFRESH_SECRET: required('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
  ACCESS_TOKEN_TTL: process.env.ACCESS_TOKEN_TTL || '15m',
  REFRESH_TOKEN_TTL: process.env.REFRESH_TOKEN_TTL || '7d',
  CLIENT_ORIGIN: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  WORK_DAY_START: process.env.WORK_DAY_START || '09:15',
  ENABLE_CRON: process.env.ENABLE_CRON !== 'false' && !process.env.VERCEL,
  // 'none' for a split client/API deploy, 'lax' when both share a domain.
  COOKIE_SAMESITE: process.env.COOKIE_SAMESITE || (process.env.NODE_ENV === 'production' ? 'none' : 'lax'),
};

env.isProd = env.NODE_ENV === 'production';
env.isTest = env.NODE_ENV === 'test';
// Vercel runs the API as serverless functions: no long-lived process, so the
// connection pool is kept at one and the cron scheduler never starts.
env.isServerless = Boolean(process.env.VERCEL);

if (env.isProd) {
  ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'].forEach((key) => {
    if (env[key].startsWith('dev-')) {
      throw new Error(`${key} must be set to a strong secret in production`);
    }
  });
}

if (!['none', 'lax', 'strict'].includes(env.COOKIE_SAMESITE)) {
  throw new Error("COOKIE_SAMESITE must be one of: none, lax, strict");
}

module.exports = env;
