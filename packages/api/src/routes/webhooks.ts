import { Router } from 'express';
import { timingSafeEqual, createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { calendars } from '../db/pg-schema.js';
import { schedulerRegistry } from '../scheduler-registry.js';
import { isOwner } from '../distributed/scheduler-owner.js';
import { getRescheduleQueue } from '../jobs/queues.js';
import { createLogger } from '../logger.js';

const log = createLogger('webhook');

/** Hash a webhook token with SHA-256 (matches storage format in poller-manager). */
function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time comparison of two hex-encoded SHA-256 hashes.
 * Both inputs are already fixed-length (64 hex chars), so we can
 * compare directly without re-hashing.
 */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const router = Router();

/**
 * Google Calendar push notification webhook.
 * Google sends POST with headers only (empty body).
 * Must respond 200 quickly; actual sync happens async.
 */
router.post('/google-calendar', (req, res) => {
  // Respond immediately; Google retries on 5xx
  res.status(200).end();

  const channelId = req.headers['x-goog-channel-id'] as string | undefined;
  const resourceId = req.headers['x-goog-resource-id'] as string | undefined;
  const resourceState = req.headers['x-goog-resource-state'] as string | undefined;
  const token = req.headers['x-goog-channel-token'] as string | undefined;

  if (!channelId || !resourceId) {
    log.warn('Missing channel/resource ID headers');
    return;
  }

  // Initial "sync" notification when a channel is created
  if (resourceState === 'sync') {
    log.info({ channelId }, 'Sync notification');
    return;
  }

  // Calendar was deleted upstream
  if (resourceState === 'not_exists') {
    log.info({ channelId }, 'Resource deleted notification');
    return;
  }

  void (async () => {
    try {
      const rows = await db.select().from(calendars).where(eq(calendars.watchChannelId, channelId));
      const cal = rows[0];

      if (!cal) {
        // Stale channel from a previous deployment; will auto-expire
        return;
      }

      // Constant-time token verification against stored hash
      const incomingTokenHash = token ? hashWebhookToken(token) : '';
      if (!cal.watchToken || !token || !safeEqualHex(cal.watchToken, incomingTokenHash)) {
        log.warn({ channelId }, 'Token mismatch');
        return;
      }

      if (cal.watchResourceId && cal.watchResourceId !== resourceId) {
        log.warn({ channelId }, 'Resource ID mismatch');
        return;
      }

      log.info({ userId: cal.userId, calId: cal.id }, 'Calendar change notification');

      // Route to BullMQ if this user's scheduler is owned by another instance
      if (!(await isOwner(cal.userId))) {
        const queue = getRescheduleQueue();
        if (queue) {
          await queue.add(
            'reschedule',
            { userId: cal.userId, reason: 'Webhook: calendar change' },
            { jobId: `reschedule-${cal.userId}` },
          );
          log.info({ userId: cal.userId }, 'Webhook routed to reschedule queue (not owner)');
          return;
        }
      }

      await schedulerRegistry.handleWebhookNotification(cal.userId, cal.id);
    } catch (err) {
      log.error({ channelId, err }, 'Error processing notification');
    }
  })();
});

export default router;
