import { eq, and, notInArray, count, desc } from 'drizzle-orm';
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

/**
 * Freeze excess items when a user downgrades.
 * Keeps the oldest items (by createdAt) active, freezes the rest.
 */
export async function freezeExcessItems(userId: string, plan: string): Promise<void> {
  // Self-hosted users always have Pro limits — nothing to freeze
  if (isSelfHosted()) return;

  const limits = getPlanLimits(plan);

  await freezeTable(userId, habits, limits.maxHabits, 'habits');
  await freezeTable(userId, tasks, limits.maxTasks, 'tasks');
  await freezeTable(userId, smartMeetings, limits.maxMeetings, 'meetings');
  await freezeTable(userId, schedulingLinks, limits.maxSchedulingLinks, 'scheduling-links');
  await freezeCalendars(userId, limits.maxCalendars);

  // Disable focus time entirely for plans that don't include it
  if (!limits.focusTimeEnabled) {
    await db
      .update(focusTimeRules)
      .set({ enabled: false })
      .where(eq(focusTimeRules.userId, userId));
    log.info({ userId }, 'Disabled focus time (not included in plan)');
  }
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
    db
      .update(calendars)
      .set({ enabled: true })
      .where(and(eq(calendars.userId, userId), eq(calendars.enabled, false))),
    db
      .update(focusTimeRules)
      .set({ enabled: true })
      .where(and(eq(focusTimeRules.userId, userId), eq(focusTimeRules.enabled, false))),
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

  await db.transaction(async (tx) => {
    // First, enable all items so we start fresh
    await tx.update(table).set({ enabled: true }).where(eq(table.userId, userId));

    // Count total
    const [{ count: totalCount }] = await tx
      .select({ count: count() })
      .from(table)
      .where(eq(table.userId, userId));

    if (totalCount <= maxCount) return;

    // Get IDs of items to KEEP (oldest first, up to limit)
    const toKeep = await tx
      .select({ id: table.id })
      .from(table)
      .where(eq(table.userId, userId))
      .orderBy(table.createdAt)
      .limit(maxCount);

    const keepIds = toKeep.map((r) => r.id);

    // Freeze everything NOT in the keep list
    if (keepIds.length > 0) {
      await tx
        .update(table)
        .set({ enabled: false })
        .where(and(eq(table.userId, userId), notInArray(table.id, keepIds)));
    } else {
      await tx.update(table).set({ enabled: false }).where(eq(table.userId, userId));
    }

    log.info({ userId, label, frozen: totalCount - maxCount }, 'Froze excess items');
  });
}

/**
 * Freeze excess calendars when a user downgrades.
 * Keeps the primary calendar, then fills remaining slots with other enabled calendars.
 */
async function freezeCalendars(userId: string, maxCount: number): Promise<void> {
  if (isUnlimited(maxCount)) return;

  const [{ count: totalCount }] = await db
    .select({ count: count() })
    .from(calendars)
    .where(eq(calendars.userId, userId));

  if (totalCount <= maxCount) return;

  // Keep primary calendar first, then fill remaining slots
  const toKeep = await db
    .select({ id: calendars.id })
    .from(calendars)
    .where(eq(calendars.userId, userId))
    .orderBy(desc(calendars.isPrimary))
    .limit(maxCount);

  const keepIds = toKeep.map((r) => r.id);

  if (keepIds.length > 0) {
    await db
      .update(calendars)
      .set({ enabled: false })
      .where(and(eq(calendars.userId, userId), notInArray(calendars.id, keepIds)));
  } else {
    await db.update(calendars).set({ enabled: false }).where(eq(calendars.userId, userId));
  }

  log.info({ userId, frozen: totalCount - maxCount }, 'Froze excess calendars');
}
