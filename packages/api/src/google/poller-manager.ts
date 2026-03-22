import { randomUUID, createHash } from 'crypto';
import { eq, and, gte } from 'drizzle-orm';
import { SYNC_LOOKBACK_MS } from '@fluxure/shared';
import { db } from '../db/pg-index.js';
import { calendars, calendarEvents, scheduledEvents } from '../db/pg-schema.js';
import { GoogleCalendarClient } from './calendar.js';
import { CalendarPoller } from './polling.js';
import type { CalendarEvent } from '@fluxure/shared';
import {
  PUSH_FALLBACK_POLL_MS,
  WATCH_CHANNEL_TTL_MS,
  WATCH_RENEWAL_CHECK_MS,
  WATCH_RENEWAL_BUFFER_MS,
} from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('poller');

/** Hash a webhook token with SHA-256 before storing in the database. */
export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Manages one CalendarPoller per enabled calendar.
 * Provides methods to start/stop individual pollers when calendars
 * are enabled/disabled.
 */
export class CalendarPollerManager {
  private pollers = new Map<string, CalendarPoller>();
  private userId: string;
  private renewalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private client: GoogleCalendarClient,
    private onChanges: (calendarId: string, events: CalendarEvent[]) => Promise<void>,
    // userId is always provided by UserScheduler; optional only for legacy compat
    userId?: string,
    private onAuthError?: () => Promise<void>,
    private webhookBaseUrl?: string,
  ) {
    this.userId = userId || '';
  }

  get isPushMode(): boolean {
    return !!this.webhookBaseUrl;
  }

  /** Start pollers for all enabled calendars (scoped to user if userId set). */
  async startAll(): Promise<void> {
    const query = this.userId
      ? and(eq(calendars.userId, this.userId), eq(calendars.enabled, true))
      : eq(calendars.enabled, true);
    const enabledCalendars = await db.select().from(calendars).where(query!);

    for (const cal of enabledCalendars) {
      await this.startPoller(cal.id, cal.googleCalendarId);
    }

    this.startRenewalTimer();
  }

  /** Start a poller for a specific calendar. Also does an initial event cache. */
  async startPoller(calId: string, googleCalendarId: string): Promise<void> {
    // Stop existing poller if any
    await this.stopPoller(calId);

    // Initial sync: fetch all events and cache them immediately
    try {
      const calRows = await db.select().from(calendars).where(eq(calendars.id, calId));
      const calRow = calRows[0];
      const syncResult = await this.client.syncEvents(googleCalendarId, calRow?.syncToken || null);

      // Store sync token
      if (syncResult.nextSyncToken) {
        await db
          .update(calendars)
          .set({ syncToken: syncResult.nextSyncToken })
          .where(eq(calendars.id, calId));
      }

      // Cache external events only (skip events managed by THIS instance).
      // Events with Fluxure extended props that don't exist in our scheduledEvents
      // table are from another instance and should be treated as external.
      const now = new Date().toISOString();
      // Use the same lookback window as syncEvents (SYNC_LOOKBACK_MS) so that
      // past managed events (e.g. habits from earlier today/this week) are
      // recognised and not re-imported as external duplicates on restart.
      const lookbackCutoff = new Date(Date.now() - SYNC_LOOKBACK_MS).toISOString();
      const localScheduled = await db
        .select({ googleEventId: scheduledEvents.googleEventId })
        .from(scheduledEvents)
        .where(
          and(eq(scheduledEvents.userId, this.userId), gte(scheduledEvents.end, lookbackCutoff)),
        );
      const localGoogleEventIds = new Set(
        localScheduled.map((r) => r.googleEventId).filter(Boolean),
      );
      const externalEvents = syncResult.events.filter(
        (ev) =>
          ev.start &&
          ev.end &&
          ev.title &&
          (!ev.isManaged || !localGoogleEventIds.has(ev.googleEventId ?? '')),
      );
      await db.transaction(async (tx) => {
        await tx
          .delete(calendarEvents)
          .where(and(eq(calendarEvents.calendarId, calId), eq(calendarEvents.userId, this.userId)));
        if (externalEvents.length > 0) {
          await tx.insert(calendarEvents).values(
            // externalEvents is pre-filtered to have title, start, end set
            externalEvents
              .filter((ev) => ev.title && ev.start && ev.end)
              .map((ev) => ({
                userId: this.userId,
                calendarId: calId,
                googleEventId: ev.googleEventId || '',
                title: ev.title ?? '',
                start: ev.start ?? '',
                end: ev.end ?? '',
                status: ev.status || 'busy',
                location: ev.location || null,
                isAllDay: !(ev.start ?? '').includes('T'),
                updatedAt: now,
              })),
          );
        }
      });
      log.info({ calId, eventCount: syncResult.events.length }, 'Cached events for calendar');
    } catch (err) {
      log.error({ calId, err }, 'Initial sync failed');
    }

    // Register watch channel in push mode
    let watchRegistered = false;
    if (this.webhookBaseUrl) {
      try {
        const channelId = randomUUID();
        const token = randomUUID();
        const address = `${this.webhookBaseUrl}/api/webhooks/google-calendar`;

        const watch = await this.client.watchEvents(
          googleCalendarId,
          address,
          channelId,
          token,
          WATCH_CHANNEL_TTL_MS,
        );

        await db
          .update(calendars)
          .set({
            watchChannelId: channelId,
            watchResourceId: watch.resourceId,
            watchToken: hashWebhookToken(token),
            watchExpiresAt: watch.expiration,
          })
          .where(eq(calendars.id, calId));

        watchRegistered = true;
        log.info({ calId, expires: watch.expiration }, 'Push channel registered');
      } catch (err) {
        log.error({ calId, err }, 'Failed to register push channel, falling back to polling');
      }
    }

    // Use longer fallback interval in push mode (5min vs 15s)
    const intervalMs = watchRegistered ? PUSH_FALLBACK_POLL_MS : undefined;

    const poller = new CalendarPoller(
      this.client,
      googleCalendarId,
      async (events) => {
        const validEvents = events.filter((ev) => {
          if (!ev.title || !ev.start || !ev.end) {
            log.warn(
              { calId, eventId: ev.googleEventId },
              'Skipping event with missing title/start/end',
            );
            return false;
          }
          return true;
        });
        await this.onChanges(calId, validEvents);
      },
      async () => {
        const rows = await db.select().from(calendars).where(eq(calendars.id, calId));
        return rows[0]?.syncToken || null;
      },
      async (token) => {
        await db.update(calendars).set({ syncToken: token }).where(eq(calendars.id, calId));
      },
      this.onAuthError,
      intervalMs,
    );

    this.pollers.set(calId, poller);
    await poller.start();
  }

  /** Stop a specific calendar's poller and clear cached events. */
  async stopPoller(calId: string): Promise<void> {
    const poller = this.pollers.get(calId);
    if (poller) {
      poller.stop();

      // Stop push channel if active
      if (this.userId) {
        try {
          const calRows = await db.select().from(calendars).where(eq(calendars.id, calId));
          const cal = calRows[0];
          if (cal?.watchChannelId && cal?.watchResourceId) {
            try {
              await this.client.stopWatch(cal.watchChannelId, cal.watchResourceId);
              log.info({ calId }, 'Push channel stopped');
            } catch (stopErr) {
              log.warn({ calId, err: stopErr }, 'stopWatch API failed (will clear DB anyway)');
            }
            // Always clear DB watch data even if Google API call failed
            await db
              .update(calendars)
              .set({
                watchChannelId: null,
                watchResourceId: null,
                watchToken: null,
                watchExpiresAt: null,
              })
              .where(eq(calendars.id, calId));
          }
        } catch (err) {
          log.error({ calId, err }, 'Failed to stop push channel');
        }
      }

      this.pollers.delete(calId);
    }
    // Clear cached events for this calendar (scoped to user)
    if (this.userId) {
      await db
        .delete(calendarEvents)
        .where(and(eq(calendarEvents.calendarId, calId), eq(calendarEvents.userId, this.userId)));
    } else {
      await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, calId));
    }
  }

  /** Stop all pollers and deregister push channels. */
  async stopAll(): Promise<void> {
    this.stopRenewalTimer();
    for (const [calId, poller] of this.pollers) {
      poller.stop();
      // Deregister push channel if active
      if (this.userId) {
        try {
          const calRows = await db.select().from(calendars).where(eq(calendars.id, calId));
          const cal = calRows[0];
          if (cal?.watchChannelId && cal?.watchResourceId) {
            try {
              await this.client.stopWatch(cal.watchChannelId, cal.watchResourceId);
            } catch (stopErr) {
              log.warn(
                { calId, err: stopErr },
                'stopWatch API failed during shutdown (clearing DB anyway)',
              );
            }
            // Always clear DB watch data even if Google API call failed
            await db
              .update(calendars)
              .set({
                watchChannelId: null,
                watchResourceId: null,
                watchToken: null,
                watchExpiresAt: null,
              })
              .where(eq(calendars.id, calId));
          }
        } catch (err) {
          log.error({ calId, err }, 'Failed to clean up push channel during shutdown');
        }
      }
    }
    this.pollers.clear();
  }

  /** Force-sync all active pollers and await completion (with timeout). */
  async syncAllNow(): Promise<void> {
    const SYNC_TIMEOUT_MS = 60_000;
    const promises = Array.from(this.pollers.values()).map((p) => p.forcePoll());
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        log.warn('syncAllNow timed out, proceeding with stale data');
        resolve();
      }, SYNC_TIMEOUT_MS);
    });
    await Promise.race([Promise.allSettled(promises).then(() => {}), timeout]);
    if (timer) clearTimeout(timer);
  }

  /** Force-sync all pollers with no timeout — waits until every calendar is fully synced. */
  async syncAllNowNoTimeout(): Promise<void> {
    const promises = Array.from(this.pollers.values()).map((p) => p.forcePoll());
    await Promise.allSettled(promises);
  }

  /** Reset all pollers' in-memory caches (sync token + change detection).
   *  Call before syncAllNowNoTimeout() during a force sync to ensure a true full re-fetch. */
  resetAllPollerCaches(): void {
    for (const poller of this.pollers.values()) {
      poller.resetCache();
    }
  }

  /** Signal that we wrote to a specific calendar. */
  markWritten(calId: string): void {
    this.pollers.get(calId)?.markWritten();
  }

  /** Mark all pollers as written (used after rescheduling). */
  markAllWritten(): void {
    for (const poller of this.pollers.values()) {
      poller.markWritten();
    }
  }

  /** Handle a push notification by triggering immediate sync on the target calendar.
   *  Returns true if the poller was found and sync triggered, false otherwise. */
  handleWebhookNotification(calId: string): boolean {
    const poller = this.pollers.get(calId);
    if (poller) {
      poller.triggerSync();
      return true;
    }
    log.warn({ calId, knownPollers: this.pollers.size }, 'No active poller for calendar');
    return false;
  }

  /** Restart a poller by looking up its Google calendar ID from the DB. */
  async restartPoller(calId: string): Promise<void> {
    const calRows = await db.select().from(calendars).where(eq(calendars.id, calId));
    const cal = calRows[0];
    if (!cal || !cal.enabled) {
      log.warn({ calId }, 'Cannot restart poller: not found or disabled');
      return;
    }
    await this.startPoller(cal.id, cal.googleCalendarId);
  }

  /** Start periodic check for expiring watch channels. */
  startRenewalTimer(): void {
    if (!this.webhookBaseUrl) return;

    this.renewalTimer = setInterval(() => {
      this.renewExpiringChannels().catch((err) => {
        log.warn({ err }, 'Watch channel renewal check failed');
      });
    }, WATCH_RENEWAL_CHECK_MS);
  }

  /** Stop the renewal timer. */
  stopRenewalTimer(): void {
    if (this.renewalTimer) {
      clearInterval(this.renewalTimer);
      this.renewalTimer = null;
    }
  }

  private async renewExpiringChannels(): Promise<void> {
    if (!this.userId || !this.webhookBaseUrl) return;

    try {
      const userCals = await db.select().from(calendars).where(eq(calendars.userId, this.userId));

      const now = Date.now();
      for (const cal of userCals) {
        if (!cal.watchExpiresAt || !cal.watchChannelId) continue;

        const expiresAt = new Date(cal.watchExpiresAt).getTime();
        if (expiresAt - now > WATCH_RENEWAL_BUFFER_MS) continue;

        log.info({ calId: cal.id, expires: cal.watchExpiresAt }, 'Renewing push channel');

        // Stop old channel
        try {
          if (cal.watchResourceId) {
            await this.client.stopWatch(cal.watchChannelId, cal.watchResourceId);
          }
        } catch (err) {
          log.warn({ calId: cal.id, err }, 'Failed to stop old channel');
        }

        // Create new channel
        try {
          const channelId = randomUUID();
          const token = randomUUID();
          const address = `${this.webhookBaseUrl}/api/webhooks/google-calendar`;

          const watch = await this.client.watchEvents(
            cal.googleCalendarId,
            address,
            channelId,
            token,
            WATCH_CHANNEL_TTL_MS,
          );

          await db
            .update(calendars)
            .set({
              watchChannelId: channelId,
              watchResourceId: watch.resourceId,
              watchToken: hashWebhookToken(token),
              watchExpiresAt: watch.expiration,
            })
            .where(eq(calendars.id, cal.id));

          log.info({ calId: cal.id, expires: watch.expiration }, 'Push channel renewed');
        } catch (err) {
          log.error(
            { calId: cal.id, err },
            'Failed to renew push channel, restarting with polling fallback',
          );
          // Clear stale watch data and restart poller (will fall back to 15s polling)
          await db
            .update(calendars)
            .set({
              watchChannelId: null,
              watchResourceId: null,
              watchToken: null,
              watchExpiresAt: null,
            })
            .where(eq(calendars.id, cal.id));
          await this.startPoller(cal.id, cal.googleCalendarId);
        }
      }
    } catch (err) {
      log.error({ err }, 'Channel renewal check failed');
    }
  }
}
