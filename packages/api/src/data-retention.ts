import { sql } from 'drizzle-orm';
import { SCHEDULE_CHANGES_RETENTION_DAYS_DEFAULT } from '@fluxure/shared';
import { db } from './db/pg-index.js';
import { createLogger } from './logger.js';
import { revertExpiredTrials } from './billing/trial.js';

const log = createLogger('data-retention');

/** Activity log entries older than 180 days are deleted. */
const ACTIVITY_LOG_RETENTION_DAYS = 180;

/** Used or expired password reset tokens older than 24 hours are deleted. */
const PASSWORD_RESET_CLEANUP_HOURS = 24;

/** Schedule changes retention (days). */
const SCHEDULE_CHANGES_RETENTION_DAYS = SCHEDULE_CHANGES_RETENTION_DAYS_DEFAULT;

/** Stripe webhook events older than 90 days are deleted. */
const STRIPE_WEBHOOK_EVENTS_RETENTION_DAYS = 90;

/** Retention cleanup runs every 6 hours. */
const RETENTION_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Default batch size for cleanup DELETEs to avoid long-running locks. */
const CLEANUP_BATCH_SIZE = 5000;

/** Pause between batched deletes (ms) to reduce lock contention. */
const CLEANUP_BATCH_PAUSE_MS = 100;

/** Calendar events older than 30 days (past end date) are deleted. */
const CALENDAR_EVENTS_RETENTION_DAYS = 30;

type CleanupTable =
  | 'activity_log'
  | 'password_resets'
  | 'sessions'
  | 'schedule_changes'
  | 'email_verifications'
  | 'oauth_states'
  | 'stripe_webhook_events'
  | 'calendar_events';

/** Runtime whitelist of tables allowed in cleanup DELETEs (defense-in-depth against SQL injection). */
const VALID_CLEANUP_TABLES: ReadonlySet<string> = new Set<CleanupTable>([
  'activity_log',
  'password_resets',
  'sessions',
  'schedule_changes',
  'email_verifications',
  'oauth_states',
  'stripe_webhook_events',
  'calendar_events',
]);

/**
 * Delete rows in batches to avoid long-running locks on large tables.
 * Uses a subquery with LIMIT to cap each DELETE.
 */
async function batchDeleteByCondition(
  tableName: CleanupTable,
  conditionSql: ReturnType<typeof sql>,
  batchSize: number = CLEANUP_BATCH_SIZE,
): Promise<number> {
  if (!VALID_CLEANUP_TABLES.has(tableName)) {
    throw new Error(`Invalid cleanup table: ${tableName}`);
  }
  let deleted = 0;
  while (true) {
    const result = await db.execute(sql`
      DELETE FROM ${sql.identifier(tableName)} WHERE id IN (
        SELECT id FROM ${sql.identifier(tableName)} WHERE ${conditionSql} LIMIT ${batchSize}
      )
    `);
    const count = (result as { rowCount?: number }).rowCount ?? 0;
    deleted += count;
    if (count < batchSize) break;
    await new Promise((r) => setTimeout(r, CLEANUP_BATCH_PAUSE_MS));
  }
  return deleted;
}

export async function cleanupActivityLog(): Promise<number> {
  const cutoff = new Date(
    Date.now() - ACTIVITY_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return batchDeleteByCondition('activity_log', sql`created_at < ${cutoff}`);
}

export async function cleanupPasswordResets(): Promise<number> {
  const cutoff = new Date(Date.now() - PASSWORD_RESET_CLEANUP_HOURS * 60 * 60 * 1000).toISOString();
  return batchDeleteByCondition(
    'password_resets',
    sql`created_at < ${cutoff} AND (used_at IS NOT NULL OR expires_at < NOW())`,
  );
}

export async function cleanupExpiredSessions(): Promise<number> {
  return batchDeleteByCondition('sessions', sql`expires_at < NOW()`);
}

export async function cleanupScheduleChanges(): Promise<number> {
  const cutoff = new Date(
    Date.now() - SCHEDULE_CHANGES_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return batchDeleteByCondition('schedule_changes', sql`created_at < ${cutoff}`);
}

export async function cleanupStripeWebhookEvents(): Promise<number> {
  const cutoff = new Date(
    Date.now() - STRIPE_WEBHOOK_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return batchDeleteByCondition('stripe_webhook_events', sql`processed_at < ${cutoff}`);
}

export async function cleanupExpiredVerifications(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(); // 24h expiry
  return batchDeleteByCondition(
    'email_verifications',
    sql`${sql.identifier('expires_at')} < ${cutoff}`,
  );
}

export async function cleanupCalendarEvents(): Promise<number> {
  const cutoff = new Date(
    Date.now() - CALENDAR_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  return batchDeleteByCondition('calendar_events', sql`"end" < ${cutoff}`);
}

async function runRetentionCleanup(): Promise<void> {
  try {
    const [
      activityDeleted,
      resetsDeleted,
      sessionsDeleted,
      changesDeleted,
      verificationsDeleted,
      webhookEventsDeleted,
      calendarEventsDeleted,
      trialsReverted,
    ] = await Promise.all([
      cleanupActivityLog(),
      cleanupPasswordResets(),
      cleanupExpiredSessions(),
      cleanupScheduleChanges(),
      cleanupExpiredVerifications(),
      cleanupStripeWebhookEvents(),
      cleanupCalendarEvents(),
      revertExpiredTrials(),
    ]);

    if (
      activityDeleted > 0 ||
      resetsDeleted > 0 ||
      sessionsDeleted > 0 ||
      changesDeleted > 0 ||
      verificationsDeleted > 0 ||
      webhookEventsDeleted > 0 ||
      calendarEventsDeleted > 0 ||
      trialsReverted > 0
    ) {
      log.info(
        {
          activityDeleted,
          resetsDeleted,
          sessionsDeleted,
          changesDeleted,
          verificationsDeleted,
          webhookEventsDeleted,
          calendarEventsDeleted,
          trialsReverted,
        },
        'Data retention cleanup completed',
      );
    }
  } catch (err) {
    log.error({ err }, 'Data retention cleanup failed');
  }
}

let startupTimeout: ReturnType<typeof setTimeout> | null = null;
let retentionInterval: ReturnType<typeof setInterval> | null = null;

/** Start periodic data retention cleanup (fallback when BullMQ unavailable). Runs immediately then every 6 hours. */
export function startRetentionCleanupFallback(): void {
  // Run once at startup (delayed 30s to avoid competing with migrations/startup)
  startupTimeout = setTimeout(() => {
    startupTimeout = null;
    runRetentionCleanup();
  }, 30_000);

  retentionInterval = setInterval(runRetentionCleanup, RETENTION_CLEANUP_INTERVAL_MS);
}

/** Stop the periodic retention cleanup timer. */
export function stopRetentionCleanup(): void {
  if (startupTimeout) {
    clearTimeout(startupTimeout);
    startupTimeout = null;
  }
  if (retentionInterval) {
    clearInterval(retentionInterval);
    retentionInterval = null;
  }
}
