import { Router } from 'express';
import { eq, and, gte, lte } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { scheduledEvents, habits, habitCompletions } from '../db/pg-schema.js';
import type { AnalyticsData } from '@fluxure/shared';
import { MAX_ANALYTICS_RANGE_DAYS, DEFAULT_ANALYTICS_RANGE_MS, toDateStr } from '@fluxure/shared';
import { asyncHandler } from '../middleware/async-handler.js';
import { getUserTimezoneCached } from '../cache/user-settings.js';
import { cacheGet, cacheSet, cacheDel } from '../cache/redis.js';
import { getPlanLimits } from '@fluxure/shared';
import { sendFeatureGated } from '../middleware/plan-gate.js';

const ANALYTICS_CACHE_TTL_S = 300; // 5 minutes

// Strict ISO 8601 date or datetime pattern (YYYY-MM-DD or full ISO)
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;

function isValidIsoDate(value: string): boolean {
  return ISO_DATE_RE.test(value) && !isNaN(Date.parse(value));
}

const router = Router();

/**
 * Invalidate all analytics cache entries for a user.
 * NOTE: Uses a glob pattern which triggers a Redis SCAN. This is acceptable
 * given that analytics keys are invalidated infrequently (on schedule changes).
 * If analytics cache volume grows significantly, consider switching to a hash-key
 * pattern (e.g., HSET analytics:{userId} {from}:{to} ...) for O(1) DEL.
 */
export async function invalidateAnalyticsCache(userId: string): Promise<void> {
  await cacheDel(`analytics:${userId}:*`);
}

function getDateRange(
  req: import('express').Request,
): { fromDate: string; toDate: string } | { error: string } {
  const now = new Date();
  let toDate: string;
  let fromDate: string;

  if (typeof req.query.to === 'string') {
    if (!isValidIsoDate(req.query.to))
      return {
        error: 'Invalid "to" date format — use ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      };
    toDate = req.query.to;
  } else {
    toDate = now.toISOString();
  }

  if (typeof req.query.from === 'string') {
    if (!isValidIsoDate(req.query.from))
      return {
        error: 'Invalid "from" date format — use ISO 8601 (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SSZ)',
      };
    fromDate = req.query.from;
  } else {
    fromDate = new Date(now.getTime() - DEFAULT_ANALYTICS_RANGE_MS).toISOString();
  }

  const rangeMs = new Date(toDate).getTime() - new Date(fromDate).getTime();
  if (rangeMs < 0) return { error: '"from" must be before "to"' };
  if (rangeMs > MAX_ANALYTICS_RANGE_DAYS * 24 * 60 * 60 * 1000)
    return { error: `Date range must not exceed ${MAX_ANALYTICS_RANGE_DAYS} days` };

  return { fromDate, toDate };
}

// GET /api/analytics — compute analytics from scheduled_events
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    const limits = getPlanLimits(req.userPlan);
    if (!limits.analyticsEnabled) {
      sendFeatureGated(res, 'analytics');
      return;
    }

    const range = getDateRange(req);
    if ('error' in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const { fromDate, toDate } = range;

    // Check cache first
    const cacheKey = `analytics:${userId}:${fromDate}:${toDate}`;
    const cached = await cacheGet<AnalyticsData>(cacheKey);
    if (cached) {
      res.json(cached);
      return;
    }

    const [events, allHabits, tz, allCompletions] = await Promise.all([
      db
        .select()
        .from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.userId, userId),
            gte(scheduledEvents.end, fromDate),
            lte(scheduledEvents.start, toDate),
          ),
        ),
      db.select().from(habits).where(eq(habits.userId, userId)),
      getUserTimezoneCached(userId),
      // Fetch completions in parallel — avoids a serial await after computing enabledHabitsCount
      db
        .select()
        .from(habitCompletions)
        .where(
          and(
            eq(habitCompletions.userId, userId),
            gte(habitCompletions.scheduledDate, fromDate.substring(0, 10)),
            lte(habitCompletions.scheduledDate, toDate.substring(0, 10)),
          ),
        ),
    ]);

    let habitMinutes = 0;
    let taskMinutes = 0;
    let meetingMinutes = 0;
    let focusMinutes = 0;

    for (const event of events) {
      const minutes = computeMinutes(event.start, event.end);
      switch (event.itemType) {
        case 'habit':
          habitMinutes += minutes;
          break;
        case 'task':
          taskMinutes += minutes;
          break;
        case 'meeting':
          meetingMinutes += minutes;
          break;
        case 'focus':
          focusMinutes += minutes;
          break;
      }
    }

    // Habit completion rate: actual completions / enabled habits count
    const enabledHabitsCount = allHabits.filter((h) => h.enabled).length;
    const completionsInRange = enabledHabitsCount > 0 ? allCompletions : [];
    // Calculate the number of days in the range
    const rangeDays = Math.max(
      1,
      Math.ceil(
        (new Date(toDate).getTime() - new Date(fromDate).getTime()) / (24 * 60 * 60 * 1000),
      ),
    );
    const expectedCompletions = enabledHabitsCount * rangeDays;
    const habitCompletionRate =
      expectedCompletions > 0 ? completionsInRange.length / expectedCompletions : 0;

    // Build daily breakdown by type
    const dayMap = new Map<
      string,
      { habitMinutes: number; taskMinutes: number; meetingMinutes: number; focusMinutes: number }
    >();
    for (const event of events) {
      if (!event.start) continue;
      const date = toDateStr(new Date(event.start), tz);
      const minutes = computeMinutes(event.start, event.end);
      if (!dayMap.has(date)) {
        dayMap.set(date, { habitMinutes: 0, taskMinutes: 0, meetingMinutes: 0, focusMinutes: 0 });
      }
      const day = dayMap.get(date)!;
      switch (event.itemType) {
        case 'habit':
          day.habitMinutes += minutes;
          break;
        case 'task':
          day.taskMinutes += minutes;
          break;
        case 'meeting':
          day.meetingMinutes += minutes;
          break;
        case 'focus':
          day.focusMinutes += minutes;
          break;
      }
    }
    const weeklyBreakdown = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    const analytics: AnalyticsData = {
      habitMinutes,
      taskMinutes,
      meetingMinutes,
      focusMinutes,
      habitCompletionRate: Math.min(habitCompletionRate, 1),
      weeklyBreakdown,
    };

    await cacheSet(cacheKey, analytics, ANALYTICS_CACHE_TTL_S);
    res.json(analytics);
  }),
);

// GET /api/analytics/daily-breakdown — daily breakdown of scheduled time
router.get(
  '/daily-breakdown',
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    const limits = getPlanLimits(req.userPlan);
    if (!limits.analyticsEnabled) {
      sendFeatureGated(res, 'analytics');
      return;
    }

    const range = getDateRange(req);
    if ('error' in range) {
      res.status(400).json({ error: range.error });
      return;
    }
    const { fromDate, toDate } = range;
    const [events, tz] = await Promise.all([
      db
        .select()
        .from(scheduledEvents)
        .where(
          and(
            eq(scheduledEvents.userId, userId),
            gte(scheduledEvents.end, fromDate),
            lte(scheduledEvents.start, toDate),
          ),
        ),
      getUserTimezoneCached(userId),
    ]);

    // Group events by date (day) in the user's timezone
    const dayMap = new Map<
      string,
      { habitMinutes: number; taskMinutes: number; meetingMinutes: number; focusMinutes: number }
    >();

    for (const event of events) {
      if (!event.start) continue;
      const date = toDateStr(new Date(event.start), tz);
      const minutes = computeMinutes(event.start, event.end);

      if (!dayMap.has(date)) {
        dayMap.set(date, { habitMinutes: 0, taskMinutes: 0, meetingMinutes: 0, focusMinutes: 0 });
      }

      const day = dayMap.get(date)!;
      switch (event.itemType) {
        case 'habit':
          day.habitMinutes += minutes;
          break;
        case 'task':
          day.taskMinutes += minutes;
          break;
        case 'meeting':
          day.meetingMinutes += minutes;
          break;
        case 'focus':
          day.focusMinutes += minutes;
          break;
      }
    }

    // Sort by date and return
    const dailyBreakdown = Array.from(dayMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({ date, ...data }));

    res.json({ dailyBreakdown });
  }),
);

function computeMinutes(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const startDate = new Date(start);
  const endDate = new Date(end);
  const diffMs = endDate.getTime() - startDate.getTime();
  return Math.max(0, Math.round(diffMs / 60000));
}

export default router;
