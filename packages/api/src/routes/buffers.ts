import { Router } from 'express';
import { eq } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { bufferConfig } from '../db/pg-schema.js';
import type { BufferConfig } from '@fluxure/shared';
import { updateBufferSchema } from '../validation.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { sendValidationError } from './helpers.js';
import { asyncHandler } from '../middleware/async-handler.js';

const router = Router();

// GET /api/buffers — get buffer config for the current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.userId;
    const rows = await db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId));

    if (rows.length === 0) {
      res.json({
        id: 'default',
        travelTimeMinutes: 15,
        decompressionMinutes: 10,
        breakBetweenItemsMinutes: 5,
        applyDecompressionTo: 'all',
      });
      return;
    }

    res.json(toBufferConfig(rows[0]));
  }),
);

// PUT /api/buffers — update (upsert single row per user)
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = updateBufferSchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(res, parsed.error);
      return;
    }

    const userId = req.userId;
    const body = parsed.data;

    await db
      .insert(bufferConfig)
      .values({
        userId,
        travelTimeMinutes: body.travelTimeMinutes ?? 15,
        decompressionMinutes: body.decompressionMinutes ?? 10,
        breakBetweenItemsMinutes: body.breakBetweenItemsMinutes ?? 5,
        applyDecompressionTo: body.applyDecompressionTo ?? 'all',
      })
      .onConflictDoUpdate({
        target: bufferConfig.userId,
        set: {
          ...(body.travelTimeMinutes !== undefined
            ? { travelTimeMinutes: body.travelTimeMinutes }
            : {}),
          ...(body.decompressionMinutes !== undefined
            ? { decompressionMinutes: body.decompressionMinutes }
            : {}),
          ...(body.breakBetweenItemsMinutes !== undefined
            ? { breakBetweenItemsMinutes: body.breakBetweenItemsMinutes }
            : {}),
          ...(body.applyDecompressionTo !== undefined
            ? { applyDecompressionTo: body.applyDecompressionTo }
            : {}),
        },
      });

    const updated = await db.select().from(bufferConfig).where(eq(bufferConfig.userId, userId));
    broadcastToUser(req.userId, 'schedule_updated', 'Buffer config updated');
    triggerReschedule('Buffer config updated', req.userId);
    res.json(toBufferConfig(updated[0]));
  }),
);

function toBufferConfig(row: typeof bufferConfig.$inferSelect): BufferConfig {
  return {
    id: row.id,
    travelTimeMinutes: row.travelTimeMinutes ?? 15,
    decompressionMinutes: row.decompressionMinutes ?? 10,
    breakBetweenItemsMinutes: row.breakBetweenItemsMinutes ?? 5,
    applyDecompressionTo: (row.applyDecompressionTo ??
      'all') as BufferConfig['applyDecompressionTo'],
  };
}

export default router;
