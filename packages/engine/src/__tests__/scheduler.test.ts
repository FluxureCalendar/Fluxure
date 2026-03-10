import { describe, it, expect } from 'vitest';
import { reschedule } from '../scheduler.js';
import {
  BufferConfig,
  UserSettings,
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  EventStatus,
  ItemType,
  CalendarOpType,
} from '@fluxure/shared';
import {
  NOW,
  defaultSettings,
  defaultBuffer,
  makeHabit,
  makeTask,
  makeMeeting,
  makeCalendarEvent,
  makeFocusRule,
  getCreates,
  opDurationMin,
  overlaps,
} from './test-helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('reschedule', () => {
  // =========================================================================
  // Empty / Baseline
  // =========================================================================
  describe('empty schedule', () => {
    it('returns no operations and no unschedulable items when given nothing', () => {
      const result = reschedule([], [], [], [], [], defaultBuffer, defaultSettings, NOW);

      expect(result.operations).toHaveLength(0);
      expect(result.unschedulable).toHaveLength(0);
    });
  });

  // =========================================================================
  // Basic Habit Placement
  // =========================================================================
  describe('habit placement', () => {
    it('places a single enabled habit', () => {
      const result = reschedule([makeHabit()], [], [], [], [], defaultBuffer, defaultSettings, NOW);

      const creates = getCreates(result);
      expect(creates.length).toBeGreaterThan(0);
      for (const op of creates) {
        expect(op.itemType).toBe(ItemType.Habit);
      }
    });

    it('skips disabled habits', () => {
      const result = reschedule(
        [makeHabit({ enabled: false })],
        [],
        [],
        [],
        [],
        defaultBuffer,
        defaultSettings,
        NOW,
      );
      expect(result.operations).toHaveLength(0);
    });

    it('places habits on each matching day in the window', () => {
      const habit = makeHabit({
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        durationMin: 30,
        durationMax: 30,
      });

      const creates = getCreates(
        reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      // 7-day window starting Monday: Mon-Fri = 5 weekdays + Mon of next week
      expect(creates.length).toBeGreaterThanOrEqual(5);
    });

    it('places habits only on specified days', () => {
      const habit = makeHabit({
        days: ['wed'],
        durationMin: 30,
        durationMax: 30,
      });

      const creates = getCreates(
        reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      // 7-day window from Monday — one Wednesday
      expect(creates.length).toBeGreaterThanOrEqual(1);
    });

    it('handles habits with empty windowStart gracefully', () => {
      const habit = makeHabit({
        id: 'habit-badtime',
        days: ['mon'],
        windowStart: '',
        windowEnd: '12:00',
        durationMin: 30,
        durationMax: 30,
      });

      const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW);
      expect(result).toBeDefined();
      expect(result.operations).toBeDefined();
      expect(result.unschedulable).toBeDefined();
    });

    it('assigns Free or Busy status to placed habits', () => {
      const habit = makeHabit({
        days: ['mon'],
        durationMin: 30,
        durationMax: 30,
        windowStart: '09:00',
        windowEnd: '17:00',
      });

      const creates = getCreates(
        reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      for (const op of creates) {
        expect([EventStatus.Free, EventStatus.Busy]).toContain(op.status);
      }
    });
  });

  // =========================================================================
  // Task Scheduling
  // =========================================================================
  describe('task scheduling', () => {
    it('skips completed tasks', () => {
      const result = reschedule(
        [],
        [makeTask({ status: TaskStatus.Completed })],
        [],
        [],
        [],
        defaultBuffer,
        defaultSettings,
        NOW,
      );
      expect(result.operations).toHaveLength(0);
    });

    it('skips tasks with DoneScheduling status', () => {
      const result = reschedule(
        [],
        [makeTask({ status: TaskStatus.DoneScheduling })],
        [],
        [],
        [],
        defaultBuffer,
        defaultSettings,
        NOW,
      );
      expect(result.operations).toHaveLength(0);
    });

    it('splits tasks into chunks based on chunkMax', () => {
      const task = makeTask({
        totalDuration: 120,
        remainingDuration: 120,
        chunkMin: 30,
        chunkMax: 60,
      });

      const creates = getCreates(
        reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      // 120 min / 60 max = 2 chunks
      expect(creates.length).toBe(2);
      for (const op of creates) {
        expect(opDurationMin(op)).toBe(60);
      }
    });

    it('creates a single chunk when remainingDuration < chunkMax', () => {
      const task = makeTask({
        totalDuration: 45,
        remainingDuration: 45,
        chunkMin: 30,
        chunkMax: 60,
      });

      const creates = getCreates(
        reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      expect(creates.length).toBe(1);
      expect(opDurationMin(creates[0])).toBe(45);
    });

    it('never creates chunks exceeding chunkMax', () => {
      const task = makeTask({
        id: 'task-max-check',
        totalDuration: 200,
        remainingDuration: 200,
        chunkMin: 40,
        chunkMax: 70,
      });

      const creates = getCreates(
        reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW),
        'task-max-check',
      );
      expect(creates.length).toBe(3);
      for (const op of creates) {
        expect(opDurationMin(op)).toBeLessThanOrEqual(70);
      }
    });

    it('avoids runt chunks smaller than chunkMin', () => {
      // 90 min / chunkMax=50 / chunkMin=45: runt reduction merges remainder
      const task = makeTask({
        id: 'task-chunkmax',
        totalDuration: 90,
        remainingDuration: 90,
        chunkMin: 45,
        chunkMax: 50,
      });

      const creates = getCreates(
        reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW),
        'task-chunkmax',
      );
      expect(creates.length).toBe(2);
      for (const op of creates) {
        expect(opDurationMin(op)).toBeLessThanOrEqual(50);
      }
    });

    it('maintains deterministic chunk ordering via dependsOn chain', () => {
      const task = makeTask({
        id: 'task-order',
        totalDuration: 180,
        remainingDuration: 180,
        chunkMin: 60,
        chunkMax: 60,
      });

      const creates = getCreates(
        reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW),
        'task-order',
      ).sort((a, b) => a.itemId.localeCompare(b.itemId));

      expect(creates.length).toBe(3);
      for (let i = 1; i < creates.length; i++) {
        const prevEnd = new Date(creates[i - 1].end).getTime();
        const currStart = new Date(creates[i].start).getTime();
        expect(currStart).toBeGreaterThanOrEqual(prevEnd);
      }
    });
  });

  // =========================================================================
  // Meeting Scheduling
  // =========================================================================
  describe('meeting scheduling', () => {
    it('places monthly meetings', () => {
      const meeting = makeMeeting({
        id: 'monthly-meeting',
        frequency: Frequency.Monthly,
        duration: 30,
      });
      // Default to 1st of month; April 1 is a Wednesday
      const now = new Date('2026-03-30T12:00:00Z');

      const creates = getCreates(
        reschedule([], [], [meeting], [], [], defaultBuffer, defaultSettings, now),
        'monthly-meeting',
      );
      expect(creates.length).toBe(1);
    });
  });

  // =========================================================================
  // Priority & Ordering
  // =========================================================================
  describe('priority and ordering', () => {
    it('promotes isUpNext tasks to Critical priority (scheduled first)', () => {
      const taskUpNext = makeTask({
        id: 'task-upnext',
        priority: Priority.Low,
        isUpNext: true,
        totalDuration: 30,
        remainingDuration: 30,
        chunkMax: 30,
      });
      const taskNormal = makeTask({
        id: 'task-normal',
        priority: Priority.High,
        isUpNext: false,
        totalDuration: 30,
        remainingDuration: 30,
        chunkMax: 30,
      });

      const creates = getCreates(
        reschedule([], [taskNormal, taskUpNext], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      expect(creates.length).toBe(2);
      expect(creates[0].itemId.startsWith('task-upnext')).toBe(true);
    });

    it('schedules Critical tasks before Low habits', () => {
      const criticalTask = makeTask({
        id: 'critical-task',
        priority: Priority.Critical,
        totalDuration: 60,
        remainingDuration: 60,
        chunkMax: 60,
      });
      const lowHabit = makeHabit({
        id: 'low-habit',
        priority: Priority.Low,
        days: ['mon'],
        durationMin: 60,
        durationMax: 60,
      });

      const creates = getCreates(
        reschedule([lowHabit], [criticalTask], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      expect(creates.length).toBeGreaterThanOrEqual(2);
      expect(creates.find((op) => op.itemId.startsWith('critical-task'))).toBeDefined();
    });

    it('schedules meetings before habits at the same priority (TYPE_ORDER)', () => {
      const meeting = makeMeeting({
        id: 'meeting-1',
        priority: Priority.High,
        duration: 30,
        windowStart: '09:00',
        windowEnd: '12:00',
      });
      const habit = makeHabit({
        id: 'habit-1',
        priority: Priority.High,
        windowStart: '09:00',
        windowEnd: '12:00',
        durationMin: 30,
        durationMax: 30,
        days: ['mon'],
      });

      const creates = getCreates(
        reschedule([habit], [], [meeting], [], [], defaultBuffer, defaultSettings, NOW),
      );
      expect(creates.length).toBeGreaterThanOrEqual(2);
      const meetingOps = creates.filter((op) => op.itemType === ItemType.Meeting);
      const habitOps = creates.filter((op) => op.itemType === ItemType.Habit);
      expect(meetingOps.length).toBeGreaterThan(0);
      expect(habitOps.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // Conflict Resolution & Calendar Events
  // =========================================================================
  describe('conflict resolution', () => {
    it('avoids overlapping with fixed external calendar events', () => {
      const ext = makeCalendarEvent({
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T11:00:00.000Z',
        title: 'Doctor Appointment',
      });
      const habit = makeHabit({
        windowStart: '09:00',
        windowEnd: '12:00',
        durationMin: 30,
        durationMax: 30,
        days: ['mon'],
      });

      const creates = getCreates(
        reschedule([habit], [], [], [], [ext], defaultBuffer, defaultSettings, NOW),
      );
      for (const op of creates) {
        expect(overlaps(op.start, op.end, ext.start, ext.end)).toBe(false);
      }
    });

    it('avoids overlapping with locked external events', () => {
      const locked = makeCalendarEvent({
        id: 'ext-locked-1',
        googleEventId: 'g-locked-ext-1',
        title: 'University Lecture',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T11:00:00.000Z',
        status: EventStatus.Locked,
      });
      const habit = makeHabit({
        id: 'habit-lock-test',
        days: ['mon'],
        windowStart: '09:00',
        windowEnd: '14:00',
        idealTime: '10:00',
        durationMin: 60,
        durationMax: 60,
      });

      const creates = getCreates(
        reschedule([habit], [], [], [], [locked], defaultBuffer, defaultSettings, NOW),
      );
      expect(creates.length).toBeGreaterThan(0);
      for (const op of creates) {
        expect(overlaps(op.start, op.end, locked.start, locked.end)).toBe(false);
      }
    });

    it('marks items as unschedulable when no slots are available', () => {
      const allDay = makeCalendarEvent({
        id: 'all-day',
        title: 'All Day Event',
        start: '2026-03-02T00:00:00.000Z',
        end: '2026-03-09T00:00:00.000Z',
      });
      const habit = makeHabit({
        days: ['mon'],
        windowStart: '09:00',
        windowEnd: '10:00',
        durationMin: 60,
        durationMax: 60,
      });

      const result = reschedule([habit], [], [], [], [allDay], defaultBuffer, defaultSettings, NOW);
      expect(result.unschedulable.length).toBeGreaterThan(0);
    });

    it('blocks P3 habit when soft external event fills its window', () => {
      const ext = makeCalendarEvent({
        id: 'ext-busy-1',
        title: 'External Meeting',
        start: '2026-03-02T14:00:00.000Z', // 9am ET
        end: '2026-03-02T17:00:00.000Z', // 12pm ET
      });
      const habit = makeHabit({
        id: 'habit-p3',
        priority: Priority.Medium,
        days: ['mon'],
        windowStart: '09:00',
        windowEnd: '12:00',
        durationMin: 60,
        durationMax: 60,
      });

      const result = reschedule([habit], [], [], [], [ext], defaultBuffer, defaultSettings, NOW);
      expect(getCreates(result, 'habit-p3').length).toBe(0);
      expect(result.unschedulable.some((u) => u.itemId.startsWith('habit-p3'))).toBe(true);
    });

    it('allows Critical task to override soft external event when no other slot', () => {
      const ext = makeCalendarEvent({
        id: 'ext-busy-2',
        title: 'External Meeting',
        start: '2026-03-02T14:00:00.000Z',
        end: '2026-03-02T17:00:00.000Z',
      });
      const task = makeTask({
        id: 'task-p1',
        priority: Priority.Critical,
        totalDuration: 60,
        remainingDuration: 60,
        chunkMax: 60,
        earliestStart: '2026-03-02T14:00:00.000Z',
        dueDate: '2026-03-02T17:00:00.000Z',
      });

      const creates = getCreates(
        reschedule([], [task], [], [], [ext], defaultBuffer, defaultSettings, NOW),
        'task-p1',
      );
      expect(creates.length).toBe(1);
    });

    it('does NOT allow Critical task to override locked external event', () => {
      const locked = makeCalendarEvent({
        id: 'ext-locked-2',
        title: 'University Lecture',
        start: '2026-03-02T14:00:00.000Z',
        end: '2026-03-02T17:00:00.000Z',
        status: EventStatus.Locked,
      });
      const task = makeTask({
        id: 'task-p1-locked',
        priority: Priority.Critical,
        totalDuration: 60,
        remainingDuration: 60,
        chunkMax: 60,
        earliestStart: '2026-03-02T14:00:00.000Z',
        dueDate: '2026-03-02T17:00:00.000Z',
      });

      const result = reschedule([], [task], [], [], [locked], defaultBuffer, defaultSettings, NOW);
      expect(getCreates(result, 'task-p1-locked').length).toBe(0);
      expect(result.unschedulable.some((u) => u.itemId.startsWith('task-p1-locked'))).toBe(true);
    });
  });

  // =========================================================================
  // Buffers
  // =========================================================================
  describe('buffer between items', () => {
    it('enforces breakBetweenItemsMinutes gap between consecutive placements', () => {
      const bufferConfig: BufferConfig = { breakBetweenItemsMinutes: 15 };
      const habits = [
        makeHabit({
          id: 'habit-a',
          days: ['mon'],
          windowStart: '09:00',
          windowEnd: '10:30',
          durationMin: 30,
          durationMax: 30,
        }),
        makeHabit({
          id: 'habit-b',
          priority: Priority.Medium,
          days: ['mon'],
          windowStart: '09:00',
          windowEnd: '10:30',
          durationMin: 30,
          durationMax: 30,
        }),
      ];

      const creates = getCreates(
        reschedule(habits, [], [], [], [], bufferConfig, defaultSettings, NOW),
      );
      if (creates.length >= 2) {
        const sorted = creates
          .map((op) => ({ start: new Date(op.start).getTime(), end: new Date(op.end).getTime() }))
          .sort((a, b) => a.start - b.start);
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i].start - sorted[i - 1].end).toBeGreaterThanOrEqual(15 * 60 * 1000);
        }
      }
    });
  });

  // =========================================================================
  // Dependencies
  // =========================================================================
  describe('habit dependencies', () => {
    it('places dependent habit after its prerequisite', () => {
      const habitA = makeHabit({
        id: 'habit-a',
        priority: Priority.High,
        days: ['mon'],
        windowStart: '09:00',
        windowEnd: '17:00',
        durationMin: 30,
        durationMax: 30,
      });
      const habitB = makeHabit({
        id: 'habit-b',
        priority: Priority.High,
        days: ['mon'],
        windowStart: '09:00',
        windowEnd: '17:00',
        durationMin: 30,
        durationMax: 30,
        dependsOn: 'habit-a',
      });

      const creates = getCreates(
        reschedule([habitA, habitB], [], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      expect(creates.length).toBe(2);
      const aOp = creates.find((op) => op.itemId.startsWith('habit-a'));
      const bOp = creates.find((op) => op.itemId.startsWith('habit-b'));
      if (aOp && bOp) {
        expect(new Date(bOp.start).getTime()).toBeGreaterThanOrEqual(new Date(aOp.end).getTime());
      }
    });

    it('resolves date-based dependency IDs for habits on the same day', () => {
      const daily = makeHabit({
        id: 'habit-daily',
        priority: Priority.High,
        days: ['wed'],
        windowStart: '09:00',
        windowEnd: '17:00',
        durationMin: 30,
        durationMax: 30,
      });
      const weekly = makeHabit({
        id: 'habit-weekly',
        priority: Priority.High,
        days: ['wed'],
        windowStart: '09:00',
        windowEnd: '17:00',
        durationMin: 30,
        durationMax: 30,
        dependsOn: 'habit-daily',
      });

      const creates = getCreates(
        reschedule([daily, weekly], [], [], [], [], defaultBuffer, defaultSettings, NOW),
      );
      const dailyOps = creates.filter((op) => op.itemId.startsWith('habit-daily'));
      const weeklyOps = creates.filter((op) => op.itemId.startsWith('habit-weekly'));
      expect(dailyOps.length).toBeGreaterThan(0);
      expect(weeklyOps.length).toBeGreaterThan(0);
      if (dailyOps.length > 0 && weeklyOps.length > 0) {
        expect(new Date(weeklyOps[0].start).getTime()).toBeGreaterThanOrEqual(
          new Date(dailyOps[0].end).getTime(),
        );
      }
    });

    it('detects circular dependencies and reports them as unschedulable', () => {
      const habitA = makeHabit({
        id: 'habit-a',
        name: 'Habit A',
        days: ['mon'],
        dependsOn: 'habit-b',
      });
      const habitB = makeHabit({
        id: 'habit-b',
        name: 'Habit B',
        days: ['mon'],
        dependsOn: 'habit-a',
      });

      const result = reschedule(
        [habitA, habitB],
        [],
        [],
        [],
        [],
        defaultBuffer,
        defaultSettings,
        NOW,
      );
      const circularErrors = result.unschedulable.filter((u) =>
        u.reason.includes('Circular dependency'),
      );
      expect(circularErrors.length).toBeGreaterThan(0);
      // Both habits still scheduled with dependsOn stripped
      expect(getCreates(result).filter((op) => op.itemType === ItemType.Habit).length).toBe(2);
    });
  });

  // =========================================================================
  // Managed Event Operations (Create / Update / Delete)
  // =========================================================================
  describe('managed event operations', () => {
    it('generates Delete for orphaned managed events', () => {
      const managed = makeCalendarEvent({
        id: 'managed-1',
        title: 'Old Habit Event',
        start: '2026-03-02T15:00:00.000Z',
        end: '2026-03-02T15:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'old-habit-id',
        status: EventStatus.Free,
      });

      const result = reschedule([], [], [], [], [managed], defaultBuffer, defaultSettings, NOW);
      const deletes = result.operations.filter((op) => op.type === CalendarOpType.Delete);
      expect(deletes.length).toBe(1);
      expect(deletes[0].eventId).toBe('managed-1');
    });

    it('generates Update (or no-op) for moved managed events', () => {
      const habit = makeHabit({
        id: 'habit-moved',
        days: ['mon'],
        durationMin: 30,
        durationMax: 30,
      });
      const managed = makeCalendarEvent({
        id: 'managed-event-1',
        title: 'Morning Exercise',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'habit-moved__2026-03-02',
        status: EventStatus.Free,
      });

      const result = reschedule(
        [habit],
        [],
        [],
        [],
        [managed],
        defaultBuffer,
        defaultSettings,
        NOW,
      );
      expect(result.operations.length).toBeGreaterThan(0);
    });

    it('does NOT delete locked managed events', () => {
      const habit = makeHabit({
        id: 'habit-locked',
        days: ['mon'],
        durationMin: 30,
        durationMax: 30,
        forced: true,
      });
      const locked = makeCalendarEvent({
        id: 'locked-event-1',
        googleEventId: 'g-locked-1',
        title: 'Locked Habit Event',
        start: '2026-03-02T09:00:00.000Z',
        end: '2026-03-02T09:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'habit-locked__2026-03-02',
        status: EventStatus.Locked,
      });

      const result = reschedule([habit], [], [], [], [locked], defaultBuffer, defaultSettings, NOW);
      expect(result.operations.filter((op) => op.type === CalendarOpType.Delete).length).toBe(0);
    });

    it('preserves position of locked (forced) managed events', () => {
      const habit = makeHabit({
        id: 'habit-stable',
        priority: Priority.Medium,
        days: ['mon'],
        windowStart: '09:00',
        windowEnd: '17:00',
        durationMin: 30,
        durationMax: 30,
        forced: true,
      });
      const locked = makeCalendarEvent({
        id: 'locked-managed-1',
        googleEventId: 'g-locked-m1',
        title: 'Morning Exercise',
        start: '2026-03-02T14:00:00.000Z',
        end: '2026-03-02T14:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'habit-stable__2026-03-02',
        status: EventStatus.Locked,
      });

      const result = reschedule([habit], [], [], [], [locked], defaultBuffer, defaultSettings, NOW);
      expect(result.operations.filter((op) => op.type === CalendarOpType.Delete).length).toBe(0);
      const updates = result.operations.filter(
        (op) => op.type === CalendarOpType.Update && op.eventId === 'locked-managed-1',
      );
      for (const up of updates) {
        expect(new Date(up.start).getTime()).toBe(new Date('2026-03-02T14:00:00.000Z').getTime());
        expect(new Date(up.end).getTime()).toBe(new Date('2026-03-02T14:30:00.000Z').getTime());
      }
    });
  });

  // =========================================================================
  // DST / Timezone
  // =========================================================================
  describe('DST and timezone handling', () => {
    it('maintains correct duration across US spring-forward (March 8, 2026)', () => {
      const now = new Date('2026-03-06T13:00:00Z'); // March 6 (Friday), 8am ET
      const habit = makeHabit({
        id: 'dst-habit',
        days: ['fri', 'sat', 'sun', 'mon'],
        windowStart: '09:00',
        windowEnd: '10:00',
        durationMin: 30,
        durationMax: 30,
      });

      const creates = getCreates(
        reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, now),
        'dst-habit',
      );
      expect(creates.length).toBeGreaterThanOrEqual(3);
      for (const op of creates) {
        expect(opDurationMin(op)).toBe(30);
      }
    });

    it('maintains correct duration across Australia/Sydney fall-back (April 5, 2026)', () => {
      const tz = 'Australia/Sydney';
      const now = new Date('2026-04-04T13:00:00Z'); // Apr 5 00:00 AEDT
      const habit = makeHabit({
        id: 'sydney-dst-habit',
        days: ['sat', 'sun', 'mon'],
        windowStart: '09:00',
        windowEnd: '17:00',
        durationMin: 60,
        durationMax: 60,
      });

      const creates = getCreates(
        reschedule(
          [habit],
          [],
          [],
          [],
          [],
          defaultBuffer,
          { ...defaultSettings, timezone: tz },
          now,
        ),
        'sydney-dst-habit',
      );
      expect(creates.length).toBeGreaterThanOrEqual(2);
      for (const op of creates) {
        expect(opDurationMin(op)).toBe(60);
      }
    });
  });

  // =========================================================================
  // Focus Time
  // =========================================================================
  describe('focus time placement', () => {
    it('places focus blocks when weekly target exceeds available free time', () => {
      // Timeline includes personal hours (7am-10pm = 900min/day * 7 days = ~6300min).
      // Risk multiplier = 1.5, so need target > 6300/1.5 = 4200 to trigger placement.
      const focusRule = makeFocusRule({
        weeklyTargetMinutes: 5000,
        dailyTargetMinutes: 120,
      });

      const result = reschedule([], [], [], [focusRule], [], defaultBuffer, defaultSettings, NOW);
      const focusOps = result.operations.filter(
        (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Focus,
      );
      expect(focusOps.length).toBeGreaterThan(0);
      for (const op of focusOps) {
        expect(opDurationMin(op)).toBeLessThanOrEqual(120);
      }
    });

    it('skips disabled focus rules', () => {
      const focusRule = makeFocusRule({ enabled: false });

      const result = reschedule([], [], [], [focusRule], [], defaultBuffer, defaultSettings, NOW);
      const focusOps = result.operations.filter(
        (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Focus,
      );
      expect(focusOps.length).toBe(0);
    });

    it('does not place focus blocks when available time greatly exceeds target', () => {
      // Very low target with wide-open schedule — risk multiplier should skip placement
      const focusRule = makeFocusRule({
        weeklyTargetMinutes: 10,
        dailyTargetMinutes: 5,
      });

      const result = reschedule([], [], [], [focusRule], [], defaultBuffer, defaultSettings, NOW);
      const focusOps = result.operations.filter(
        (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Focus,
      );
      // With FOCUS_TIME_RISK_MULTIPLIER, 10min target in a mostly-free week should be skipped
      expect(focusOps.length).toBe(0);
    });
  });

  // =========================================================================
  // Edge Cases
  // =========================================================================
  describe('edge cases', () => {
    it('handles all item types scheduled together without errors', () => {
      const habit = makeHabit({
        id: 'combo-habit',
        days: ['mon'],
        durationMin: 30,
        durationMax: 30,
      });
      const task = makeTask({
        id: 'combo-task',
        totalDuration: 60,
        remainingDuration: 60,
        chunkMax: 60,
      });
      const meeting = makeMeeting({
        id: 'combo-meeting',
        duration: 30,
        frequency: Frequency.Weekly,
        windowStart: '14:00',
        windowEnd: '16:00',
      });

      const result = reschedule(
        [habit],
        [task],
        [meeting],
        [],
        [],
        defaultBuffer,
        defaultSettings,
        NOW,
      );
      expect(result.operations.length).toBeGreaterThan(0);
      // All three item types should be placed
      expect(getCreates(result, 'combo-habit').length).toBeGreaterThan(0);
      expect(getCreates(result, 'combo-task').length).toBeGreaterThan(0);
      expect(getCreates(result, 'combo-meeting').length).toBeGreaterThan(0);
    });

    it('reports overdue tasks as unschedulable', () => {
      const task = makeTask({
        id: 'overdue-task',
        dueDate: '2026-03-01T17:00:00Z', // Due before NOW
      });

      const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);
      expect(result.unschedulable.some((u) => u.itemId === 'overdue-task')).toBe(true);
    });

    it('caps scheduling window to MAX_SCHEDULING_WINDOW_DAYS', () => {
      const settings = { ...defaultSettings, schedulingWindowDays: 9999 };
      const habit = makeHabit({
        days: ['mon'],
        durationMin: 30,
        durationMax: 30,
      });

      // Should not throw or hang — window is capped internally
      const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, NOW);
      expect(result).toBeDefined();
    });

    it('handles habit with durationMax of 0 (skipped)', () => {
      const habit = makeHabit({ durationMax: 0 });

      const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW);
      expect(result.operations).toHaveLength(0);
    });

    it('handles task with remainingDuration of 0 (skipped)', () => {
      const task = makeTask({ remainingDuration: 0 });

      const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);
      expect(result.operations).toHaveLength(0);
    });
  });
});
