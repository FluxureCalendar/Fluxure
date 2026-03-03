import { Router } from 'express';
import { eq, and, count } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { smartMeetings, calendars } from '../db/pg-schema.js';
import type { CreateMeetingRequest, SmartMeeting } from '@fluxure/shared';
import { getPlanLimits } from '@fluxure/shared';
import { toMeeting } from '../utils/converters.js';
import { checkEntityLimit, sendPlanLimitError } from '../middleware/plan-gate.js';
import { createMeetingSchema, updateMeetingSchema, paginationSchema } from '../validation.js';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../logger.js';

const log = createLogger('meetings');

const router = Router();

// GET /api/meetings — list all meetings for the current user
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
        id: smartMeetings.id,
        name: smartMeetings.name,
        priority: smartMeetings.priority,
        attendees: smartMeetings.attendees,
        duration: smartMeetings.duration,
        frequency: smartMeetings.frequency,
        idealTime: smartMeetings.idealTime,
        windowStart: smartMeetings.windowStart,
        windowEnd: smartMeetings.windowEnd,
        location: smartMeetings.location,
        conferenceType: smartMeetings.conferenceType,
        skipBuffer: smartMeetings.skipBuffer,
        enabled: smartMeetings.enabled,
        calendarId: smartMeetings.calendarId,
        userId: smartMeetings.userId,
        color: smartMeetings.color,
        createdAt: smartMeetings.createdAt,
        updatedAt: smartMeetings.updatedAt,
      })
      .from(smartMeetings)
      .where(eq(smartMeetings.userId, req.userId))
      .limit(limit)
      .offset(offset);
    const result: SmartMeeting[] = rows.map(toMeeting);
    res.json(result);
  }),
);

// GET /api/meetings/:id — get a single meeting by ID
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const rows = await db
      .select()
      .from(smartMeetings)
      .where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Meeting');
      return;
    }
    res.json(toMeeting(rows[0]));
  }),
);

// POST /api/meetings — create a meeting
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const body = parsed.data as CreateMeetingRequest;

    const limits = getPlanLimits(req.userPlan);
    const [{ count: meetingCount }] = await db
      .select({ count: count() })
      .from(smartMeetings)
      .where(eq(smartMeetings.userId, req.userId));
    if (!checkEntityLimit(meetingCount, limits.maxMeetings)) {
      sendPlanLimitError(res, 'maxMeetings', meetingCount, limits.maxMeetings);
      return;
    }

    // Validate calendarId belongs to the authenticated user
    if (body.calendarId) {
      const [cal] = await db
        .select({ id: calendars.id })
        .from(calendars)
        .where(and(eq(calendars.id, body.calendarId), eq(calendars.userId, req.userId)));
      if (!cal) {
        sendError(res, 400, 'Invalid calendar ID');
        return;
      }
    }

    const row = {
      userId: req.userId,
      name: body.name,
      priority: body.priority ?? 2,
      attendees: body.attendees ?? [],
      duration: body.duration,
      frequency: body.frequency,
      idealTime: body.idealTime,
      windowStart: body.windowStart,
      windowEnd: body.windowEnd,
      location: body.location ?? '',
      conferenceType: body.conferenceType ?? 'none',
      skipBuffer: body.skipBuffer ?? false,
      calendarId: body.calendarId ?? null,
      color: body.color ?? null,
    };

    const inserted = await db.insert(smartMeetings).values(row).returning();
    const created = inserted[0];
    logActivity(req.userId, 'create', 'meeting', created.id, { name: body.name }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Meeting created');
    triggerReschedule('Meeting created', req.userId);
    res.status(201).json(toMeeting(created));
  }),
);

// PUT /api/meetings/:id — update a meeting
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const parsed = updateMeetingSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const body = parsed.data;

    // Validate calendarId belongs to the authenticated user
    if (body.calendarId) {
      const [cal] = await db
        .select({ id: calendars.id })
        .from(calendars)
        .where(and(eq(calendars.id, body.calendarId), eq(calendars.userId, req.userId)));
      if (!cal) {
        sendError(res, 400, 'Invalid calendar ID');
        return;
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (body.name !== undefined) updates.name = body.name;
    if (body.priority !== undefined) updates.priority = body.priority;
    if (body.attendees !== undefined) updates.attendees = body.attendees;
    if (body.duration !== undefined) updates.duration = body.duration;
    if (body.frequency !== undefined) updates.frequency = body.frequency;
    if (body.idealTime !== undefined) updates.idealTime = body.idealTime;
    if (body.windowStart !== undefined) updates.windowStart = body.windowStart;
    if (body.windowEnd !== undefined) updates.windowEnd = body.windowEnd;
    if (body.location !== undefined) updates.location = body.location;
    if (body.conferenceType !== undefined) updates.conferenceType = body.conferenceType;
    if (body.skipBuffer !== undefined) updates.skipBuffer = body.skipBuffer;
    if (body.calendarId !== undefined) updates.calendarId = body.calendarId;
    if (body.color !== undefined) updates.color = body.color;

    const updated = await db
      .update(smartMeetings)
      .set(updates)
      .where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId)))
      .returning();
    if (updated.length === 0) {
      sendNotFound(res, 'Meeting');
      return;
    }
    logActivity(req.userId, 'update', 'meeting', id, { fields: Object.keys(updates) }).catch(
      (err) => log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Meeting updated');
    triggerReschedule('Meeting updated', req.userId);
    res.json(toMeeting(updated[0]));
  }),
);

// DELETE /api/meetings/:id — delete a meeting
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(smartMeetings)
      .where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId)));

    if (existing.length === 0) {
      sendNotFound(res, 'Meeting');
      return;
    }

    // Delete the meeting but keep scheduled_events rows — the reschedule will
    // diff against them and generate Delete ops for Google Calendar cleanup.
    await db
      .delete(smartMeetings)
      .where(and(eq(smartMeetings.id, id), eq(smartMeetings.userId, req.userId)));
    logActivity(req.userId, 'delete', 'meeting', id, { name: existing[0].name }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Meeting deleted');
    triggerReschedule('Meeting deleted', req.userId);

    res.status(204).send();
  }),
);

export default router;
