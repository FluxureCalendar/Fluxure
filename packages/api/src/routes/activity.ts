import { Router } from 'express';
import { desc, eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { activityLog } from '../db/pg-schema.js';
import type { ActivityLogEntry } from '@fluxure/shared';
import { activityQuerySchema } from '../validation.js';
import { sendValidationError } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { getPlanLimits } from '@fluxure/shared';
import { sendFeatureGated } from '../middleware/plan-gate.js';

const router = Router();

// GET /api/activity?limit=50&entityType=habit
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limits = getPlanLimits(req.userPlan);
    if (!limits.activityLogEnabled) {
      sendFeatureGated(res, 'activity log');
      return;
    }

    const parsed = activityQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }
    const { limit, entityType } = parsed.data;

    const userId = req.userId;

    let rows;
    if (entityType) {
      rows = await db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.userId, userId), eq(activityLog.entityType, entityType)))
        .orderBy(desc(activityLog.createdAt))
        .limit(limit);
    } else {
      rows = await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.userId, userId))
        .orderBy(desc(activityLog.createdAt))
        .limit(limit);
    }

    const result: ActivityLogEntry[] = rows.map((row) => ({
      id: row.id,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      details: (row.details as string | null) ?? null,
      createdAt: row.createdAt ?? '',
    }));

    res.json(result);
  }),
);

export default router;

export async function logActivity(
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await db.insert(activityLog).values({
    userId,
    action,
    entityType,
    entityId,
    details: details ?? null,
  });
}
