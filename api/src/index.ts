import { config } from './config';
import { createApp } from './app';
import { pool } from './db';

const app = createApp();

// Replit (and most hosts) need the server to listen on all interfaces.
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`TestScript listening on :${config.port} (auth: ${config.authMode}, storage: ${config.storageDriver})`);
});

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
