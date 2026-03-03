import type { Habit, Task, SmartMeeting, FocusTimeRule, BufferConfig } from '@fluxure/shared';
import {
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  DecompressionTarget,
  DEFAULT_DECOMPRESSION_MINUTES,
  DEFAULT_TRAVEL_TIME_MINUTES,
  DEFAULT_BREAK_BETWEEN_MINUTES,
} from '@fluxure/shared';
import type {
  habits,
  tasks,
  smartMeetings,
  focusTimeRules,
  bufferConfig,
} from '../db/pg-schema.js';

type HabitRow = typeof habits.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type MeetingRow = typeof smartMeetings.$inferSelect;
type FocusRuleRow = typeof focusTimeRules.$inferSelect;
type BufferConfigRow = typeof bufferConfig.$inferSelect;

export function toHabit(row: HabitRow): Habit {
  return {
    ...row,
    priority: row.priority ?? Priority.Medium,
    frequency: (row.frequency ?? Frequency.Daily) as Frequency,
    frequencyConfig: (row.frequencyConfig || {}) as Habit['frequencyConfig'],
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    forced: !!row.forced,
    autoDecline: !!row.autoDecline,
    enabled: row.enabled !== false,
    skipBuffer: !!row.skipBuffer,
    notifications: !!row.notifications,
    durationMin: row.durationMin ?? 15,
    durationMax: row.durationMax ?? 60,
    // null→undefined coercion for optional fields (DB stores null, type expects undefined)
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
  } as Habit;
}

export function toTask(row: TaskRow): Task {
  return {
    ...row,
    priority: row.priority ?? Priority.High,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    status: (row.status || 'open') as TaskStatus,
    isUpNext: !!row.isUpNext,
    skipBuffer: !!row.skipBuffer,
    enabled: row.enabled !== false,
    totalDuration: row.totalDuration ?? 60,
    remainingDuration: row.remainingDuration ?? row.totalDuration ?? 60,
    chunkMin: row.chunkMin ?? 15,
    chunkMax: row.chunkMax ?? 120,
    dueDate: row.dueDate ?? null,
    earliestStart: row.earliestStart ?? null,
  } as Task;
}

export function toMeeting(row: MeetingRow): SmartMeeting {
  return {
    ...row,
    priority: row.priority ?? Priority.High,
    frequency: (row.frequency ?? Frequency.Weekly) as Frequency,
    attendees: (row.attendees || []) as SmartMeeting['attendees'],
    skipBuffer: !!row.skipBuffer,
    enabled: row.enabled !== false,
    duration: row.duration ?? 30,
    // null→empty string coercion for required string fields
    location: row.location ?? '',
    conferenceType: row.conferenceType ?? 'none',
  } as SmartMeeting;
}

export function toFocusRule(row: FocusRuleRow): FocusTimeRule {
  return {
    ...row,
    schedulingHours: (row.schedulingHours || 'working') as SchedulingHours,
    enabled: row.enabled !== false,
    // null→0 coercion for numeric fields
    weeklyTargetMinutes: row.weeklyTargetMinutes ?? 0,
    dailyTargetMinutes: row.dailyTargetMinutes ?? 0,
  } as FocusTimeRule;
}

export function toBufConfig(row: BufferConfigRow): BufferConfig {
  return {
    ...row,
    travelTimeMinutes: row.travelTimeMinutes ?? DEFAULT_TRAVEL_TIME_MINUTES,
    decompressionMinutes: row.decompressionMinutes ?? DEFAULT_DECOMPRESSION_MINUTES,
    breakBetweenItemsMinutes: row.breakBetweenItemsMinutes ?? DEFAULT_BREAK_BETWEEN_MINUTES,
    applyDecompressionTo: (row.applyDecompressionTo || 'all') as DecompressionTarget,
  } as BufferConfig;
}
