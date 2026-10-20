import { Pool, PoolClient, QueryResult } from 'pg';
import { config } from './config';

function sslFor(url: string) {
  // Replit and most hosted Postgres require TLS; local Docker/dev databases don't.
  if (/sslmode=disable/.test(url)) return undefined;
  if (/localhost|127\.0\.0\.1|@db:/.test(url)) return undefined;
  return { rejectUnauthorized: false };
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: sslFor(config.databaseUrl),
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => console.error('[db] idle client error', err));

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Db {
  query(text: string, params?: unknown[]): Promise<QueryResult<any>>;
}

export async function query<T = any>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T[]> {
  const res = await db.query(text, params);
  return res.rows as T[];
}

export async function one<T = any>(
  text: string,
  params: unknown[] = [],
  db: Db = pool,
): Promise<T | undefined> {
  const rows = await query<T>(text, params, db);
  return rows[0];
}

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Returns a plain boolean rather than a type guard: a string that fails the
// test is still a string (a slug, say), not `never`.
export const isUuid = (v: unknown): boolean => typeof v === 'string' && UUID_RE.test(v);
