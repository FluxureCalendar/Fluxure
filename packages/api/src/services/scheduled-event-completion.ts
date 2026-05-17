import { eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { scheduledEvents, calendars } from '../db/pg-schema.js';
import {
  EventStatus,
  ItemType,
  CalendarOpType,
  STATUS_PREFIX,
  EXTENDED_PROPS,
} from '@fluxure/shared';
import { schedulerRegistry } from '../scheduler-registry.js';
import { getUserSettings } from '../routes/schedule-helpers.js';
import { createLogger } from '../logger.js';

const log = createLogger('scheduled-event-completion');

const STATUS_PREFIXES = [
  STATUS_PREFIX.free,
  STATUS_PREFIX.busy,
  STATUS_PREFIX.locked,
  STATUS_PREFIX.completed,
];

function stripStatusPrefix(title: string): string {
  for (const prefix of STATUS_PREFIXES) {
    if (title.startsWith(prefix)) return title.slice(prefix.length).trimStart();
  }
  return title;
}

async function resolveGoogleCalId(calendarId: string | null, userId: string): Promise<string> {
  if (!calendarId) return 'primary';
  const calRows = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId)));
  return calRows[0]?.googleCalendarId || 'primary';
}

/**
 * Bring the scheduled-event side of a habit completion to parity with the
 * manual UI completion (`handleCompleteEvent`): flip the row to `Completed`,
 * trim an in-progress block when the user opted in, and push the ✅ prefix to
 * Google Calendar. Best-effort and idempotent — the auto-complete worker must
 * stay non-fatal, so a missing row, absent Google connection, or sync failure
 * never throws.
 */
export async function syncScheduledHabitEventCompleted(
  userId: string,
  habitId: string,
  scheduledDate: string,
): Promise<void> {
  const itemId = `${habitId}__${scheduledDate}`;

  const rows = await db
    .select()
    .from(scheduledEvents)
    .where(
      and(
        eq(scheduledEvents.userId, userId),
        eq(scheduledEvents.itemType, 'habit'),
        eq(scheduledEvents.itemId, itemId),
      ),
    );
  const row = rows[0];
  if (!row || !row.start || !row.end) return;
  if (row.status === EventStatus.Completed) return;

  const userSettings = await getUserSettings(userId);
  const now = new Date();
  const nowISO = now.toISOString();
  const eventStart = new Date(row.start);
  const eventEnd = new Date(row.end);
  const shouldTrim =
    userSettings.trimCompletedEvents !== false && now >= eventStart && now < eventEnd;
  const newEnd = shouldTrim ? nowISO : row.end;

  await db
    .update(scheduledEvents)
    .set({ status: EventStatus.Completed, end: newEnd, updatedAt: nowISO })
    .where(and(eq(scheduledEvents.id, row.id), eq(scheduledEvents.userId, userId)));

  const calClient = schedulerRegistry.get(userId)?.getCalClient() ?? null;
  if (!calClient || !row.googleEventId) return;

  try {
    const googleCalId = await resolveGoogleCalId(row.calendarId, userId);
    const cleanTitle = stripStatusPrefix(row.title || '');
    const failed = await calClient.applyOperations(googleCalId, [
      {
        type: CalendarOpType.Update,
        eventId: row.id,
        googleEventId: row.googleEventId,
        itemType: (row.itemType || ItemType.Habit) as ItemType,
        itemId: row.itemId || '',
        title: `${STATUS_PREFIX.completed} ${cleanTitle}`,
        start: row.start,
        end: newEnd,
        status: EventStatus.Completed,
        extendedProperties: {
          [EXTENDED_PROPS.fluxureId]: row.id,
          [EXTENDED_PROPS.itemType]: row.itemType || ItemType.Habit,
          [EXTENDED_PROPS.itemId]: row.itemId?.split('__')[0] || '',
          [EXTENDED_PROPS.status]: EventStatus.Completed,
        },
      },
    ]);
    if (failed.length > 0) {
      log.warn({ userId, habitId, scheduledDate }, 'Completion ✅ sync to Google was rate-limited');
    }
  } catch (err) {
    log.error({ err, userId, habitId, scheduledDate }, 'Failed to sync completion ✅ to Google');
  }
}
