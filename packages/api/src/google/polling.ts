import type { CalendarEvent } from '@fluxure/shared';
import { MAX_EVENTS_CACHE } from '@fluxure/shared';
import { GoogleCalendarClient, isGoogleApiError } from './calendar.js';
import { POLL_INTERVAL_MS } from '../config.js';
import { createLogger } from '../logger.js';

const log = createLogger('poller');

/** Maximum number of sync retry attempts before giving up (0 = no retries). */
const MAX_SYNC_RETRIES = 2;

/** Base delay (ms) for exponential backoff between sync retries. */
const SYNC_RETRY_BASE_MS = 1000;

/**
 * Polls Google Calendar at a fixed interval and invokes a callback when
 * external changes (not originating from our own writes) are detected.
 */
export class CalendarPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private syncToken: string | null = null;
  private skipNextPoll = false;
  private lastEventsById: Map<string, CalendarEvent> = new Map();
  private isPolling = false;
  private pendingSync = false;
  private pendingForcePollResolvers: Array<() => void> = [];

  /**
   * @param client           Authenticated GoogleCalendarClient.
   * @param calendarId       The Google calendar to poll (defaults to 'primary').
   * @param onChanges        Called with the full set of changed events whenever
   *                         external modifications are detected.
   * @param getSyncToken     Load the persisted sync token (e.g. from DB).
   * @param saveSyncToken    Persist a new sync token after each successful poll.
   * @param onAuthError      Called when a 401 error is detected (token revoked).
   */
  constructor(
    private client: GoogleCalendarClient,
    private calendarId: string = 'primary',
    private onChanges: (events: CalendarEvent[]) => Promise<void>,
    private getSyncToken: () => Promise<string | null>,
    private saveSyncToken: (token: string) => Promise<void>,
    private onAuthError?: () => Promise<void>,
    private intervalMs: number = POLL_INTERVAL_MS,
  ) {}

  /** Start the initial sync and begin the polling interval. */
  async start(): Promise<void> {
    this.syncToken = await this.getSyncToken();

    // Initial full/incremental sync
    await this.poll();

    this.intervalId = setInterval(() => {
      void this.poll();
    }, this.intervalMs);
  }

  /** Stop polling. */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Trigger an immediate sync cycle (used by push notification webhook). */
  triggerSync(): void {
    // Webhook = explicit external signal — always honor it.
    // skipNextPoll is a feedback-loop guard for interval-based polling;
    // it must not block webhook-triggered syncs.
    this.skipNextPoll = false;
    if (this.isPolling) {
      // A poll is in progress — queue a re-sync after it completes
      this.pendingSync = true;
      return;
    }
    void this.poll();
  }

  /** Awaitable forced sync — used before reschedule to ensure fresh data. */
  forcePoll(): Promise<void> {
    this.skipNextPoll = false;
    if (this.isPolling) {
      this.pendingSync = true;
      // Return a promise that resolves when the in-flight poll completes
      return new Promise<void>((resolve) => {
        this.pendingForcePollResolvers.push(resolve);
      });
    }
    return this.poll();
  }

  /**
   * Reset the in-memory sync token and change-detection cache.
   * Must be called before forcePoll() during a force sync so that:
   * - syncToken=null triggers a full (not incremental) Google API fetch
   * - lastEventsById is empty so all fetched events are treated as new changes
   */
  resetCache(): void {
    this.syncToken = null;
    this.lastEventsById.clear();
  }

  /**
   * Signal that we just wrote changes to the calendar.
   * The next poll cycle will be skipped to prevent a feedback loop where we
   * react to our own modifications.
   */
  markWritten(): void {
    this.skipNextPoll = true;
  }

  // ---------------------------------------------------------------------------

  private async poll(): Promise<void> {
    // Guard against overlapping polls (in case a poll takes longer than the interval)
    if (this.isPolling) {
      return;
    }

    if (this.skipNextPoll) {
      this.skipNextPoll = false;
      return;
    }

    this.isPolling = true;

    try {
      // Save the previous sync token so we can restore it if the sync fails.
      // This prevents token loss when a 410 triggers a full-sync retry that also fails.
      const previousSyncToken = this.syncToken;

      const result = await this.attemptSyncWithRetry(previousSyncToken);

      // Sync succeeded — persist the new token
      this.syncToken = result.nextSyncToken;
      await this.saveSyncToken(result.nextSyncToken);

      const externalChanges = this.filterExternalChanges(result.events);

      // Update our local snapshot
      for (const event of result.events) {
        if (event.googleEventId) {
          this.lastEventsById.set(event.googleEventId, event);
        }
      }

      // Evict oldest entries incrementally if over the cache limit
      if (this.lastEventsById.size > MAX_EVENTS_CACHE) {
        const excess = this.lastEventsById.size - MAX_EVENTS_CACHE;
        const keys = this.lastEventsById.keys();
        for (let i = 0; i < excess; i++) {
          const { value } = keys.next();
          if (value) this.lastEventsById.delete(value);
        }
      }

      if (externalChanges.length > 0) {
        await this.onChanges(externalChanges);
      }
    } catch (error) {
      // 401 means the token was revoked — stop polling and notify caller
      // 403 means insufficient scopes — token doesn't have calendar permissions
      if (isGoogleApiError(error) && (error.code === 401 || error.code === 403)) {
        log.error(
          { code: error.code },
          error.code === 401
            ? 'Google auth error (401) — token likely revoked'
            : 'Google scope error (403) — token lacks calendar permissions, needs re-authorization',
        );
        this.stop();
        if (this.onAuthError) {
          await this.onAuthError();
        }
        return;
      }

      log.error({ err: error }, 'Poll error (all retries exhausted)');

      // If the sync token has gone stale, clear it so the next poll does a
      // full sync automatically (syncEvents already handles 410 internally,
      // but this is a safety net for unexpected failures).
      if (isGoneError(error)) {
        this.syncToken = null;
        // Persist the cleared token so a restart doesn't reload the stale one from DB
        await this.saveSyncToken('').catch((saveErr) => {
          log.error({ err: saveErr }, 'Failed to persist cleared sync token after 410');
        });
      }
    } finally {
      this.isPolling = false;
      // Drain any webhook-triggered sync that arrived while we were polling.
      // Run it BEFORE resolving forcePoll callers so they see the latest data.
      if (this.pendingSync) {
        this.pendingSync = false;
        try {
          await this.poll();
        } catch (drainErr) {
          log.error({ err: drainErr }, 'Pending sync drain failed');
        }
      }
      // Resolve any callers waiting on forcePoll()
      if (this.pendingForcePollResolvers.length > 0) {
        const resolvers = this.pendingForcePollResolvers;
        this.pendingForcePollResolvers = [];
        for (const resolve of resolvers) resolve();
      }
    }
  }

  /**
   * Attempt sync with up to MAX_SYNC_RETRIES retries for transient errors.
   * Preserves the previous sync token on failure so the next poll can retry
   * with the same token instead of losing it.
   */
  private async attemptSyncWithRetry(
    previousSyncToken: string | null,
  ): Promise<{ events: CalendarEvent[]; nextSyncToken: string; fullSync: boolean }> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_SYNC_RETRIES; attempt++) {
      try {
        return await this.client.syncEvents(this.calendarId, this.syncToken);
      } catch (error) {
        lastError = error;
        // 401, 403, and 410 should not be retried — propagate immediately
        // 403 = insufficient scopes (token doesn't have calendar permission)
        if (
          isGoogleApiError(error) &&
          (error.code === 401 || error.code === 403 || error.code === 410)
        ) {
          throw error;
        }
        // Restore previous sync token so the retry uses the same starting point
        this.syncToken = previousSyncToken;
        if (attempt < MAX_SYNC_RETRIES) {
          const delayMs = SYNC_RETRY_BASE_MS * Math.pow(2, attempt);
          log.warn(
            { err: error, attempt: attempt + 1, maxRetries: MAX_SYNC_RETRIES + 1 },
            'Sync failed, retrying',
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw lastError;
  }

  /**
   * Filter out events that haven't changed since the last poll cycle.
   * Compares each event against the `lastEventsById` snapshot — if
   * all tracked fields are identical, the event is dropped.
   */
  private filterExternalChanges(events: CalendarEvent[]): CalendarEvent[] {
    return events.filter((event) => {
      // Events without a googleEventId are malformed; skip them
      if (!event.googleEventId) {
        return false;
      }

      // If we've seen this event before and nothing changed, filter it out
      const previous = this.lastEventsById.get(event.googleEventId);
      if (previous && this.eventsAreEqual(previous, event)) {
        return false;
      }

      return true;
    });
  }

  /** Shallow comparison of the fields we care about for change detection. */
  private eventsAreEqual(a: CalendarEvent, b: CalendarEvent): boolean {
    return (
      a.title === b.title &&
      a.start === b.start &&
      a.end === b.end &&
      a.status === b.status &&
      a.itemType === b.itemType &&
      a.itemId === b.itemId &&
      (a.location ?? null) === (b.location ?? null)
    );
  }
}

// ---------- Utility ---------------------------------------------------------

function isGoneError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: number }).code === 410
  );
}
