import type {
  Habit,
  Task,
  SmartMeeting,
  FocusTimeRule,
  DayOfWeek,
  ConferenceType,
} from '@fluxure/shared';
import {
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  DEFAULT_CHUNK_MAX,
} from '@fluxure/shared';
import type { habits, tasks, smartMeetings, focusTimeRules } from '../db/pg-schema.js';

type HabitRow = typeof habits.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type MeetingRow = typeof smartMeetings.$inferSelect;
type FocusRuleRow = typeof focusTimeRules.$inferSelect;

const DEFAULT_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function toHabit(row: HabitRow): Habit {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority ?? Priority.Medium,
    windowStart: row.windowStart,
    windowEnd: row.windowEnd,
    idealTime: row.idealTime,
    durationMin: row.durationMin ?? 15,
    durationMax: row.durationMax ?? 60,
    days: (row.days || DEFAULT_DAYS) as DayOfWeek[],
    schedulingHours: (row.schedulingHours || SchedulingHours.Working) as SchedulingHours,
    forced: !!row.forced,
    autoDecline: !!row.autoDecline,
    dependsOn: row.dependsOn ?? null,
    enabled: row.enabled !== false,
    skipBuffer: !!row.skipBuffer,
    notifications: !!row.notifications,
    // null→undefined coercion for optional fields (DB stores null, type expects undefined)
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies Habit;
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority ?? Priority.High,
    totalDuration: row.totalDuration ?? 60,
    remainingDuration: row.remainingDuration ?? row.totalDuration ?? 60,
    dueDate: row.dueDate ?? null,
    earliestStart: row.earliestStart ?? null,
    chunkMin: row.chunkMin ?? 15,
    chunkMax: row.chunkMax ?? DEFAULT_CHUNK_MAX,
    schedulingHours: (row.schedulingHours || SchedulingHours.Working) as SchedulingHours,
    status: (row.status || TaskStatus.Open) as TaskStatus,
    isUpNext: !!row.isUpNext,
    skipBuffer: !!row.skipBuffer,
    enabled: row.enabled !== false,
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies Task;
}

export function toMeeting(row: MeetingRow): SmartMeeting {
  return {
    id: row.id,
    name: row.name,
    priority: row.priority ?? Priority.High,
    frequency: (row.frequency ?? Frequency.Weekly) as Frequency,
    attendees: (row.attendees || []) as string[],
    duration: row.duration ?? 30,
    idealTime: row.idealTime ?? null,
    windowStart: row.windowStart ?? null,
    windowEnd: row.windowEnd ?? null,
    location: row.location ?? '',
    conferenceType: (row.conferenceType ?? 'none') as ConferenceType,
    skipBuffer: !!row.skipBuffer,
    enabled: row.enabled !== false,
    calendarId: row.calendarId ?? undefined,
    color: row.color ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies SmartMeeting;
}

export function toFocusRule(row: FocusRuleRow): FocusTimeRule {
  return {
    id: row.id,
    weeklyTargetMinutes: row.weeklyTargetMinutes ?? 0,
    dailyTargetMinutes: row.dailyTargetMinutes ?? 0,
    schedulingHours: (row.schedulingHours || SchedulingHours.Working) as SchedulingHours,
    windowStart: row.windowStart ?? null,
    windowEnd: row.windowEnd ?? null,
    enabled: row.enabled !== false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } satisfies FocusTimeRule;
}
