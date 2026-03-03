import { Router } from 'express';
import { ilike, and, eq } from 'drizzle-orm';
import rateLimit from 'express-rate-limit';
import { db } from '../db/pg-index.js';
import { habits, tasks, smartMeetings, calendarEvents } from '../db/pg-schema.js';
import { sendError } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createStore } from '../rate-limiters.js';

const router = Router();

const searchLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: 'Too many search requests, please try again later' },
  store: createStore('search'),
});

// GET /api/search?q=... — search across habits, tasks, meetings, and events
router.get(
  '/',
  searchLimiter,
  asyncHandler(async (req, res) => {
    const q = req.query.q;
    if (!q || typeof q !== 'string' || q.trim().length < 2) {
      res.json({ results: [] });
      return;
    }
    if (q.length > 100) {
      sendError(res, 400, 'Search query too long');
      return;
    }

    const escaped = q.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`);
    const pattern = `%${escaped}%`;
    const userId = req.userId;

    // Column projection: only fetch id + name/title needed for search results
    const [habitResults, taskResults, meetingResults, eventResults] = await Promise.all([
      db
        .select({ id: habits.id, name: habits.name })
        .from(habits)
        .where(and(eq(habits.userId, userId), ilike(habits.name, pattern)))
        .limit(50),
      db
        .select({ id: tasks.id, name: tasks.name })
        .from(tasks)
        .where(and(eq(tasks.userId, userId), ilike(tasks.name, pattern)))
        .limit(50),
      db
        .select({ id: smartMeetings.id, name: smartMeetings.name })
        .from(smartMeetings)
        .where(and(eq(smartMeetings.userId, userId), ilike(smartMeetings.name, pattern)))
        .limit(50),
      db
        .select({ id: calendarEvents.id, title: calendarEvents.title })
        .from(calendarEvents)
        .where(and(eq(calendarEvents.userId, userId), ilike(calendarEvents.title, pattern)))
        .limit(50),
    ]);

    res.json({
      results: [
        ...habitResults.map((h) => ({ type: 'habit', id: h.id, name: h.name, href: '/habits' })),
        ...taskResults.map((t) => ({ type: 'task', id: t.id, name: t.name, href: '/tasks' })),
        ...meetingResults.map((m) => ({
          type: 'meeting',
          id: m.id,
          name: m.name,
          href: '/meetings',
        })),
        ...eventResults.map((e) => ({ type: 'event', id: e.id, name: e.title, href: '/' })),
      ],
    });
  }),
);

export default router;
