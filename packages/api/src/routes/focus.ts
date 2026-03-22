import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { focusTimeRules } from '../db/pg-schema.js';
import type { FocusTimeRule } from '@fluxure/shared';
import { getPlanLimits } from '@fluxure/shared';
import { updateFocusSchema } from '../validation.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError } from './helpers.js';
import { sendFeatureGated } from '../middleware/plan-gate.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

// GET /api/focus-time — get focus time rules for the current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const limits = getPlanLimits(req.userPlan);
    if (!limits.focusTimeEnabled) {
      sendFeatureGated(res, 'focus time');
      return;
    }

    const userId = req.userId;
    const rows = await db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId));

    if (rows.length === 0) {
      res.json({
        id: 'default',
        weeklyTargetMinutes: 600,
        dailyTargetMinutes: 120,
        schedulingHours: 'working',
        windowStart: null,
        windowEnd: null,
        enabled: false,
        createdAt: '',
        updatedAt: '',
      });
      return;
    }

    res.json(toFocusTimeRule(rows[0]));
  }),
);

// PUT /api/focus-time — update (upsert single row per user)
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const limits = getPlanLimits(req.userPlan);
    if (!limits.focusTimeEnabled) {
      sendFeatureGated(res, 'focus time');
      return;
    }

    const parsed = updateFocusSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const userId = req.userId;
    const body = parsed.data;

    await db
      .insert(focusTimeRules)
      .values({
        userId,
        weeklyTargetMinutes: body.weeklyTargetMinutes ?? 600,
        dailyTargetMinutes: body.dailyTargetMinutes ?? 120,
        schedulingHours: body.schedulingHours ?? 'working',
        windowStart: body.windowStart ?? null,
        windowEnd: body.windowEnd ?? null,
        enabled: body.enabled ?? false,
      })
      .onConflictDoUpdate({
        target: focusTimeRules.userId,
        set: {
          ...(body.weeklyTargetMinutes !== undefined
            ? { weeklyTargetMinutes: body.weeklyTargetMinutes }
            : {}),
          ...(body.dailyTargetMinutes !== undefined
            ? { dailyTargetMinutes: body.dailyTargetMinutes }
            : {}),
          ...(body.schedulingHours !== undefined ? { schedulingHours: body.schedulingHours } : {}),
          ...(body.windowStart !== undefined ? { windowStart: body.windowStart } : {}),
          ...(body.windowEnd !== undefined ? { windowEnd: body.windowEnd } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          updatedAt: new Date().toISOString(),
        },
      });

    const updated = await db.select().from(focusTimeRules).where(eq(focusTimeRules.userId, userId));
    broadcastToUser(req.userId, 'schedule_updated', 'Focus time updated');
    triggerReschedule('Focus time updated', req.userId);
    res.json(toFocusTimeRule(updated[0]));
  }),
);

function toFocusTimeRule(row: typeof focusTimeRules.$inferSelect): FocusTimeRule {
  return {
    id: row.id,
    weeklyTargetMinutes: row.weeklyTargetMinutes ?? 600,
    dailyTargetMinutes: row.dailyTargetMinutes ?? 120,
    schedulingHours: (row.schedulingHours ?? 'working') as FocusTimeRule['schedulingHours'],
    windowStart: row.windowStart ?? null,
    windowEnd: row.windowEnd ?? null,
    enabled: row.enabled ?? true,
    createdAt: row.createdAt ?? '',
    updatedAt: row.updatedAt ?? '',
  };
}

export default router;
