import { describe, it, expect } from 'vitest';
import { reschedule } from '../scheduler.js';
import {
  Habit,
  Task,
  CalendarEvent,
  BufferConfig,
  UserSettings,
  Priority,
  Frequency,
  SchedulingHours,
  TaskStatus,
  EventStatus,
  ItemType,
  CalendarOpType,
  DecompressionTarget,
} from '@fluxure/shared';

const TEST_TZ = 'America/New_York';

const defaultSettings: UserSettings = {
  workingHours: { start: '09:00', end: '17:00' },
  personalHours: { start: '07:00', end: '22:00' },
  timezone: TEST_TZ,
  schedulingWindowDays: 7,
};

const defaultBuffer: BufferConfig = {
  id: 'buf-1',
  travelTimeMinutes: 0,
  decompressionMinutes: 0,
  breakBetweenItemsMinutes: 0,
  applyDecompressionTo: DecompressionTarget.All,
};

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    name: 'Test Habit',
    priority: Priority.Medium,
    windowStart: '09:00',
    windowEnd: '17:00',
    idealTime: '09:00',
    durationMin: 30,
    durationMax: 60,
    frequency: Frequency.Daily,
    frequencyConfig: { days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    schedulingHours: SchedulingHours.Working,
    forced: false,
    autoDecline: false,
    dependsOn: null,
    enabled: true,
    skipBuffer: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
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
    skipBuffer: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Monday 2026-03-02 at 8:00 AM ET (13:00 UTC, ET is UTC-5 before DST)
const NOW = new Date('2026-03-02T13:00:00Z');

describe('DST edge cases', () => {
  it('should handle scheduling window entirely within the skipped DST hour (2:00-3:00 AM)', () => {
    // March 8 2026: spring-forward in ET, 2:00-3:00 AM does not exist
    const now = new Date('2026-03-07T13:00:00Z'); // March 7, 8am ET

    const habit = makeHabit({
      id: 'dst-skipped-hour',
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['sun'] }, // March 8 is a Sunday
      windowStart: '02:00',
      windowEnd: '03:00',
      durationMin: 30,
      durationMax: 30,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [],
      defaultBuffer,
      { ...defaultSettings, personalHours: { start: '00:00', end: '23:59' } },
      now,
    );

    expect(result).toBeDefined();
    expect(result.operations).toBeDefined();
    expect(result.unschedulable).toBeDefined();
  });

  it('should not double-schedule during fall-back repeated hour', () => {
    // Nov 1 2026: ET fall-back at 2am, 1:00-2:00 AM repeats
    const now = new Date('2026-10-31T12:00:00Z'); // Oct 31, 8am ET

    const habit = makeHabit({
      id: 'dst-fallback',
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['sun'] }, // Nov 1 is a Sunday
      windowStart: '01:00',
      windowEnd: '03:00',
      durationMin: 30,
      durationMax: 30,
      schedulingHours: SchedulingHours.Personal,
    });

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [],
      defaultBuffer,
      { ...defaultSettings, personalHours: { start: '00:00', end: '23:59' } },
      now,
    );

    const creates = result.operations.filter(
      (op) =>
        op.type === CalendarOpType.Create &&
        op.itemId.startsWith('dst-fallback') &&
        op.itemId.includes('2026-11-01'),
    );
    expect(creates.length).toBeLessThanOrEqual(1);
  });

  it('should produce correct durations across DST spring-forward boundary', () => {
    const now = new Date('2026-03-07T13:00:00Z');
    const habit = makeHabit({
      id: 'dst-duration-check',
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['sat', 'sun', 'mon'] },
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('dst-duration-check'),
    );

    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });
});

describe('Monthly frequency edge cases', () => {
  it('should handle monthly habit on day 31 in months with fewer days', () => {
    const now = new Date('2026-03-28T13:00:00Z'); // March 28
    const settings = { ...defaultSettings, schedulingWindowDays: 42 };

    const habit = makeHabit({
      id: 'monthly-31',
      frequency: Frequency.Monthly,
      frequencyConfig: { monthDay: 31 },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('monthly-31'),
    );

    expect(creates.length).toBeGreaterThanOrEqual(1);

    const marchOp = creates.find((op) => op.itemId.includes('2026-03-31'));
    expect(marchOp).toBeDefined();

    // April has no day 31
    const aprilOp = creates.find((op) => op.itemId.includes('2026-04'));
    expect(aprilOp).toBeUndefined();
  });

  it('should handle monthly habit on Feb 29 in a non-leap year', () => {
    const now = new Date('2027-02-01T13:00:00Z');
    const settings = { ...defaultSettings, schedulingWindowDays: 30 };

    const habit = makeHabit({
      id: 'monthly-feb29',
      frequency: Frequency.Monthly,
      frequencyConfig: { monthDay: 29 },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);

    // Feb 29 doesn't exist in 2027
    const febOps = result.operations.filter(
      (op) =>
        op.type === CalendarOpType.Create &&
        op.itemId.startsWith('monthly-feb29') &&
        op.itemId.includes('2027-02'),
    );
    expect(febOps.length).toBe(0);
    expect(result).toBeDefined();
  });

  it('should handle monthly habit on Feb 29 in a leap year', () => {
    const now = new Date('2028-02-25T13:00:00Z');
    const settings = { ...defaultSettings, schedulingWindowDays: 7 };

    const habit = makeHabit({
      id: 'monthly-feb29-leap',
      frequency: Frequency.Monthly,
      frequencyConfig: { monthDay: 29 },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('monthly-feb29-leap'),
    );

    expect(creates.length).toBe(1);
    expect(creates[0].itemId).toContain('2028-02-29');
  });
});

describe('Stress tests', () => {
  it(
    'should handle large scheduling window (80+ days) within acceptable time',
    {
      timeout: 15000,
    },
    () => {
      const settings = { ...defaultSettings, schedulingWindowDays: 80 };
      const habit = makeHabit({
        id: 'stress-habit',
        frequency: Frequency.Daily,
        frequencyConfig: { days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
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

  it(
    'should handle 100+ items with empty calendar without errors',
    {
      timeout: 15000,
    },
    () => {
      const habits: Habit[] = [];
      for (let i = 0; i < 50; i++) {
        habits.push(
          makeHabit({
            id: `stress-habit-${i}`,
            name: `Habit ${i}`,
            frequency: Frequency.Weekly,
            frequencyConfig: { days: ['mon'] },
            durationMin: 15,
            durationMax: 15,
            windowStart: '07:00',
            windowEnd: '22:00',
          }),
        );
      }

      const tasks: Task[] = [];
      for (let i = 0; i < 60; i++) {
        tasks.push(
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
      }

      const startTime = Date.now();
      const result = reschedule(habits, tasks, [], [], [], defaultBuffer, defaultSettings, NOW);
      const elapsed = Date.now() - startTime;

      expect(result).toBeDefined();
      expect(result.operations.length).toBeGreaterThan(0);
      expect(elapsed).toBeLessThan(10000);
    },
  );

  it(
    'should handle many items with overlapping preferred times without infinite loops',
    {
      timeout: 15000,
    },
    () => {
      const habits: Habit[] = [];
      for (let i = 0; i < 30; i++) {
        habits.push(
          makeHabit({
            id: `overlap-habit-${i}`,
            name: `Overlap Habit ${i}`,
            frequency: Frequency.Weekly,
            frequencyConfig: { days: ['mon'] },
            windowStart: '09:00',
            windowEnd: '10:00',
            idealTime: '09:00',
            durationMin: 30,
            durationMax: 30,
          }),
        );
      }

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
  it('should keep locked items in place and schedule dependent items around them', () => {
    const habitA = makeHabit({
      id: 'dep-locked-a',
      priority: Priority.High,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
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
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'dep-locked-a',
    });

    const lockedEvent: CalendarEvent = {
      id: 'locked-dep-event',
      googleEventId: 'g-locked-dep',
      title: 'Locked Habit A',
      start: '2026-03-02T14:00:00.000Z',
      end: '2026-03-02T14:30:00.000Z',
      isManaged: true,
      itemType: ItemType.Habit,
      itemId: 'dep-locked-a__2026-03-02',
      status: EventStatus.Locked,
    };

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

    const deletes = result.operations.filter((op) => op.type === CalendarOpType.Delete);
    expect(deletes.length).toBe(0);

    const bCreates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('dep-locked-b'),
    );
    if (bCreates.length > 0) {
      const bStart = new Date(bCreates[0].start).getTime();
      const aEnd = new Date('2026-03-02T14:30:00.000Z').getTime();
      expect(bStart).toBeGreaterThanOrEqual(aEnd);
    }
  });

  it('should detect dependency cycles and break them without looping infinitely', () => {
    const habitA = makeHabit({
      id: 'cycle-a',
      name: 'Cycle A',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'cycle-c',
    });

    const habitB = makeHabit({
      id: 'cycle-b',
      name: 'Cycle B',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'cycle-a',
    });

    const habitC = makeHabit({
      id: 'cycle-c',
      name: 'Cycle C',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
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

    expect(elapsed).toBeLessThan(5000);

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

  it('should handle task chunk dependencies correctly (sequential placement)', () => {
    const task = makeTask({
      id: 'dep-chunks',
      totalDuration: 240,
      remainingDuration: 240,
      chunkMin: 60,
      chunkMax: 60,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations
      .filter((op) => op.type === CalendarOpType.Create && op.itemId.startsWith('dep-chunks'))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    expect(creates.length).toBe(4);

    for (let i = 1; i < creates.length; i++) {
      const prevEnd = new Date(creates[i - 1].end).getTime();
      const currStart = new Date(creates[i].start).getTime();
      expect(currStart).toBeGreaterThanOrEqual(prevEnd);
    }
  });
});

describe('Midnight crossing', () => {
  it('should handle scheduling window that crosses midnight', () => {
    const habit = makeHabit({
      id: 'midnight-cross',
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['mon'] },
      windowStart: '23:00',
      windowEnd: '01:00', // next day
      durationMin: 60,
      durationMax: 60,
      schedulingHours: SchedulingHours.Personal,
    });

    const settings: UserSettings = {
      ...defaultSettings,
      personalHours: { start: '00:00', end: '23:59' },
    };

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, NOW);

    expect(result).toBeDefined();

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('midnight-cross'),
    );

    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });

  it('should handle habit with windowEnd at midnight (00:00)', () => {
    const habit = makeHabit({
      id: 'midnight-end',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '22:00',
      windowEnd: '00:00', // midnight = end of day
      durationMin: 30,
      durationMax: 30,
      schedulingHours: SchedulingHours.Personal,
    });

    const settings: UserSettings = {
      ...defaultSettings,
      personalHours: { start: '00:00', end: '23:59' },
    };

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, NOW);

    expect(result).toBeDefined();

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('midnight-end'),
    );

    if (creates.length > 0) {
      const durationMs = new Date(creates[0].end).getTime() - new Date(creates[0].start).getTime();
      expect(durationMs).toBe(30 * 60 * 1000);
    }
  });
});
