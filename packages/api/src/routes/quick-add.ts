import { Router } from 'express';
import { z } from 'zod/v4';
import { db } from '../db/pg-index.js';
import { habits, tasks, smartMeetings } from '../db/pg-schema.js';
import { parseQuickAdd, getPlanLimits } from '@fluxure/shared';
import type { ParsedHabit, ParsedTask, ParsedMeeting } from '@fluxure/shared';
import { checkEntityLimit, sendPlanLimitError } from '../middleware/plan-gate.js';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendError } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../logger.js';
import { eq, count } from 'drizzle-orm';

const log = createLogger('quick-add');

const router = Router();

const quickAddSchema = z.object({
  input: z.string().min(1).max(500),
});

async function createHabitFromParsed(userId: string, p: ParsedHabit) {
  const duration = p.duration ?? 30;
  const days = p.days ?? ['mon', 'tue', 'wed', 'thu', 'fri'];
  const idealTime = p.idealTime ?? '09:00';
  const row = {
    userId,
    name: p.name,
    priority: 3,
    windowStart: '07:00',
    windowEnd: '22:00',
    idealTime,
    durationMin: duration,
    durationMax: duration,
    days,
    schedulingHours: 'personal' as const,
    forced: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    skipBuffer: false,
    notifications: false,
    calendarId: null,
    color: null,
  };
  const inserted = await db.insert(habits).values(row).returning();
  const created = inserted[0];
  logActivity(userId, 'create', 'habit', created.id, {
    name: p.name,
    source: 'quick-add',
  }).catch((err) => log.error({ err }, 'Activity log error'));
  broadcastToUser(userId, 'schedule_updated', 'Habit created via quick-add');
  triggerReschedule('Habit created via quick-add', userId);
  return created;
}

async function createTaskFromParsed(userId: string, p: ParsedTask) {
  const now = new Date().toISOString();
  const totalDuration = p.totalDuration ?? 60;
  const dueDate = p.dueDate ?? null;
  const row = {
    userId,
    name: p.name,
    priority: 2,
    totalDuration,
    remainingDuration: totalDuration,
    dueDate,
    earliestStart: now,
    chunkMin: 15,
    chunkMax: 120,
    schedulingHours: 'working' as const,
    status: 'open' as const,
    isUpNext: false,
    skipBuffer: false,
    calendarId: null,
    color: null,
  };
  const inserted = await db.insert(tasks).values(row).returning();
  const created = inserted[0];
  logActivity(userId, 'create', 'task', created.id, {
    name: p.name,
    source: 'quick-add',
  }).catch((err) => log.error({ err }, 'Activity log error'));
  broadcastToUser(userId, 'schedule_updated', 'Task created via quick-add');
  triggerReschedule('Task created via quick-add', userId);
  return created;
}

async function createMeetingFromParsed(userId: string, p: ParsedMeeting) {
  const frequency = p.frequency ?? 'weekly';
  const duration = p.duration ?? 30;
  const idealTime = p.idealTime ?? '09:00';
  const row = {
    userId,
    name: p.name,
    priority: 2,
    attendees: [],
    duration,
    frequency,
    idealTime,
    windowStart: '09:00',
    windowEnd: '17:00',
    location: '',
    conferenceType: 'none',
    skipBuffer: false,
    calendarId: null,
    color: null,
  };
  const inserted = await db.insert(smartMeetings).values(row).returning();
  const created = inserted[0];
  logActivity(userId, 'create', 'meeting', created.id, {
    name: p.name,
    source: 'quick-add',
  }).catch((err) => log.error({ err }, 'Activity log error'));
  broadcastToUser(userId, 'schedule_updated', 'Meeting created via quick-add');
  triggerReschedule('Meeting created via quick-add', userId);
  return created;
}

// POST /api/quick-add — parse natural language input and create item
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = quickAddSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { input } = parsed.data;
    const result = parseQuickAdd(input);

    if (!result) {
      res.status(400).json({
        error:
          'Could not parse input. Try formats like "Gym MWF 7am 1h" or "Finish report by Friday 3h"',
        parsed: null,
      });
      return;
    }

    const userId = req.userId;
    const limits = getPlanLimits(req.userPlan);

    if (result.type === 'habit') {
      const p = result as ParsedHabit;
      if (p.days && p.days.length > 0 && p.duration) {
        const [{ count: entityCount }] = await db
          .select({ count: count() })
          .from(habits)
          .where(eq(habits.userId, userId));
        if (!checkEntityLimit(entityCount, limits.maxHabits)) {
          sendPlanLimitError(res, 'maxHabits', entityCount, limits.maxHabits);
          return;
        }
        const created = await createHabitFromParsed(userId, p);
        res.status(201).json({ created: true, type: 'habit', item: created, parsed: result });
        return;
      }
      res.json({ created: false, type: 'habit', parsed: result });
      return;
    }

    if (result.type === 'task') {
      const p = result as ParsedTask;
      if (p.totalDuration && p.dueDate) {
        const [{ count: entityCount }] = await db
          .select({ count: count() })
          .from(tasks)
          .where(eq(tasks.userId, userId));
        if (!checkEntityLimit(entityCount, limits.maxTasks)) {
          sendPlanLimitError(res, 'maxTasks', entityCount, limits.maxTasks);
          return;
        }
        const created = await createTaskFromParsed(userId, p);
        res.status(201).json({ created: true, type: 'task', item: created, parsed: result });
        return;
      }
      res.json({ created: false, type: 'task', parsed: result });
      return;
    }

    if (result.type === 'meeting') {
      const p = result as ParsedMeeting;
      if (p.duration && p.idealTime) {
        const [{ count: entityCount }] = await db
          .select({ count: count() })
          .from(smartMeetings)
          .where(eq(smartMeetings.userId, userId));
        if (!checkEntityLimit(entityCount, limits.maxMeetings)) {
          sendPlanLimitError(res, 'maxMeetings', entityCount, limits.maxMeetings);
          return;
        }
        const created = await createMeetingFromParsed(userId, p);
        res.status(201).json({ created: true, type: 'meeting', item: created, parsed: result });
        return;
      }
      res.json({ created: false, type: 'meeting', parsed: result });
      return;
    }

    sendError(res, 400, 'Unknown item type');
  }),
);

export default router;
