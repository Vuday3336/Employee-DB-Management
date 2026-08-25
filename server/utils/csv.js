'use strict';

const escapeCell = (value) => {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Neutralise spreadsheet formula injection (=, +, -, @ prefixes).
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** columns: [{ key, header, map? }] */
function toCSV(rows, columns) {
  const header = columns.map((c) => escapeCell(c.header ?? c.key)).join(',');
  const body = rows.map((row) =>
    columns.map((c) => escapeCell(c.map ? c.map(row) : row[c.key])).join(',')
  );
  return [header, ...body].join('\r\n');
}

module.exports = { toCSV };
