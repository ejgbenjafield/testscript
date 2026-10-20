import { execSync } from 'child_process';
import path from 'path';

/** Bring the test database up to the latest schema before the suite runs. */
export default function setup() {
  execSync('node scripts/migrate.js up', {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit',
  });
}
