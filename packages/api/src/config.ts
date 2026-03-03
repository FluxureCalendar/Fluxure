/**
 * Resolved runtime configuration — the single env-override layer for the API.
 * Every process.env read happens here; consumers import resolved values.
 * All values are read once at module load time for consistency.
 */

import { randomUUID } from 'crypto';

import {
  BRAND,
  MS_PER_MINUTE,
  MS_PER_DAY,
  DEFAULT_PORT,
  DEFAULT_CORS_ORIGIN,
  DEFAULT_APP_URL,
  DEFAULT_JSON_BODY_LIMIT,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  DEFAULT_LOG_LEVEL,
  DEFAULT_LOG_LEVEL_DEV,
  DEFAULT_WORKER_POOL_SIZE,
  DEFAULT_SMTP_PORT,
  DEFAULT_SMTP_FROM,
  CANDIDATE_STEP_MINUTES as CANDIDATE_STEP_MINUTES_SHARED,
  WATCH_RENEWAL_BUFFER_MS as WATCH_RENEWAL_BUFFER_MS_SHARED,
  WATCH_RENEWAL_CHECK_MS_DEFAULT,
  SCHEDULE_CHANGES_RETENTION_DAYS_DEFAULT,
  PG_POOL_MAX_DEFAULT,
  PG_IDLE_TIMEOUT_MS_DEFAULT,
  PG_CONNECT_TIMEOUT_MS_DEFAULT,
  PG_STATEMENT_TIMEOUT_MS_DEFAULT,
  REDIS_MAX_RETRIES_DEFAULT,
  REDIS_CONNECT_TIMEOUT_MS_DEFAULT,
} from '@fluxure/shared';

function envInt(key: string, defaultValue: number): number {
  const raw = process.env[key];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function envStr(key: string, defaultValue: string): string {
  return process.env[key] ?? defaultValue;
}

// ── Instance ─────────────────────────────────────────────────

/** Unique identifier for this API instance. Used for distributed coordination. */
export const INSTANCE_ID = process.env.INSTANCE_ID || randomUUID();

// ── Server ──────────────────────────────────────────────────

/** Server listen port. Default: 3000 */
export const PORT = envInt('PORT', DEFAULT_PORT);

/** Comma-separated allowed origins for CORS. Default: http://localhost:5173 */
export const CORS_ORIGIN = envStr('CORS_ORIGIN', DEFAULT_CORS_ORIGIN);

/** Parsed array of allowed origins for CORS, CSP, and WebSocket origin checks. */
export const allowedOrigins = CORS_ORIGIN.split(',').map((o) => o.trim());

/** Frontend URL for email links, OAuth redirects. Falls back to first CORS origin, then default. */
export const FRONTEND_URL =
  process.env.FRONTEND_URL || process.env.CORS_ORIGIN?.split(',')[0]?.trim() || DEFAULT_APP_URL;

/** Express JSON body size limit. Default: 64kb */
export const JSON_BODY_LIMIT = envStr('JSON_BODY_LIMIT', DEFAULT_JSON_BODY_LIMIT);

/** Graceful shutdown timeout (ms). Default: 15s */
export const SHUTDOWN_TIMEOUT_MS = envInt('SHUTDOWN_TIMEOUT_MS', DEFAULT_SHUTDOWN_TIMEOUT_MS);

/** Log level. Default: 'info' in production, 'debug' in development */
export const LOG_LEVEL = envStr(
  'LOG_LEVEL',
  process.env.NODE_ENV === 'production' ? DEFAULT_LOG_LEVEL : DEFAULT_LOG_LEVEL_DEV,
);

/** Worker pool size for scheduling computation. Default: 2 */
export const WORKER_POOL_SIZE = envInt('WORKER_POOL_SIZE', DEFAULT_WORKER_POOL_SIZE);

// ── SMTP ────────────────────────────────────────────────────

/** SMTP port. Default: 587 */
export const SMTP_PORT = envInt('SMTP_PORT', DEFAULT_SMTP_PORT);

/** SMTP From address. Default: Fluxure <noreply@fluxure.app> */
export const SMTP_FROM = envStr('SMTP_FROM', `${BRAND.name} <${DEFAULT_SMTP_FROM}>`);

// ── Google Calendar ─────────────────────────────────────────

/** Polling interval for Google Calendar sync when in polling mode (ms). Default: 60s */
export const POLL_INTERVAL_MS = envInt('POLL_INTERVAL_MS', MS_PER_MINUTE);

/** Fallback polling interval in push mode (ms). Default: 30 min */
export const PUSH_FALLBACK_POLL_MS = envInt('PUSH_FALLBACK_POLL_MS', 30 * MS_PER_MINUTE);

/** TTL for Google Calendar watch channels (ms). Default: 30 days */
export const WATCH_CHANNEL_TTL_MS = envInt('WATCH_CHANNEL_TTL_DAYS', 30) * MS_PER_DAY;

/** How often to check for expiring watch channels (ms). Default: 6 hours */
export const WATCH_RENEWAL_CHECK_MS = envInt(
  'WATCH_RENEWAL_CHECK_MS',
  WATCH_RENEWAL_CHECK_MS_DEFAULT,
);

/** Buffer before channel expiry to trigger renewal (ms). Default: 12 hours */
export const WATCH_RENEWAL_BUFFER_MS = WATCH_RENEWAL_BUFFER_MS_SHARED;

// ── Scheduling ──────────────────────────────────────────────

/** Idle timeout before destroying a user scheduler (ms). Default: 15 min */
export const IDLE_TIMEOUT_MS = envInt('IDLE_TIMEOUT_MS', 15 * MS_PER_MINUTE);

/** Slot step for candidate generation in the engine (minutes). Default: 30 */
export const SLOT_STEP_MINUTES = envInt('SLOT_STEP_MINUTES', CANDIDATE_STEP_MINUTES_SHARED);

/** Retention period for schedule_changes rows (days). Default: 90 */
export const SCHEDULE_CHANGES_RETENTION_DAYS = envInt(
  'SCHEDULE_CHANGES_RETENTION_DAYS',
  SCHEDULE_CHANGES_RETENTION_DAYS_DEFAULT,
);

// ── PostgreSQL ──────────────────────────────────────────────

/** PostgreSQL connection pool max connections. Default: 50 */
export const PG_POOL_MAX = envInt('PG_POOL_MAX', PG_POOL_MAX_DEFAULT);

/** PostgreSQL idle timeout (ms). Default: 30s */
export const PG_IDLE_TIMEOUT_MS = envInt('PG_IDLE_TIMEOUT_MS', PG_IDLE_TIMEOUT_MS_DEFAULT);

/** PostgreSQL connect timeout (ms). Default: 5s */
export const PG_CONNECT_TIMEOUT_MS = envInt('PG_CONNECT_TIMEOUT_MS', PG_CONNECT_TIMEOUT_MS_DEFAULT);

/** PostgreSQL statement timeout (ms). Default: 30s */
export const PG_STATEMENT_TIMEOUT_MS = envInt(
  'PG_STATEMENT_TIMEOUT_MS',
  PG_STATEMENT_TIMEOUT_MS_DEFAULT,
);

// ── Redis ───────────────────────────────────────────────────

/** Redis max retries per request. Default: 3 */
export const REDIS_MAX_RETRIES = envInt('REDIS_MAX_RETRIES', REDIS_MAX_RETRIES_DEFAULT);

/** Redis connect timeout (ms). Default: 5s */
export const REDIS_CONNECT_TIMEOUT_MS = envInt(
  'REDIS_CONNECT_TIMEOUT_MS',
  REDIS_CONNECT_TIMEOUT_MS_DEFAULT,
);

// ── Stripe ──────────────────────────────────────────────────
// Stripe config uses lazy getters because dotenv.config() runs at the top of
// index.ts but ES module imports are hoisted above it, so process.env isn't
// populated yet when this module first evaluates.

/** Stripe secret API key (read lazily from process.env) */
export function getStripeSecretKey(): string {
  return process.env.STRIPE_SECRET_KEY ?? '';
}

/** Stripe webhook signing secret (read lazily from process.env) */
export function getStripeWebhookSecret(): string {
  return process.env.STRIPE_WEBHOOK_SECRET ?? '';
}

/** Stripe Price ID for Pro monthly plan (read lazily from process.env) */
export function getStripeProMonthlyPriceId(): string {
  return process.env.STRIPE_PRO_MONTHLY_PRICE_ID ?? '';
}

/** Stripe Price ID for Pro annual plan (read lazily from process.env) */
export function getStripeProAnnualPriceId(): string {
  return process.env.STRIPE_PRO_ANNUAL_PRICE_ID ?? '';
}
