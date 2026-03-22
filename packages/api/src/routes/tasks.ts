import { Router } from 'express';
import { eq, and, asc, sql, count } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { tasks, subtasks } from '../db/pg-schema.js';
import type { CreateTaskRequest, Task, Subtask } from '@fluxure/shared';
import { getPlanLimits } from '@fluxure/shared';
import { toTask } from '../utils/converters.js';
import { checkEntityLimit, sendPlanLimitError } from '../middleware/plan-gate.js';
import {
  createTaskSchema,
  updateTaskSchema,
  updateSubtaskSchema,
  createSubtaskSchema,
  upNextBodySchema,
  paginationSchema,
} from '../validation.js';
import { logActivity } from './activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError, sendNotFound, sendError, validateUUID } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { createLogger } from '../logger.js';
import { buildUpdates, validateCalendarOwnership } from '../utils/route-helpers.js';

const log = createLogger('tasks');

const router = Router();

// GET /api/tasks — list all tasks for the current user
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
        id: tasks.id,
        name: tasks.name,
        priority: tasks.priority,
        totalDuration: tasks.totalDuration,
        remainingDuration: tasks.remainingDuration,
        dueDate: tasks.dueDate,
        earliestStart: tasks.earliestStart,
        chunkMin: tasks.chunkMin,
        chunkMax: tasks.chunkMax,
        schedulingHours: tasks.schedulingHours,
        status: tasks.status,
        isUpNext: tasks.isUpNext,
        skipBuffer: tasks.skipBuffer,
        enabled: tasks.enabled,
        userId: tasks.userId,
        calendarId: tasks.calendarId,
        color: tasks.color,
        createdAt: tasks.createdAt,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(eq(tasks.userId, req.userId))
      .limit(limit)
      .offset(offset);
    const result: Task[] = rows.map(toTask);
    res.json(result);
  }),
);

// POST /api/tasks — create a task
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const body = parsed.data as CreateTaskRequest;

    const limits = getPlanLimits(req.userPlan);
    const [{ count: taskCount }] = await db
      .select({ count: count() })
      .from(tasks)
      .where(eq(tasks.userId, req.userId));
    if (!checkEntityLimit(taskCount, limits.maxTasks)) {
      sendPlanLimitError(res, 'maxTasks', taskCount, limits.maxTasks);
      return;
    }

    if (body.calendarId) {
      if (!(await validateCalendarOwnership(body.calendarId, req.userId))) {
        sendError(res, 400, 'Invalid calendar ID');
        return;
      }
    }

    const now = new Date().toISOString();

    const row = {
      userId: req.userId,
      name: body.name,
      priority: body.priority ?? 2,
      totalDuration: body.totalDuration,
      remainingDuration: body.totalDuration,
      dueDate: body.dueDate,
      earliestStart: body.earliestStart ?? now,
      chunkMin: body.chunkMin ?? 15,
      chunkMax: body.chunkMax ?? 120,
      schedulingHours: body.schedulingHours ?? ('working' as const),
      status: 'open' as const,
      isUpNext: false,
      skipBuffer: body.skipBuffer ?? false,
      calendarId: body.calendarId ?? null,
      color: body.color ?? null,
    };

    const inserted = await db.insert(tasks).values(row).returning();
    const created = inserted[0];
    logActivity(req.userId, 'create', 'task', created.id, { name: body.name }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Task created');
    triggerReschedule('Task created', req.userId);
    res.status(201).json(toTask(created));
  }),
);

// PUT /api/tasks/:id — update a task
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const parsed = updateTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const body = parsed.data;

    // Cross-field validation: merge partial update with existing values
    const existingTask = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
    if (existingTask.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }
    const mergedChunkMin = body.chunkMin ?? existingTask[0].chunkMin;
    const mergedChunkMax = body.chunkMax ?? existingTask[0].chunkMax;
    if (
      mergedChunkMin !== undefined &&
      mergedChunkMin !== null &&
      mergedChunkMax !== undefined &&
      mergedChunkMax !== null &&
      mergedChunkMin > mergedChunkMax
    ) {
      sendError(res, 400, 'chunkMin must be <= chunkMax');
      return;
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
        'totalDuration',
        'remainingDuration',
        'dueDate',
        'earliestStart',
        'chunkMin',
        'chunkMax',
        'schedulingHours',
        'status',
        'isUpNext',
        'skipBuffer',
        'enabled',
        'calendarId',
        'color',
      ] as const),
      updatedAt: new Date().toISOString(),
    };

    const updated = await db
      .update(tasks)
      .set(updates)
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)))
      .returning();
    if (updated.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }
    logActivity(req.userId, 'update', 'task', id, { fields: Object.keys(updates) }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Task updated');
    triggerReschedule('Task updated', req.userId);
    res.json(toTask(updated[0]));
  }),
);

// DELETE /api/tasks/:id — delete task and scheduled events
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));

    if (existing.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }

    // Delete the task but keep scheduled_events rows — the reschedule will
    // diff against them and generate Delete ops for Google Calendar cleanup.
    await db.delete(tasks).where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
    logActivity(req.userId, 'delete', 'task', id, { name: existing[0].name }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(req.userId, 'schedule_updated', 'Task deleted');
    triggerReschedule('Task deleted', req.userId);

    res.status(204).send();
  }),
);

// POST /api/tasks/:id/complete — set status to 'completed'
router.post(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const updated = await db
      .update(tasks)
      .set({ status: 'completed', updatedAt: new Date().toISOString() })
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)))
      .returning();

    if (updated.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }

    broadcastToUser(req.userId, 'schedule_updated', 'Task completed');
    triggerReschedule('Task completed', req.userId);
    res.json(toTask(updated[0]));
  }),
);

// POST /api/tasks/:id/up-next — toggle isUpNext
router.post(
  '/:id/up-next',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const upNextParsed = upNextBodySchema.safeParse(req.body);
    if (!upNextParsed.success) {
      sendValidationError(res, upNextParsed.error);
      return;
    }

    const newIsUpNext = upNextParsed.data.isUpNext;

    const updated = await db
      .update(tasks)
      .set({ isUpNext: newIsUpNext, updatedAt: new Date().toISOString() })
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)))
      .returning();

    if (updated.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }

    broadcastToUser(req.userId, 'schedule_updated', 'Task priority changed');
    triggerReschedule('Task priority changed', req.userId);
    res.json(toTask(updated[0]));
  }),
);

// GET /api/tasks/:id/subtasks — list subtasks ordered by sortOrder
router.get(
  '/:id/subtasks',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
    if (existing.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }

    const rows = await db
      .select()
      .from(subtasks)
      .where(and(eq(subtasks.taskId, id), eq(subtasks.userId, req.userId)))
      .orderBy(asc(subtasks.sortOrder));

    const result: Subtask[] = rows.map(toSubtask);
    res.json(result);
  }),
);

// POST /api/tasks/:id/subtasks — create a subtask
router.post(
  '/:id/subtasks',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const existing = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
    if (existing.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }

    const subtaskParsed = createSubtaskSchema.safeParse(req.body);
    if (!subtaskParsed.success) {
      sendValidationError(res, subtaskParsed.error);
      return;
    }
    const { name } = subtaskParsed.data;

    // Drizzle doesn't support aggregate-only selects, so we fetch rows and reduce in JS
    const existingSubtasks = await db
      .select()
      .from(subtasks)
      .where(and(eq(subtasks.taskId, id), eq(subtasks.userId, req.userId)));
    const maxSort = existingSubtasks.reduce((max, s) => Math.max(max, s.sortOrder ?? 0), -1);

    const inserted = await db
      .insert(subtasks)
      .values({
        userId: req.userId,
        taskId: id,
        name: name.trim(),
        completed: false,
        sortOrder: maxSort + 1,
      })
      .returning();

    logActivity(req.userId, 'create', 'task', id, { subtask: name.trim() }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    res.status(201).json(toSubtask(inserted[0]));
  }),
);

// PUT /api/tasks/:id/subtasks/:subtaskId — update a subtask
router.put(
  '/:id/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    const { id, subtaskId } = req.params;
    if (!validateUUID(id, res)) return;
    if (!validateUUID(subtaskId, res)) return;
    const existing = await db
      .select()
      .from(subtasks)
      .where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId)));
    if (existing.length === 0 || existing[0].taskId !== id) {
      sendNotFound(res, 'Subtask');
      return;
    }

    const parsed = updateSubtaskSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const body = parsed.data;
    const updates: Record<string, unknown> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.completed !== undefined) updates.completed = body.completed;
    if (body.sortOrder !== undefined) updates.sortOrder = body.sortOrder;

    if (Object.keys(updates).length === 0) {
      sendError(res, 400, 'No fields to update');
      return;
    }

    const updated = await db
      .update(subtasks)
      .set(updates)
      .where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId)))
      .returning();
    res.json(toSubtask(updated[0]));
  }),
);

// DELETE /api/tasks/:id/subtasks/:subtaskId — delete a subtask
router.delete(
  '/:id/subtasks/:subtaskId',
  asyncHandler(async (req, res) => {
    const { id, subtaskId } = req.params;
    if (!validateUUID(id, res)) return;
    if (!validateUUID(subtaskId, res)) return;
    const existing = await db
      .select()
      .from(subtasks)
      .where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId)));
    if (existing.length === 0 || existing[0].taskId !== id) {
      sendNotFound(res, 'Subtask');
      return;
    }

    await db
      .delete(subtasks)
      .where(and(eq(subtasks.id, subtaskId), eq(subtasks.userId, req.userId)));
    res.status(204).send();
  }),
);

// GET /api/tasks/subtask-counts — { taskId: { done, total } } map in single call
router.get(
  '/subtask-counts',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select({
        taskId: subtasks.taskId,
        total: count(),
        done: sql<number>`count(*) filter (where ${subtasks.completed} = true)`,
      })
      .from(subtasks)
      .where(eq(subtasks.userId, req.userId))
      .groupBy(subtasks.taskId);

    const result: Record<string, { done: number; total: number }> = {};
    for (const row of rows) {
      result[row.taskId] = { done: Number(row.done), total: Number(row.total) };
    }
    res.json(result);
  }),
);

// GET /api/tasks/:id — get a single task by ID
// Placed after /subtask-counts to avoid parameterized route shadowing
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;
    const rows = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.id, id), eq(tasks.userId, req.userId)));
    if (rows.length === 0) {
      sendNotFound(res, 'Task');
      return;
    }
    res.json(toTask(rows[0]));
  }),
);

function toSubtask(row: typeof subtasks.$inferSelect): Subtask {
  return {
    id: row.id,
    taskId: row.taskId,
    name: row.name,
    completed: row.completed ?? false,
    sortOrder: row.sortOrder ?? 0,
    createdAt: row.createdAt ?? '',
  };
}

export default router;
