import { describe, it, expect } from 'vitest';
import { generateCandidateSlots, slotsOverlap } from '../slots.js';
import {
  ScheduleItem,
  TimeSlot,
  BufferConfig,
  ItemType,
  Priority,
  DecompressionTarget,
} from '@fluxure/shared';

const defaultBuffer: BufferConfig = {
  id: 'buf-1',
  travelTimeMinutes: 0,
  decompressionMinutes: 0,
  breakBetweenItemsMinutes: 0,
  applyDecompressionTo: 'all' as DecompressionTarget,
};

function makeItem(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    id: 'item-1',
    type: ItemType.Habit,
    priority: Priority.Medium,
    timeWindow: {
      start: new Date(2026, 2, 2, 9, 0, 0),
      end: new Date(2026, 2, 2, 17, 0, 0),
    },
    idealTime: '10:00',
    duration: 30,
    skipBuffer: false,
    forced: false,
    dependsOn: null,
    ...overrides,
  };
}

describe('slotsOverlap', () => {
  it('should detect overlapping slots', () => {
    const a: TimeSlot = {
      start: new Date(2026, 2, 2, 9, 0),
      end: new Date(2026, 2, 2, 10, 0),
    };
    const b: TimeSlot = {
      start: new Date(2026, 2, 2, 9, 30),
      end: new Date(2026, 2, 2, 10, 30),
    };
    expect(slotsOverlap(a, b)).toBe(true);
  });

  it('should not detect adjacent slots as overlapping', () => {
    const a: TimeSlot = {
      start: new Date(2026, 2, 2, 9, 0),
      end: new Date(2026, 2, 2, 10, 0),
    };
    const b: TimeSlot = {
      start: new Date(2026, 2, 2, 10, 0),
      end: new Date(2026, 2, 2, 11, 0),
    };
    expect(slotsOverlap(a, b)).toBe(false);
  });

  it('should not detect non-overlapping slots', () => {
    const a: TimeSlot = {
      start: new Date(2026, 2, 2, 9, 0),
      end: new Date(2026, 2, 2, 10, 0),
    };
    const b: TimeSlot = {
      start: new Date(2026, 2, 2, 11, 0),
      end: new Date(2026, 2, 2, 12, 0),
    };
    expect(slotsOverlap(a, b)).toBe(false);
  });

  it('should detect when one slot contains another', () => {
    const a: TimeSlot = {
      start: new Date(2026, 2, 2, 9, 0),
      end: new Date(2026, 2, 2, 12, 0),
    };
    const b: TimeSlot = {
      start: new Date(2026, 2, 2, 10, 0),
      end: new Date(2026, 2, 2, 11, 0),
    };
    expect(slotsOverlap(a, b)).toBe(true);
    expect(slotsOverlap(b, a)).toBe(true);
  });
});

describe('generateCandidateSlots', () => {
  it('should generate candidates for a 30-min item in an 8-hour window', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 17, 0),
      },
    ];

    const item = makeItem({ duration: 30 });
    const candidates = generateCandidateSlots(
      item,
      timeline,
      [],
      defaultBuffer,
      undefined,
      undefined,
      undefined,
      15,
    );

    // 8 hours = 480 minutes, 30 min duration, 15 min step
    // (480 - 30) / 15 + 1 = 31 candidates
    expect(candidates.length).toBe(31);

    // All candidates should be 30 minutes long
    for (const c of candidates) {
      const durationMs = c.end.getTime() - c.start.getTime();
      expect(durationMs).toBe(30 * 60 * 1000);
    }
  });

  it('should filter out candidates that overlap with occupied slots', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 12, 0),
      },
    ];

    const occupiedSlots: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 10, 0),
        end: new Date(2026, 2, 2, 11, 0),
      },
    ];

    const item = makeItem({ duration: 30 });
    const candidates = generateCandidateSlots(item, timeline, occupiedSlots, defaultBuffer);

    // No candidate should overlap with 10:00-11:00
    for (const c of candidates) {
      expect(slotsOverlap(c, occupiedSlots[0])).toBe(false);
    }
  });

  it('should respect buffer between items', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 12, 0),
      },
    ];

    const occupiedSlots: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 10, 0),
        end: new Date(2026, 2, 2, 10, 30),
      },
    ];

    const bufferConfig: BufferConfig = {
      ...defaultBuffer,
      breakBetweenItemsMinutes: 15,
    };

    const item = makeItem({ duration: 30 });
    const candidates = generateCandidateSlots(item, timeline, occupiedSlots, bufferConfig);

    // No candidate should start or end within 15 minutes of the occupied slot
    for (const c of candidates) {
      // Candidate must end at or before 9:45 (10:00 - 15 min buffer)
      // or start at or after 10:45 (10:30 + 15 min buffer)
      const endsBeforeBuffer = c.end.getTime() <= new Date(2026, 2, 2, 9, 45).getTime();
      const startsAfterBuffer = c.start.getTime() >= new Date(2026, 2, 2, 10, 45).getTime();
      expect(endsBeforeBuffer || startsAfterBuffer).toBe(true);
    }
  });

  it('should return empty array when no slots fit', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 9, 15),
      },
    ];

    const item = makeItem({ duration: 30 });
    const candidates = generateCandidateSlots(item, timeline, [], defaultBuffer);

    expect(candidates.length).toBe(0);
  });

  it('should only generate candidates within the item time window', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 7, 0),
        end: new Date(2026, 2, 2, 22, 0),
      },
    ];

    const item = makeItem({
      duration: 30,
      timeWindow: {
        start: new Date(2026, 2, 2, 10, 0),
        end: new Date(2026, 2, 2, 12, 0),
      },
    });

    const candidates = generateCandidateSlots(item, timeline, [], defaultBuffer);

    for (const c of candidates) {
      expect(c.start.getTime()).toBeGreaterThanOrEqual(new Date(2026, 2, 2, 10, 0).getTime());
      expect(c.end.getTime()).toBeLessThanOrEqual(new Date(2026, 2, 2, 12, 0).getTime());
    }
  });

  it('should generate candidates with initial score of 0', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 17, 0),
      },
    ];

    const item = makeItem({ duration: 60 });
    const candidates = generateCandidateSlots(item, timeline, [], defaultBuffer);

    for (const c of candidates) {
      expect(c.score).toBe(0);
    }
  });

  it('should enforce hard dependency constraint (no candidates before dependency end)', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 17, 0),
      },
    ];

    // Dependency is placed at 10:00-11:00
    const existingPlacements = new Map<string, TimeSlot>();
    existingPlacements.set('dep-item', {
      start: new Date(2026, 2, 2, 10, 0),
      end: new Date(2026, 2, 2, 11, 0),
    });

    const item = makeItem({
      duration: 30,
      dependsOn: 'dep-item',
    });

    const candidates = generateCandidateSlots(
      item,
      timeline,
      [],
      defaultBuffer,
      existingPlacements,
      'dep-item',
    );

    // All candidates should start at or after 11:00
    for (const c of candidates) {
      expect(c.start.getTime()).toBeGreaterThanOrEqual(new Date(2026, 2, 2, 11, 0).getTime());
    }

    // And there should be candidates available
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('should allow candidates after dependency end regardless of calendar day', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 17, 0),
      },
      {
        start: new Date(2026, 2, 3, 9, 0),
        end: new Date(2026, 2, 3, 17, 0),
      },
    ];

    // Dependency is placed on March 2 at 14:00-15:00
    const existingPlacements = new Map<string, TimeSlot>();
    existingPlacements.set('dep-item', {
      start: new Date(2026, 2, 2, 14, 0),
      end: new Date(2026, 2, 2, 15, 0),
    });

    const item = makeItem({
      duration: 30,
      timeWindow: {
        start: new Date(2026, 2, 3, 9, 0),
        end: new Date(2026, 2, 3, 17, 0),
      },
      dependsOn: 'dep-item',
    });

    const candidates = generateCandidateSlots(
      item,
      timeline,
      [],
      defaultBuffer,
      existingPlacements,
      'dep-item',
    );

    // Should have candidates on March 3 (different day, no restriction)
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.start.getDate()).toBe(3); // March 3
    }
  });

  it('should not filter candidates when dependency is not yet placed', () => {
    const timeline: TimeSlot[] = [
      {
        start: new Date(2026, 2, 2, 9, 0),
        end: new Date(2026, 2, 2, 17, 0),
      },
    ];

    const existingPlacements = new Map<string, TimeSlot>();
    // dep-item not in the map

    const item = makeItem({
      duration: 30,
      dependsOn: 'dep-item',
    });

    const candidatesWithDep = generateCandidateSlots(
      item,
      timeline,
      [],
      defaultBuffer,
      existingPlacements,
      'dep-item',
    );

    const candidatesWithout = generateCandidateSlots(item, timeline, [], defaultBuffer);

    // Both should have the same number of candidates
    expect(candidatesWithDep.length).toBe(candidatesWithout.length);
  });
});
