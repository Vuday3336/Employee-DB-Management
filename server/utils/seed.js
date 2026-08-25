'use strict';
/**
 * Loads the demo organisation by executing db/seed.sql.
 *
 * The seed lives in SQL rather than JavaScript so the same script can be run
 * through this command, through psql, or straight from the Supabase SQL editor —
 * and so the whole thing commits or rolls back as one transaction.
 *
 *   npm run seed
 *
 * WARNING: truncates every table first. Never point it at real data.
 */
const fs = require('fs');
const path = require('path');
const { db, disconnect } = require('../db');
const logger = require('./logger');

async function run() {
  const file = path.join(__dirname, '..', 'db', 'seed.sql');
  logger.info('Seeding — this truncates every table first.');

  await db.unsafe(fs.readFileSync(file, 'utf8'));

  const [counts] = await db`
    select
      (select count(*) from employees)           as employees,
      (select count(*) from users)               as users,
      (select count(*) from attendance)          as attendance,
      (select count(*) from leave_requests)      as leave_requests,
      (select count(*) from performance_reviews) as reviews`;

  logger.info(`Seeded ${counts.employees} employees, ${counts.users} accounts`);
  logger.info(`        ${counts.attendance} attendance rows, ${counts.leave_requests} leave requests`);
  logger.info(`        ${counts.reviews} performance reviews`);
  logger.info('');
  logger.info('=== Demo accounts (password: Password@123) ===');
  logger.info('  admin    aditi.rao@empcore.dev');
  logger.info('  manager  sofia.ramirez@empcore.dev   (Engineering Manager, 4 reports)');
  logger.info('  employee wei.chen@empcore.dev');
  logger.info('');

  await disconnect();
}

run().catch(async (err) => {
  logger.error('Seed failed:', err.message);
  await disconnect().catch(() => {});
  process.exit(1);
});
