import { Router } from 'express';
import { eq, and, desc, gte, sql, count } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '../db/pg-index.js';
import { habits, scheduledEvents, habitCompletions } from '../db/pg-schema.js';
import type { Habit, HabitCompletion } from '@fluxure/shared';
import { EventStatus, addDays, toDateStr, getPlanLimits } from '@fluxure/shared';
import { toHabit } from '../utils/converters.js';
import { checkEntityLimit, sendPlanLimitError } from '../middleware/plan-gate.js';
import { shouldHabitScheduleOnDay } from './schedule-helpers.js';
import {
  createHabitSchema,
  updateHabitSchema,
  forceBodySchema,
  paginationSchema,
  completionSchema,
} from '../validation.js';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { completeHabit } from '../services/habit-completion.js';
import { cancelAutoCompleteJob, cancelAllForHabit } from '../jobs/habit-auto-complete.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../logger.js';
import { getUserTimezoneCached as getUserTimezone } from '../cache/user-settings.js';
import { detectCycle } from '../utils/cycle-detection.js';
import { buildUpdates, validateCalendarOwnership } from '../utils/route-helpers.js';

const log = createLogger('habits');

const router = Router();

// GET /api/habits — list all habits for the current user
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
        id: habits.id,
        name: habits.name,
        priority: habits.priority,
        userId: habits.userId,
        windowStart: habits.windowStart,
        windowEnd: habits.windowEnd,
        idealTime: habits.idealTime,
        durationMin: habits.durationMin,
        durationMax: habits.durationMax,
        days: habits.days,
        schedulingHours: habits.schedulingHours,
        forced: habits.forced,
        autoDecline: habits.autoDecline,
        dependsOn: habits.dependsOn,
        enabled: habits.enabled,
        skipBuffer: habits.skipBuffer,
        notifications: habits.notifications,
        calendarId: habits.calendarId,
        color: habits.color,
        createdAt: habits.createdAt,
        updatedAt: habits.updatedAt,
      })
      .from(habits)
      .where(eq(habits.userId, req.userId))
      .limit(limit)
      .offset(offset);
    const result: Habit[] = rows.map(toHabit);
    res.json(result);
  }),
);

// POST /api/habits — create a habit
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createHabitSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const body = parsed.data;

    const limits = getPlanLimits(req.userPlan);
    const [{ count: habitCount }] = await db
      .select({ count: count() })
      .from(habits)
      .where(eq(habits.userId, req.userId));
    if (!checkEntityLimit(habitCount, limits.maxHabits)) {
      sendPlanLimitError(res, 'maxHabits', habitCount, limits.maxHabits);
      return;
    }

    if (body.dependsOn) {
      const [depRows, allUserHabits] = await Promise.all([
        db
          .select({ id: habits.id })
          .from(habits)
          .where(and(eq(habits.id, body.dependsOn), eq(habits.userId, req.userId))),
        db
          .select({ id: habits.id, dependsOn: habits.dependsOn })
          .from(habits)
          .where(eq(habits.userId, req.userId)),
      ]);
      if (depRows.length === 0) {
        sendError(res, 400, 'Referenced habit not found');
        return;
      }
      if (detectCycle('new', body.dependsOn, allUserHabits)) {
        sendError(res, 400, 'Dependency would create a circular chain');
        return;
      }
    }

    if (body.calendarId) {
      if (!(await validateCalendarOwnership(body.calendarId, req.userId))) {
        sendError(res, 400, 'Invalid calendar ID');
        return;
      }
    }

    const row = {
      userId: req.userId,
      name: body.name,
      priority: body.priority ?? 3,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      idealTime: body.idealTime,
      durationMin: body.durationMin,
      durationMax: body.durationMax,
      days: body.days,
      schedulingHours: body.schedulingHours ?? ('working' as const),
      forced: false,
      autoDecline: body.autoDecline ?? false,
      dependsOn: body.dependsOn ?? null,
      enabled: true,
      skipBuffer: body.skipBuffer ?? false,
      notifications: body.notifications ?? false,
      calendarId: body.calendarId ?? null,
      color: body.color ?? null,
    };

    const inserted = await db.insert(habits).values(row).returning();
    const created = inserted[0];
    logActivity(req.userId, 'create', 'habit', created.id, { name: body.name }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Habit created');
    triggerReschedule('Habit created', req.userId);
    res.status(201).json(toHabit(created));
  }),
);

// PUT /api/habits/:id — update a habit
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)));

    if (existing.length === 0) {
      sendNotFound(res, 'Habit');
      return;
    }

    const parsed = updateHabitSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const body = parsed.data;

    // Cross-field validation: merge partial update with existing values
    const mergedWindowStart = body.windowStart ?? existing[0].windowStart;
    const mergedWindowEnd = body.windowEnd ?? existing[0].windowEnd;
    if (mergedWindowStart && mergedWindowEnd && mergedWindowStart === mergedWindowEnd) {
      sendError(res, 400, 'windowStart and windowEnd must not be identical');
      return;
    }
    const mergedDurationMin = body.durationMin ?? existing[0].durationMin;
    const mergedDurationMax = body.durationMax ?? existing[0].durationMax;
    if (
      mergedDurationMin !== undefined &&
      mergedDurationMax !== undefined &&
      mergedDurationMin > mergedDurationMax
    ) {
      sendError(res, 400, 'durationMin must be <= durationMax');
      return;
    }

    if (body.dependsOn !== undefined && body.dependsOn !== null) {
      if (body.dependsOn === id) {
        sendError(res, 400, 'A habit cannot depend on itself');
        return;
      }
      const depRows = await db
        .select()
        .from(habits)
        .where(and(eq(habits.id, body.dependsOn), eq(habits.userId, req.userId)));
      if (depRows.length === 0) {
        sendError(res, 400, 'Referenced habit not found');
        return;
      }
      // Check for circular dependency chain
      const allUserHabits = await db
        .select({ id: habits.id, dependsOn: habits.dependsOn })
        .from(habits)
        .where(eq(habits.userId, req.userId));
      if (detectCycle(id, body.dependsOn, allUserHabits)) {
        sendError(res, 400, 'Dependency would create a circular chain');
        return;
      }
    }

    if (body.calendarId) {
      if (!(await validateCalendarOwnership(body.calendarId, req.userId))) {
        sendError(res, 400, 'Invalid calendar ID');
        return;
      }
    }

    const updates: Record<string, unknown> = {
      ...buildUpdates(body, [
        'name',
        'priority',
        'windowStart',
        'windowEnd',
        'idealTime',
        'durationMin',
        'durationMax',
        'days',
        'schedulingHours',
        'forced',
        'autoDecline',
        'dependsOn',
        'enabled',
        'skipBuffer',
        'notifications',
        'calendarId',
        'color',
      ] as const),
      updatedAt: new Date().toISOString(),
    };

    const updated = await db
      .update(habits)
      .set(updates)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)))
      .returning();
    if (parsed.data.enabled === false) {
      cancelAllForHabit(id, req.userId).catch((err) =>
        log.warn({ err, habitId: id }, 'Failed to cancel auto-complete jobs on habit disable'),
      );
    }
    logActivity(req.userId, 'update', 'habit', id, { fields: Object.keys(updates) }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Habit updated');
    triggerReschedule('Habit updated', req.userId);
    res.json(toHabit(updated[0]));
  }),
);

// DELETE /api/habits/:id — delete habit and its scheduled events
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)));

    if (existing.length === 0) {
      sendNotFound(res, 'Habit');
      return;
    }

    // Delete the habit but keep scheduled_events rows — the reschedule will
    // diff against them and generate Delete ops for Google Calendar cleanup.
    await db.delete(habits).where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
    cancelAllForHabit(id, req.userId).catch((err) =>
      log.warn({ err, habitId: id }, 'Failed to cancel auto-complete jobs on habit delete'),
    );
    logActivity(req.userId, 'delete', 'habit', id, { name: existing[0].name }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Habit deleted');
    triggerReschedule('Habit deleted', req.userId);

    res.status(204).send();
  }),
);

// POST /api/habits/:id/force — toggle forced field (all occurrences pinned)
router.post(
  '/:id/force',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)));

    if (existing.length === 0) {
      sendNotFound(res, 'Habit');
      return;
    }

    const parsed = forceBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const newForced = parsed.data.forced;

    const now = new Date().toISOString();
    const updated = await db
      .update(habits)
      .set({ forced: newForced, updatedAt: now })
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)))
      .returning();

    // When un-forcing, also clear per-event Locked status on scheduled events
    // so the engine treats them as flexible again.
    if (!newForced) {
      await db
        .update(scheduledEvents)
        .set({ status: EventStatus.Free, updatedAt: now })
        .where(
          and(
            eq(scheduledEvents.userId, req.userId),
            eq(scheduledEvents.status, EventStatus.Locked),
            sql`${scheduledEvents.itemId} LIKE ${id} || '__' || '%'`,
          ),
        );
    }

    broadcastToUser(req.userId, 'schedule_updated', 'Habit force toggled');
    triggerReschedule('Habit force toggled', req.userId);
    res.json(toHabit(updated[0]));
  }),
);

const completionsPaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(365).default(100),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

// GET /api/habits/:id/completions — list completions for a habit
router.get(
  '/:id/completions',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
    if (existing.length === 0) {
      sendNotFound(res, 'Habit');
      return;
    }

    const parsed = completionsPaginationSchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, 'Invalid pagination parameters');
      return;
    }
    const { limit, offset } = parsed.data;

    const rows = await db
      .select()
      .from(habitCompletions)
      .where(and(eq(habitCompletions.habitId, id), eq(habitCompletions.userId, req.userId)))
      .orderBy(desc(habitCompletions.scheduledDate))
      .limit(limit)
      .offset(offset);

    const result: HabitCompletion[] = rows.map((row) => ({
      id: row.id,
      habitId: row.habitId,
      scheduledDate: row.scheduledDate,
      completedAt: row.completedAt,
    }));

    res.json(result);
  }),
);

// POST /api/habits/:id/completions — record a completion
router.post(
  '/:id/completions',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
    if (existing.length === 0) {
      sendNotFound(res, 'Habit');
      return;
    }

    const parsed2 = completionSchema.safeParse(req.body);
    if (!parsed2.success) {
      sendValidationError(res, parsed2.error);
      return;
    }
    const { scheduledDate } = parsed2.data;

    const result = await completeHabit(req.userId, id, scheduledDate);

    if (result) {
      // Cancel any pending auto-complete job for this habit+date
      cancelAutoCompleteJob(id, scheduledDate, req.userId).catch((err) =>
        log.warn({ err, habitId: id, scheduledDate }, 'Failed to cancel auto-complete job'),
      );
      res.status(201).json(result);
    } else {
      // Already completed — return existing
      const rows = await db
        .select()
        .from(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, req.userId),
            eq(habitCompletions.habitId, id),
            eq(habitCompletions.scheduledDate, scheduledDate),
          ),
        );
      res.status(200).json({
        id: rows[0]?.id ?? '',
        habitId: id,
        scheduledDate,
        completedAt: rows[0]?.completedAt ?? new Date().toISOString(),
      });
    }
  }),
);

// GET /api/habits/:id/streak — compute current streak
router.get(
  '/:id/streak',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select({
        id: habits.id,
        userId: habits.userId,
        name: habits.name,
        priority: habits.priority,
        days: habits.days,
        durationMin: habits.durationMin,
        durationMax: habits.durationMax,
        windowStart: habits.windowStart,
        windowEnd: habits.windowEnd,
        idealTime: habits.idealTime,
        schedulingHours: habits.schedulingHours,
        forced: habits.forced,
        autoDecline: habits.autoDecline,
        dependsOn: habits.dependsOn,
        enabled: habits.enabled,
        skipBuffer: habits.skipBuffer,
        notifications: habits.notifications,
        calendarId: habits.calendarId,
        color: habits.color,
        createdAt: habits.createdAt,
        updatedAt: habits.updatedAt,
      })
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
    if (existing.length === 0) {
      sendNotFound(res, 'Habit');
      return;
    }

    const tz = await getUserTimezone(req.userId);
    const habit = toHabit(existing[0]);

    const today = new Date();
    // Walk backward from today counting consecutive scheduled days with completions
    const streakQuerySchema = z.object({
      maxStreak: z.coerce.number().int().min(1).max(365).default(90),
    });
    const streakParsed = streakQuerySchema.safeParse(req.query);
    if (!streakParsed.success) {
      sendError(res, 400, 'Invalid maxStreak parameter');
      return;
    }
    const maxStreakDays = streakParsed.data.maxStreak;

    // Limit completions lookback to maxStreak days
    const lookbackDate = addDays(today, -maxStreakDays);
    const lookbackStr = toDateStr(lookbackDate, tz);

    const rows = await db
      .select()
      .from(habitCompletions)
      .where(
        and(
          eq(habitCompletions.habitId, id),
          eq(habitCompletions.userId, req.userId),
          gte(habitCompletions.scheduledDate, lookbackStr),
        ),
      )
      .orderBy(desc(habitCompletions.scheduledDate));

    const completedDates = new Set(rows.map((r) => r.scheduledDate));

    let streak = 0;
    for (let i = 1; i < Math.min(maxStreakDays, 365); i++) {
      const d = addDays(today, -i);
      // Skip days when this habit isn't scheduled based on its frequency
      if (!shouldHabitScheduleOnDay(habit, d, tz)) continue;
      const dateStr = toDateStr(d, tz);
      if (completedDates.has(dateStr)) {
        streak++;
      } else {
        break;
      }
    }

    res.json({ habitId: id, currentStreak: streak });
  }),
);

const bulkStatusSchema = z.object({
  maxStreak: z.coerce.number().int().min(1).max(365).default(90),
});

// GET /api/habits/bulk-status — streaks + completions for all habits in one call
router.get(
  '/bulk-status',
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    const parsed = bulkStatusSchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, 'Invalid parameters');
      return;
    }
    const { maxStreak } = parsed.data;

    const now = new Date();
    const tz = await getUserTimezone(userId);
    // Limit completions lookback to maxStreak days
    const lookbackDate = addDays(now, -maxStreak);
    const lookbackStr = toDateStr(lookbackDate, tz);

    const [userHabits, completions] = await Promise.all([
      db
        .select()
        .from(habits)
        .where(and(eq(habits.userId, userId), eq(habits.enabled, true))),
      db
        .select()
        .from(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, userId),
            gte(habitCompletions.scheduledDate, lookbackStr),
          ),
        ),
    ]);

    // Group completions by habitId
    const completionsByHabit = new Map<string, typeof completions>();
    for (const c of completions) {
      const list = completionsByHabit.get(c.habitId) ?? [];
      list.push(c);
      completionsByHabit.set(c.habitId, list);
    }

    const result: Record<string, { streak: number; completions: HabitCompletion[] }> = {};

    for (const habitRow of userHabits) {
      const habit = toHabit(habitRow);
      const habitCompletionRows = completionsByHabit.get(habit.id) ?? [];
      const dates = habitCompletionRows.map((c) => c.scheduledDate);
      const dateSet = new Set(dates);

      // Streak: count consecutive scheduled days backward from yesterday, capped at maxStreak
      // Skip today (i=0) so an incomplete today doesn't reset the streak
      let streak = 0;
      for (let i = 1; i < maxStreak; i++) {
        const d = addDays(now, -i);
        // Skip days when this habit isn't scheduled based on its frequency
        if (!shouldHabitScheduleOnDay(habit, d, tz)) continue;
        if (dateSet.has(toDateStr(d, tz))) {
          streak++;
        } else {
          break;
        }
      }

      result[habit.id] = {
        streak,
        completions: habitCompletionRows.map((c) => ({
          id: c.id,
          habitId: c.habitId,
          scheduledDate: c.scheduledDate,
          completedAt: c.completedAt,
        })),
      };
    }

    res.json(result);
  }),
);

// GET /api/habits/:id — get a single habit by ID
// Placed after /bulk-status to avoid parameterized route shadowing
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const rows = await db
      .select()
      .from(habits)
      .where(and(eq(habits.id, id), eq(habits.userId, req.userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Habit');
      return;
    }
    res.json(toHabit(rows[0]));
  }),
);

export default router;
