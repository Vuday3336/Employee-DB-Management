'use strict';
const http = require('http');
const app = require('./app');
const env = require('./config/env');
const logger = require('./utils/logger');
const { init, disconnect } = require('./db');
const { initRealtime } = require('./services/realtime');
const { startJobs, stopJobs } = require('./jobs');

async function bootstrap() {
  await init();

  const server = http.createServer(app);
  initRealtime(server);
  if (env.ENABLE_CRON) startJobs();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      logger.error(`Port ${env.PORT} is already in use. Set PORT in .env to a free port.`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(env.PORT, () => {
    logger.info(`EmpCore API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
    logger.info(`API docs: http://localhost:${env.PORT}/api/docs`);
  });

  const shutdown = (signal) => async () => {
    logger.info(`${signal} received, shutting down`);
    stopJobs();
    server.close(async () => {
      await disconnect();
      process.exit(0);
    });
    // Don't hang forever on a stuck connection.
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => {
    logger.error('Unhandled rejection:', err);
  });
}

bootstrap().catch((err) => {
  logger.error('Failed to start server:', err);
  process.exit(1);
});
