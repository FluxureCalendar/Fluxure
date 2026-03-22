import { Router } from 'express';
import { eq, and, gte, lte, inArray, sql, count } from 'drizzle-orm';

import { db } from '../db/pg-index.js';
import {
  schedulingLinks,
  scheduledEvents,
  calendarEvents,
  calendars,
  users,
} from '../db/pg-schema.js';
import type { CreateLinkRequest, SchedulingLink, UserSettings } from '@fluxure/shared';
import { getPlanLimits } from '@fluxure/shared';
import { checkEntityLimit, sendPlanLimitError } from '../middleware/plan-gate.js';
import {
  SchedulingHours,
  BOOKING_SLOT_STEP_MS,
  BOOKING_MIN_LEAD_TIME_MS,
  BOOKING_WINDOW_DAYS,
  addDays,
  DEFAULT_TIMEZONE,
  setTimeInTz,
  parseTime,
  parseISO,
  minutesSinceMidnightInTz,
  parseTimeToMinutes,
} from '@fluxure/shared';
import { createLinkSchema, updateLinkSchema, linkBookingSchema } from '../validation.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';

const VALID_SLUG_RE = /^[a-z0-9-]{1,100}$/;
import { DEFAULT_USER_SETTINGS, getHoursWindow } from './defaults.js';
import { getUserSettingsCached } from '../cache/user-settings.js';
import { bookingLimiter } from '../rate-limiters.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { invalidateBookingAvailability } from './booking.js';
import { triggerReschedule } from '../polling-ref.js';
import { broadcastToUser } from '../ws.js';
import { buildUpdates } from '../utils/route-helpers.js';

import { paginationSchema } from '../validation.js';

const router = Router();

// GET /api/links — list scheduling links for the current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, 'Invalid pagination parameters');
      return;
    }
    const { limit, offset } = parsed.data;
    const rows = await db
      .select({
        id: schedulingLinks.id,
        slug: schedulingLinks.slug,
        name: schedulingLinks.name,
        durations: schedulingLinks.durations,
        schedulingHours: schedulingLinks.schedulingHours,
        priority: schedulingLinks.priority,
        enabled: schedulingLinks.enabled,
        userId: schedulingLinks.userId,
        createdAt: schedulingLinks.createdAt,
        updatedAt: schedulingLinks.updatedAt,
      })
      .from(schedulingLinks)
      .where(eq(schedulingLinks.userId, req.userId))
      .limit(limit)
      .offset(offset);
    const result: SchedulingLink[] = rows.map(toLink);
    res.json(result);
  }),
);

// POST /api/links — create a scheduling link
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const body = parsed.data as CreateLinkRequest;

    const limits = getPlanLimits(req.userPlan);
    const [{ count: linkCount }] = await db
      .select({ count: count() })
      .from(schedulingLinks)
      .where(eq(schedulingLinks.userId, req.userId));
    if (!checkEntityLimit(linkCount, limits.maxSchedulingLinks)) {
      sendPlanLimitError(res, 'maxSchedulingLinks', linkCount, limits.maxSchedulingLinks);
      return;
    }

    const row = {
      userId: req.userId,
      slug: body.slug,
      name: body.name,
      durations: body.durations,
      schedulingHours: body.schedulingHours ?? ('working' as const),
      priority: body.priority ?? 3,
      enabled: true,
    };

    try {
      const inserted = await db.insert(schedulingLinks).values(row).returning();
      res.status(201).json(toLink(inserted[0]));
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as Record<string, unknown>).code === '23505'
      ) {
        sendError(res, 409, 'Slug already exists');
        return;
      }
      throw err;
    }
  }),
);

// PUT /api/links/:id — update a scheduling link
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const parsed = updateLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const body = parsed.data;
    const updates: Record<string, unknown> = {
      ...buildUpdates(body, [
        'name',
        'slug',
        'durations',
        'schedulingHours',
        'priority',
        'enabled',
      ] as const),
      updatedAt: new Date().toISOString(),
    };

    try {
      const updated = await db
        .update(schedulingLinks)
        .set(updates)
        .where(and(eq(schedulingLinks.id, id), eq(schedulingLinks.userId, req.userId)))
        .returning();
      if (updated.length === 0) {
        sendNotFound(res, 'Scheduling link');
        return;
      }
      res.json(toLink(updated[0]));
    } catch (err: unknown) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        (err as Record<string, unknown>).code === '23505'
      ) {
        sendError(res, 409, 'Slug already exists');
        return;
      }
      throw err;
    }
  }),
);

// DELETE /api/links/:id — delete a scheduling link
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const deleted = await db
      .delete(schedulingLinks)
      .where(and(eq(schedulingLinks.id, id), eq(schedulingLinks.userId, req.userId)))
      .returning();
    if (deleted.length === 0) {
      sendNotFound(res, 'Scheduling link');
      return;
    }

    res.status(204).send();
  }),
);

// GET /api/links/:slug/slots — return available time slots
router.get(
  '/:slug/slots',
  asyncHandler(async (req, res) => {
    const { slug } = req.params;
    if (!VALID_SLUG_RE.test(slug)) {
      sendError(res, 400, 'Invalid slug format');
      return;
    }
    const linkRows = await db
      .select()
      .from(schedulingLinks)
      .where(and(eq(schedulingLinks.slug, slug), eq(schedulingLinks.userId, req.userId)));

    if (linkRows.length === 0) {
      sendNotFound(res, 'Scheduling link');
      return;
    }

    const link = linkRows[0];

    if (!link.enabled) {
      sendError(res, 410, 'Scheduling link is disabled');
      return;
    }

    const durations: number[] = (link.durations as number[]) ?? [30];
    const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;

    const userRows = await db.select().from(users).where(eq(users.id, req.userId));
    const userSettings: UserSettings =
      userRows.length > 0 && userRows[0].settings && typeof userRows[0].settings === 'object'
        ? (userRows[0].settings as UserSettings)
        : DEFAULT_USER_SETTINGS;

    const hoursWindow = getHoursWindow(schedulingHours, userSettings);
    const userTimezone = userSettings.timezone || DEFAULT_TIMEZONE;
    const windowStartParsed = parseTime(hoursWindow.start) ?? { hours: 9, minutes: 0 };
    const windowEndParsed = parseTime(hoursWindow.end) ?? { hours: 17, minutes: 0 };

    const now = new Date();
    const windowEnd = addDays(now, BOOKING_WINDOW_DAYS);

    const enabledCals = await db
      .select({ id: calendars.id })
      .from(calendars)
      .where(and(eq(calendars.userId, req.userId), eq(calendars.enabled, true)));
    const enabledCalIds = enabledCals.map((c) => c.id);

    const [existingEvents, externalEvents] = await Promise.all([
      db
        .select()
        .from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.userId, req.userId),
            gte(scheduledEvents.end, now.toISOString()),
            lte(scheduledEvents.start, windowEnd.toISOString()),
          ),
        ),
      enabledCalIds.length > 0
        ? db
            .select()
            .from(calendarEvents)
            .where(
              and(
                eq(calendarEvents.userId, req.userId),
                inArray(calendarEvents.calendarId, enabledCalIds),
                gte(calendarEvents.end, now.toISOString()),
                lte(calendarEvents.start, windowEnd.toISOString()),
              ),
            )
        : Promise.resolve([]),
    ]);

    const occupied: Array<{ start: number; end: number }> = [
      ...existingEvents.map((ev) => ({
        start: new Date(ev.start!).getTime(),
        end: new Date(ev.end!).getTime(),
      })),
      ...externalEvents.map((ev) => ({
        start: new Date(ev.start).getTime(),
        end: new Date(ev.end).getTime(),
      })),
    ];

    // Generate available slots for each duration
    const slots: Array<{ start: string; end: string; duration: number }> = [];

    for (const duration of durations) {
      const durationMs = duration * 60 * 1000;
      const slotStepMs = BOOKING_SLOT_STEP_MS;

      for (let d = 0; d < BOOKING_WINDOW_DAYS; d++) {
        const day = addDays(now, d);

        const dayWindowStart = setTimeInTz(
          day,
          windowStartParsed.hours,
          windowStartParsed.minutes,
          userTimezone,
        );
        const dayWindowEnd = setTimeInTz(
          day,
          windowEndParsed.hours,
          windowEndParsed.minutes,
          userTimezone,
        );

        const effectiveStart =
          d === 0
            ? new Date(Math.max(dayWindowStart.getTime(), now.getTime() + BOOKING_MIN_LEAD_TIME_MS))
            : dayWindowStart;

        const startMs = Math.ceil(effectiveStart.getTime() / slotStepMs) * slotStepMs;

        for (
          let slotStart = startMs;
          slotStart + durationMs <= dayWindowEnd.getTime();
          slotStart += slotStepMs
        ) {
          const slotEnd = slotStart + durationMs;

          const overlaps = occupied.some((occ) => slotStart < occ.end && slotEnd > occ.start);

          if (!overlaps) {
            slots.push({
              start: new Date(slotStart).toISOString(),
              end: new Date(slotEnd).toISOString(),
              duration,
            });
          }
        }
      }
    }

    res.json({ slug, slots });
  }),
);

// POST /api/links/:slug/book — book a slot
router.post(
  '/:slug/book',
  bookingLimiter,
  asyncHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const linkRows = await db
      .select()
      .from(schedulingLinks)
      .where(and(eq(schedulingLinks.slug, slug), eq(schedulingLinks.userId, req.userId)));

    if (linkRows.length === 0) {
      sendNotFound(res, 'Scheduling link');
      return;
    }

    const link = linkRows[0];

    if (!link.enabled) {
      sendError(res, 410, 'Scheduling link is disabled');
      return;
    }

    const parsed = linkBookingSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { start, end, name, email } = parsed.data;
    const startDate = parseISO(start);
    const endDate = parseISO(end);

    if (startDate.getTime() <= Date.now()) {
      sendError(res, 400, 'Start time must be in the future');
      return;
    }

    const bookingDurationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    const configuredDurations: number[] = (link.durations as number[]) ?? [];
    if (!configuredDurations.includes(bookingDurationMin)) {
      sendError(res, 400, 'Invalid duration');
      return;
    }

    const userSettings = await getUserSettingsCached(link.userId);
    const schedulingHours = (link.schedulingHours ?? 'working') as SchedulingHours;
    const hoursWindow = getHoursWindow(schedulingHours, userSettings);
    const userTimezone = userSettings.timezone || DEFAULT_TIMEZONE;

    const startMinutes = minutesSinceMidnightInTz(startDate, userTimezone);
    const endMinutes = minutesSinceMidnightInTz(endDate, userTimezone);
    const windowStartMinutes = parseTimeToMinutes(hoursWindow.start);
    const windowEndMinutes = parseTimeToMinutes(hoursWindow.end);

    if (windowStartMinutes === null || windowEndMinutes === null) {
      sendError(res, 500, 'Invalid booking hours configuration');
      return;
    }

    if (startMinutes < windowStartMinutes || endMinutes > windowEndMinutes) {
      sendError(res, 400, 'Requested slot is outside available booking hours');
      return;
    }

    const now = new Date().toISOString();
    const durationMin = Math.round((endDate.getTime() - startDate.getTime()) / 60000);
    const bookingTitle = name ? `Booking: ${name}` : `Booking via ${slug}`;

    try {
      const inserted = await db.transaction(async (tx) => {
        // Lock overlapping scheduled_events rows to prevent concurrent double-booking
        await tx.execute(sql`
          SELECT id FROM scheduled_events
          WHERE user_id = ${req.userId}
            AND "end" >= ${start}
            AND start <= ${end}
          FOR UPDATE
        `);

        // Verify the slot is still available inside transaction
        const conflicting = (
          await tx
            .select()
            .from(scheduledEvents)
            .where(
              and(
                eq(scheduledEvents.userId, req.userId),
                gte(scheduledEvents.end, start),
                lte(scheduledEvents.start, end),
              ),
            )
        ).filter((ev) => {
          const evStart = new Date(ev.start!).getTime();
          const evEnd = new Date(ev.end!).getTime();
          return startDate.getTime() < evEnd && endDate.getTime() > evStart;
        });

        if (conflicting.length > 0) {
          throw new Error('SLOT_CONFLICT');
        }

        // Also check external calendar events for conflicts (only enabled calendars)
        const enabledCals = await tx
          .select({ id: calendars.id })
          .from(calendars)
          .where(and(eq(calendars.userId, req.userId), eq(calendars.enabled, true)));
        const calIds = enabledCals.map((c) => c.id);

        if (calIds.length > 0) {
          const externalConflicts = (
            await tx
              .select()
              .from(calendarEvents)
              .where(
                and(
                  eq(calendarEvents.userId, req.userId),
                  inArray(calendarEvents.calendarId, calIds),
                  gte(calendarEvents.end, start),
                  lte(calendarEvents.start, end),
                ),
              )
          ).filter((ev) => {
            if (ev.isAllDay) return false;
            return (
              startDate.getTime() < new Date(ev.end).getTime() &&
              endDate.getTime() > new Date(ev.start).getTime()
            );
          });

          if (externalConflicts.length > 0) {
            throw new Error('SLOT_CONFLICT');
          }
        }

        return await tx
          .insert(scheduledEvents)
          .values({
            userId: req.userId,
            itemType: 'meeting',
            itemId: link.id,
            title: bookingTitle,
            googleEventId: null,
            start,
            end,
            status: 'busy',
            alternativeSlotsCount: null,
          })
          .returning();
      });

      // Invalidate availability caches and trigger reschedule
      await invalidateBookingAvailability(req.userId);
      triggerReschedule('Link booking created', req.userId);
      broadcastToUser(req.userId, 'schedule_updated', 'Booking created');

      res.status(201).json({
        id: inserted[0].id,
        slug,
        title: bookingTitle,
        start,
        end,
        duration: durationMin,
        name: name || null,
        email: email || null,
        createdAt: now,
      });
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'SLOT_CONFLICT') {
        sendError(res, 409, 'Slot is no longer available');
        return;
      }
      throw err;
    }
  }),
);

function toLink(row: typeof schedulingLinks.$inferSelect): SchedulingLink {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    durations: (row.durations ?? []) as number[],
    schedulingHours: (row.schedulingHours ?? 'working') as SchedulingLink['schedulingHours'],
    priority: row.priority ?? 3,
    enabled: row.enabled ?? true,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
