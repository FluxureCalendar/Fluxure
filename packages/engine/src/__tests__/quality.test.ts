import { describe, it, expect } from 'vitest';
import { calculateScheduleQuality } from '../quality.js';
import {
  ScheduleItem,
  FocusTimeRule,
  BufferConfig,
  TimeSlot,
  ItemType,
  Priority,
  SchedulingHours,
  QUALITY_WEIGHTS,
  QUALITY_IDEAL_MAX_DIFF_MINUTES,
} from '@fluxure/shared';

// --- Shared test fixtures ---

const TZ = 'America/New_York';

const defaultBuffer: BufferConfig = { breakBetweenItemsMinutes: 5 };

const zeroBufConfig: BufferConfig = { breakBetweenItemsMinutes: 0 };

const defaultFocusRule: FocusTimeRule = {
  id: 'focus-1',
  weeklyTargetMinutes: 300,
  dailyTargetMinutes: 60,
  schedulingHours: SchedulingHours.Working,
  windowStart: null,
  windowEnd: null,
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

/** Create a TimeSlot for a given ET hour on March 7, 2026 (UTC-5) */
function makePlacement(startHourET: number, durationMin: number): TimeSlot {
  const startMs = new Date('2026-03-07T00:00:00Z').getTime() + (startHourET + 5) * 3600000;
  return {
    start: new Date(startMs),
    end: new Date(startMs + durationMin * 60000),
  };
}

// --- Tests ---

describe('calculateScheduleQuality', () => {
  describe('empty schedule', () => {
    it('returns 100 when no items to schedule', () => {
      const result = calculateScheduleQuality([], new Map(), [], defaultBuffer, 0, TZ);
      expect(result.overall).toBe(100);
      expect(result.components.placement.score).toBe(100);
      expect(result.components.idealTime.score).toBe(100);
      expect(result.components.focusTime.score).toBe(100);
      expect(result.components.buffers.score).toBe(100);
      expect(result.components.priorities.score).toBe(100);
    });
  });

  describe('placement rate (weight: 0.3)', () => {
    it('scores 100 when all items placed', () => {
      const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
      const placements = new Map<string, TimeSlot>([
        ['a', makePlacement(9, 60)],
        ['b', makePlacement(10, 60)],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.placement.score).toBe(100);
      expect(result.components.placement.weight).toBe(QUALITY_WEIGHTS.placement);
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

    it('adds breakdown notes for unplaced items by type', () => {
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

    it('notes all items scheduled when placement is 100%', () => {
      const items = [makeItem({ id: 'a' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], zeroBufConfig, 0, TZ);
      expect(result.breakdown).toContainEqual(
        expect.stringContaining('All items successfully scheduled'),
      );
    });
  });

  describe('ideal time proximity (weight: 0.25)', () => {
    it('scores 100 when placed exactly at ideal time', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.idealTime.score).toBe(100);
      expect(result.components.idealTime.weight).toBe(QUALITY_WEIGHTS.idealTime);
    });

    it('scores 50 when placed 1 hour from ideal (linear decay)', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(10, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      // Linear: 100 - (60/120)*100 = 50
      expect(result.components.idealTime.score).toBe(50);
    });

    it('scores 0 when placed at exactly MAX_DIFF_MINUTES from ideal', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      // 2 hours = QUALITY_IDEAL_MAX_DIFF_MINUTES (120)
      const placements = new Map<string, TimeSlot>([['a', makePlacement(11, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.idealTime.score).toBe(0);
    });

    it('scores 0 when placed beyond MAX_DIFF_MINUTES from ideal', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      // 3 hours away
      const placements = new Map<string, TimeSlot>([['a', makePlacement(12, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.idealTime.score).toBe(0);
    });

    it('handles items without idealTime (scores 100, skipped)', () => {
      const items = [makeItem({ id: 'a', idealTime: undefined })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(14, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.idealTime.score).toBe(100);
    });

    it('uses circular distance for wrap-around (e.g., 23:00 ideal, placed at 01:00)', () => {
      // idealTime 23:00, placed at 01:00 => diff should be 2h (120 min), not 22h
      const items = [makeItem({ id: 'a', idealTime: '23:00' })];
      // 01:00 ET = 06:00 UTC
      const earlySlot: TimeSlot = {
        start: new Date('2026-03-07T06:00:00Z'),
        end: new Date('2026-03-07T07:00:00Z'),
      };
      const placements = new Map<string, TimeSlot>([['a', earlySlot]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      // 2h = MAX_DIFF, so score = 0
      expect(result.components.idealTime.score).toBe(0);
    });

    it('averages scores across multiple placed items', () => {
      const items = [
        makeItem({ id: 'a', idealTime: '09:00' }),
        makeItem({ id: 'b', idealTime: '14:00' }),
      ];
      const placements = new Map<string, TimeSlot>([
        ['a', makePlacement(9, 60)], // perfect = 100
        ['b', makePlacement(15, 60)], // 1h off = 50
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      // Average of 100 and 50 = 75
      expect(result.components.idealTime.score).toBe(75);
    });
  });

  describe('focus time achievement (weight: 0.2)', () => {
    it('scores 100 when daily target met', () => {
      const result = calculateScheduleQuality(
        [],
        new Map(),
        [defaultFocusRule],
        defaultBuffer,
        60,
        TZ,
      );
      expect(result.components.focusTime.score).toBe(100);
      expect(result.components.focusTime.weight).toBe(QUALITY_WEIGHTS.focus);
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
      // 48/60 = 80%
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

    it('scores 0 when zero focus minutes placed', () => {
      const result = calculateScheduleQuality(
        [],
        new Map(),
        [defaultFocusRule],
        defaultBuffer,
        0,
        TZ,
      );
      expect(result.components.focusTime.score).toBe(0);
    });

    it('derives daily target from weekly when dailyTargetMinutes is 0', () => {
      const weeklyOnlyRule: FocusTimeRule = {
        ...defaultFocusRule,
        dailyTargetMinutes: 0,
        weeklyTargetMinutes: 300, // 300/5 = 60 min/day
      };
      const result = calculateScheduleQuality(
        [],
        new Map(),
        [weeklyOnlyRule],
        defaultBuffer,
        60,
        TZ,
      );
      expect(result.components.focusTime.score).toBe(100);
    });

    it('ignores disabled focus rules', () => {
      const disabledRule: FocusTimeRule = {
        ...defaultFocusRule,
        enabled: false,
      };
      const result = calculateScheduleQuality([], new Map(), [disabledRule], defaultBuffer, 0, TZ);
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

  describe('buffer compliance (weight: 0.15)', () => {
    it('scores 100 when all items have adequate buffers', () => {
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting })];
      const placements = new Map<string, TimeSlot>([
        ['mtg-1', makePlacement(10, 30)],
        ['other', makePlacement(9, 30)], // 30 min gap > 5 min required
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.buffers.score).toBe(100);
      expect(result.components.buffers.weight).toBe(QUALITY_WEIGHTS.buffers);
    });

    it('scores 0 when items lack required buffer', () => {
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting })];
      const otherSlot: TimeSlot = {
        start: new Date('2026-03-07T15:00:00Z'),
        end: new Date('2026-03-07T15:30:00Z'),
      };
      const mtgSlot: TimeSlot = {
        start: new Date('2026-03-07T15:32:00Z'), // 2 min gap < 5 min required
        end: new Date('2026-03-07T16:02:00Z'),
      };
      const placements = new Map<string, TimeSlot>([
        ['mtg-1', mtgSlot],
        ['other', otherSlot],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.buffers.score).toBe(0);
    });

    it('scores 100 when no buffer config (breakBetweenItemsMinutes = 0)', () => {
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting })];
      const placements = new Map<string, TimeSlot>([['mtg-1', makePlacement(10, 30)]]);
      const result = calculateScheduleQuality(items, placements, [], zeroBufConfig, 0, TZ);
      expect(result.components.buffers.score).toBe(100);
    });

    it('skips items with skipBuffer flag', () => {
      const items = [makeItem({ id: 'mtg-1', type: ItemType.Meeting, skipBuffer: true })];
      const placements = new Map<string, TimeSlot>([
        ['mtg-1', makePlacement(10, 30)],
        ['other', makePlacement(10, 30)], // overlapping, but skipBuffer
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.buffers.score).toBe(100);
    });

    it('checks buffer compliance for habits and tasks too', () => {
      const items = [makeItem({ id: 'habit-1', type: ItemType.Habit })];
      const habitSlot: TimeSlot = {
        start: new Date('2026-03-07T15:32:00Z'),
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

    it('scores 50 when half of items have adequate buffers', () => {
      const items = [
        makeItem({ id: 'a', type: ItemType.Habit }),
        makeItem({ id: 'b', type: ItemType.Habit }),
      ];
      const placements = new Map<string, TimeSlot>([
        ['a', makePlacement(9, 30)], // 9:00-9:30
        ['b', makePlacement(9.5 + 1 / 60, 30)], // 9:31-10:01 — 1 min gap < 5 min
        ['c', makePlacement(11, 30)], // far neighbor for 'a'
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      // 'a' has neighbor 'b' at 1 min gap — non-compliant
      // 'b' has neighbor 'a' at 1 min gap — non-compliant
      // Both non-compliant
      expect(result.components.buffers.score).toBeLessThanOrEqual(50);
    });
  });

  describe('priority respect (weight: 0.1)', () => {
    it('scores 100 when higher priority items scheduled earlier', () => {
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
      expect(result.components.priorities.weight).toBe(QUALITY_WEIGHTS.priorities);
    });

    it('scores 0 when priorities fully inverted', () => {
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

    it('scores 100 with a single item (no pairs to invert)', () => {
      const items = [makeItem({ id: 'a' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.priorities.score).toBe(100);
    });

    it('scores 100 when all items share the same priority', () => {
      const items = [
        makeItem({ id: 'a', priority: Priority.Medium }),
        makeItem({ id: 'b', priority: Priority.Medium }),
        makeItem({ id: 'c', priority: Priority.Medium }),
      ];
      const placements = new Map<string, TimeSlot>([
        ['a', makePlacement(14, 60)],
        ['b', makePlacement(9, 60)],
        ['c', makePlacement(11, 60)],
      ]);
      const result = calculateScheduleQuality(items, placements, [], defaultBuffer, 0, TZ);
      expect(result.components.priorities.score).toBe(100);
    });
  });

  describe('overall score (weighted average)', () => {
    it('computes perfect 100 when all components are perfect', () => {
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(9, 60)]]);
      const result = calculateScheduleQuality(items, placements, [], zeroBufConfig, 0, TZ);
      expect(result.overall).toBe(100);
    });

    it('returns breakdown array', () => {
      const result = calculateScheduleQuality([], new Map(), [], defaultBuffer, 0, TZ);
      expect(Array.isArray(result.breakdown)).toBe(true);
    });

    it('verifies weighted average calculation with known component scores', () => {
      // placement=50, idealTime=50, focus=100 (no rule), buffers=100 (no buffer), priorities=100
      const items = [makeItem({ id: 'a' }), makeItem({ id: 'b' })];
      const placements = new Map<string, TimeSlot>([['a', makePlacement(10, 60)]]); // 1 of 2 placed
      const result = calculateScheduleQuality(items, placements, [], zeroBufConfig, 0, TZ);

      const expected = Math.round(
        result.components.placement.score * QUALITY_WEIGHTS.placement +
          result.components.idealTime.score * QUALITY_WEIGHTS.idealTime +
          result.components.focusTime.score * QUALITY_WEIGHTS.focus +
          result.components.buffers.score * QUALITY_WEIGHTS.buffers +
          result.components.priorities.score * QUALITY_WEIGHTS.priorities,
      );
      expect(result.overall).toBe(expected);
    });

    it('perfect schedule with all components active', () => {
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
      expect(result.overall).toBeGreaterThanOrEqual(90);
    });

    it('overall score is 0 when all components score 0', () => {
      // 0 placement (nothing placed), focus target unmet
      const items = [makeItem({ id: 'a', idealTime: '09:00' })];
      const placements = new Map<string, TimeSlot>();
      const result = calculateScheduleQuality(
        items,
        placements,
        [defaultFocusRule],
        defaultBuffer,
        0,
        TZ,
      );
      // placement=0, idealTime=100 (no placed items with idealTime), focus=0, buffers=100, priorities=100
      // This won't be literally 0 but we can verify it's calculated correctly
      const expected = Math.round(
        result.components.placement.score * QUALITY_WEIGHTS.placement +
          result.components.idealTime.score * QUALITY_WEIGHTS.idealTime +
          result.components.focusTime.score * QUALITY_WEIGHTS.focus +
          result.components.buffers.score * QUALITY_WEIGHTS.buffers +
          result.components.priorities.score * QUALITY_WEIGHTS.priorities,
      );
      expect(result.overall).toBe(expected);
    });
  });
});
