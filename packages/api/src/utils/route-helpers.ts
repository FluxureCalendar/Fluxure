import { eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { calendars } from '../db/pg-schema.js';

/**
 * Pick only defined fields from a validated request body.
 * Returns a partial object suitable for Drizzle `.set()`.
 */
export function buildUpdates<T extends Record<string, unknown>>(
  body: T,
  allowedFields: readonly (keyof T)[],
): Partial<T> {
  const updates: Partial<T> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates[field] = body[field];
    }
  }
  return updates;
}

/**
 * Verify that a calendarId belongs to the given user.
 * Returns true if the calendar exists and belongs to the user.
 */
export async function validateCalendarOwnership(
  calendarId: string,
  userId: string,
): Promise<boolean> {
  const [cal] = await db
    .select({ id: calendars.id })
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId)));
  return !!cal;
}
