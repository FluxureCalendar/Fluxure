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
    const sslEnv = (process.env.DATABASE_SSL ?? '').toLowerCase();
    const TRUTHY = new Set(['true', 'yes', '1', 'on']);
    const FALSY = new Set(['false', 'no', '0', 'off', '']);

    let sslEnabled: boolean;
    if (TRUTHY.has(sslEnv)) {
      sslEnabled = true;
    } else if (FALSY.has(sslEnv)) {
      sslEnabled = isProduction;
    } else {
      log.warn({ value: sslEnv }, 'Unrecognized DATABASE_SSL value, defaulting to false');
      sslEnabled = false;
    }

    const sslConfig = sslEnabled
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
