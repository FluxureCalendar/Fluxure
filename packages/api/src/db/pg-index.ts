import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './pg-schema.js';
import {
  PG_POOL_MAX,
  PG_IDLE_TIMEOUT_MS,
  PG_CONNECT_TIMEOUT_MS,
  PG_STATEMENT_TIMEOUT_MS,
} from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('db');
const { Pool } = pg;

let pool: pg.Pool | null = null;
let _db: NodePgDatabase<typeof schema> | null = null;

function getPool(): pg.Pool {
  if (!pool) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL environment variable is required');
    }
    const isProduction = process.env.NODE_ENV === 'production';
    const sslDisabled = process.env.DATABASE_SSL === 'false';

    // SSL enabled by default in production, disabled only with DATABASE_SSL=false
    const sslConfig =
      isProduction && !sslDisabled
        ? { rejectUnauthorized: true }
        : process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== 'false' }
          : false;

    pool = new Pool({
      connectionString: databaseUrl,
      max: PG_POOL_MAX,
      idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: PG_CONNECT_TIMEOUT_MS,
      statement_timeout: PG_STATEMENT_TIMEOUT_MS,
      ssl: sslConfig,
    });
    pool.on('error', (err) => {
      log.error({ err }, 'Unexpected pool error');
    });
  }
  return pool;
}

export const db = new Proxy({} as NodePgDatabase<typeof schema>, {
  get(_target, prop) {
    if (!_db) {
      _db = drizzle(getPool(), { schema });
    }
    return Reflect.get(_db!, prop);
  },
});

export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    _db = null;
  }
}

export { getPool as pool };
