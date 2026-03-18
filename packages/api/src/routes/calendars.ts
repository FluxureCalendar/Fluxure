import { Router } from 'express';
import { eq, and, count } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '../db/pg-index.js';
import { calendars, users } from '../db/pg-schema.js';
import { createOAuth2Client, setCredentials, GoogleCalendarClient } from '../google/index.js';
import { decrypt } from '../crypto.js';
import { CalendarMode, getPlanLimits } from '@fluxure/shared';
import { checkEntityLimit, sendPlanLimitError } from '../middleware/plan-gate.js';
import { schedulerRegistry } from '../scheduler-registry.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../logger.js';

const log = createLogger('calendars');

const patchCalendarSchema = z.object({
  mode: z.enum([CalendarMode.Writable, CalendarMode.Locked]).optional(),
  enabled: z.boolean().optional(),
});

/** Sort calendars: primary first, then alphabetically by name */
function sortCalendars<T extends { isPrimary: boolean | null; name: string }>(cals: T[]): T[] {
  return [...cals].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return a.name.localeCompare(b.name);
  });
}

const router = Router();

// GET /api/calendars - list all saved calendars for the current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db.select().from(calendars).where(eq(calendars.userId, req.userId));
    res.json(sortCalendars(rows));
  }),
);

// GET /api/calendars/discover - fetch from Google and upsert
router.get(
  '/discover',
  asyncHandler(async (req, res) => {
    try {
      const userRows = await db.select().from(users).where(eq(users.id, req.userId));

      if (userRows.length === 0 || !userRows[0].googleRefreshToken) {
        sendError(res, 400, 'Google Calendar not connected. Connect in Settings first.');
        return;
      }

      const oauth2Client = createOAuth2Client();
      const refreshToken = decrypt(userRows[0].googleRefreshToken);
      setCredentials(oauth2Client, refreshToken);
      const client = new GoogleCalendarClient(oauth2Client);
      const googleCalendars = await client.listCalendars();
      const now = new Date().toISOString();

      // Batch: fetch all existing calendars for this user in one query
      const existingCalendars = await db
        .select()
        .from(calendars)
        .where(eq(calendars.userId, req.userId));
      const existingByGoogleId = new Map(existingCalendars.map((c) => [c.googleCalendarId, c]));

      // Run all upserts in parallel
      await Promise.all(
        googleCalendars.map((gcal) => {
          const existing = existingByGoogleId.get(gcal.googleCalendarId);
          if (existing) {
            // Update name, color, isPrimary; keep user's mode/enabled for non-primary
            // Primary calendar is always enabled + writable (owner access guaranteed by Google)
            const updateFields: Record<string, unknown> = {
              name: gcal.name,
              color: gcal.color,
              isPrimary: gcal.isPrimary,
              updatedAt: now,
            };
            if (gcal.isPrimary) {
              updateFields.enabled = true;
              updateFields.mode = CalendarMode.Writable;
            }
            return db
              .update(calendars)
              .set(updateFields)
              .where(
                and(
                  eq(calendars.googleCalendarId, gcal.googleCalendarId),
                  eq(calendars.userId, req.userId),
                ),
              );
          } else {
            // Primary calendar auto-enabled and always writable
            return db.insert(calendars).values({
              userId: req.userId,
              googleCalendarId: gcal.googleCalendarId,
              name: gcal.name,
              color: gcal.color,
              mode: 'writable',
              enabled: gcal.isPrimary, // primary starts enabled, others disabled
              isPrimary: gcal.isPrimary,
              syncToken: null,
            });
          }
        }),
      );

      // Return updated list sorted
      const rows = await db.select().from(calendars).where(eq(calendars.userId, req.userId));
      res.json(sortCalendars(rows));
    } catch (err) {
      log.error({ err }, 'Discovery failed');
      sendError(res, 500, 'Failed to discover calendars');
    }
  }),
);

// PATCH /api/calendars/:id - update mode or enabled
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const parsed = patchCalendarSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const { mode, enabled } = parsed.data;

    const existing = await db
      .select()
      .from(calendars)
      .where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));
    if (existing.length === 0) {
      sendNotFound(res, 'Calendar');
      return;
    }

    if (enabled && !existing[0].enabled) {
      const limits = getPlanLimits(req.userPlan);
      const [{ count: enabledCount }] = await db
        .select({ count: count() })
        .from(calendars)
        .where(and(eq(calendars.userId, req.userId), eq(calendars.enabled, true)));
      if (!checkEntityLimit(enabledCount, limits.maxCalendars)) {
        sendPlanLimitError(res, 'maxCalendars', enabledCount, limits.maxCalendars);
        return;
      }
    }

    // Protect primary calendar — cannot disable or lock
    if (existing[0].isPrimary) {
      if (enabled === false) {
        sendError(res, 400, 'Cannot disable the primary calendar');
        return;
      }
      if (mode === CalendarMode.Locked) {
        sendError(res, 400, 'Cannot lock the primary calendar');
        return;
      }
    }

    // Enforce at least one writable calendar remains
    if (enabled === false || mode === CalendarMode.Locked) {
      const allCals = await db.select().from(calendars).where(eq(calendars.userId, req.userId));

      const wouldBeWritable = allCals.filter((c) => {
        if (c.id === id) {
          // Apply the proposed change
          const calEnabled = enabled !== undefined ? enabled : c.enabled;
          const calMode = mode !== undefined ? mode : c.mode;
          return calEnabled && calMode === CalendarMode.Writable;
        }
        return c.enabled && c.mode === CalendarMode.Writable;
      });

      if (wouldBeWritable.length === 0) {
        sendError(res, 400, 'At least one writable calendar must remain enabled');
        return;
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (mode !== undefined) updates.mode = mode;
    if (enabled !== undefined) updates.enabled = enabled;

    await db
      .update(calendars)
      .set(updates)
      .where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));

    // Start/stop poller when enabled state changes
    if (enabled !== undefined) {
      const scheduler = schedulerRegistry.get(req.userId);
      const manager = scheduler?.getPollerManager();
      if (manager) {
        const calRows = await db
          .select()
          .from(calendars)
          .where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));
        const cal = calRows[0];
        if (enabled) {
          await manager.startPoller(cal.id, cal.googleCalendarId);
        } else {
          manager.stopPoller(cal.id);
        }
      }
    }

    // Reset defaults if disabled calendar was a default
    if (enabled === false) {
      const userRows = await db.select().from(users).where(eq(users.id, req.userId));
      if (userRows[0]?.settings && typeof userRows[0].settings === 'object') {
        const settings = { ...(userRows[0].settings as Record<string, unknown>) };
        let changed = false;
        if (settings.defaultHabitCalendarId === id) {
          settings.defaultHabitCalendarId = null;
          changed = true;
        }
        if (settings.defaultTaskCalendarId === id) {
          settings.defaultTaskCalendarId = null;
          changed = true;
        }
        if (changed) {
          await db
            .update(users)
            .set({ settings, updatedAt: new Date().toISOString() })
            .where(eq(users.id, req.userId));
        }
      }
    }

    const updated = await db
      .select()
      .from(calendars)
      .where(and(eq(calendars.id, id), eq(calendars.userId, req.userId)));

    // Mode or enabled changes affect how the engine treats this calendar's events
    if (mode !== undefined || enabled !== undefined) {
      triggerReschedule('Calendar settings changed', req.userId);
    }

    res.json(updated[0]);
  }),
);

export default router;
