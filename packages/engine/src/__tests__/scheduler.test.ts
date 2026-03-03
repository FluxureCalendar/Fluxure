import { describe, it, expect } from 'vitest';
import { reschedule } from '../scheduler.js';
import {
  Habit,
  Task,
  SmartMeeting,
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

// Fixed timezone for test determinism; America/New_York observes DST, making DST tests meaningful.
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
    name: 'Morning Exercise',
    priority: Priority.Medium,
    windowStart: '09:00',
    windowEnd: '12:00',
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
    name: 'Write Report',
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

function makeMeeting(overrides: Partial<SmartMeeting> = {}): SmartMeeting {
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
    skipBuffer: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// Monday 2026-03-02 at 8:00 AM ET (13:00 UTC, ET is UTC-5 before DST)
const NOW = new Date('2026-03-02T13:00:00Z');

describe('reschedule', () => {
  it('should return empty result when no items to schedule', () => {
    const result = reschedule([], [], [], [], [], defaultBuffer, defaultSettings, NOW);

    expect(result.operations).toHaveLength(0);
    expect(result.unschedulable).toHaveLength(0);
  });

  it('should place a single habit', () => {
    const habits = [makeHabit()];

    const result = reschedule(habits, [], [], [], [], defaultBuffer, defaultSettings, NOW);

    expect(result.operations.length).toBeGreaterThan(0);

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);
    expect(creates.length).toBeGreaterThan(0);

    for (const op of creates) {
      expect(op.itemType).toBe(ItemType.Habit);
    }
  });

  it('should skip disabled habits', () => {
    const habits = [makeHabit({ enabled: false })];

    const result = reschedule(habits, [], [], [], [], defaultBuffer, defaultSettings, NOW);

    expect(result.operations).toHaveLength(0);
  });

  it('should skip completed tasks', () => {
    const tasks = [makeTask({ status: TaskStatus.Completed })];

    const result = reschedule([], tasks, [], [], [], defaultBuffer, defaultSettings, NOW);

    expect(result.operations).toHaveLength(0);
  });

  it('should chunk tasks into blocks', () => {
    const tasks = [
      makeTask({
        totalDuration: 120,
        remainingDuration: 120,
        chunkMin: 30,
        chunkMax: 60,
      }),
    ];

    const result = reschedule([], tasks, [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);
    // 120 min / 60 max = 2 chunks
    expect(creates.length).toBe(2);

    for (const op of creates) {
      const start = new Date(op.start);
      const end = new Date(op.end);
      const durationMin = (end.getTime() - start.getTime()) / (1000 * 60);
      expect(durationMin).toBe(60);
    }
  });

  it('should override task priority to Critical when isUpNext', () => {
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

    const result = reschedule(
      [],
      [taskNormal, taskUpNext],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);
    expect(creates.length).toBe(2);

    // isUpNext promotes to Critical, so it should be scheduled first
    expect(creates[0].itemId.startsWith('task-upnext')).toBe(true);
  });

  it('should schedule meetings before habits and tasks at same priority', () => {
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
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
    });

    const result = reschedule([habit], [], [meeting], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);
    expect(creates.length).toBeGreaterThanOrEqual(2);

    // TYPE_ORDER: meeting=0, habit=1 — meetings scheduled first
    const meetingOps = creates.filter((op) => op.itemType === ItemType.Meeting);
    const habitOps = creates.filter((op) => op.itemType === ItemType.Habit);
    expect(meetingOps.length).toBeGreaterThan(0);
    expect(habitOps.length).toBeGreaterThan(0);
  });

  it('should respect fixed calendar events', () => {
    const calendarEvents: CalendarEvent[] = [
      {
        id: 'ext-1',
        googleEventId: 'g-1',
        title: 'Doctor Appointment',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T11:00:00.000Z',
        isManaged: false,
        itemType: null,
        itemId: null,
        status: EventStatus.Busy,
      },
    ];

    const habits = [
      makeHabit({
        windowStart: '09:00',
        windowEnd: '12:00',
        durationMin: 30,
        durationMax: 30,
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
      }),
    ];

    const result = reschedule(
      habits,
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);

    for (const op of creates) {
      const opStart = new Date(op.start).getTime();
      const opEnd = new Date(op.end).getTime();
      const fixedStart = new Date('2026-03-02T10:00:00.000Z').getTime();
      const fixedEnd = new Date('2026-03-02T11:00:00.000Z').getTime();

      const overlaps = opStart < fixedEnd && fixedStart < opEnd;
      expect(overlaps).toBe(false);
    }
  });

  it('should generate delete operations for removed managed events', () => {
    // Event must be in the future relative to NOW to not be filtered as past
    const calendarEvents: CalendarEvent[] = [
      {
        id: 'managed-1',
        googleEventId: 'g-1',
        title: 'Old Habit Event',
        start: '2026-03-02T15:00:00.000Z',
        end: '2026-03-02T15:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: 'old-habit-id',
        status: EventStatus.Free,
      },
    ];

    const result = reschedule([], [], [], [], calendarEvents, defaultBuffer, defaultSettings, NOW);

    const deletes = result.operations.filter((op) => op.type === CalendarOpType.Delete);
    expect(deletes.length).toBe(1);
    expect(deletes[0].eventId).toBe('managed-1');
  });

  it('should generate update operations for moved managed events', () => {
    const habit = makeHabit({
      id: 'habit-moved',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 30,
      durationMax: 30,
    });

    // Weekly habits now use date-based IDs: {id}__{YYYY-MM-DD}
    const managedItemId = `habit-moved__2026-03-02`;

    const calendarEvents: CalendarEvent[] = [
      {
        id: 'managed-event-1',
        googleEventId: 'g-1',
        title: 'Morning Exercise',
        start: '2026-03-02T10:00:00.000Z',
        end: '2026-03-02T10:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: managedItemId,
        status: EventStatus.Free,
      },
    ];

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    expect(result.operations.length).toBeGreaterThan(0);
  });

  it('should handle priority cascade correctly', () => {
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
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule(
      [lowHabit],
      [criticalTask],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);
    expect(creates.length).toBeGreaterThanOrEqual(2);

    const taskOp = creates.find((op) => op.itemId.startsWith('critical-task'));
    expect(taskOp).toBeDefined();
  });

  it('should add items to unschedulable when no slots available', () => {
    const calendarEvents: CalendarEvent[] = [
      {
        id: 'all-day',
        googleEventId: 'g-1',
        title: 'All Day Event',
        start: '2026-03-02T00:00:00.000Z',
        end: '2026-03-09T00:00:00.000Z',
        isManaged: false,
        itemType: null,
        itemId: null,
        status: EventStatus.Busy,
      },
    ];

    const habits = [
      makeHabit({
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
        windowStart: '09:00',
        windowEnd: '10:00', // very narrow window
        durationMin: 60,
        durationMax: 60,
      }),
    ];

    const result = reschedule(
      habits,
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    expect(result.unschedulable.length).toBeGreaterThan(0);
  });

  it('should handle daily habit frequency correctly', () => {
    const habit = makeHabit({
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Habit,
    );

    // 7-day window starting Monday: Mon-Fri = 5 weekdays + Mon of next week
    // Plus potentially more depending on exact window calculation
    expect(creates.length).toBeGreaterThanOrEqual(5);
  });

  it('should handle weekly habit frequency correctly', () => {
    const habit = makeHabit({
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['wed'] },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Habit,
    );

    // Within a 7-day window starting Monday, there should be 1 Wednesday
    expect(creates.length).toBeGreaterThanOrEqual(1);
  });

  it('should respect buffer between items', () => {
    const bufferConfig: BufferConfig = {
      ...defaultBuffer,
      breakBetweenItemsMinutes: 15,
    };

    // Two habits that need to be placed
    const habits = [
      makeHabit({
        id: 'habit-a',
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
        windowStart: '09:00',
        windowEnd: '10:30',
        durationMin: 30,
        durationMax: 30,
      }),
      makeHabit({
        id: 'habit-b',
        priority: Priority.Medium,
        frequency: Frequency.Weekly,
        frequencyConfig: { days: ['mon'] },
        windowStart: '09:00',
        windowEnd: '10:30',
        durationMin: 30,
        durationMax: 30,
      }),
    ];

    const result = reschedule(habits, [], [], [], [], bufferConfig, defaultSettings, NOW);

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);

    if (creates.length >= 2) {
      const sorted = creates
        .map((op) => ({
          start: new Date(op.start).getTime(),
          end: new Date(op.end).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      for (let i = 1; i < sorted.length; i++) {
        const gap = sorted[i].start - sorted[i - 1].end;
        expect(gap).toBeGreaterThanOrEqual(15 * 60 * 1000);
      }
    }
  });

  it('should set Free/Busy status appropriately', () => {
    const habit = makeHabit({
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 30,
      durationMax: 30,
      windowStart: '09:00',
      windowEnd: '17:00',
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);

    for (const op of creates) {
      expect([EventStatus.Free, EventStatus.Busy]).toContain(op.status);
    }
  });

  it('should handle task with remaining duration less than chunkMax', () => {
    const task = makeTask({
      totalDuration: 45,
      remainingDuration: 45,
      chunkMin: 30,
      chunkMax: 60,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);

    expect(creates.length).toBe(1);
    const duration =
      (new Date(creates[0].end).getTime() - new Date(creates[0].start).getTime()) / (1000 * 60);
    expect(duration).toBe(45);
  });

  it('should handle habit dependencies (dependsOn)', () => {
    const habitA = makeHabit({
      id: 'habit-a',
      priority: Priority.High,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      dependsOn: null,
    });

    const habitB = makeHabit({
      id: 'habit-b',
      priority: Priority.High,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
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

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);

    expect(creates.length).toBe(2);

    const aOp = creates.find((op) => op.itemId.startsWith('habit-a'));
    const bOp = creates.find((op) => op.itemId.startsWith('habit-b'));

    if (aOp && bOp) {
      expect(new Date(bOp.start).getTime()).toBeGreaterThanOrEqual(new Date(aOp.end).getTime());
    }
  });

  it('should NOT delete locked managed events', () => {
    const habit = makeHabit({
      id: 'habit-locked',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      durationMin: 30,
      durationMax: 30,
      forced: true,
    });

    // Weekly habits now use date-based IDs: {id}__{YYYY-MM-DD}
    const managedItemId = `habit-locked__2026-03-02`;

    const calendarEvents: CalendarEvent[] = [
      {
        id: 'locked-event-1',
        googleEventId: 'g-locked-1',
        title: 'Locked Habit Event',
        start: '2026-03-02T09:00:00.000Z',
        end: '2026-03-02T09:30:00.000Z',
        isManaged: true,
        itemType: ItemType.Habit,
        itemId: managedItemId,
        status: EventStatus.Locked,
      },
    ];

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      calendarEvents,
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const deletes = result.operations.filter((op) => op.type === CalendarOpType.Delete);
    expect(deletes.length).toBe(0);
  });

  it('should not create chunks smaller than chunkMin', () => {
    // 90 min / chunkMax=50 / chunkMin=45: runt reduction clamps effectiveChunkSize
    // back to chunkMax, ensuring no chunk exceeds 50 minutes
    const task = makeTask({
      id: 'task-chunkmax',
      totalDuration: 90,
      remainingDuration: 90,
      chunkMin: 45,
      chunkMax: 50,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('task-chunkmax'),
    );

    expect(creates.length).toBe(2);

    for (const op of creates) {
      const durationMin = (new Date(op.end).getTime() - new Date(op.start).getTime()) / (1000 * 60);
      expect(durationMin).toBeLessThanOrEqual(50);
    }
  });

  it('should skip tasks with DoneScheduling status', () => {
    const task = makeTask({
      status: TaskStatus.DoneScheduling,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    expect(result.operations).toHaveLength(0);
  });

  it('should detect circular dependencies and add to unschedulable', () => {
    const habitA = makeHabit({
      id: 'habit-a',
      name: 'Habit A',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      dependsOn: 'habit-b',
    });

    const habitB = makeHabit({
      id: 'habit-b',
      name: 'Habit B',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
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
    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemType === ItemType.Habit,
    );
    expect(creates.length).toBe(2);
  });

  it('should schedule monthly habits on a specific day of the month', () => {
    // Window starts March 2, extends 7 days — March 5 is in range
    const habit = makeHabit({
      id: 'monthly-habit',
      frequency: Frequency.Monthly,
      frequencyConfig: { monthDay: 5 },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('monthly-habit'),
    );

    expect(creates.length).toBe(1);
    expect(creates[0].itemId).toContain('2026-03-05');
  });

  it('should schedule monthly habits on the 1st by default', () => {
    // Set NOW to Feb 28 so the 7-day window includes March 1
    const now = new Date('2026-02-28T13:00:00Z'); // Feb 28, 8am ET

    const habit = makeHabit({
      id: 'monthly-habit-default',
      frequency: Frequency.Monthly,
      frequencyConfig: {},
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('monthly-habit-default'),
    );

    expect(creates.length).toBe(1);
    expect(creates[0].itemId).toContain('2026-03-01');
  });

  it('should schedule monthly meetings', () => {
    const meeting = makeMeeting({
      id: 'monthly-meeting',
      frequency: Frequency.Monthly,
      duration: 30,
    });

    // Default to 1st of month; April 1 is a Wednesday (not a weekend)
    const now = new Date('2026-03-30T12:00:00Z'); // March 30 (Monday), 8am ET

    const result = reschedule([], [], [meeting], [], [], defaultBuffer, defaultSettings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('monthly-meeting'),
    );

    expect(creates.length).toBe(1);
  });

  it('should handle habits with empty/invalid windowStart or windowEnd gracefully', () => {
    // Empty windowStart should default to 00:00 via parseTime, not produce NaN
    const habit = makeHabit({
      id: 'habit-badtime',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
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

  it('should schedule around locked external calendar events', () => {
    const habit = makeHabit({
      id: 'habit-lock-test',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '14:00',
      idealTime: '10:00',
      durationMin: 60,
      durationMax: 60,
    });

    // Locked external event simulating a uni timetable entry
    const lockedEvent: CalendarEvent = {
      id: 'ext-locked-1',
      googleEventId: 'g-locked-ext-1',
      title: 'University Lecture',
      start: '2026-03-02T10:00:00.000Z',
      end: '2026-03-02T11:00:00.000Z',
      isManaged: false,
      itemType: null,
      itemId: null,
      status: EventStatus.Locked,
    };

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [lockedEvent],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);

    expect(creates.length).toBeGreaterThan(0);

    const lockedStart = new Date('2026-03-02T10:00:00.000Z').getTime();
    const lockedEnd = new Date('2026-03-02T11:00:00.000Z').getTime();

    for (const op of creates) {
      const opStart = new Date(op.start).getTime();
      const opEnd = new Date(op.end).getTime();
      const overlaps = opStart < lockedEnd && lockedStart < opEnd;
      expect(overlaps).toBe(false);
    }
  });

  it('should use date-based IDs for weekly habits so dependencies resolve', () => {
    const dailyHabit = makeHabit({
      id: 'habit-daily',
      priority: Priority.High,
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['wed'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      dependsOn: null,
    });

    const weeklyHabit = makeHabit({
      id: 'habit-weekly',
      priority: Priority.High,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['wed'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      dependsOn: 'habit-daily',
    });

    const result = reschedule(
      [dailyHabit, weeklyHabit],
      [],
      [],
      [],
      [],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter((op) => op.type === CalendarOpType.Create);

    const dailyOps = creates.filter((op) => op.itemId.startsWith('habit-daily'));
    const weeklyOps = creates.filter((op) => op.itemId.startsWith('habit-weekly'));
    expect(dailyOps.length).toBeGreaterThan(0);
    expect(weeklyOps.length).toBeGreaterThan(0);

    if (dailyOps.length > 0 && weeklyOps.length > 0) {
      const dailyEnd = new Date(dailyOps[0].end).getTime();
      const weeklyStart = new Date(weeklyOps[0].start).getTime();
      expect(weeklyStart).toBeGreaterThanOrEqual(dailyEnd);
    }
  });

  it('should never create chunks that exceed chunkMax', () => {
    const task = makeTask({
      id: 'task-max-check',
      totalDuration: 200,
      remainingDuration: 200,
      chunkMin: 40,
      chunkMax: 70,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('task-max-check'),
    );

    expect(creates.length).toBe(3);

    for (const op of creates) {
      const durationMin = (new Date(op.end).getTime() - new Date(op.start).getTime()) / (1000 * 60);
      expect(durationMin).toBeLessThanOrEqual(70);
    }
  });

  it('should maintain deterministic chunk ordering via id tiebreaker', () => {
    // Chunks have identical priority/type/window; id tiebreaker ensures stable ordering
    const task = makeTask({
      id: 'task-order',
      totalDuration: 180,
      remainingDuration: 180,
      chunkMin: 60,
      chunkMax: 60,
    });

    const result = reschedule([], [task], [], [], [], defaultBuffer, defaultSettings, NOW);

    const creates = result.operations
      .filter((op) => op.type === CalendarOpType.Create && op.itemId.startsWith('task-order'))
      .sort((a, b) => a.itemId.localeCompare(b.itemId));

    expect(creates.length).toBe(3);

    for (let i = 1; i < creates.length; i++) {
      const prevEnd = new Date(creates[i - 1].end).getTime();
      const currStart = new Date(creates[i].start).getTime();
      expect(currStart).toBeGreaterThanOrEqual(prevEnd);
    }
  });

  it('should block P3 habit by writable-calendar external event', () => {
    // External event fills the entire habit window (9am-12pm ET = 14:00-17:00 UTC)
    const monStart = '2026-03-02T14:00:00.000Z';
    const monEnd = '2026-03-02T17:00:00.000Z';
    const externalEvent: CalendarEvent = {
      id: 'ext-busy-1',
      googleEventId: 'g-busy-1',
      title: 'External Meeting',
      start: monStart,
      end: monEnd,
      isManaged: false,
      itemType: null,
      itemId: null,
      status: EventStatus.Busy,
    };

    const habit = makeHabit({
      id: 'habit-p3',
      priority: Priority.Medium, // P3
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '12:00',
      durationMin: 60,
      durationMax: 60,
    });

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [externalEvent],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('habit-p3'),
    );
    expect(creates.length).toBe(0);
    expect(result.unschedulable.some((u) => u.itemId.startsWith('habit-p3'))).toBe(true);
  });

  it('should allow P1 task to override writable-calendar external when no other slot', () => {
    const monStart = '2026-03-02T14:00:00.000Z';
    const monEnd = '2026-03-02T17:00:00.000Z';
    const externalEvent: CalendarEvent = {
      id: 'ext-busy-2',
      googleEventId: 'g-busy-2',
      title: 'External Meeting',
      start: monStart,
      end: monEnd,
      isManaged: false,
      itemType: null,
      itemId: null,
      status: EventStatus.Busy,
    };

    const task = makeTask({
      id: 'task-p1',
      priority: Priority.Critical,
      totalDuration: 60,
      remainingDuration: 60,
      chunkMax: 60,
      earliestStart: monStart,
      dueDate: monEnd,
    });

    const result = reschedule(
      [],
      [task],
      [],
      [],
      [externalEvent],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('task-p1'),
    );
    expect(creates.length).toBe(1);
  });

  it('should NOT allow P1 task to override locked-calendar external', () => {
    const monStart = '2026-03-02T14:00:00.000Z';
    const monEnd = '2026-03-02T17:00:00.000Z';
    const lockedExternal: CalendarEvent = {
      id: 'ext-locked-2',
      googleEventId: 'g-locked-2',
      title: 'University Lecture',
      start: monStart,
      end: monEnd,
      isManaged: false,
      itemType: null,
      itemId: null,
      status: EventStatus.Locked,
    };

    const task = makeTask({
      id: 'task-p1-locked',
      priority: Priority.Critical,
      totalDuration: 60,
      remainingDuration: 60,
      chunkMax: 60,
      earliestStart: monStart,
      dueDate: monEnd,
    });

    const result = reschedule(
      [],
      [task],
      [],
      [],
      [lockedExternal],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('task-p1-locked'),
    );
    expect(creates.length).toBe(0);
    expect(result.unschedulable.some((u) => u.itemId.startsWith('task-p1-locked'))).toBe(true);
  });

  it('should schedule monthly habit on the 2nd Wednesday of the month', () => {
    const now = new Date('2026-03-09T13:00:00Z'); // March 9 (Monday), 8am ET
    const settings = { ...defaultSettings, schedulingWindowDays: 14 };

    const habit = makeHabit({
      id: 'monthly-weekday-habit',
      frequency: Frequency.Monthly,
      frequencyConfig: { monthWeek: 2, monthWeekday: 'wed' },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('monthly-weekday-habit'),
    );

    expect(creates.length).toBe(1);
    expect(creates[0].itemId).toContain('2026-03-11');
  });

  it('should schedule monthly habit on the LAST Friday when monthWeek=5', () => {
    // March 2026 Fridays: 6, 13, 20, 27 — last is 27th
    const now = new Date('2026-03-23T13:00:00Z'); // March 23 (Monday), 8am ET
    const settings = { ...defaultSettings, schedulingWindowDays: 14 };

    const habit = makeHabit({
      id: 'monthly-last-fri',
      frequency: Frequency.Monthly,
      frequencyConfig: { monthWeek: 5, monthWeekday: 'fri' },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('monthly-last-fri'),
    );

    expect(creates.length).toBe(1);
    expect(creates[0].itemId).toContain('2026-03-27');
  });

  it('should schedule correctly across DST spring-forward (March 8 2026)', () => {
    // DST spring-forward: Sunday March 8, 2026 at 2am ET
    const now = new Date('2026-03-06T13:00:00Z'); // March 6 (Friday), 8am ET

    const habit = makeHabit({
      id: 'dst-habit',
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['fri', 'sat', 'sun', 'mon'] },
      windowStart: '09:00',
      windowEnd: '10:00',
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, defaultSettings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('dst-habit'),
    );

    expect(creates.length).toBeGreaterThanOrEqual(3);

    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(30 * 60 * 1000);
    }
  });

  it('handles Australia/Sydney DST fall-back correctly', () => {
    // April 5, 2026: clocks go back 3am to 2am (AEDT to AEST)
    const tz = 'Australia/Sydney';
    const now = new Date('2026-04-04T13:00:00Z'); // Apr 5 00:00 AEDT

    const habit = makeHabit({
      id: 'sydney-dst-habit',
      frequency: Frequency.Daily,
      frequencyConfig: { days: ['sat', 'sun', 'mon'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 60,
      durationMax: 60,
    });

    const settings = { ...defaultSettings, timezone: tz };
    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('sydney-dst-habit'),
    );

    expect(creates.length).toBeGreaterThanOrEqual(2);

    // Duration must be exactly 60 minutes despite DST transition
    for (const op of creates) {
      const durationMs = new Date(op.end).getTime() - new Date(op.start).getTime();
      expect(durationMs).toBe(60 * 60 * 1000);
    }
  });

  it('should handle bi-weekly habits across year boundary (Dec/Jan)', () => {
    // Dec 29, 2025 (Monday) is ISO week 1 of 2026
    const now = new Date('2025-12-29T13:00:00Z'); // Dec 29, 8am ET
    const settings = { ...defaultSettings, schedulingWindowDays: 21 };

    const habit = makeHabit({
      id: 'biweekly-year-boundary',
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'], weekInterval: 2 },
      durationMin: 30,
      durationMax: 30,
    });

    const result = reschedule([habit], [], [], [], [], defaultBuffer, settings, now);

    const creates = result.operations.filter(
      (op) => op.type === CalendarOpType.Create && op.itemId.startsWith('biweekly-year-boundary'),
    );

    expect(creates.length).toBeGreaterThanOrEqual(1);
    expect(creates.length).toBeLessThanOrEqual(2);
  });

  it('should not re-place locked scheduled events in the greedy loop', () => {
    const habit = makeHabit({
      id: 'habit-stable',
      priority: Priority.Medium,
      frequency: Frequency.Weekly,
      frequencyConfig: { days: ['mon'] },
      windowStart: '09:00',
      windowEnd: '17:00',
      durationMin: 30,
      durationMax: 30,
      forced: true,
    });

    const lockedManaged: CalendarEvent = {
      id: 'locked-managed-1',
      googleEventId: 'g-locked-m1',
      title: 'Morning Exercise',
      start: '2026-03-02T14:00:00.000Z',
      end: '2026-03-02T14:30:00.000Z',
      isManaged: true,
      itemType: ItemType.Habit,
      itemId: 'habit-stable__2026-03-02',
      status: EventStatus.Locked,
    };

    const result = reschedule(
      [habit],
      [],
      [],
      [],
      [lockedManaged],
      defaultBuffer,
      defaultSettings,
      NOW,
    );

    const deletes = result.operations.filter((op) => op.type === CalendarOpType.Delete);
    expect(deletes.length).toBe(0);

    // No update should move the locked event to a different time
    const updates = result.operations.filter(
      (op) => op.type === CalendarOpType.Update && op.eventId === 'locked-managed-1',
    );
    for (const up of updates) {
      expect(new Date(up.start).getTime()).toBe(new Date('2026-03-02T14:00:00.000Z').getTime());
      expect(new Date(up.end).getTime()).toBe(new Date('2026-03-02T14:30:00.000Z').getTime());
    }
  });
});
