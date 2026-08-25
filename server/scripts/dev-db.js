'use strict';
/**
 * Starts a local MongoDB for development without installing MongoDB system-wide.
 *
 * It reuses the real `mongod` binary that `mongodb-memory-server` (a dev dependency)
 * already downloads for the test suite, but points it at a persistent folder so your
 * data survives restarts — unlike the throwaway instance the tests use.
 *
 *   npm run db          # foreground, Ctrl-C to stop
 *   npm run db -- --port 27018
 *
 * This is a convenience for local development only. For anything real, use a proper
 * MongoDB installation or a hosted cluster (see the README).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { MongoBinary } = require('mongodb-memory-server');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const port = arg('port', '27017');
const dbPath = path.resolve(__dirname, '..', '.mongo-data');

async function main() {
  fs.mkdirSync(dbPath, { recursive: true });

  console.log('Resolving a mongod binary (first run may download ~90 MB)…');
  const binary = await MongoBinary.getPath({});

  console.log(`\n  mongod   ${binary}`);
  console.log(`  data     ${dbPath}`);
  console.log(`  listening on mongodb://127.0.0.1:${port}\n`);
  console.log('  Leave this window open, then in another terminal:');
  console.log('    npm run seed     (first time only)');
  console.log('    npm run dev\n');

  const child = spawn(
    binary,
    ['--dbpath', dbPath, '--port', port, '--bind_ip', '127.0.0.1'],
    { stdio: 'inherit' }
  );

  const stop = () => child.kill('SIGINT');
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  child.on('exit', (code) => process.exit(code ?? 0));
  child.on('error', (err) => {
    console.error('Failed to start mongod:', err.message);
    process.exit(1);
  });
}

main().catch((err) => {
  console.error('Could not start the development database:', err.message);
  console.error('\nInstall MongoDB Community Server or use a hosted cluster instead —');
  console.error('see the "Database" section of the README.');
  process.exit(1);
});
