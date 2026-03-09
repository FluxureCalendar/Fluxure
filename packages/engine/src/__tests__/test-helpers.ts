import {
  Habit,
  Task,
  SmartMeeting,
  CalendarEvent,
  FocusTimeRule,
  BufferConfig,
  UserSettings,
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  EventStatus,
  CalendarOpType,
} from '@fluxure/shared';
import type { reschedule } from '../scheduler.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed timezone for test determinism; America/New_York observes DST. */
export const TEST_TZ = 'America/New_York';

/** Monday 2026-03-02 at 8:00 AM ET (13:00 UTC, ET is UTC-5 before DST). */
export const NOW = new Date('2026-03-02T13:00:00Z');

export const defaultSettings: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: TEST_TZ,
  schedulingWindowDays: 7,
};

export const allDaySettings: UserSettings = {
  ...defaultSettings,
  personalHours: { start: '00:00', end: '23:59' },
};

export const defaultBuffer: BufferConfig = { breakBetweenItemsMinutes: 0 };

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    name: 'Test Habit',
    priority: Priority.Medium,
    windowStart: '09:00',
    windowEnd: '17:00',
    idealTime: '09:00',
    durationMin: 30,
    durationMax: 60,
    days: ['mon', 'tue', 'wed', 'thu', 'fri'],
    schedulingHours: SchedulingHours.Working,
    forced: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    notifications: false,
    skipBuffer: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    name: 'Test Task',
    priority: Priority.High,
    totalDuration: 120,
    remainingDuration: 120,
    dueDate: '2026-03-09T17:00:00Z',
    earliestStart: '2026-03-02T09:00:00Z',
    chunkMin: 30,
    chunkMax: 60,
    schedulingHours: SchedulingHours.Working,
    status: TaskStatus.Open,
    isUpNext: false,
    enabled: true,
    skipBuffer: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeMeeting(overrides: Partial<SmartMeeting> = {}): SmartMeeting {
  return {
    id: 'meeting-1',
    name: 'Team Standup',
    priority: Priority.High,
    attendees: ['alice@example.com'],
    duration: 30,
    frequency: Frequency.Daily,
    idealTime: '09:30',
    windowStart: '09:00',
    windowEnd: '11:00',
    location: '',
    conferenceType: 'zoom',
    enabled: true,
    skipBuffer: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeCalendarEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'ext-1',
    googleEventId: 'g-1',
    title: 'External Event',
    start: '2026-03-02T10:00:00.000Z',
    end: '2026-03-02T11:00:00.000Z',
    isManaged: false,
    itemType: null,
    itemId: null,
    status: EventStatus.Busy,
    location: null,
    description: null,
    calendarId: null,
    lastModifiedByUs: null,
    googleUpdatedAt: null,
    ...overrides,
  };
}

export function makeFocusRule(overrides: Partial<FocusTimeRule> = {}): FocusTimeRule {
  return {
    id: 'focus-1',
    enabled: true,
    weeklyTargetMinutes: 300,
    dailyTargetMinutes: 60,
    schedulingHours: SchedulingHours.Working,
    windowStart: null,
    windowEnd: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract Create operations, optionally filtered by item ID prefix. */
export function getCreates(result: ReturnType<typeof reschedule>, idPrefix?: string) {
  const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);
  return idPrefix ? creates.filter((op) => op.itemId.startsWith(idPrefix)) : creates;
}

/** Compute duration in minutes from an operation. */
export function opDurationMin(op: { start: string; end: string }): number {
  return (new Date(op.end).getTime() - new Date(op.start).getTime()) / (1000 * 60);
}

/** Check whether two time ranges overlap. */
export function overlaps(
  aStart: string | Date,
  aEnd: string | Date,
  bStart: string | Date,
  bEnd: string | Date,
): boolean {
  return (
    new Date(aStart).getTime() < new Date(bEnd).getTime() &&
    new Date(bStart).getTime() < new Date(aEnd).getTime()
  );
}
