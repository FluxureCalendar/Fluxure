import { Router } from 'express';
import { eq, and, gte } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../db/pg-index.js';
import { habits, tasks, calendarEvents } from '../db/pg-schema.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createStore } from '../rate-limiters.js';

const router = Router();

const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: 'Too many search requests, please try again later' },
  store: createStore('search'),
});

// GET /api/search/index — returns all user items for client-side filtering
router.get(
  '/index',
  searchLimiter,
  asyncHandler(async (req, res) => {
    const userId = req.userId;

    // Events bounded to past 7 days + next 30 days
    const now = new Date();
    const pastBound = new Date(now);
    pastBound.setDate(pastBound.getDate() - 7);
    const pastBoundISO = pastBound.toISOString();

    const [habitRows, taskRows, eventRows] = await Promise.all([
      db
        .select({
          id: habits.id,
          name: habits.name,
          priority: habits.priority,
          color: habits.color,
          enabled: habits.enabled,
          days: habits.days,
        })
        .from(habits)
        .where(eq(habits.userId, userId)),
      db
        .select({
          id: tasks.id,
          name: tasks.name,
          priority: tasks.priority,
          color: tasks.color,
          status: tasks.status,
          dueDate: tasks.dueDate,
          enabled: tasks.enabled,
        })
        .from(tasks)
        .where(eq(tasks.userId, userId)),
      db
        .select({
          id: calendarEvents.id,
          title: calendarEvents.title,
          start: calendarEvents.start,
          end: calendarEvents.end,
          isAllDay: calendarEvents.isAllDay,
        })
        .from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), gte(calendarEvents.end, pastBoundISO))),
    ]);

    res.json({
      habits: habitRows,
      tasks: taskRows,
      meetings: [],
      events: eventRows,
    });
  }),
);

export default router;
