import type { Router } from 'express';
import { eq, and } from 'drizzle-orm';
import { z } from 'zod/v4';
import crypto from 'node:crypto';
import { db } from '../db/pg-index.js';
import {
  scheduledEvents,
  calendarEvents,
  calendars,
  scheduleChanges,
  habitCompletions,
} from '../db/pg-schema.js';
import {
  EventStatus,
  ItemType,
  CalendarOpType,
  STATUS_PREFIX,
  EXTENDED_PROPS,
  ScheduleChangeType,
} from '@fluxure/shared';
import { triggerReschedule } from '../polling-ref.js';
import { broadcastToUser } from '../ws.js';
import { moveEventSchema, lockBodySchema } from '../validation.js';
import { schedulerRegistry } from '../scheduler-registry.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';
import { getUserSettings } from './schedule-helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../logger.js';
import { cacheHashDelAll } from '../cache/redis.js';
import { invalidateAnalyticsCache } from './analytics.js';

const log = createLogger('schedule-actions');

/** Notify the user via WS that a Google Calendar sync failed but the local action succeeded. */
function notifyGoogleSyncFailure(userId: string, action: string): void {
  broadcastToUser(userId, 'system_message', `Google Calendar sync failed for ${action}`, {
    level: 'warning',
    message: 'Google Calendar may be temporarily out of sync. It will reconcile automatically.',
  });
}

/** Invalidate all quality + analytics cache entries for a user. */
async function invalidateQualityCache(userId: string): Promise<void> {
  await Promise.all([cacheHashDelAll(`quality:${userId}`), invalidateAnalyticsCache(userId)]);
}

type ItemTypeEnum = 'habit' | 'task' | 'meeting' | 'focus' | 'external';

/** Log a schedule change for the Recent Changes feed and broadcast via WS. */
async function logChange(
  userId: string,
  type: ScheduleChangeType,
  row: {
    itemType: string | null;
    itemId: string | null;
    title: string | null;
    start: string | null;
    end: string | null;
  },
  newStart?: string | null,
  newEnd?: string | null,
) {
  const change = {
    id: crypto.randomUUID(),
    userId,
    operationType: type,
    itemType: (row.itemType || 'habit') as ItemTypeEnum,
    itemId: row.itemId || '',
    itemName: row.title || '(unnamed)',
    previousStart: row.start,
    previousEnd: row.end,
    newStart: newStart ?? row.start,
    newEnd: newEnd ?? row.end,
    reason: null,
    batchId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
  };
  await db.insert(scheduleChanges).values(change);
  broadcastToUser(userId, 'schedule_changes', 'Event action', { data: [change] });
}

/** Get scheduler helpers for a user. */
function getSchedulerClients(userId: string) {
  const scheduler = schedulerRegistry.get(userId);
  return {
    calClient: scheduler?.getCalClient() ?? null,
    manager: scheduler?.getPollerManager() ?? null,
  };
}

/** Look up the Google Calendar ID for a given internal calendar ID. */
async function resolveGoogleCalId(calendarId: string | null, userId: string): Promise<string> {
  if (!calendarId) return 'primary';
  const calRows = await db
    .select()
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId)));
  return calRows[0]?.googleCalendarId || 'primary';
}

/** Build extended properties for a Google Calendar update operation. */
function buildExtendedProps(
  row: { id: string; itemType: string | null; itemId: string | null },
  status: string,
) {
  return {
    [EXTENDED_PROPS.fluxureId]: row.id,
    [EXTENDED_PROPS.itemType]: row.itemType || ItemType.Habit,
    [EXTENDED_PROPS.itemId]: row.itemId?.split('__')[0] || '',
    [EXTENDED_PROPS.status]: status,
  };
}

const deleteManagedEventsSchema = z.object({
  confirm: z.literal(true),
});

/** Handler: DELETE /api/schedule/managed-events */
async function handleDeleteManagedEvents(
  req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
  try {
    const parsed = deleteManagedEventsSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, 'Request body must include { "confirm": true }');
      return;
    }

    const userId = req.userId;
    let { calClient, manager } = getSchedulerClients(userId);
    if (!calClient) {
      try {
        const scheduler = await schedulerRegistry.getOrCreate(userId);
        calClient = scheduler.getCalClient();
        manager = scheduler.getPollerManager();
      } catch {
        /* no Google connection */
      }
    }
    let googleDeleted = 0;

    // Scan Google Calendar directly for Fluxure-managed events and delete them,
    // regardless of whether they exist in the local DB.
    if (calClient) {
      const enabledCals = await db
        .select()
        .from(calendars)
        .where(and(eq(calendars.userId, userId), eq(calendars.enabled, true)));
      for (const cal of enabledCals) {
        const deleted = await calClient.deleteAllManagedEvents(cal.googleCalendarId);
        googleDeleted += deleted;
      }
    }

    // Clean up local DB rows
    const localRows = await db
      .select({ id: scheduledEvents.id })
      .from(scheduledEvents)
      .where(eq(scheduledEvents.userId, userId));
    const localCount = localRows.length;

    if (localCount > 0) {
      await db.delete(scheduledEvents).where(eq(scheduledEvents.userId, userId));
    }
    manager?.markAllWritten();

    broadcastToUser(userId, 'schedule_updated', 'Managed events cleared');
    res.json({
      message: 'All managed events deleted',
      googleEventsDeleted: googleDeleted,
      localEventsDeleted: localCount,
    });
  } catch (error: unknown) {
    log.error({ err: error }, 'Nuke managed events error');
    sendError(res, 500, 'Failed to delete managed events');
  }
}

/** Handler: POST /api/schedule/:eventId/move */
async function handleMoveEvent(
  req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
  try {
    const userId = req.userId;
    const eventId = req.params.eventId as string;
    if (!validateUUID(eventId as string, res)) return;
    const parsed = moveEventSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid input');
      return;
    }
    const { start, end } = parsed.data;

    const rows = await db
      .select()
      .from(scheduledEvents)
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Scheduled event');
      return;
    }
    const row = rows[0];

    const now = new Date().toISOString();
    await db
      .update(scheduledEvents)
      .set({ start, end, status: EventStatus.Locked, updatedAt: now })
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));

    let { calClient, manager } = getSchedulerClients(userId);
    if (!calClient) {
      try {
        const scheduler = await schedulerRegistry.getOrCreate(userId);
        calClient = scheduler.getCalClient();
        manager = scheduler.getPollerManager();
      } catch {
        /* no Google connection — skip sync */
      }
    }

    if (calClient && row.googleEventId) {
      try {
        const googleCalId = await resolveGoogleCalId(row.calendarId, userId);
        const cleanTitle = stripStatusPrefix(row.title || '');
        const op = {
          type: CalendarOpType.Update as const,
          eventId: row.id,
          googleEventId: row.googleEventId,
          itemType: (row.itemType || ItemType.Habit) as ItemType,
          itemId: row.itemId || '',
          title: `${STATUS_PREFIX.locked} ${cleanTitle}`,
          start,
          end,
          status: EventStatus.Locked,
          extendedProperties: buildExtendedProps(row, EventStatus.Locked),
        };
        const failed = await calClient.applyOperations(googleCalId, [op]);
        if (failed.length > 0) {
          log.warn(
            { itemId: op.itemId },
            'Move sync to Google was rate-limited, will reconcile on next reschedule',
          );
          notifyGoogleSyncFailure(userId, 'move');
        }
      } catch (syncErr) {
        log.error({ err: syncErr }, 'Failed to sync move to Google Calendar');
        notifyGoogleSyncFailure(userId, 'move');
      }
    }

    manager?.markAllWritten();
    await invalidateQualityCache(userId);
    await logChange(userId, ScheduleChangeType.Moved, row, start, end);
    triggerReschedule('Event moved and locked', userId);
    broadcastToUser(userId, 'schedule_updated', 'Event moved');
    res.json({ message: 'Event moved and locked', eventId, start, end });
  } catch (error: unknown) {
    log.error({ err: error }, 'Move event error');
    sendError(res, 500, 'Failed to move event');
  }
}

/** Register event action routes (move, lock, complete, external-move, delete-managed) on the router. */
export function registerScheduleActions(router: Router): void {
  router.delete('/managed-events', asyncHandler(handleDeleteManagedEvents));
  router.post('/:eventId/move', asyncHandler(handleMoveEvent));

  router.post('/:eventId/lock', asyncHandler(handleLockEvent));
  router.post('/:eventId/complete', asyncHandler(handleCompleteEvent));
  router.post('/:eventId/uncomplete', asyncHandler(handleUncompleteEvent));
  router.post('/external/:eventId/move', asyncHandler(handleMoveExternalEvent));
}

/** Handler: POST /api/schedule/:eventId/lock */
async function handleLockEvent(
  req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
  try {
    const userId = req.userId;
    const eventId = req.params.eventId as string;
    if (!validateUUID(eventId as string, res)) return;
    const parsed = lockBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const { locked } = parsed.data;

    const rows = await db
      .select()
      .from(scheduledEvents)
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Scheduled event');
      return;
    }
    const row = rows[0];

    const now = new Date().toISOString();
    const newStatus = locked ? EventStatus.Locked : EventStatus.Free;

    await db
      .update(scheduledEvents)
      .set({ status: newStatus, updatedAt: now })
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));

    // Sync lock status to Google Calendar
    let { calClient, manager } = getSchedulerClients(userId);
    if (!calClient) {
      try {
        const scheduler = await schedulerRegistry.getOrCreate(userId);
        calClient = scheduler.getCalClient();
        manager = scheduler.getPollerManager();
      } catch {
        /* no Google connection */
      }
    }

    if (calClient && row.googleEventId) {
      try {
        const googleCalId = await resolveGoogleCalId(row.calendarId, userId);
        const cleanTitle = stripStatusPrefix(row.title || '');
        const prefix = locked ? STATUS_PREFIX.locked : STATUS_PREFIX.free;
        const op = {
          type: CalendarOpType.Update as const,
          eventId: row.id,
          googleEventId: row.googleEventId,
          itemType: (row.itemType || ItemType.Habit) as ItemType,
          itemId: row.itemId || '',
          title: `${prefix} ${cleanTitle}`,
          start: row.start || '',
          end: row.end || '',
          status: newStatus,
          extendedProperties: buildExtendedProps(row, newStatus),
        };
        const failed = await calClient.applyOperations(googleCalId, [op]);
        if (failed.length > 0) {
          log.warn(
            { itemId: op.itemId },
            'Lock sync to Google was rate-limited, will reconcile on next reschedule',
          );
          notifyGoogleSyncFailure(userId, 'lock');
        }
      } catch (syncErr) {
        log.error({ err: syncErr }, 'Failed to sync lock status to Google Calendar');
        notifyGoogleSyncFailure(userId, 'lock');
      }
    }

    manager?.markAllWritten();
    await invalidateQualityCache(userId);
    await logChange(userId, locked ? ScheduleChangeType.Locked : ScheduleChangeType.Unlocked, row);
    broadcastToUser(userId, 'schedule_updated', 'Event lock toggled');
    triggerReschedule('Event lock toggled', userId);
    res.json({ eventId, locked, status: newStatus });
  } catch (error: unknown) {
    log.error({ err: error }, 'Lock event error');
    sendError(res, 500, 'Failed to lock event');
  }
}

/** Strip status prefix from a title. */
function stripStatusPrefix(title: string): string {
  for (const prefix of [
    STATUS_PREFIX.free,
    STATUS_PREFIX.busy,
    STATUS_PREFIX.locked,
    STATUS_PREFIX.completed,
  ]) {
    if (title.startsWith(prefix)) {
      return title.slice(prefix.length).trimStart();
    }
  }
  return title;
}

/** Handler: POST /api/schedule/:eventId/complete */
async function handleCompleteEvent(
  req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
  try {
    const userId = req.userId;
    const eventId = req.params.eventId as string;
    if (!validateUUID(eventId as string, res)) return;

    const rows = await db
      .select()
      .from(scheduledEvents)
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Scheduled event');
      return;
    }
    const row = rows[0];

    if (!row.start || !row.end) {
      sendError(res, 400, 'Event has no start/end time');
      return;
    }

    const userSettings = await getUserSettings(userId);
    const now = new Date();
    const nowISO = now.toISOString();
    const eventStart = new Date(row.start);
    const eventEnd = new Date(row.end);
    // Only trim if the event is currently in progress (started but not ended)
    const shouldTrim =
      userSettings.trimCompletedEvents !== false && now >= eventStart && now < eventEnd;
    const newEnd = shouldTrim ? nowISO : row.end;

    const [updatedRow] = await db
      .update(scheduledEvents)
      .set({ status: EventStatus.Completed, end: newEnd, updatedAt: nowISO })
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)))
      .returning();

    let { calClient, manager } = getSchedulerClients(userId);
    if (!calClient) {
      try {
        const scheduler = await schedulerRegistry.getOrCreate(userId);
        calClient = scheduler.getCalClient();
        manager = scheduler.getPollerManager();
      } catch {
        /* no Google connection — skip sync */
      }
    }

    if (calClient && row.googleEventId) {
      try {
        const googleCalId = await resolveGoogleCalId(row.calendarId, userId);
        const cleanTitle = stripStatusPrefix(row.title || '');
        const op = {
          type: CalendarOpType.Update as const,
          eventId: row.id,
          googleEventId: row.googleEventId,
          itemType: (row.itemType || ItemType.Habit) as ItemType,
          itemId: row.itemId || '',
          title: `${STATUS_PREFIX.completed} ${cleanTitle}`,
          start: row.start,
          end: newEnd,
          status: EventStatus.Completed,
          extendedProperties: buildExtendedProps(row, EventStatus.Completed),
        };
        const failed = await calClient.applyOperations(googleCalId, [op]);
        if (failed.length > 0) {
          log.warn(
            { itemId: op.itemId },
            'Complete sync to Google was rate-limited, will reconcile on next reschedule',
          );
          notifyGoogleSyncFailure(userId, 'complete');
        }
      } catch (syncErr) {
        log.error({ err: syncErr }, 'Failed to sync completion to Google Calendar');
        notifyGoogleSyncFailure(userId, 'complete');
      }
    }

    // Record habit completion for the day so the scheduler won't re-schedule it
    if (row.itemType === ItemType.Habit && row.itemId) {
      const habitId = row.itemId.split('__')[0];
      const scheduledDate = row.itemId.split('__')[1] || row.start.slice(0, 10);
      await db
        .insert(habitCompletions)
        .values({
          userId,
          habitId,
          scheduledDate,
          completedAt: nowISO,
        })
        .onConflictDoNothing(); // unique constraint on (userId, habitId, scheduledDate)
    }

    manager?.markAllWritten();
    await invalidateQualityCache(userId);
    await logChange(userId, ScheduleChangeType.Completed, row, row.start, newEnd);
    triggerReschedule('Event completed', userId);
    broadcastToUser(userId, 'schedule_updated', 'Event completed');

    res.json(
      updatedRow ?? { ...row, status: EventStatus.Completed, end: newEnd, updatedAt: nowISO },
    );
  } catch (error: unknown) {
    log.error({ err: error }, 'Complete event error');
    sendError(res, 500, 'Failed to complete event');
  }
}

/** Handler: POST /api/schedule/:eventId/uncomplete — revert a completed event to free */
async function handleUncompleteEvent(
  req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
  try {
    const userId = req.userId;
    const eventId = req.params.eventId as string;
    if (!validateUUID(eventId as string, res)) return;

    const rows = await db
      .select()
      .from(scheduledEvents)
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Scheduled event');
      return;
    }
    const row = rows[0];

    if (row.status !== EventStatus.Completed) {
      sendError(res, 400, 'Event is not completed');
      return;
    }

    const nowISO = new Date().toISOString();

    const [updatedRow] = await db
      .update(scheduledEvents)
      .set({ status: EventStatus.Free, updatedAt: nowISO })
      .where(and(eq(scheduledEvents.id, eventId), eq(scheduledEvents.userId, userId)))
      .returning();

    let { calClient, manager } = getSchedulerClients(userId);
    if (!calClient) {
      try {
        const scheduler = await schedulerRegistry.getOrCreate(userId);
        calClient = scheduler.getCalClient();
        manager = scheduler.getPollerManager();
      } catch {
        /* no Google connection */
      }
    }

    if (calClient && row.googleEventId) {
      try {
        const googleCalId = await resolveGoogleCalId(row.calendarId, userId);
        const cleanTitle = stripStatusPrefix(row.title || '');
        const op = {
          type: CalendarOpType.Update as const,
          eventId: row.id,
          googleEventId: row.googleEventId,
          itemType: (row.itemType || ItemType.Habit) as ItemType,
          itemId: row.itemId || '',
          title: `${STATUS_PREFIX.free} ${cleanTitle}`,
          start: row.start || '',
          end: row.end || '',
          status: EventStatus.Free,
          extendedProperties: buildExtendedProps(row, EventStatus.Free),
        };
        const failed = await calClient.applyOperations(googleCalId, [op]);
        if (failed.length > 0) {
          log.warn(
            { itemId: op.itemId },
            'Uncomplete sync to Google was rate-limited, will reconcile on next reschedule',
          );
          notifyGoogleSyncFailure(userId, 'uncomplete');
        }
      } catch (syncErr) {
        log.error({ err: syncErr }, 'Failed to sync uncomplete to Google Calendar');
        notifyGoogleSyncFailure(userId, 'uncomplete');
      }
    }

    // Remove habit completion record so the scheduler treats the day as incomplete
    if (row.itemType === ItemType.Habit && row.itemId) {
      const habitId = row.itemId.split('__')[0];
      const scheduledDate = row.itemId.split('__')[1] || row.start?.slice(0, 10) || '';
      await db
        .delete(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, userId),
            eq(habitCompletions.habitId, habitId),
            eq(habitCompletions.scheduledDate, scheduledDate),
          ),
        );
    }

    manager?.markAllWritten();
    await invalidateQualityCache(userId);
    await logChange(
      userId,
      ScheduleChangeType.Unlocked,
      { ...row, title: row.title },
      row.start,
      row.end,
    );
    broadcastToUser(userId, 'schedule_updated', 'Event uncompleted');

    res.json(updatedRow ?? { ...row, status: EventStatus.Free, updatedAt: nowISO });
  } catch (error: unknown) {
    log.error({ err: error }, 'Uncomplete event error');
    sendError(res, 500, 'Failed to uncomplete event');
  }
}

/** Handler: POST /api/schedule/external/:eventId/move */
async function handleMoveExternalEvent(
  req: import('express').Request,
  res: import('express').Response,
): Promise<void> {
  try {
    const userId = req.userId;
    const eventId = req.params.eventId as string;
    if (!validateUUID(eventId as string, res)) return;
    const parsed = moveEventSchema.safeParse(req.body);
    if (!parsed.success) {
      sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid input');
      return;
    }
    const { start, end } = parsed.data;

    const rows = await db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'External event');
      return;
    }
    const row = rows[0];

    const calRows = await db
      .select()
      .from(calendars)
      .where(and(eq(calendars.id, row.calendarId), eq(calendars.userId, userId)));
    if (calRows.length === 0) {
      sendError(res, 400, 'Calendar not found for this event');
      return;
    }
    const googleCalId = calRows[0].googleCalendarId;

    let { calClient, manager } = getSchedulerClients(userId);

    // If scheduler isn't running yet, try to start it
    if (!calClient) {
      try {
        const scheduler = await schedulerRegistry.getOrCreate(userId);
        calClient = scheduler.getCalClient();
        manager = scheduler.getPollerManager();
      } catch {
        sendError(res, 400, 'Google Calendar not connected');
        return;
      }
    }

    if (!calClient) {
      sendError(res, 400, 'Google Calendar not connected');
      return;
    }

    try {
      await calClient.patchEventTime(googleCalId, row.googleEventId, start, end);
    } catch (syncErr) {
      log.error(
        { err: syncErr, googleEventId: row.googleEventId },
        'Failed to move external event on Google Calendar',
      );
      sendError(res, 502, 'Failed to update event on Google Calendar');
      return;
    }

    const now = new Date().toISOString();
    await db
      .update(calendarEvents)
      .set({ start, end, updatedAt: now })
      .where(and(eq(calendarEvents.id, eventId), eq(calendarEvents.userId, userId)));

    manager?.markAllWritten();
    await invalidateQualityCache(userId);
    await logChange(
      userId,
      ScheduleChangeType.Moved,
      { ...row, itemType: 'external', itemId: row.id },
      start,
      end,
    );
    triggerReschedule('External event moved', userId);
    broadcastToUser(userId, 'schedule_updated', 'External event moved');

    res.json({ message: 'External event moved', eventId, start, end });
  } catch (error: unknown) {
    log.error({ err: error }, 'Move external event error');
    sendError(res, 500, 'Failed to move external event');
  }
}
