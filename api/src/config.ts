import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const env = process.env;
const isProduction = env.NODE_ENV === 'production' || env.REPLIT_DEPLOYMENT === '1';
const isTest = env.NODE_ENV === 'test' || env.VITEST === 'true';

function required(name: string, fallback?: string): string {
  const value = env[name] || fallback;
  if (!value) {
    throw new Error(
      `Missing ${name}. On Replit, add it in the Secrets tool (and in the published app's secrets).`,
    );
  }
  return value;
}

const authMode = (env.AUTH_MODE || 'dev') === 'auth0' ? 'auth0' : 'dev';

export const config = {
  isProduction,
  isTest,
  port: Number(env.PORT || 8080),
  databaseUrl: isTest
    ? env.TEST_DATABASE_URL || 'postgres://testscript:testscript@localhost:5432/testscript_test'
    : required('DATABASE_URL'),
  signingSecret: isProduction
    ? required('APP_SIGNING_SECRET')
    : env.APP_SIGNING_SECRET || 'dev-only-signing-secret-do-not-use-in-production',
  appUrl: (env.APP_URL || '').replace(/\/$/, ''),
  authMode: authMode as 'dev' | 'auth0',
  allowDevLogin: authMode === 'dev' && (!isProduction || env.ALLOW_DEV_LOGIN === 'true'),
  auth0: {
    domain: (env.AUTH0_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    clientId: env.AUTH0_CLIENT_ID || '',
    audience: env.AUTH0_AUDIENCE || 'https://api.testscript.app',
    claimNamespace: env.AUTH0_CLAIM_NAMESPACE || 'https://testscript.app/',
  },
  storageDriver: (env.STORAGE_DRIVER || (env.REPL_ID ? 'replit' : 'local')) as 'replit' | 'local',
  localStorageDir: env.LOCAL_STORAGE_DIR || path.resolve(__dirname, '../data/uploads'),
  sendgridApiKey: env.SENDGRID_API_KEY || '',
  emailFrom: env.EMAIL_FROM || 'no-reply@testscript.app',
  /** Built frontend to serve from the same server; set automatically for `npm start`. */
  webDistDir: env.WEB_DIST_DIR || path.resolve(__dirname, '../../frontend/dist'),
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
};

if (config.authMode === 'auth0' && (!config.auth0.domain || !config.auth0.clientId)) {
  throw new Error('AUTH_MODE=auth0 needs AUTH0_DOMAIN and AUTH0_CLIENT_ID.');
}
if (config.authMode === 'dev' && isProduction && !config.allowDevLogin) {
  // Started in production without real logins configured: refuse to let anyone
  // in as anyone. The site still serves, and sign-in explains what to set.
  console.warn(
    '[auth] AUTH_MODE=dev in a published app: dev login is disabled. Set up Auth0, or set ALLOW_DEV_LOGIN=true for a private preview.',
  );
}
