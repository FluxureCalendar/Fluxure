import { eq, and, inArray, asc, desc } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import {
  habits,
  tasks,
  smartMeetings,
  schedulingLinks,
  calendars,
  focusTimeRules,
} from '../db/pg-schema.js';
import { getPlanLimits, isUnlimited } from '@fluxure/shared';
import { createLogger } from '../logger.js';
import { isSelfHosted } from '../config.js';

const log = createLogger('freeze');

type LimitedTable = typeof habits | typeof tasks | typeof smartMeetings | typeof schedulingLinks;

/**
 * Reconcile which of a user's items are active for the given plan.
 * The oldest items (by createdAt) up to the plan limit stay active; the rest
 * are frozen. The user's own enabled/paused state is never modified.
 */
export async function freezeExcessItems(userId: string, plan: string): Promise<void> {
  if (isSelfHosted()) return;

  const limits = getPlanLimits(plan);

  await reconcileTable(userId, habits, limits.maxHabits, asc(habits.createdAt), 'habits');
  await reconcileTable(userId, tasks, limits.maxTasks, asc(tasks.createdAt), 'tasks');
  await reconcileTable(
    userId,
    smartMeetings,
    limits.maxMeetings,
    asc(smartMeetings.createdAt),
    'meetings',
  );
  await reconcileTable(
    userId,
    schedulingLinks,
    limits.maxSchedulingLinks,
    asc(schedulingLinks.createdAt),
    'scheduling-links',
  );
  await reconcileCalendars(userId, limits.maxCalendars);

  if (!limits.focusTimeEnabled) {
    await db
      .update(focusTimeRules)
      .set({ enabled: false })
      .where(eq(focusTimeRules.userId, userId));
    log.info({ userId }, 'Disabled focus time (not included in plan)');
  }
}

/** Clear the frozen flag on every limited item for this user (used on upgrade). */
export async function unfreezeAllItems(userId: string): Promise<void> {
  await Promise.all([
    db.update(habits).set({ frozen: false }).where(eq(habits.userId, userId)),
    db.update(tasks).set({ frozen: false }).where(eq(tasks.userId, userId)),
    db.update(smartMeetings).set({ frozen: false }).where(eq(smartMeetings.userId, userId)),
    db.update(schedulingLinks).set({ frozen: false }).where(eq(schedulingLinks.userId, userId)),
    db.update(calendars).set({ frozen: false }).where(eq(calendars.userId, userId)),
    db
      .update(focusTimeRules)
      .set({ enabled: true })
      .where(and(eq(focusTimeRules.userId, userId), eq(focusTimeRules.enabled, false))),
  ]);
  log.info({ userId }, 'Cleared frozen state for all items');
}

async function reconcileTable(
  userId: string,
  table: LimitedTable,
  maxCount: number,
  order: ReturnType<typeof asc>,
  label: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.userId, userId))
      .orderBy(order);

    const ids = rows.map((r) => r.id);
    const keepIds = isUnlimited(maxCount) ? ids : ids.slice(0, maxCount);
    const freezeIds = isUnlimited(maxCount) ? [] : ids.slice(maxCount);

    if (keepIds.length > 0) {
      await tx
        .update(table)
        .set({ frozen: false })
        .where(and(eq(table.userId, userId), inArray(table.id, keepIds)));
    }
    if (freezeIds.length > 0) {
      await tx
        .update(table)
        .set({ frozen: true })
        .where(and(eq(table.userId, userId), inArray(table.id, freezeIds)));
      log.info({ userId, label, frozen: freezeIds.length }, 'Froze excess items');
    }
  });
}

/** Calendars keep the primary first, then oldest, up to the limit. */
async function reconcileCalendars(userId: string, maxCount: number): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: calendars.id })
      .from(calendars)
      .where(eq(calendars.userId, userId))
      .orderBy(desc(calendars.isPrimary), asc(calendars.createdAt));

    const ids = rows.map((r) => r.id);
    const keepIds = isUnlimited(maxCount) ? ids : ids.slice(0, maxCount);
    const freezeIds = isUnlimited(maxCount) ? [] : ids.slice(maxCount);

    if (keepIds.length > 0) {
      await tx
        .update(calendars)
        .set({ frozen: false })
        .where(and(eq(calendars.userId, userId), inArray(calendars.id, keepIds)));
    }
    if (freezeIds.length > 0) {
      await tx
        .update(calendars)
        .set({ frozen: true })
        .where(and(eq(calendars.userId, userId), inArray(calendars.id, freezeIds)));
      log.info({ userId, frozen: freezeIds.length }, 'Froze excess calendars');
    }
  });
}
