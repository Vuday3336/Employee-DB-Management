'use strict';

/**
 * Strips Mongo operator keys ($gt, $ne, dotted paths) from user input so a crafted
 * body like {"email": {"$ne": null}} cannot turn a findOne into a match-anything query.
 */
function scrub(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  const clean = {};
  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith('$') || key.includes('.')) continue;
    clean[key] = scrub(val, depth + 1);
  }
  return clean;
}

module.exports = (req, _res, next) => {
  if (req.body) req.body = scrub(req.body);
  if (req.params) req.params = scrub(req.params);
  // req.query is a getter on Express 5-style requests; mutate in place where possible.
  if (req.query) {
    const cleaned = scrub(req.query);
    for (const key of Object.keys(req.query)) if (!(key in cleaned)) delete req.query[key];
    Object.assign(req.query, cleaned);
  }
  next();
};
