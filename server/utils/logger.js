'use strict';
const env = require('../config/env');

const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const active = levels[process.env.LOG_LEVEL] ?? (env.isTest ? levels.error : levels.info);

const stamp = () => new Date().toISOString();

const log = (level, ...args) => {
  if (levels[level] > active) return;
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${stamp()}] ${level.toUpperCase()}`, ...args);
};

module.exports = {
  error: (...a) => log('error', ...a),
  warn: (...a) => log('warn', ...a),
  info: (...a) => log('info', ...a),
  debug: (...a) => log('debug', ...a),
};
