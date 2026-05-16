import { and, eq, type SQL } from 'drizzle-orm';
import { habits, tasks, smartMeetings, schedulingLinks, calendars } from '../db/pg-schema.js';

type FrozenTable =
  | typeof habits
  | typeof tasks
  | typeof smartMeetings
  | typeof schedulingLinks
  | typeof calendars;

/** Predicate: the row is not frozen by plan enforcement. */
export function notFrozen(table: FrozenTable): SQL {
  return eq(table.frozen, false);
}

/** Predicate: row belongs to the user, is user-enabled, and is not plan-frozen. */
export function activeForScheduling(table: FrozenTable, userId: string): SQL {
  return and(eq(table.userId, userId), eq(table.enabled, true), notFrozen(table))!;
}
