import { describe, it, expect } from 'vitest';
import { reschedule } from '../scheduler.js';
import {
  UserSettings,
  Priority,
  SchedulingHours,
  EventStatus,
  ItemType,
  CalendarOpType,
} from '@fluxure/shared';
import {
  NOW,
  defaultSettings,
  allDaySettings,
  defaultBuffer,
  makeHabit,
  makeTask,
  makeCalendarEvent,
  getCreates as filterCreates,
} from './test-helpers.js';

// --- Tests ---

describe('DST edge cases', () => {
  // ==========================================================================
  // US Eastern: Spring forward March 8 2026 at 2:00 AM → 3:00 AM
  // ==========================================================================

  it('spring-forward: habit at 1am for 1h — should still be exactly 60 real minutes', () => {
    // A habit window 01:00-02:00 on the spring-forward night.
    // 1:00 AM EST exists. 2:00 AM EST does not — TZDate resolves it to 3:00 AM EDT.
    // So the window is effectively 06:00Z-07:00Z (1am EST) to 07:00Z (3am EDT clock, but that's
    // the same instant as 2am EST would have been). The habit should land at 1am and be 60 real min.
    const now = new Date('2026-03-07T13:00:00Z'); // Sat Mar 7 8am ET

    const habit = makeHabit({
      id: 'dst-1am-spring',
      days: ['sun'],
      windowStart: '01:00',
      windowEnd: '04:00',
      durationMin: 60,
      durationMax: 60,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, now);

    const creates = filterCreates(result, 'dst-1am-spring').filter((op) =>
      op.itemId.includes('2026-03-08'),
    );

    expect(creates.length).toBe(1);
    const op = creates[0];
    const realDurationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
    // Must be exactly 60 real minutes regardless of clock jump
    expect(realDurationMs).toBe(60 * 60 * 1000);
  });

  it('spring-forward: window entirely within skipped hour (2:00-3:00 AM) — should be unschedulable or zero-width', () => {
    // March 8 2026: 2:00 AM EST → 3:00 AM EDT. The 2:00-3:00 AM window doesn't exist.
    // setTimeInTz(day, 2, 0) and setTimeInTz(day, 3, 0) both resolve to 3:00 AM EDT (07:00Z),
    // producing a zero-width window. No slots can be generated.
    const now = new Date('2026-03-07T13:00:00Z');

    const habit = makeHabit({
      id: 'dst-skipped-hour',
      days: ['sun'],
      windowStart: '02:00',
      windowEnd: '03:00',
      durationMin: 30,
      durationMax: 30,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, now);

    // Should not crash
    expect(result).toBeDefined();
    // The habit on Mar 8 should either not be created or be unschedulable
    const mar8Creates = filterCreates(result, 'dst-skipped-hour').filter((op) =>
      op.itemId.includes('2026-03-08'),
    );
    expect(mar8Creates.length).toBe(0);
  });

  it('spring-forward: habit spanning the 2am boundary (1:30-3:30) — real duration is 60 min not 120', () => {
    // Window 01:00-05:00 on spring-forward night. A 60-min habit should be placed
    // somewhere in the window and always be exactly 60 real minutes.
    const now = new Date('2026-03-07T13:00:00Z');

    const habit = makeHabit({
      id: 'dst-span-boundary',
      days: ['sun'],
      windowStart: '01:00',
      windowEnd: '05:00',
      durationMin: 60,
      durationMax: 60,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, now);
    const mar8Creates = filterCreates(result, 'dst-span-boundary').filter((op) =>
      op.itemId.includes('2026-03-08'),
    );

    expect(mar8Creates.length).toBe(1);
    const durationMs =
      new Date(mar8Creates[0].end).getTime() - new Date(mar8Creates[0].start).getTime();
    expect(durationMs).toBe(60 * 60 * 1000);
  });

  // ==========================================================================
  // US Eastern: Fall back November 1 2026 at 2:00 AM → 1:00 AM
  // ==========================================================================

  it('fall-back: habit at 1am for 1h — exactly one placement, 60 real minutes', () => {
    // Nov 1 2026: 2:00 AM EDT → 1:00 AM EST. The 1:00-2:00 AM hour repeats.
    // The engine should produce exactly one 60-minute event, not two.
    const now = new Date('2026-10-31T12:00:00Z'); // Sat Oct 31

    const habit = makeHabit({
      id: 'dst-1am-fall',
      days: ['sun'],
      windowStart: '01:00',
      windowEnd: '03:00',
      durationMin: 60,
      durationMax: 60,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, now);

    const nov1Creates = filterCreates(result, 'dst-1am-fall').filter((op) =>
      op.itemId.includes('2026-11-01'),
    );

    // Exactly one placement
    expect(nov1Creates.length).toBe(1);
    const durationMs =
      new Date(nov1Creates[0].end).getTime() - new Date(nov1Creates[0].start).getTime();
    // Must be exactly 60 real minutes
    expect(durationMs).toBe(60 * 60 * 1000);
  });

  it('fall-back: 30-min habit in repeated hour window — no double-schedule', () => {
    const now = new Date('2026-10-31T12:00:00Z');

    const habit = makeHabit({
      id: 'dst-fallback-30',
      days: ['sun'],
      windowStart: '00:30',
      windowEnd: '02:30',
      durationMin: 30,
      durationMax: 30,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, now);

    const nov1Creates = filterCreates(result, 'dst-fallback-30').filter((op) =>
      op.itemId.includes('2026-11-01'),
    );

    // Exactly one placement per day, never duplicated
    expect(nov1Creates.length).toBe(1);
    const durationMs =
      new Date(nov1Creates[0].end).getTime() - new Date(nov1Creates[0].start).getTime();
    expect(durationMs).toBe(30 * 60 * 1000);
  });

  // ==========================================================================
  // Daytime habits on DST transition days — should be totally unaffected
  // ==========================================================================

  it('spring-forward: daytime habit (9am-12pm) produces correct 60-min duration', () => {
    const now = new Date('2026-03-07T13:00:00Z');
    const habit = makeHabit({
      id: 'dst-daytime-spring',
      days: ['sat', 'sun', 'mon'],
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, now);
    const creates = filterCreates(result, 'dst-daytime-spring');

    expect(creates.length).toBeGreaterThan(0);
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });

  // ==========================================================================
  // Southern hemisphere DST
  // ==========================================================================

  it('Australia/Sydney fall-back (Apr 5): habit durations remain correct', () => {
    // Australia/Sydney: AEDT→AEST first Sunday of April 2026 (Apr 5)
    // Clocks go back 1h at 3:00am → 2:00am
    const sydneySettings: UserSettings = {
      workingHours: { start: '09:00', end: '17:00' },
      personalHours: { start: '01:00', end: '22:00' },
      timezone: 'Australia/Sydney',
      schedulingWindowDays: 7,
    };
    const now = new Date('2026-04-04T00:00:00Z'); // Apr 4 10am AEDT

    const habit = makeHabit({
      id: 'sydney-dst-fallback',
      days: ['sat', 'sun', 'mon'],
      windowStart: '02:00',
      windowEnd: '05:00',
      durationMin: 60,
      durationMax: 60,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, sydneySettings, now);
    const creates = filterCreates(result, 'sydney-dst-fallback');

    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });

  it('Australia/Sydney spring-forward (Oct): habit at 2am for 60min', () => {
    // Australia/Sydney: AEST→AEDT first Sunday of October 2026 (Oct 4)
    // Clocks go forward 1h at 2:00am → 3:00am
    const sydneySettings: UserSettings = {
      workingHours: { start: '09:00', end: '17:00' },
      personalHours: { start: '01:00', end: '22:00' },
      timezone: 'Australia/Sydney',
      schedulingWindowDays: 7,
    };
    const now = new Date('2026-10-03T00:00:00Z'); // Oct 3 10am AEST

    const habit = makeHabit({
      id: 'sydney-dst-spring',
      days: ['sat', 'sun', 'mon'],
      windowStart: '01:00',
      windowEnd: '05:00',
      durationMin: 60,
      durationMax: 60,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, sydneySettings, now);
    const creates = filterCreates(result, 'sydney-dst-spring');

    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });
});

// ==========================================================================
// Leap year edge cases
// ==========================================================================

describe('Leap year edge cases', () => {
  it('task with due date on Feb 29 of a leap year should be schedulable', () => {
    // 2028 is a leap year. Task due Feb 29.
    const leapSettings: UserSettings = {
      ...defaultSettings,
      schedulingWindowDays: 14,
    };
    const now = new Date('2028-02-20T13:00:00Z');

    const task = makeTask({
      id: 'leap-task-feb29',
      name: 'Leap year task',
      totalDuration: 60,
      remainingDuration: 60,
      chunkMin: 60,
      chunkMax: 60,
      dueDate: '2028-02-29T17:00:00Z',
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, leapSettings, now);
    const creates = filterCreates(result, 'leap-task-feb29');

    expect(creates.length).toBe(1);
    const durationMs = new Date(creates[0].end).getTime() - new Date(creates[0].start).getTime();
    expect(durationMs).toBe(60 * 60 * 1000);

    // Must be scheduled before the due date
    const endTime = new Date(creates[0].end).getTime();
    expect(endTime).toBeLessThanOrEqual(new Date('2028-02-29T17:00:00Z').getTime());
  });

  it('scheduling window spanning Feb 28 → Mar 1 on non-leap year should work', () => {
    // 2027 is not a leap year. Feb has 28 days.
    const settings: UserSettings = {
      ...defaultSettings,
      schedulingWindowDays: 7,
    };
    const now = new Date('2027-02-25T13:00:00Z'); // Thu Feb 25

    const habit = makeHabit({
      id: 'non-leap-span',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);
    const creates = filterCreates(result, 'non-leap-span');

    // Should schedule across Feb 28 → Mar 1 without gaps or errors
    expect(creates.length).toBeGreaterThan(0);
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(30 * 60 * 1000);
    }

    // Verify at least one event lands on or after Mar 1
    const mar1OrLater = creates.filter(
      (op) => new Date(op.start).getTime() >= new Date('2027-03-01T00:00:00Z').getTime(),
    );
    expect(mar1OrLater.length).toBeGreaterThan(0);
  });

  it('scheduling window spanning Feb 28 → Mar 1 on leap year should include Feb 29', () => {
    // 2028 is a leap year.
    const settings: UserSettings = {
      ...defaultSettings,
      schedulingWindowDays: 7,
    };
    const now = new Date('2028-02-25T13:00:00Z'); // Fri Feb 25

    const habit = makeHabit({
      id: 'leap-span',
      days: ['mon', 'tue', 'wed', 'thu', 'fri'],
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);
    const creates = filterCreates(result, 'leap-span');

    expect(creates.length).toBeGreaterThan(0);

    // Verify Feb 29 is included in the scheduled dates
    const feb29Events = creates.filter((op) => op.itemId.includes('2028-02-29'));
    expect(feb29Events.length).toBe(1);
    const durationMs =
      new Date(feb29Events[0].end).getTime() - new Date(feb29Events[0].start).getTime();
    expect(durationMs).toBe(30 * 60 * 1000);
  });
});

describe('Non-DST and extreme timezone edge cases', () => {
  it('should schedule correctly in a timezone that never observes DST (Asia/Tokyo, UTC+9)', () => {
    const tokyoSettings: UserSettings = {
      workingHours: { start: '09:00', end: '17:00' },
      personalHours: { start: '07:00', end: '22:00' },
      timezone: 'Asia/Tokyo',
      schedulingWindowDays: 7,
    };
    const now = new Date('2026-03-07T00:00:00Z'); // Mar 7 09:00 JST

    const habit = makeHabit({
      id: 'tokyo-no-dst',
      days: ['sat', 'sun', 'mon'],
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, tokyoSettings, now);
    const creates = filterCreates(result, 'tokyo-no-dst');

    expect(creates.length).toBeGreaterThan(0);
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });

  it('should schedule correctly in UTC (no offset, no DST)', () => {
    const utcSettings: UserSettings = {
      workingHours: { start: '09:00', end: '17:00' },
      personalHours: { start: '07:00', end: '22:00' },
      timezone: 'UTC',
      schedulingWindowDays: 7,
    };
    const now = new Date('2026-03-02T09:00:00Z');

    const habit = makeHabit({
      id: 'utc-habit',
      days: ['mon', 'tue', 'wed'],
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, utcSettings, now);
    const creates = filterCreates(result, 'utc-habit');

    expect(creates.length).toBeGreaterThan(0);
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(30 * 60 * 1000);
    }
  });

  it('should handle negative UTC offset timezone (Pacific/Honolulu, UTC-10, no DST)', () => {
    const hawaiiSettings: UserSettings = {
      workingHours: { start: '08:00', end: '16:00' },
      personalHours: { start: '06:00', end: '22:00' },
      timezone: 'Pacific/Honolulu',
      schedulingWindowDays: 7,
    };
    // Mar 2 06:00 HST = Mar 2 16:00 UTC
    const now = new Date('2026-03-02T16:00:00Z');

    const habit = makeHabit({
      id: 'hawaii-habit',
      days: ['mon', 'tue'],
      windowStart: '08:00',
      windowEnd: '12:00',
      durationMin: 45,
      durationMax: 45,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, hawaiiSettings, now);
    const creates = filterCreates(result, 'hawaii-habit');

    expect(creates.length).toBeGreaterThan(0);
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(45 * 60 * 1000);
    }
  });

  it('should handle large positive UTC offset (Pacific/Auckland, UTC+12/+13)', () => {
    // NZ switches from NZDT (UTC+13) to NZST (UTC+12) first Sunday of April
    const nzSettings: UserSettings = {
      workingHours: { start: '09:00', end: '17:00' },
      personalHours: { start: '07:00', end: '22:00' },
      timezone: 'Pacific/Auckland',
      schedulingWindowDays: 7,
    };
    // Apr 4 2026 in NZ is just before DST ends (Apr 5)
    const now = new Date('2026-04-03T18:00:00Z'); // Apr 4 07:00 NZDT

    const habit = makeHabit({
      id: 'nz-dst-transition',
      days: ['sat', 'sun', 'mon'],
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, nzSettings, now);
    const creates = filterCreates(result, 'nz-dst-transition');

    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });
});

describe('Empty and minimal calendar edge cases', () => {
  it('should return empty operations when no items to schedule', () => {
    const result = reschedule([], [], [], [], [], defaultBuffer, defaultSettings, NOW);
    expect(result.operations).toHaveLength(0);
    expect(result.unschedulable).toHaveLength(0);
  });

  it('should handle all disabled habits gracefully', () => {
    const habits = Array.from({ length: 5 }, (_, i) =>
      makeHabit({ id: `disabled-${i}`, enabled: false }),
    );

    const result = reschedule(habits, [], [], [], [], defaultBuffer, defaultSettings, NOW);
    expect(result.operations).toHaveLength(0);
  });

  it('should schedule into a single-slot day when only one slot fits', () => {
    // Working hours 09:00-10:00 leaves exactly one 60-min slot
    const tightSettings: UserSettings = {
      ...defaultSettings,
      workingHours: { start: '09:00', end: '10:00' },
      schedulingWindowDays: 1,
    };

    const habit = makeHabit({
      id: 'single-slot',
      days: ['mon'],
      windowStart: '09:00',
      windowEnd: '10:00',
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, tightSettings, NOW);
    const creates = filterCreates(result, 'single-slot');

    expect(creates.length).toBe(1);
    const durationMs = new Date(creates[0].end).getTime() - new Date(creates[0].start).getTime();
    expect(durationMs).toBe(60 * 60 * 1000);
  });

  it('should handle schedulingWindowDays = 1', () => {
    const settings = { ...defaultSettings, schedulingWindowDays: 1 };
    const habit = makeHabit({
      id: 'one-day',
      days: ['mon'],
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, NOW);
    // Should schedule at most 1 day
    const creates = filterCreates(result, 'one-day');
    expect(creates.length).toBeLessThanOrEqual(1);
  });
});

describe('Stress tests', () => {
  it(
    'should handle large scheduling window (80+ days) within acceptable time',
    { timeout: 15000 },
    () => {
      const settings = { ...defaultSettings, schedulingWindowDays: 80 };
      const habit = makeHabit({
        id: 'stress-habit',
        days: ['mon', 'tue', 'wed', 'thu', 'fri'],
        durationMin: 30,
        durationMax: 30,
      });

      const startTime = Date.now();
      const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, NOW);
      const elapsed = Date.now() - startTime;

      expect(result.operations.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(10000);
    },
  );

  it('should handle 100+ items with empty calendar without errors', { timeout: 15000 }, () => {
    const habits = Array.from({ length: 50 }, (_, i) =>
      makeHabit({
        id: `stress-habit-${i}`,
        name: `Habit ${i}`,
        days: ['mon'],
        durationMin: 15,
        durationMax: 15,
        windowStart: '07:00',
        windowEnd: '22:00',
      }),
    );

    const tasks = Array.from({ length: 60 }, (_, i) =>
      makeTask({
        id: `stress-task-${i}`,
        name: `Task ${i}`,
        totalDuration: 30,
        remainingDuration: 30,
        chunkMin: 30,
        chunkMax: 30,
        dueDate: '2026-03-09T17:00:00Z',
      }),
    );

    const startTime = Date.now();
    const result = reschedule(habits, tasks, [], [], [], defaultBuffer, defaultSettings, NOW);
    const elapsed = Date.now() - startTime;

    expect(result).toBeDefined();
    expect(result.operations.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(10000);
  });

  it(
    'should handle many items with overlapping preferred times without infinite loops',
    { timeout: 15000 },
    () => {
      const habits = Array.from({ length: 30 }, (_, i) =>
        makeHabit({
          id: `overlap-habit-${i}`,
          name: `Overlap Habit ${i}`,
          days: ['mon'],
          windowStart: '09:00',
          windowEnd: '10:00',
          idealTime: '09:00',
          durationMin: 30,
          durationMax: 30,
        }),
      );

      const startTime = Date.now();
      const result = reschedule(habits, [], [], [], [], defaultBuffer, defaultSettings, NOW);
      const elapsed = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(elapsed).toBeLessThan(10000);

      // At most 2 can fit in a 1-hour window with 30-min durations
      const mondayCreates = result.operations.filter(
        (op) => op.type === CalendarOpType.Create && op.itemId.includes('2026-03-02'),
      );
      expect(mondayCreates.length).toBeLessThanOrEqual(2);
      expect(result.unschedulable.length).toBeGreaterThanOrEqual(28);
    },
  );
});

describe('Dependency edge cases', () => {
  it('should keep locked items in place and schedule dependent items after them', () => {
    const habitA = makeHabit({
      id: 'dep-locked-a',
      priority: Priority.High,
      days: ['mon'],
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      forced: true,
      dependsOn: null,
    });

    const habitB = makeHabit({
      id: 'dep-locked-b',
      priority: Priority.High,
      days: ['mon'],
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'dep-locked-a',
    });

    const lockedEvent = makeCalendarEvent({
      id: 'locked-dep-event',
      googleEventId: 'g-locked-dep',
      title: 'Locked Habit A',
      start: '2026-03-02T14:00:00.000Z',
      end: '2026-03-02T14:30:00.000Z',
      isManaged: true,
      itemType: ItemType.Habit,
      itemId: 'dep-locked-a__2026-03-02',
      status: EventStatus.Locked,
    });

    const result = reschedule(
      [habitA, habitB],
      [],
      [],
      [],
      [lockedEvent],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    // Locked events should never be deleted
    const deletes = result.operations.filter((op) => op.type === CalendarOpType.Delete);
    expect(deletes.length).toBe(0);

    // Dependent habit B must start at or after habit A's end
    const bCreates = filterCreates(result, 'dep-locked-b');
    if (bCreates.length > 0) {
      const bStart = new Date(bCreates[0].start).getTime();
      const aEnd = new Date('2026-03-02T14:30:00.000Z').getTime();
      expect(bStart).toBeGreaterThanOrEqual(aEnd);
    }
  });

  it('should detect dependency cycles and still schedule all habits', () => {
    const habitA = makeHabit({
      id: 'cycle-a',
      name: 'Cycle A',
      days: ['mon'],
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'cycle-c',
    });

    const habitB = makeHabit({
      id: 'cycle-b',
      name: 'Cycle B',
      days: ['mon'],
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'cycle-a',
    });

    const habitC = makeHabit({
      id: 'cycle-c',
      name: 'Cycle C',
      days: ['mon'],
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'cycle-b',
    });

    const startTime = Date.now();
    const result = reschedule(
      [habitA, habitB, habitC],
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );
    const elapsed = Date.now() - startTime;

    // Must complete quickly (no infinite loop)
    expect(elapsed).toBeLessThan(5000);

    // Circular dependency warnings should be reported
    const circularErrors = result.unschedulable.filter((u) =>
      u.reason.includes('Circular dependency'),
    );
    expect(circularErrors.length).toBeGreaterThan(0);

    // All habits still scheduled with dependsOn stripped
    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Habit,
    );
    expect(creates.length).toBe(3);
  });

  it('should place task chunks sequentially', () => {
    const task = makeTask({
      id: 'dep-chunks',
      totalDuration: 240,
      remainingDuration: 240,
      chunkMin: 60,
      chunkMax: 60,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = filterCreates(result, 'dep-chunks').sort((a, b) =>
      a.itemId.localeCompare(b.itemId),
    );

    expect(creates.length).toBe(4);

    for (let i = 1; i < creates.length; i++) {
      const prevEnd = new Date(creates[i - 1].end).getTime();
      const currStart = new Date(creates[i].start).getTime();
      expect(currStart).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it('should handle dependency on a non-existent habit ID gracefully', () => {
    const habit = makeHabit({
      id: 'orphan-dep',
      days: ['mon'],
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'non-existent-habit',
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW);
    // Should still schedule (dependency ignored since target doesn't exist)
    expect(result).toBeDefined();
    const creates = filterCreates(result, 'orphan-dep');
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Midnight crossing', () => {
  it('should handle scheduling window that crosses midnight', () => {
    const habit = makeHabit({
      id: 'midnight-cross',
      days: ['mon'],
      windowStart: '23:00',
      windowEnd: '01:00',
      durationMin: 60,
      durationMax: 60,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, NOW);
    expect(result).toBeDefined();

    const creates = filterCreates(result, 'midnight-cross');
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });

  it('should handle habit with windowEnd at midnight (00:00)', () => {
    const habit = makeHabit({
      id: 'midnight-end',
      days: ['mon'],
      windowStart: '22:00',
      windowEnd: '00:00',
      durationMin: 30,
      durationMax: 30,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, NOW);
    expect(result).toBeDefined();

    const creates = filterCreates(result, 'midnight-end');
    if (creates.length > 0) {
      const durationMs = new Date(creates[0].end).getTime() - new Date(creates[0].start).getTime();
      expect(durationMs).toBe(30 * 60 * 1000);
    }
  });

  it('should handle early-morning window starting at 00:00', () => {
    const habit = makeHabit({
      id: 'early-morning',
      days: ['mon'],
      windowStart: '00:00',
      windowEnd: '02:00',
      durationMin: 30,
      durationMax: 30,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, allDaySettings, NOW);
    expect(result).toBeDefined();

    const creates = filterCreates(result, 'early-morning');
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(30 * 60 * 1000);
    }
  });
});

describe('Task edge cases', () => {
  it('should mark overdue tasks as unschedulable', () => {
    const task = makeTask({
      id: 'overdue-task',
      dueDate: '2026-03-01T17:00:00Z', // before NOW
      totalDuration: 60,
      remainingDuration: 60,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    const overdue = result.unschedulable.find((u) => u.itemId === 'overdue-task');
    expect(overdue).toBeDefined();
    expect(overdue!.reason).toContain('overdue');
  });

  it('should handle task with remainingDuration smaller than chunkMin', () => {
    const task = makeTask({
      id: 'small-remaining',
      totalDuration: 60,
      remainingDuration: 15, // less than chunkMin=30
      chunkMin: 30,
      chunkMax: 60,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);
    // Should handle gracefully without crashing
    expect(result).toBeDefined();
  });
});
