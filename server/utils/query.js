'use strict';

const MAX_LIMIT = 100;

/** Parse ?page & ?limit into safe skip/limit values. */
function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || 10));
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Turn ?sort=-hireDate,lastName into a Mongo sort object, refusing any field
 * that is not explicitly allow-listed by the caller.
 */
function parseSort(sortParam, allowed, fallback = { createdAt: -1 }) {
  if (!sortParam) return fallback;
  const sort = {};
  for (const raw of String(sortParam).split(',')) {
    const desc = raw.startsWith('-');
    const field = desc ? raw.slice(1) : raw;
    if (allowed.includes(field)) sort[field] = desc ? -1 : 1;
  }
  return Object.keys(sort).length ? sort : fallback;
}

/** Escape user input before it becomes part of a RegExp. */
const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function buildMeta({ page, limit, total }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return { page, limit, total, pages, hasNext: page < pages, hasPrev: page > 1 };
}

module.exports = { parsePagination, parseSort, escapeRegex, buildMeta };
