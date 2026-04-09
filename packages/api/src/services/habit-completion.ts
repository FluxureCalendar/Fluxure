import { db } from '../db/pg-index.js';
import { habitCompletions } from '../db/pg-schema.js';
import { logActivity } from '../routes/activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { createLogger } from '../logger.js';
import type { HabitCompletion } from '@fluxure/shared';

const log = createLogger('habit-completion');

/**
 * Mark a habit as completed for a given scheduled date.
 * Shared between the API route handler and the auto-complete worker.
 *
 * Returns the completion record, or null if:
 * - Already completed (PG 23505 duplicate)
 * - Habit no longer exists (PG 23503 FK violation)
 */
export async function completeHabit(
  userId: string,
  habitId: string,
  scheduledDate: string,
): Promise<HabitCompletion | null> {
  const now = new Date().toISOString();

  try {
    const inserted = await db
      .insert(habitCompletions)
      .values({
        userId,
        habitId,
        scheduledDate,
        completedAt: now,
      })
      .returning();

    logActivity(userId, 'create', 'habit', habitId, { completion: scheduledDate }).catch((err) =>
      log.error({ err }, 'Activity log error'),
    );
    broadcastToUser(userId, 'schedule_updated', 'Habit completed');
    triggerReschedule('Habit completed', userId);

    return {
      id: inserted[0].id,
      habitId,
      scheduledDate,
      completedAt: now,
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err) {
      const pgCode = (err as Record<string, unknown>).code;
      // Duplicate completion — already done
      if (pgCode === '23505') {
        log.debug({ userId, habitId, scheduledDate }, 'Habit already completed');
        return null;
      }
      // FK violation — habit was deleted between job registration and firing
      if (pgCode === '23503') {
        log.warn({ userId, habitId, scheduledDate }, 'Habit no longer exists, skipping completion');
        return null;
      }
    }
    throw err;
  }
}
