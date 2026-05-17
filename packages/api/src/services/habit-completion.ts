import { db } from '../db/pg-index.js';
import { habitCompletions } from '../db/pg-schema.js';
import { pgErrorCode, PG_UNIQUE_VIOLATION, PG_FK_VIOLATION } from '../db/pg-errors.js';
import { logActivity } from '../routes/activity.js';
import { broadcastToUser } from '../ws.js';
import { triggerReschedule } from '../polling-ref.js';
import { syncScheduledHabitEventCompleted } from './scheduled-event-completion.js';
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

    // Parity with manual completion: flip the scheduled event to Completed and
    // push the ✅ prefix to Google before rescheduling. Best-effort — a failure
    // here must not fail the job (BullMQ would retry into a duplicate-key loop).
    await syncScheduledHabitEventCompleted(userId, habitId, scheduledDate).catch((err) =>
      log.error({ err, userId, habitId, scheduledDate }, 'Scheduled-event completion sync failed'),
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
    // drizzle wraps driver errors in DrizzleQueryError — unwrap to the
    // SQLSTATE code so expected duplicate/FK cases stay non-fatal.
    const pgCode = pgErrorCode(err);
    // Duplicate completion — already done
    if (pgCode === PG_UNIQUE_VIOLATION) {
      log.debug({ userId, habitId, scheduledDate }, 'Habit already completed');
      return null;
    }
    // FK violation — habit was deleted between job registration and firing
    if (pgCode === PG_FK_VIOLATION) {
      log.warn({ userId, habitId, scheduledDate }, 'Habit no longer exists, skipping completion');
      return null;
    }
    throw err;
  }
}
