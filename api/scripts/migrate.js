#!/usr/bin/env node
/**
 * Runs the db-migrate migrations in api/migrations against DATABASE_URL.
 *
 *   node scripts/migrate.js up       apply everything new (default)
 *   node scripts/migrate.js down     undo the latest migration
 *   node scripts/migrate.js reset    undo everything
 *   node scripts/migrate.js create name   add a new migration with SQL files
 *
 * Connection settings come from the environment rather than database.json, so
 * hosted databases that need TLS (such as Replit's) work without extra setup.
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const DBMigrate = require('db-migrate');

const apiDir = path.resolve(__dirname, '..');
const url =
  process.env.MIGRATE_DATABASE_URL ||
  (process.env.NODE_ENV === 'test'
    ? process.env.TEST_DATABASE_URL || 'postgres://testscript:testscript@localhost:5432/testscript_test'
    : process.env.DATABASE_URL);

if (!url) {
  console.error('DATABASE_URL is not set. On Replit, add a PostgreSQL database from the Database tool.');
  process.exit(1);
}

const local = /sslmode=disable/.test(url) || /localhost|127\.0\.0\.1|@db[:/]/.test(url);

const command = process.argv[2] || 'up';
const dbm = DBMigrate.getInstance(true, {
  cwd: apiDir,
  env: 'app',
  config: {
    app: {
      driver: 'pg',
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: false },
    },
  },
  cmdOptions: { 'migrations-dir': path.join(apiDir, 'migrations'), 'sql-file': true },
});

async function main() {
  switch (command) {
    case 'up':
      await dbm.up();
      break;
    case 'down':
      await dbm.down(1);
      break;
    case 'reset':
      await dbm.reset();
      break;
    case 'create':
      if (!process.argv[3]) throw new Error('Give the migration a name: npm run migrate:create -- add-thing');
      await dbm.create(process.argv[3]);
      break;
    default:
      throw new Error(`Unknown command "${command}". Use up, down, reset or create.`);
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('[migrate] failed:', err && err.message ? err.message : err);
    process.exit(1);
  },
);
