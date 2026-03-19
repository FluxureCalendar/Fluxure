import { Router } from 'express';
import { eq, and, asc } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { schedulingTemplates } from '../db/pg-schema.js';
import { getPlanLimits } from '@fluxure/shared';
import { checkEntityLimit, sendPlanLimitError } from '../middleware/plan-gate.js';
import { createSchedulingTemplateSchema } from '../validation.js';
import { sendValidationError, sendError, validateUUID } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

// GET /api/scheduling-templates — list all templates for the current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rows = await db
      .select()
      .from(schedulingTemplates)
      .where(eq(schedulingTemplates.userId, req.userId))
      .orderBy(asc(schedulingTemplates.createdAt));
    res.json({ templates: rows });
  }),
);

// POST /api/scheduling-templates — create a template
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createSchedulingTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const { name, startTime, endTime } = parsed.data;

    // Enforce max templates per user
    const existing = await db
      .select()
      .from(schedulingTemplates)
      .where(eq(schedulingTemplates.userId, req.userId));
    const limits = getPlanLimits(req.userPlan);
    if (!checkEntityLimit(existing.length, limits.maxTemplates)) {
      sendPlanLimitError(res, 'maxTemplates', existing.length, limits.maxTemplates);
      return;
    }

    let inserted;
    try {
      inserted = await db
        .insert(schedulingTemplates)
        .values({
          userId: req.userId,
          name,
          startTime,
          endTime,
        })
        .returning();
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as { code: unknown }).code === '23505') {
        sendError(res, 409, 'A template with that name already exists');
        return;
      }
      throw err;
    }

    res.status(201).json({ template: inserted[0] });
  }),
);

// DELETE /api/scheduling-templates/:id — delete a template
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    if (!validateUUID(id, res)) return;

    const deleted = await db
      .delete(schedulingTemplates)
      .where(and(eq(schedulingTemplates.id, id), eq(schedulingTemplates.userId, req.userId)))
      .returning();

    if (deleted.length === 0) {
      sendError(res, 404, 'Template not found');
      return;
    }

    res.status(204).end();
  }),
);

export default router;
