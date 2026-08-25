'use strict';

/**
 * Zod-backed request validation. Parsed output replaces the raw input, so
 * controllers only ever see coerced, stripped values — never arbitrary keys
 * a client tacked onto the body.
 */
const validate = (schemas) => (req, _res, next) => {
  try {
    if (schemas.body) req.body = schemas.body.parse(req.body);
    if (schemas.params) req.params = { ...req.params, ...schemas.params.parse(req.params) };
    if (schemas.query) req.validatedQuery = schemas.query.parse(req.query);
    next();
  } catch (err) {
    next(err);
  }
};

module.exports = validate;
