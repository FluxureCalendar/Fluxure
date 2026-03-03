import { eq, and, notInArray, count } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { habits, tasks, smartMeetings, schedulingLinks } from '../db/pg-schema.js';
import { getPlanLimits, isUnlimited } from '@fluxure/shared';
import { createLogger } from '../logger.js';

const log = createLogger('freeze');

/**
 * Freeze excess items when a user downgrades.
 * Keeps the oldest items (by createdAt) active, freezes the rest.
 */
export async function freezeExcessItems(userId: string, plan: string): Promise<void> {
  const limits = getPlanLimits(plan);

  await freezeTable(userId, habits, limits.maxHabits, 'habits');
  await freezeTable(userId, tasks, limits.maxTasks, 'tasks');
  await freezeTable(userId, smartMeetings, limits.maxMeetings, 'meetings');
  await freezeTable(userId, schedulingLinks, limits.maxSchedulingLinks, 'scheduling-links');
}

/**
 * Unfreeze all items when a user upgrades.
 */
export async function unfreezeAllItems(userId: string): Promise<void> {
  await Promise.all([
    db
      .update(habits)
      .set({ enabled: true })
      .where(and(eq(habits.userId, userId), eq(habits.enabled, false))),
    db
      .update(tasks)
      .set({ enabled: true })
      .where(and(eq(tasks.userId, userId), eq(tasks.enabled, false))),
    db
      .update(smartMeetings)
      .set({ enabled: true })
      .where(and(eq(smartMeetings.userId, userId), eq(smartMeetings.enabled, false))),
    db
      .update(schedulingLinks)
      .set({ enabled: true })
      .where(and(eq(schedulingLinks.userId, userId), eq(schedulingLinks.enabled, false))),
  ]);
  log.info({ userId }, 'Unfroze all items');
}

async function freezeTable(
  userId: string,
  table: typeof habits | typeof tasks | typeof smartMeetings | typeof schedulingLinks,
  maxCount: number,
  label: string,
): Promise<void> {
  if (isUnlimited(maxCount)) return;

  // First, enable all items so we start fresh
  await db.update(table).set({ enabled: true }).where(eq(table.userId, userId));

  // Count total
  const [{ count: totalCount }] = await db
    .select({ count: count() })
    .from(table)
    .where(eq(table.userId, userId));

  if (totalCount <= maxCount) return;

  // Get IDs of items to KEEP (oldest first, up to limit)
  const toKeep = await db
    .select({ id: table.id })
    .from(table)
    .where(eq(table.userId, userId))
    .orderBy(table.createdAt)
    .limit(maxCount);

  const keepIds = toKeep.map((r) => r.id);

  // Freeze everything NOT in the keep list
  if (keepIds.length > 0) {
    await db
      .update(table)
      .set({ enabled: false })
      .where(and(eq(table.userId, userId), notInArray(table.id, keepIds)));
  } else {
    await db.update(table).set({ enabled: false }).where(eq(table.userId, userId));
  }

  log.info({ userId, label, frozen: totalCount - maxCount }, 'Froze excess items');
}
