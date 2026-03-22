import { Router } from 'express';
import { eq, and, gte, lte, lt, desc, inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db } from '../db/pg-index.js';
import {
  scheduledEvents,
  calendarEvents,
  calendars,
  habits,
  tasks,
  smartMeetings,
  focusTimeRules,
  scheduleChanges,
} from '../db/pg-schema.js';
import { reschedule, generateCandidateSlots, scoreSlot, buildTimeline } from '@fluxure/engine';
import type {
  BufferConfig,
  CalendarEvent,
  CalendarOperation,
  QualityScore,
  TimeSlot,
} from '@fluxure/shared';
import {
  EventStatus,
  ItemType,
  CalendarOpType,
  BRAND,
  DEFAULT_BREAK_BETWEEN_MINUTES,
  RATE_LIMIT as RATE_LIMIT_CONST,
  QUALITY_CACHE_TTL_S,
  MS_PER_DAY,
  startOfDayInTz,
  nextDayInTz,
  toDateStr,
  getPlanLimits,
  DEFAULT_TIMEZONE,
} from '@fluxure/shared';
import rateLimit from 'express-rate-limit';
import { createStore } from '../rate-limiters.js';
import { broadcastToUser } from '../ws.js';
import { scheduleChangesQuerySchema } from '../validation.js';
import { schedulerRegistry } from '../scheduler-registry.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendNotFound, sendError, UUID_REGEX } from './helpers.js';
import { sendFeatureGated } from '../middleware/plan-gate.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { cacheHashGet, cacheHashSet, cacheHashDelAll } from '../cache/redis.js';
import { toHabit, toTask, toMeeting, toFocusRule } from '../utils/converters.js';
import { createLogger } from '../logger.js';
import { withDistributedLock, LockNotAcquiredError } from '../distributed/lock.js';
import { registerScheduleActions } from './schedule-actions.js';
import {
  getUserSettings,
  loadDomainObjectsForQuality,
  buildScheduleItemsForDay,
  buildPlacementsFromRows,
  computeQualityForDay,
  buildScheduleItemFromEntity,
  recordScheduleChanges,
} from './schedule-helpers.js';
import { invalidateAnalyticsCache } from './analytics.js';

const log = createLogger('schedule');

// ============================================================
// Quality score cache (5-min TTL per user:date) via Redis hashes
// Store: HSET quality:{userId} {date} {json}
// Read:  HGET quality:{userId} {date}
// Invalidate all: DEL quality:{userId} — O(1) instead of SCAN
// ============================================================
async function getCachedQuality(userId: string, date: string): Promise<QualityScore | null> {
  return cacheHashGet<QualityScore>(`quality:${userId}`, date);
}

async function setCachedQuality(userId: string, date: string, score: QualityScore): Promise<void> {
  await cacheHashSet(`quality:${userId}`, date, score, QUALITY_CACHE_TTL_S);
}

/** Invalidate all quality cache entries for a user. O(1) via DEL on hash key. */
export async function invalidateQualityCache(userId: string): Promise<void> {
  await Promise.all([cacheHashDelAll(`quality:${userId}`), invalidateAnalyticsCache(userId)]);
}

// Zod schemas for new endpoints
const qualityRangeSchema = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
});

const router = Router();

// Re-export for backwards compatibility (used by scheduler-registry.ts)
export { recordScheduleChanges } from './schedule-helpers.js';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

const scheduleQuerySchema = z.object({
  start: z.string().regex(ISO_DATE_RE, 'Must be ISO date format').optional(),
  end: z.string().regex(ISO_DATE_RE, 'Must be ISO date format').optional(),
});

const MAX_SCHEDULE_RANGE_DAYS = 90;
const DEFAULT_SCHEDULE_RANGE_DAYS = 14;

// GET /api/schedule — return scheduled + external calendar events, filtered by date range
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    const parsed = scheduleQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendError(res, 400, 'Invalid query parameters');
      return;
    }

    let startDate: Date;
    let endDate: Date;

    if (parsed.data.start) {
      startDate = new Date(parsed.data.start);
      if (isNaN(startDate.getTime())) {
        sendError(res, 400, 'Invalid start date format');
        return;
      }
    } else {
      // Default: today - 1 day
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 1);
    }

    if (parsed.data.end) {
      endDate = new Date(parsed.data.end);
      if (isNaN(endDate.getTime())) {
        sendError(res, 400, 'Invalid end date format');
        return;
      }
    } else {
      // Default: start + DEFAULT_SCHEDULE_RANGE_DAYS
      endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + DEFAULT_SCHEDULE_RANGE_DAYS);
    }

    // Enforce max range of 90 days
    const rangeDays = (endDate.getTime() - startDate.getTime()) / MS_PER_DAY;
    if (rangeDays > MAX_SCHEDULE_RANGE_DAYS) {
      sendError(res, 400, `Date range must not exceed ${MAX_SCHEDULE_RANGE_DAYS} days`);
      return;
    }
    if (rangeDays < 0) {
      sendError(res, 400, 'start must be before end');
      return;
    }

    const startISO = startDate.toISOString();
    const endISO = endDate.toISOString();

    const managedWhere = and(
      eq(scheduledEvents.userId, userId),
      gte(scheduledEvents.end, startISO),
      lte(scheduledEvents.start, endISO),
    );

    // External events from enabled calendars
    const enabledCals = await db
      .select()
      .from(calendars)
      .where(and(eq(calendars.userId, userId), eq(calendars.enabled, true)));
    const enabledCalIds = enabledCals.map((c) => c.id);
    const calColorMap = new Map(enabledCals.map((c) => [c.id, c.color]));
    const calNameMap = new Map(enabledCals.map((c) => [c.id, c.name]));

    const externalWhere =
      enabledCalIds.length > 0
        ? and(
            eq(calendarEvents.userId, userId),
            inArray(calendarEvents.calendarId, enabledCalIds),
            gte(calendarEvents.end, startISO),
            lte(calendarEvents.start, endISO),
          )
        : null;

    const [allManaged, allExternal] = await Promise.all([
      db.select().from(scheduledEvents).where(managedWhere),
      externalWhere ? db.select().from(calendarEvents).where(externalWhere) : Promise.resolve([]),
    ]);

    const managed = allManaged
      .filter((row) => row.start && row.end)
      .map((row) => ({
        ...row,
        calendarId: row.calendarId || null,
      }));

    const externalAll = allExternal
      .filter((row) => row.start && row.end)
      .map((row) => ({
        id: row.id,
        googleEventId: row.googleEventId,
        title: row.title,
        start: row.start,
        end: row.end,
        status: row.status || 'busy',
        itemType: 'external',
        itemId: null,
        calendarId: row.calendarId,
        calendarName: calNameMap.get(row.calendarId) || '',
        calendarColor: calColorMap.get(row.calendarId) || '#4285f4',
        location: row.location,
        isAllDay: row.isAllDay,
      }));

    // Deduplicate events shared across multiple calendars
    const seenKeys = new Set<string>();
    const external = externalAll.filter((ev) => {
      const startMs = new Date(ev.start).getTime();
      const endMs = new Date(ev.end).getTime();
      const key = ev.googleEventId ? ev.googleEventId : `${ev.title}|${startMs}|${endMs}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    res.json([...managed, ...external]);
  }),
);

/** Run a local-only reschedule (no Google Calendar sync). */
async function runLocalReschedule(userId: string) {
  const [allHabitsRaw, allTasksRaw, allMeetingsRaw, allFocusRulesRaw] = await Promise.all([
    db.select().from(habits).where(eq(habits.userId, userId)),
    db.select().from(tasks).where(eq(tasks.userId, userId)),
    db.select().from(smartMeetings).where(eq(smartMeetings.userId, userId)),
    db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId)),
  ]);

  const allHabits = allHabitsRaw.map(toHabit);
  const allTasks = allTasksRaw.map(toTask);
  const allMeetings = allMeetingsRaw.map(toMeeting);
  const allFocusRules = allFocusRulesRaw.map(toFocusRule);

  const userSettings = await getUserSettings(userId);
  const buf: BufferConfig = {
    breakBetweenItemsMinutes:
      userSettings.breakBetweenItemsMinutes ?? DEFAULT_BREAK_BETWEEN_MINUTES,
  };

  const nowISO = new Date().toISOString();
  const scheduledRows = await db
    .select()
    .from(scheduledEvents)
    .where(and(eq(scheduledEvents.userId, userId), gte(scheduledEvents.end, nowISO)));

  const existingEvents: CalendarEvent[] = scheduledRows.map((row) => ({
    id: row.id,
    googleEventId: row.googleEventId || '',
    title: row.title || '',
    start: row.start || '',
    end: row.end || '',
    isManaged: true,
    itemType: row.itemType as ItemType,
    itemId: row.itemId,
    status: (row.status || 'free') as EventStatus,
    location: null,
    description: null,
    calendarId: row.calendarId ?? null,
    lastModifiedByUs: null,
    googleUpdatedAt: null,
  }));

  const result = reschedule(
    allHabits,
    allTasks,
    allMeetings,
    allFocusRules,
    existingEvents,
    buf,
    userSettings,
  );

  const existingEventsMap = new Map<
    string,
    { start: string; end: string; title: string; itemType: string; itemId: string }
  >();
  for (const ev of existingEvents) {
    existingEventsMap.set(ev.id, {
      start: ev.start,
      end: ev.end,
      title: ev.title || '',
      itemType: ev.itemType || '',
      itemId: ev.itemId || '',
    });
  }

  await applyOperationsLocally(result.operations, userId);
  await recordScheduleChanges(result.operations, existingEventsMap, userId);

  return result;
}

/** Apply calendar operations to the local DB in a transaction. */
async function applyOperationsLocally(
  operations: CalendarOperation[],
  userId: string,
): Promise<void> {
  const now = new Date().toISOString();

  // Pre-categorize operations by type for batching
  type ItemTypeEnum = 'habit' | 'task' | 'meeting' | 'focus' | 'external';
  type EventStatusEnum = 'free' | 'busy' | 'locked' | 'completed';
  const insertValues: Array<{
    userId: string;
    itemType: ItemTypeEnum;
    itemId: string;
    title: string;
    googleEventId: null;
    start: string;
    end: string;
    status: EventStatusEnum;
    alternativeSlotsCount: null;
    createdAt: string;
    updatedAt: string;
  }> = [];
  const updateOps: Array<CalendarOperation> = [];
  const deleteIds: string[] = [];

  for (const op of operations) {
    if (op.type === CalendarOpType.Create) {
      insertValues.push({
        userId,
        itemType: op.itemType,
        itemId: op.itemId,
        title: op.title,
        googleEventId: null,
        start: op.start,
        end: op.end,
        status: op.status as EventStatusEnum,
        alternativeSlotsCount: null,
        createdAt: now,
        updatedAt: now,
      });
    } else if (op.type === CalendarOpType.Update && op.eventId) {
      updateOps.push(op);
    } else if (op.type === CalendarOpType.Delete && op.eventId) {
      deleteIds.push(op.eventId);
    }
  }

  await db.transaction(async (tx) => {
    if (insertValues.length > 0) {
      await tx.insert(scheduledEvents).values(insertValues);
    }

    if (updateOps.length > 0) {
      await Promise.all(
        updateOps.map((op) =>
          tx
            .update(scheduledEvents)
            .set({
              title: op.title,
              start: op.start,
              end: op.end,
              status: op.status as EventStatusEnum,
              updatedAt: now,
            })
            .where(and(eq(scheduledEvents.id, op.eventId!), eq(scheduledEvents.userId, userId))),
        ),
      );
    }

    if (deleteIds.length > 0) {
      await tx
        .delete(scheduledEvents)
        .where(and(inArray(scheduledEvents.id, deleteIds), eq(scheduledEvents.userId, userId)));
    }
  });
}

const RESCHEDULE_TIMEOUT_MS = 60_000;

// POST /api/schedule/reschedule — run the scheduling engine
router.post(
  '/reschedule',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.userId;

      // Try the per-user scheduler (lazily starts if Google is connected)
      try {
        const scheduler = await schedulerRegistry.getOrCreate(userId);
        const opsPromise = scheduler.triggerReschedule('Manual reschedule');
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Reschedule timed out')), RESCHEDULE_TIMEOUT_MS);
        });
        const ops = await Promise.race([opsPromise, timeoutPromise]);
        broadcastToUser(userId, 'schedule_updated', 'Manual reschedule');
        res.json({ message: 'Reschedule complete', operationsApplied: ops, unschedulable: [] });
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '';
        if (
          !msg.includes('Google') &&
          !msg.includes('refresh token') &&
          !msg.includes('not connected')
        ) {
          throw err;
        }
      }

      // Google not connected — run local-only reschedule with distributed lock
      try {
        const result = await withDistributedLock(`lock:reschedule:${userId}`, 120_000, () =>
          runLocalReschedule(userId),
        );
        broadcastToUser(userId, 'schedule_updated', 'Manual reschedule');
        res.json({
          message: 'Reschedule complete',
          operationsApplied: result.operations.length,
          unschedulable: result.unschedulable,
        });
      } catch (err) {
        if (err instanceof LockNotAcquiredError) {
          sendError(res, 409, 'Reschedule already in progress');
          return;
        }
        throw err;
      }
    } catch (error: unknown) {
      log.error({ err: error }, 'Reschedule error');
      sendError(res, 500, 'Reschedule failed');
    }
  }),
);

// GET /api/schedule/changes — return recent schedule changes
router.get(
  '/changes',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.userId;
      const parsed = scheduleChangesQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid query parameters');
        return;
      }

      const { limit, since } = parsed.data;

      const limits = getPlanLimits(req.userPlan);
      const minSince = new Date(Date.now() - limits.changeHistoryDays * 24 * 60 * 60 * 1000);

      let sinceDate = since ? new Date(since) : minSince;
      if (sinceDate < minSince) {
        sinceDate = minSince;
      }
      const sinceISO = sinceDate.toISOString();

      const rows = await db
        .select()
        .from(scheduleChanges)
        .where(and(eq(scheduleChanges.userId, userId), gte(scheduleChanges.createdAt, sinceISO)))
        .orderBy(desc(scheduleChanges.createdAt))
        .limit(limit);

      res.json(rows);
    } catch (error: unknown) {
      log.error({ err: error }, 'Schedule changes query error');
      sendError(res, 500, 'Failed to fetch schedule changes');
    }
  }),
);

// GET /api/schedule/quality — calculate schedule quality score
router.get(
  '/quality',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.userId;
      const qualityDateSchema = z.object({
        date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD format')
          .optional(),
      });
      const dateParsed = qualityDateSchema.safeParse(req.query);
      if (!dateParsed.success) {
        sendError(res, 400, dateParsed.error.issues[0]?.message || 'Invalid date format');
        return;
      }
      const dateParam = dateParsed.data.date;
      const targetDate = dateParam ? new Date(dateParam + 'T12:00:00Z') : new Date();
      if (isNaN(targetDate.getTime())) {
        sendError(res, 400, 'Invalid date');
        return;
      }

      const userSettings = await getUserSettings(userId);
      const tz = userSettings.timezone || DEFAULT_TIMEZONE;

      const dateKey = toDateStr(targetDate, tz);
      const cached = await getCachedQuality(userId, dateKey);
      if (cached) {
        res.json(cached);
        return;
      }

      const { allHabits, allTasks, allMeetings, allFocusRules, buf } =
        await loadDomainObjectsForQuality(userId);

      const scheduleItems = buildScheduleItemsForDay(
        allHabits,
        allTasks,
        allMeetings,
        targetDate,
        tz,
        userSettings,
      );

      const dayStart = startOfDayInTz(targetDate, tz);
      const dayEnd = nextDayInTz(targetDate, tz);
      const scheduledRows = await db
        .select()
        .from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.userId, userId),
            gte(scheduledEvents.end, dayStart.toISOString()),
            lte(scheduledEvents.start, dayEnd.toISOString()),
          ),
        );

      const { placements, focusMinutesPlaced } = buildPlacementsFromRows(scheduledRows);

      const quality = computeQualityForDay(
        scheduleItems,
        placements,
        allFocusRules,
        buf,
        focusMinutesPlaced,
        tz,
      );

      await setCachedQuality(userId, dateKey, quality);

      const limits = getPlanLimits(req.userPlan);
      if (!limits.qualityScoreBreakdown) {
        // Free users see only the aggregate score
        res.json({ overall: quality.overall });
        return;
      }
      res.json(quality);
    } catch (error: unknown) {
      log.error({ err: error }, 'Quality score error');
      sendError(res, 500, 'Failed to calculate quality score');
    }
  }),
);

// GET /api/schedule/quality-range?start=YYYY-MM-DD&end=YYYY-MM-DD — quality scores for date range
router.get(
  '/quality-range',
  asyncHandler(async (req, res) => {
    try {
      const userId = req.userId;

      const limits = getPlanLimits(req.userPlan);
      if (!limits.qualityScoreTrend) {
        sendFeatureGated(res, 'quality score trend');
        return;
      }

      const parsed = qualityRangeSchema.safeParse(req.query);
      if (!parsed.success) {
        sendError(res, 400, parsed.error.issues[0]?.message || 'Invalid query parameters');
        return;
      }

      const { start, end } = parsed.data;
      if (start > end) {
        sendError(res, 400, 'start must be before end');
        return;
      }

      // Max 31 days to prevent abuse
      const startDate = new Date(start);
      const endDate = new Date(end);
      const daysDiff = Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY);
      if (daysDiff > 31) {
        sendError(res, 400, 'Date range must not exceed 31 days');
        return;
      }

      const { allHabits, allTasks, allMeetings, allFocusRules, buf, userSettings } =
        await loadDomainObjectsForQuality(userId);
      const tz = userSettings.timezone || DEFAULT_TIMEZONE;

      const rangeStart = startOfDayInTz(startDate, tz);
      const rangeEnd = nextDayInTz(endDate, tz);

      const allScheduled = await db
        .select()
        .from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.userId, userId),
            gte(scheduledEvents.end, rangeStart.toISOString()),
            lte(scheduledEvents.start, rangeEnd.toISOString()),
          ),
        );

      const results: Array<{
        date: string;
        overall: number;
        components: QualityScore['components'];
      }> = [];

      // Collect all date strings in range
      const allDates: Array<{ dateStr: string; day: Date }> = [];
      {
        let cur = startOfDayInTz(startDate, tz);
        const rangeEndMs = nextDayInTz(endDate, tz).getTime();
        while (cur.getTime() < rangeEndMs) {
          allDates.push({ dateStr: toDateStr(cur, tz), day: cur });
          cur = nextDayInTz(cur, tz);
        }
      }

      const cacheResults = await Promise.all(
        allDates.map(({ dateStr }) => getCachedQuality(userId, dateStr)),
      );

      // Pre-compute timestamps to avoid repeated Date construction in the loop
      const eventsWithTimestamps = allScheduled.map((ev) => ({
        ...ev,
        _startMs: new Date(ev.start!).getTime(),
        _endMs: new Date(ev.end!).getTime(),
      }));

      const cacheWrites: Promise<void>[] = [];

      for (let di = 0; di < allDates.length; di++) {
        const { dateStr, day: current } = allDates[di];
        const cached = cacheResults[di];
        if (cached) {
          results.push({ date: dateStr, overall: cached.overall, components: cached.components });
          continue;
        }

        const dayStart = startOfDayInTz(current, tz);
        const dayEnd = nextDayInTz(current, tz);
        const dayStartMs = dayStart.getTime();
        const dayEndMs = dayEnd.getTime();

        const scheduleItems = buildScheduleItemsForDay(
          allHabits,
          allTasks,
          allMeetings,
          current,
          tz,
          userSettings,
        );

        // Filter scheduled events to this day using pre-computed timestamps
        const dayScheduled = eventsWithTimestamps.filter((r) => {
          if (!r.start || !r.end) return false;
          return r._endMs > dayStartMs && r._startMs < dayEndMs;
        });

        const { placements, focusMinutesPlaced } = buildPlacementsFromRows(dayScheduled);

        const quality = computeQualityForDay(
          scheduleItems,
          placements,
          allFocusRules,
          buf,
          focusMinutesPlaced,
          tz,
        );
        cacheWrites.push(setCachedQuality(userId, dateStr, quality));
        results.push({ date: dateStr, overall: quality.overall, components: quality.components });
      }

      await Promise.all(cacheWrites);

      res.json(results);
    } catch (error: unknown) {
      log.error({ err: error }, 'Quality range error');
      sendError(res, 500, 'Failed to calculate quality scores');
    }
  }),
);

const alternativesLimiter = rateLimit({
  ...RATE_LIMIT_CONST.alternatives,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many alternatives requests, please try again later.' },
  store: createStore('alternatives'),
});

// GET /api/schedule/:itemId/alternatives — find alternative time slots
router.get(
  '/:itemId/alternatives',
  alternativesLimiter,
  asyncHandler(async (req, res) => {
    try {
      const userId = req.userId;
      const itemId = req.params.itemId as string;

      if (!UUID_REGEX.test(itemId)) {
        sendError(res, 400, 'Invalid itemId format');
        return;
      }

      // Look up the item across habits, tasks, meetings (scoped to user)
      const [habitRows, taskRows, meetingRows] = await Promise.all([
        db
          .select()
          .from(habits)
          .where(and(eq(habits.id, itemId), eq(habits.userId, userId))),
        db
          .select()
          .from(tasks)
          .where(and(eq(tasks.id, itemId), eq(tasks.userId, userId))),
        db
          .select()
          .from(smartMeetings)
          .where(and(eq(smartMeetings.id, itemId), eq(smartMeetings.userId, userId))),
      ]);

      const habit = habitRows[0] ?? null;
      const task = taskRows[0] ?? null;
      const meeting = meetingRows[0] ?? null;

      if (!habit && !task && !meeting) {
        sendNotFound(res, 'Item');
        return;
      }

      const [userSettings, allScheduled] = await Promise.all([
        getUserSettings(userId),
        db
          .select({
            start: scheduledEvents.start,
            end: scheduledEvents.end,
            itemId: scheduledEvents.itemId,
          })
          .from(scheduledEvents)
          .where(
            and(
              eq(scheduledEvents.userId, userId),
              gte(scheduledEvents.end, new Date().toISOString()),
            ),
          ),
      ]);

      const buf: BufferConfig = {
        breakBetweenItemsMinutes:
          userSettings.breakBetweenItemsMinutes ?? DEFAULT_BREAK_BETWEEN_MINUTES,
      };
      const occupiedSlots: TimeSlot[] = allScheduled
        .filter((r): r is typeof r & { start: string; end: string } => !!r.start && !!r.end)
        .map((r) => ({
          start: new Date(r.start),
          end: new Date(r.end),
        }));

      const existingPlacements = new Map<string, TimeSlot>();
      for (const ev of allScheduled) {
        if (ev.itemId && ev.start && ev.end) {
          existingPlacements.set(ev.itemId, {
            start: new Date(ev.start),
            end: new Date(ev.end),
          });
        }
      }

      const now = new Date();
      const windowEnd = new Date(now.getTime() + userSettings.schedulingWindowDays * MS_PER_DAY);

      const scheduleItem = buildScheduleItemFromEntity(
        habit ? toHabit(habit) : null,
        task ? toTask(task) : null,
        meeting ? toMeeting(meeting) : null,
        now,
        windowEnd,
      );

      const timeline = buildTimeline(now, windowEnd, userSettings);
      const tz = userSettings.timezone || DEFAULT_TIMEZONE;
      const candidates = generateCandidateSlots(
        scheduleItem,
        timeline,
        occupiedSlots,
        buf,
        existingPlacements,
        scheduleItem.dependsOn,
        tz,
      );

      const scored = candidates.map((slot) => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString(),
        score: scoreSlot(slot, scheduleItem, existingPlacements, buf, tz),
      }));

      scored.sort((a, b) => b.score - a.score);

      res.json({ alternatives: scored.slice(0, 5) });
    } catch (error: unknown) {
      log.error({ err: error }, 'Alternatives error');
      sendError(res, 500, 'Failed to compute alternatives');
    }
  }),
);

// POST /api/schedule/force-sync — clear sync tokens and force a full calendar resync
const forceSyncLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000, // 24 hours
  max: 10,
  message: { error: 'Sync limit reached (10/day). Try again tomorrow.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('force-sync'),
});

router.post(
  '/force-sync',
  forceSyncLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    // 1. Clear sync tokens for a full re-fetch
    await db.update(calendars).set({ syncToken: null }).where(eq(calendars.userId, userId));

    // 2. Wipe all cached external events
    await db.delete(calendarEvents).where(eq(calendarEvents.userId, userId));

    // 3. Re-fetch everything from Google — no timeout, wait for full completion
    const scheduler = schedulerRegistry.get(userId);
    if (scheduler) {
      const manager = scheduler.getPollerManager();
      if (manager) {
        // Reset in-memory caches so pollers do a true full sync
        // (DB sync tokens already cleared above, but pollers cache them in-memory)
        manager.resetAllPollerCaches();
        await manager.syncAllNowNoTimeout();
      }
    }

    // 4. Reschedule with fresh data
    triggerReschedule('Force sync', userId);

    res.json({ message: 'Full sync completed' });
  }),
);

// Register event action routes (move, lock, complete, external-move, delete-managed)
registerScheduleActions(router);

export default router;
