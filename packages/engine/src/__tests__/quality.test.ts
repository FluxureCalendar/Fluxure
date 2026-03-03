import { describe, it, expect } from 'vitest';
import { calculateScheduleQuality } from '../quality.js';
import {
  ScheduleItem,
  FocusTimeRule,
  BufferConfig,
  TimeSlot,
  ItemType,
  Priority,
  DecompressionTarget,
  SchedulingHours,
} from '@fluxure/shared';

const TZ = 'America/New_York';

const defaultBuffer: BufferConfig = {
  id: 'buf-1',
  travelTimeMinutes: 0,
  decompressionMinutes: 0,
  breakBetweenItemsMinutes: 5,
  applyDecompressionTo: DecompressionTarget.All,
};

const defaultFocusRule: FocusTimeRule = {
  id: 'focus-1',
  weeklyTargetMinutes: 300,
  dailyTargetMinutes: 60,
  schedulingHours: SchedulingHours.Working,
  enabled: true,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

function makeItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  const day = new Date('2026-03-07T14:00:00Z'); // 9am ET
  return {
    id: 'item-1',
    type: ItemType.Habit,
    priority: Priority.Medium,
    timeWindow: {
      start: day,
      end: new Date(day.getTime() + 8 * 3600000),
    },
    idealTime: '09:00',
    duration: 60,
    skipBuffer: false,
    forced: false,
    dependsOn: null,
    ...overrides,
  };
}

function makePlacement(startHourET: number, durationMin: number): TimeSlot {
  // March 7, 2026: ET is UTC-5
  const startMs = new Date('2026-03-07T00:00:00Z').getTime() + (startHourET + 5) * 3600000;
  return {
    start: new Date(startMs),
    end: new Date(startMs + durationMin * 60000),
  };
}

describe('calculateScheduleQuality', () => {
  describe('empty schedule', () => {
    it('returns 100 when no items to schedule', () => {
      const result = calculateScheduleQuality([], new Map(), [], defaultBuffer, 0, TZ);
      expect(result.overall).toBe(100);
      expect(result.components.placement.score).toBe(100);
    });
  });

  describe('placement rate', () => {
    it('scores 100 when all items placed', () => {
      const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
      const placements = new Map<string, TimeSlot>([
        ['a', makePlacement(9, 60)],
        ['b', makePlacement(10, 60)],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.placement.score).toBe(100);
    });

    it('scores 50 when half items placed', () => {
      const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.placement.score).toBe(50);
    });

    it('scores 0 when no items placed', () => {
      const items = [makeItem({ id: 'a' })];
      const placements = new Map<string, TimeSlot>();
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.placement.score).toBe(0);
    });

    it('adds breakdown notes for unplaced items', () => {
      const items = [
        makeItem({ id: 'a', type: ItemType.Habit }),
        makeItem({ id: 'b', type: ItemType.Habit }),
        makeItem({ id: 'c', type: ItemType.Task }),
      ];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.breakdown).toContainEqual(
        expect.stringContaining("1 habit couldn't be scheduled"),
      );
      expect(result.breakdown).toContainEqual(
        expect.stringContaining("1 task couldn't be scheduled"),
      );
    });
  });

  describe('ideal time proximity', () => {
    it('scores 100 when placed exactly at ideal time', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.idealTime.score).toBe(100);
    });

    it('scores lower when placed 1 hour from ideal', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(10, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.idealTime.score).toBe(50);
    });

    it('scores 0 when placed 2+ hours from ideal', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(11, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.idealTime.score).toBe(0);
    });
  });

  describe('focus time achievement', () => {
    it('scores 100 when target met', () => {
      const result = calculateScheduleQuality(
        [],
        new Map(),
        [defaultFocusRule],
        defaultBuffer,
        60,
        TZ,
      );
      expect(result.components.focusTime.score).toBe(100);
    });

    it('scores 100 when no focus rule configured', () => {
      const result = calculateScheduleQuality([], new Map(), [], defaultBuffer, 0, TZ);
      expect(result.components.focusTime.score).toBe(100);
    });

    it('scores proportionally when partially met', () => {
      const result = calculateScheduleQuality(
        [],
        new Map(),
        [defaultFocusRule],
        defaultBuffer,
        48,
        TZ,
      );
      expect(result.components.focusTime.score).toBe(80);
    });

    it('caps at 100 when exceeding target', () => {
      const result = calculateScheduleQuality(
        [],
        new Map(),
        [defaultFocusRule],
        defaultBuffer,
        120,
        TZ,
      );
      expect(result.components.focusTime.score).toBe(100);
    });

    it('adds breakdown note with percentage', () => {
      const result = calculateScheduleQuality(
        [],
        new Map(),
        [defaultFocusRule],
        defaultBuffer,
        30,
        TZ,
      );
      expect(result.breakdown).toContainEqual(
        expect.stringContaining('Focus time 50% of daily target'),
      );
    });
  });

  // Buffer compliance checks all item types, not just meetings
  describe('buffer compliance', () => {
    it('scores 100 when all items have adequate buffers', () => {
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting })];
      const placements = new Map<string, TimeSlot>([
        ['mtg-1', makePlacement(10, 30)],
        ['other', makePlacement(9, 30)],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.buffers.score).toBe(100);
    });

    it('scores 0 when items lack buffer', () => {
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting })];
      const otherSlot: TimeSlot = {
        start: new Date('2026-03-07T15:00:00Z'), // 10:00 ET
        end: new Date('2026-03-07T15:30:00Z'), // 10:30 ET
      };
      const mtgSlot: TimeSlot = {
        start: new Date('2026-03-07T15:32:00Z'), // 10:32 ET — 2 min gap < 5min
        end: new Date('2026-03-07T16:02:00Z'),
      };
      const placements = new Map<string, TimeSlot>([
        ['mtg-1', mtgSlot],
        ['other', otherSlot],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.buffers.score).toBe(0);
    });

    it('scores 100 when no buffer config', () => {
      const noBuf: BufferConfig = { ...defaultBuffer, breakBetweenItemsMinutes: 0 };
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting })];
      const placements = new Map<string, TimeSlot>([['mtg-1', makePlacement(10, 30)]]);
      const result = calculateScheduleQuality(items, placements, [], noBuf, 0, TZ);
      expect(result.components.buffers.score).toBe(100);
    });

    it('skips items with skipBuffer flag', () => {
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting, skipBuffer: true })];
      const placements = new Map<string, TimeSlot>([
        ['mtg-1', makePlacement(10, 30)],
        ['other', makePlacement(10, 30)], // overlapping
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.buffers.score).toBe(100);
    });

    it('checks buffer compliance for habits and tasks too', () => {
      const items = [makeItem({ id: 'habit-1', type: ItemType.Habit })];
      const habitSlot: TimeSlot = {
        start: new Date('2026-03-07T15:32:00Z'), // 2 min after neighbor
        end: new Date('2026-03-07T16:02:00Z'),
      };
      const neighborSlot: TimeSlot = {
        start: new Date('2026-03-07T15:00:00Z'),
        end: new Date('2026-03-07T15:30:00Z'),
      };
      const placements = new Map<string, TimeSlot>([
        ['habit-1', habitSlot],
        ['neighbor', neighborSlot],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.buffers.score).toBe(0);
    });
  });

  describe('priority respect', () => {
    it('scores 100 when priorities in order', () => {
      const items = [
        makeItem({ id: 'p1', priority: Priority.Critical }),
        makeItem({ id: 'p3', priority: Priority.Medium }),
      ];
      const placements = new Map<string, TimeSlot>([
        ['p1', makePlacement(9, 60)],
        ['p3', makePlacement(11, 60)],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.priorities.score).toBe(100);
    });

    it('scores lower when priorities inverted', () => {
      const items = [
        makeItem({ id: 'p1', priority: Priority.Critical }),
        makeItem({ id: 'p3', priority: Priority.Medium }),
      ];
      const placements = new Map<string, TimeSlot>([
        ['p1', makePlacement(11, 60)],
        ['p3', makePlacement(9, 60)],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.priorities.score).toBe(0);
    });

    it('scores 100 with single item', () => {
      const items = [makeItem({ id: 'a' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.priorities.score).toBe(100);
    });
  });

  describe('overall score', () => {
    it('computes weighted average', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      // placement=100*0.3 + idealTime=100*0.25 + focus=100*0.2 + buffers=100*0.15 + priorities=100*0.1 = 100
      expect(result.overall).toBe(100);
    });

    it('returns breakdown array', () => {
      const result = calculateScheduleQuality([], new Map(), [], defaultBuffer, 0, TZ);
      expect(Array.isArray(result.breakdown)).toBe(true);
    });

    it('perfect schedule with all components', () => {
      const items = [
        makeItem({
          id: 'mtg-1',
          type: ItemType.Meeting,
          idealTime: '09:00',
          priority: Priority.High,
        }),
        makeItem({
          id: 'habit-1',
          type: ItemType.Habit,
          idealTime: '11:00',
          priority: Priority.Medium,
        }),
      ];
      const placements = new Map<string, TimeSlot>([
        ['mtg-1', makePlacement(9, 30)],
        ['habit-1', makePlacement(11, 60)],
      ]);
      const result = calculateScheduleQuality(
        items,
        placements,
        [defaultFocusRule],
        defaultBuffer,
        60,
        TZ,
      );
      // All components should be high
      expect(result.overall).toBeGreaterThanOrEqual(90);
    });
  });
});
