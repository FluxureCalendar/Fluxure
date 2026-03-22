import { eq, and } from 'drizzle-orm';
import { db } from '../db/pg-index.js';
import { habits, tasks, smartMeetings, focusTimeRules, scheduleChanges } from '../db/pg-schema.js';
import { calculateScheduleQuality } from '@fluxure/engine';
import type {
  BufferConfig,
  CalendarOperation,
  UserSettings,
  ScheduleItem,
  ScheduleChange,
  TimeSlot,
  QualityScore,
} from '@fluxure/shared';
import type { Habit, Task, SmartMeeting, FocusTimeRule, DayOfWeek } from '@fluxure/shared';
import {
  Priority,
  ItemType,
  CalendarOpType,
  ScheduleChangeType,
  startOfDayInTz,
  nextDayInTz,
  getDayOfWeekInTz,
  DEFAULT_BREAK_BETWEEN_MINUTES,
} from '@fluxure/shared';
import { toHabit, toTask, toMeeting, toFocusRule } from '../utils/converters.js';
import { getUserSettingsCached } from '../cache/user-settings.js';
const DAY_ABBREVS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * Check if a habit should be scheduled on a given day based on its frequency config.
 * Mirrors the filtering logic in engine's habitsToScheduleItems.
 */
export function shouldHabitScheduleOnDay(
  habit: import('@fluxure/shared').Habit,
  day: Date,
  tz: string,
): boolean {
  const dayAbbrev = DAY_ABBREVS[getDayOfWeekInTz(day, tz)];
  return habit.days.includes(dayAbbrev);
}

export { getUserSettingsCached as getUserSettings } from '../cache/user-settings.js';

/** Load all domain objects and buffer config for a user. */
export async function loadDomainObjectsForQuality(userId: string): Promise<{
  allHabits: Habit[];
  allTasks: Task[];
  allMeetings: SmartMeeting[];
  allFocusRules: FocusTimeRule[];
  buf: BufferConfig;
  userSettings: UserSettings;
}> {
  const [allHabitsRaw, allTasksRaw, allMeetingsRaw, allFocusRulesRaw, userSettings] =
    await Promise.all([
      db
        .select()
        .from(habits)
        .where(and(eq(habits.userId, userId), eq(habits.enabled, true))),
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.enabled, true), eq(tasks.status, 'open'))),
      db
        .select()
        .from(smartMeetings)
        .where(and(eq(smartMeetings.userId, userId), eq(smartMeetings.enabled, true))),
      db
        .select()
        .from(focusTimeRules)
        .where(and(eq(focusTimeRules.userId, userId), eq(focusTimeRules.enabled, true))),
      getUserSettingsCached(userId),
    ]);

  const allHabits = allHabitsRaw.map(toHabit);
  const allTasks = allTasksRaw.map(toTask);
  const allMeetings = allMeetingsRaw.map(toMeeting);
  const allFocusRules = allFocusRulesRaw.map(toFocusRule);
  const buf: BufferConfig = {
    breakBetweenItemsMinutes:
      userSettings.breakBetweenItemsMinutes ?? DEFAULT_BREAK_BETWEEN_MINUTES,
  };

  return { allHabits, allTasks, allMeetings, allFocusRules, buf, userSettings };
}

/** Build ScheduleItems for a given day from domain objects. */
export function buildScheduleItemsForDay(
  allHabits: ReturnType<typeof toHabit>[],
  allTasks: ReturnType<typeof toTask>[],
  allMeetings: ReturnType<typeof toMeeting>[],
  targetDate: Date,
  tz: string,
  userSettings: UserSettings,
): ScheduleItem[] {
  const dayStart = startOfDayInTz(targetDate, tz);
  const dayEnd = nextDayInTz(targetDate, tz);
  const scheduleItems: ScheduleItem[] = [];

  for (const h of allHabits) {
    if (!shouldHabitScheduleOnDay(h, targetDate, tz)) continue;
    scheduleItems.push({
      id: h.id,
      name: h.name,
      type: ItemType.Habit,
      priority: h.priority,
      timeWindow: { start: dayStart, end: dayEnd },
      idealTime: h.idealTime,
      duration: h.durationMax,
      durationMin: h.durationMin,
      skipBuffer: h.skipBuffer,
      forced: h.forced,
      dependsOn: h.dependsOn,
    });
  }

  for (const t of allTasks) {
    if (t.remainingDuration <= 0) continue;
    scheduleItems.push({
      id: t.id,
      name: t.name,
      type: ItemType.Task,
      priority: t.isUpNext ? Priority.Critical : t.priority,
      timeWindow: { start: dayStart, end: dayEnd },
      idealTime: userSettings.workingHours.start,
      duration: Math.min(t.remainingDuration, t.chunkMax),
      skipBuffer: t.skipBuffer,
      forced: false,
      dependsOn: null,
    });
  }

  for (const m of allMeetings) {
    scheduleItems.push({
      id: m.id,
      name: m.name,
      type: ItemType.Meeting,
      priority: m.priority,
      timeWindow: { start: dayStart, end: dayEnd },
      idealTime: m.idealTime ?? '09:00',
      duration: m.duration,
      skipBuffer: m.skipBuffer,
      forced: false,
      dependsOn: null,
    });
  }

  return scheduleItems;
}

/** Build placements map and focus minutes from scheduled event rows for a day. */
export function buildPlacementsFromRows(
  rows: Array<{
    start: string | null;
    end: string | null;
    itemId: string | null;
    itemType: string | null;
  }>,
): { placements: Map<string, TimeSlot>; focusMinutesPlaced: number } {
  const placements = new Map<string, TimeSlot>();
  let focusMinutesPlaced = 0;

  for (const row of rows) {
    if (!row.start || !row.end) continue;
    const slot: TimeSlot = { start: new Date(row.start), end: new Date(row.end) };
    const originalId = row.itemId?.split('__')[0] || row.itemId || '';
    placements.set(originalId, slot);

    if (row.itemType === ItemType.Focus) {
      focusMinutesPlaced += (slot.end.getTime() - slot.start.getTime()) / 60000;
    }
  }

  return { placements, focusMinutesPlaced };
}

/** Build a ScheduleItem from a raw habit/task/meeting DB row. */
export function buildScheduleItemFromEntity(
  habit: ReturnType<typeof toHabit> | null,
  task: ReturnType<typeof toTask> | null,
  meeting: ReturnType<typeof toMeeting> | null,
  now: Date,
  windowEnd: Date,
): ScheduleItem {
  if (habit) {
    return {
      id: habit.id,
      type: ItemType.Habit,
      priority: habit.priority,
      timeWindow: { start: now, end: windowEnd },
      idealTime: habit.idealTime,
      duration: habit.durationMax,
      durationMin: habit.durationMin,
      skipBuffer: habit.skipBuffer,
      forced: habit.forced,
      dependsOn: habit.dependsOn,
    };
  }
  if (task) {
    return {
      id: task.id,
      type: ItemType.Task,
      priority: task.priority,
      timeWindow: { start: now, end: task.dueDate ? new Date(task.dueDate) : windowEnd },
      idealTime: '10:00',
      duration: Math.min(task.remainingDuration, task.chunkMax),
      skipBuffer: task.skipBuffer,
      forced: false,
      dependsOn: null,
    };
  }
  if (!meeting) {
    throw new Error('buildScheduleItemFromEntity: meeting is null but no habit or task provided');
  }
  return {
    id: meeting.id,
    type: ItemType.Meeting,
    priority: meeting.priority,
    timeWindow: { start: now, end: windowEnd },
    idealTime: meeting.idealTime || '10:00',
    duration: meeting.duration,
    skipBuffer: meeting.skipBuffer,
    forced: false,
    dependsOn: null,
  };
}

/** Compute quality score for a single day. */
export function computeQualityForDay(
  scheduleItems: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  allFocusRules: ReturnType<typeof toFocusRule>[],
  buf: BufferConfig,
  focusMinutesPlaced: number,
  tz: string,
): QualityScore {
  return calculateScheduleQuality(
    scheduleItems,
    placements,
    allFocusRules,
    buf,
    focusMinutesPlaced,
    tz,
  );
}

/**
 * Record schedule changes from a reschedule run.
 * Compares operations against existing scheduled_events to determine what changed.
 */
export async function recordScheduleChanges(
  operations: CalendarOperation[],
  existingEventsMap: Map<
    string,
    { start: string; end: string; title: string; itemType: string; itemId: string }
  >,
  userId?: string,
): Promise<ScheduleChange[]> {
  if (operations.length === 0) return [];

  const batchId = crypto.randomUUID();
  const now = new Date().toISOString();
  const changes: ScheduleChange[] = [];

  for (const op of operations) {
    const itemName = op.title || op.itemId;

    if (op.type === CalendarOpType.Create) {
      changes.push({
        id: crypto.randomUUID(),
        operationType: ScheduleChangeType.Created,
        itemType: op.itemType,
        itemId: op.itemId,
        itemName,
        previousStart: null,
        previousEnd: null,
        newStart: op.start,
        newEnd: op.end,
        reason: null,
        batchId,
        createdAt: now,
      });
    } else if (op.type === CalendarOpType.Update && op.eventId) {
      const existing = existingEventsMap.get(op.eventId);
      if (!existing) continue;

      const prevStart = new Date(existing.start).getTime();
      const prevEnd = new Date(existing.end).getTime();
      const newStart = new Date(op.start).getTime();
      const newEnd = new Date(op.end).getTime();

      const startMoved = Math.abs(prevStart - newStart) >= 60000;
      const durationChanged = Math.abs(prevEnd - prevStart - (newEnd - newStart)) >= 60000;

      let opType: ScheduleChangeType;
      if (startMoved && durationChanged) {
        opType = ScheduleChangeType.Moved;
      } else if (durationChanged) {
        opType = ScheduleChangeType.Resized;
      } else if (startMoved) {
        opType = ScheduleChangeType.Moved;
      } else {
        continue;
      }

      changes.push({
        id: crypto.randomUUID(),
        operationType: opType,
        itemType: op.itemType,
        itemId: op.itemId,
        itemName,
        previousStart: existing.start,
        previousEnd: existing.end,
        newStart: op.start,
        newEnd: op.end,
        reason: null,
        batchId,
        createdAt: now,
      });
    } else if (op.type === CalendarOpType.Delete && op.eventId) {
      const existing = existingEventsMap.get(op.eventId);
      changes.push({
        id: crypto.randomUUID(),
        operationType: ScheduleChangeType.Deleted,
        itemType: (existing?.itemType || op.itemType) as ItemType,
        itemId: existing?.itemId || op.itemId,
        itemName: existing?.title || itemName,
        previousStart: existing?.start || null,
        previousEnd: existing?.end || null,
        newStart: null,
        newEnd: null,
        reason: null,
        batchId,
        createdAt: now,
      });
    }
  }

  if (!userId) return changes;
  if (changes.length > 0) {
    await db.insert(scheduleChanges).values(changes.map((c) => ({ ...c, userId })));
  }

  return changes;
}
