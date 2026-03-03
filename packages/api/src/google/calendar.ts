import { google, calendar_v3, Auth } from 'googleapis';
import {
  EXTENDED_PROPS,
  STATUS_PREFIX,
  CalendarOpType,
  EventStatus,
  ItemType,
  SYNC_LOOKBACK_DAYS,
  SYNC_LOOKAHEAD_DAYS,
  GOOGLE_MAX_RETRIES,
  GOOGLE_MAX_RETRY_DELAY_MS,
  NUKE_LOOKBACK_DAYS,
  NUKE_LOOKAHEAD_DAYS,
  GOOGLE_MAX_DELETE_RETRIES,
  GOOGLE_INTER_DELETE_DELAY_MS,
  DEFAULT_WATCH_TTL_MS,
  MAX_SYNC_EVENTS,
  subDays,
  addDays,
} from '@fluxure/shared';
import type { CalendarEvent, CalendarOperation } from '@fluxure/shared';
import { createLogger } from '../logger.js';

const log = createLogger('calendar');

/** Status prefix map keyed by EventStatus enum values */
const STATUS_EMOJI: Record<EventStatus, string> = {
  [EventStatus.Free]: STATUS_PREFIX.free,
  [EventStatus.Busy]: STATUS_PREFIX.busy,
  [EventStatus.Locked]: STATUS_PREFIX.locked,
  [EventStatus.Completed]: STATUS_PREFIX.completed,
};

/** Reverse-lookup: strip a known status prefix from a title and return the clean name + status */
function parseStatusPrefix(title: string): { cleanTitle: string; status: EventStatus } {
  for (const [statusKey, emoji] of Object.entries(STATUS_EMOJI)) {
    if (title.startsWith(emoji)) {
      return {
        cleanTitle: title.slice(emoji.length).trimStart(),
        status: statusKey as EventStatus,
      };
    }
  }
  // No known prefix found; default to Busy
  return { cleanTitle: title, status: EventStatus.Busy };
}

export class GoogleCalendarClient {
  private calendar: calendar_v3.Calendar;

  constructor(auth: Auth.OAuth2Client) {
    this.calendar = google.calendar({ version: 'v3', auth });
  }

  // ---------- Sync ----------------------------------------------------------

  /**
   * Fetch events using Google's incremental sync mechanism.
   *
   * When `syncToken` is provided an incremental sync is attempted.
   * If the token is expired (HTTP 410 Gone) we transparently fall back to a
   * full sync over the next 90 days.
   */
  async syncEvents(
    calendarId: string = 'primary',
    syncToken?: string | null,
  ): Promise<{
    events: CalendarEvent[];
    nextSyncToken: string;
    fullSync: boolean;
  }> {
    const fullSync = !syncToken;
    const allEvents: CalendarEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken = '';
    let hitEventsCap = false;

    try {
      do {
        const params: calendar_v3.Params$Resource$Events$List = {
          calendarId,
          maxResults: 2500,
          singleEvents: true,
          ...(pageToken ? { pageToken } : {}),
        };

        if (syncToken && !fullSync) {
          params.syncToken = syncToken;
        } else {
          // Full sync: look 7 days back and 30 days ahead (we only schedule 14 days ahead)
          params.timeMin = subDays(new Date(), SYNC_LOOKBACK_DAYS).toISOString();
          params.timeMax = addDays(new Date(), SYNC_LOOKAHEAD_DAYS).toISOString();
          params.orderBy = 'startTime';
        }

        // Only fetch fields we need to reduce bandwidth
        params.fields =
          'nextPageToken,nextSyncToken,items(id,summary,start,end,status,location,extendedProperties,attendees,recurringEventId,description)';

        const response = await this.calendar.events.list(params);
        const items = response.data.items ?? [];

        for (const item of items) {
          // Cancelled events come through in incremental sync
          if (item.status === 'cancelled') {
            // Represent as a minimal CalendarEvent so the consumer can detect deletions
            allEvents.push({
              id: item.id ?? '',
              googleEventId: item.id ?? '',
              title: '',
              start: '',
              end: '',
              isManaged: false,
              itemType: null,
              itemId: null,
              status: EventStatus.Free,
            });
            continue;
          }

          allEvents.push(this.parseGoogleEvent(item));
        }

        pageToken = response.data.nextPageToken ?? undefined;
        if (response.data.nextSyncToken) {
          nextSyncToken = response.data.nextSyncToken;
        }

        // Safety cap: stop paginating if we've fetched too many events to
        // prevent unbounded memory usage and API quota exhaustion.
        if (allEvents.length >= MAX_SYNC_EVENTS) {
          hitEventsCap = true;
          break;
        }
      } while (pageToken);
    } catch (err: unknown) {
      // 410 Gone means the syncToken expired; do a full sync instead
      if (isGoogleApiError(err) && err.code === 410) {
        return this.syncEvents(calendarId, null);
      }
      throw err;
    }

    if (hitEventsCap) {
      log.warn(
        { calendarId, eventCount: allEvents.length, cap: MAX_SYNC_EVENTS },
        'Sync events cap reached — some events may be missing',
      );
    }

    return { events: allEvents, nextSyncToken, fullSync };
  }

  // ---------- CRUD ----------------------------------------------------------

  /**
   * Create a calendar event from a CalendarOperation and return the new
   * Google event ID.
   */
  async createEvent(calendarId: string = 'primary', op: CalendarOperation): Promise<string> {
    const body = this.buildEventBody(op);
    const response = await this.calendar.events.insert({
      calendarId,
      requestBody: body,
    });
    return response.data.id ?? '';
  }

  /** Update an existing calendar event. */
  async updateEvent(
    calendarId: string = 'primary',
    eventId: string,
    op: CalendarOperation,
  ): Promise<void> {
    const body = this.buildEventBody(op);
    await this.calendar.events.patch({
      calendarId,
      eventId,
      requestBody: body,
    });
  }

  /** Delete a calendar event by its Google event ID. */
  async deleteEvent(calendarId: string = 'primary', eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({ calendarId, eventId });
    } catch (err: unknown) {
      // 404 / 410 means the event is already gone; treat as success
      if (isGoogleApiError(err) && (err.code === 404 || err.code === 410)) {
        return;
      }
      throw err;
    }
  }

  /** Patch only the start/end time of an existing event (for external event moves). */
  async patchEventTime(
    calendarId: string,
    eventId: string,
    start: string,
    end: string,
  ): Promise<void> {
    await this.calendar.events.patch({
      calendarId,
      eventId,
      requestBody: {
        start: { dateTime: start },
        end: { dateTime: end },
      },
    });
  }

  // ---------- Calendar listing -----------------------------------------------

  /**
   * List all calendars accessible by the authenticated user.
   */
  async listCalendars(): Promise<
    Array<{
      googleCalendarId: string;
      name: string;
      color: string;
      accessRole: string;
      isPrimary: boolean;
    }>
  > {
    const result: Array<{
      googleCalendarId: string;
      name: string;
      color: string;
      accessRole: string;
      isPrimary: boolean;
    }> = [];

    let pageToken: string | undefined;

    do {
      const response = await this.calendar.calendarList.list({
        maxResults: 250,
        ...(pageToken ? { pageToken } : {}),
      });

      for (const item of response.data.items ?? []) {
        result.push({
          googleCalendarId: item.id ?? '',
          name: item.summary ?? '(Untitled)',
          color: item.backgroundColor ?? '#4285f4',
          accessRole: item.accessRole ?? 'reader',
          isPrimary: item.primary === true,
        });
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    return result;
  }

  // ---------- Batch operations ----------------------------------------------

  /**
   * Apply an ordered list of CalendarOperations.
   * For Create ops, the returned Google event ID is set on `op.googleEventId`.
   * Returns an array of operations that failed due to rate limiting (429/503).
   * Other failures are logged but do not abort the batch.
   */
  async applyOperations(
    calendarId: string = 'primary',
    operations: CalendarOperation[],
  ): Promise<CalendarOperation[]> {
    const failedOps: CalendarOperation[] = [];
    const MAX_RETRIES = GOOGLE_MAX_RETRIES;

    for (let i = 0; i < operations.length; i++) {
      const op = operations[i];
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          switch (op.type) {
            case CalendarOpType.Create: {
              const googleId = await this.createEvent(calendarId, op);
              op.googleEventId = googleId;
              break;
            }
            case CalendarOpType.Update: {
              const gEventId = op.googleEventId;
              if (!gEventId) {
                log.warn({ itemId: op.itemId }, 'Update op missing googleEventId, skipping');
                break;
              }
              await this.updateEvent(calendarId, gEventId, op);
              break;
            }
            case CalendarOpType.Delete: {
              const gEventId = op.googleEventId;
              if (!gEventId) {
                log.warn({ itemId: op.itemId }, 'Delete op missing googleEventId, skipping');
                break;
              }
              await this.deleteEvent(calendarId, gEventId);
              break;
            }
          }
          break; // Success — exit retry loop
        } catch (err) {
          // 401 means token is revoked — don't retry
          if (isGoogleApiError(err) && err.code === 401) {
            throw new Error('GOOGLE_AUTH_REVOKED', { cause: err });
          }
          // Exponential backoff with jitter on rate limits (429, 403 rate limit) and 503
          if (isRateLimitError(err) || (isGoogleApiError(err) && err.code === 503)) {
            if (attempt < MAX_RETRIES) {
              const jitter = Math.random() * 1000;
              const delay = Math.min(
                1000 * Math.pow(2, attempt) + jitter,
                GOOGLE_MAX_RETRY_DELAY_MS,
              );
              log.warn(
                {
                  code: isGoogleApiError(err) ? err.code : undefined,
                  opIndex: i,
                  attempt: attempt + 1,
                  delayMs: Math.round(delay),
                },
                'Rate limited, retrying',
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            // Exhausted retries — fail remaining ops
            log.warn(
              {
                code: isGoogleApiError(err) ? err.code : undefined,
                opIndex: i,
                totalOps: operations.length,
              },
              'Rate limited, exhausted retries, stopping batch',
            );
            failedOps.push(...operations.slice(i));
            return failedOps;
          }
          // Non-retryable error
          log.error({ opType: op.type, itemId: op.itemId, err }, 'Failed to apply operation');
          break;
        }
      }
    }

    return failedOps;
  }

  // ---------- Nuke (delete all managed events) -----------------------------

  /**
   * Find and delete all Fluxure-managed events from a calendar.
   * Returns the count of deleted events.
   */
  async deleteAllManagedEvents(calendarId: string = 'primary'): Promise<number> {
    let deleted = 0;
    let pageToken: string | undefined;

    // Fetch all events in a wide window
    const timeMin = subDays(new Date(), NUKE_LOOKBACK_DAYS);
    const timeMax = addDays(new Date(), NUKE_LOOKAHEAD_DAYS);

    // Collect all Fluxure event IDs first, then delete in parallel batches
    const fluxureEventIds: string[] = [];

    do {
      const response = await this.calendar.events.list({
        calendarId,
        maxResults: 2500,
        singleEvents: true,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        // Only fetch fields we need (saves bandwidth)
        fields: 'nextPageToken,items(id,extendedProperties)',
        ...(pageToken ? { pageToken } : {}),
      });

      const items = response.data.items ?? [];
      for (const item of items) {
        const privateProps = item.extendedProperties?.private ?? {};
        const isFluxure = Boolean(
          privateProps[EXTENDED_PROPS.fluxureId] || privateProps[EXTENDED_PROPS.itemType],
        );
        if (isFluxure && item.id) {
          fluxureEventIds.push(item.id);
        }
      }

      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);

    // Delete sequentially with rate-limit-aware retry
    for (let i = 0; i < fluxureEventIds.length; i++) {
      const eventId = fluxureEventIds[i];
      let success = false;
      for (let attempt = 0; attempt <= GOOGLE_MAX_DELETE_RETRIES; attempt++) {
        try {
          await this.calendar.events.delete({ calendarId, eventId });
          success = true;
          break;
        } catch (err: unknown) {
          if (isGoogleApiError(err) && (err.code === 404 || err.code === 410)) {
            break; // Already gone
          }
          if (isRateLimitError(err) || (isGoogleApiError(err) && err.code === 503)) {
            if (attempt < GOOGLE_MAX_DELETE_RETRIES) {
              const delay = Math.min(
                1000 * Math.pow(2, attempt) + Math.random() * 1000,
                GOOGLE_MAX_RETRY_DELAY_MS,
              );
              log.warn(
                { eventId, attempt: attempt + 1, delayMs: Math.round(delay) },
                'Rate limited deleting event, retrying',
              );
              await new Promise((resolve) => setTimeout(resolve, delay));
              continue;
            }
            log.warn({ eventId }, 'Exhausted retries deleting event, skipping');
          } else {
            log.error({ eventId, err }, 'Failed to delete managed event');
          }
          break;
        }
      }
      if (success) deleted++;
      // Small delay between deletes to stay under rate limits
      if (i < fluxureEventIds.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, GOOGLE_INTER_DELETE_DELAY_MS));
      }
    }

    return deleted;
  }

  // ---------- Push notification channels ------------------------------------

  /** Register a push notification channel for calendar events. */
  async watchEvents(
    calendarId: string,
    address: string,
    channelId: string,
    token: string,
    ttlMs?: number,
  ): Promise<{ resourceId: string; expiration: string }> {
    const expiration = ttlMs ? Date.now() + ttlMs : Date.now() + DEFAULT_WATCH_TTL_MS;

    const response = await this.calendar.events.watch({
      calendarId,
      requestBody: {
        id: channelId,
        type: 'web_hook',
        address,
        token,
        expiration: String(expiration),
      },
    });

    return {
      resourceId: response.data.resourceId || '',
      expiration: new Date(Number(response.data.expiration) || expiration).toISOString(),
    };
  }

  /** Stop a push notification channel. */
  async stopWatch(channelId: string, resourceId: string): Promise<void> {
    await this.calendar.channels.stop({
      requestBody: {
        id: channelId,
        resourceId,
      },
    });
  }

  // ---------- Internal helpers ----------------------------------------------

  /** Convert a raw Google Calendar event into our CalendarEvent shape. */
  private parseGoogleEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    const privateProps = event.extendedProperties?.private ?? {};

    const fluxureId = privateProps[EXTENDED_PROPS.fluxureId] ?? '';
    const isManaged = Boolean(fluxureId);

    const rawTitle = event.summary ?? '(No title)';
    const { cleanTitle, status: parsedStatus } = parseStatusPrefix(rawTitle);

    // Use the status stored in extendedProperties if available; fall back to
    // the one inferred from the emoji prefix.
    const storedStatus = privateProps[EXTENDED_PROPS.status] as EventStatus | undefined;
    const status =
      storedStatus && Object.values(EventStatus).includes(storedStatus)
        ? storedStatus
        : parsedStatus;

    const itemTypeRaw = privateProps[EXTENDED_PROPS.itemType] as ItemType | undefined;
    const itemType =
      itemTypeRaw && Object.values(ItemType).includes(itemTypeRaw) ? itemTypeRaw : null;

    const itemId = privateProps[EXTENDED_PROPS.itemId] ?? null;

    // Handle all-day events (date) vs timed events (dateTime)
    const start = event.start?.dateTime ?? event.start?.date ?? '';
    const end = event.end?.dateTime ?? event.end?.date ?? '';

    return {
      id: fluxureId || event.id || '',
      googleEventId: event.id ?? '',
      title: cleanTitle,
      start,
      end,
      isManaged,
      itemType,
      itemId,
      status,
      location: event.location ?? undefined,
      description: event.description ?? undefined,
    };
  }

  /** Build a Google Calendar event body from a CalendarOperation. */
  private buildEventBody(op: CalendarOperation): calendar_v3.Schema$Event {
    // Add status emoji prefix only if not already present
    const alreadyPrefixed = Object.values(STATUS_EMOJI).some((e) => op.title.startsWith(e));
    const prefixedTitle = alreadyPrefixed ? op.title : `${STATUS_EMOJI[op.status]} ${op.title}`;

    // Use extended properties from the operation; only fill in defaults for missing keys
    const privateProperties: Record<string, string> = {
      // fluxureId stores the entity's itemId (e.g., habit123__2026-03-07), not the scheduledEvent DB ID
      [EXTENDED_PROPS.fluxureId]: op.itemId,
      [EXTENDED_PROPS.itemType]: op.itemType,
      [EXTENDED_PROPS.itemId]: op.itemId,
      [EXTENDED_PROPS.status]: op.status,
      ...op.extendedProperties,
      [EXTENDED_PROPS.lastModifiedByUs]: new Date().toISOString(),
    };

    return {
      summary: prefixedTitle,
      start: { dateTime: op.start },
      end: { dateTime: op.end },
      transparency: op.status === EventStatus.Free ? 'transparent' : 'opaque',
      reminders: {
        useDefault: op.useDefaultReminders ?? false,
        overrides: [],
      },
      extendedProperties: {
        private: privateProperties,
      },
    };
  }
}

// ---------- Utility ---------------------------------------------------------

interface GoogleApiError {
  code: number;
  message?: string;
}

export function isGoogleApiError(err: unknown): err is GoogleApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'number'
  );
}

/** Google returns 403 for rate limits (not just 429). Check the cause message. */
function isRateLimitError(err: unknown): boolean {
  if (!isGoogleApiError(err)) return false;
  if (err.code === 429) return true;
  if (err.code === 403) {
    const errObj = err as unknown as Record<string, unknown>;
    const cause = errObj.cause;
    if (
      cause &&
      typeof cause === 'object' &&
      'message' in cause &&
      typeof (cause as Record<string, unknown>).message === 'string'
    ) {
      const msg = (cause as Record<string, unknown>).message as string;
      return msg.includes('Rate Limit') || msg.includes('rateLimitExceeded');
    }
    if (typeof errObj.message === 'string') {
      return errObj.message.includes('Rate Limit') || errObj.message.includes('rateLimitExceeded');
    }
  }
  return false;
}
