import { describe, it, expect } from 'vitest';
import { generateCandidateSlots, slotsOverlap } from '../slots.js';
import { ScheduleItem, TimeSlot, BufferConfig, ItemType, Priority } from '@fluxure/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultBuffer: BufferConfig = { breakBetweenItemsMinutes: 0 };

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

function slot(startH: number, startM: number, endH: number, endM: number, day = 2): TimeSlot {
  return {
    start: new Date(2026, 2, day, startH, startM),
    end: new Date(2026, 2, day, endH, endM),
  };
}

// ---------------------------------------------------------------------------
// slotsOverlap
// ---------------------------------------------------------------------------

describe('slotsOverlap', () => {
  it('detects overlapping slots', () => {
    expect(slotsOverlap(slot(9, 0, 10, 0), slot(9, 30, 10, 30))).toBe(true);
  });

  it('does not treat adjacent (touching) slots as overlapping', () => {
    expect(slotsOverlap(slot(9, 0, 10, 0), slot(10, 0, 11, 0))).toBe(false);
  });

  it('does not detect non-overlapping slots', () => {
    expect(slotsOverlap(slot(9, 0, 10, 0), slot(11, 0, 12, 0))).toBe(false);
  });

  it('detects containment in both directions', () => {
    const outer = slot(9, 0, 12, 0);
    const inner = slot(10, 0, 11, 0);
    expect(slotsOverlap(outer, inner)).toBe(true);
    expect(slotsOverlap(inner, outer)).toBe(true);
  });

  it('detects identical slots as overlapping', () => {
    const s = slot(9, 0, 10, 0);
    expect(slotsOverlap(s, s)).toBe(true);
  });

  it('handles zero-duration slots (start === end) as non-overlapping', () => {
    const zero: TimeSlot = { start: new Date(2026, 2, 2, 10, 0), end: new Date(2026, 2, 2, 10, 0) };
    const normal = slot(9, 0, 11, 0);
    // A zero-duration slot has start === end, so a.start < b.end && b.start < a.end
    // 10:00 < 11:00 = true, 9:00 < 10:00 = true → overlaps (point inside range)
    expect(slotsOverlap(zero, normal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateCandidateSlots — basic generation
// ---------------------------------------------------------------------------

describe('generateCandidateSlots', () => {
  it('generates correct count for a 30-min item in an 8-hour window (15-min step)', () => {
    const timeline = [slot(9, 0, 17, 0)];
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

    // 480 min window, 30 min duration, 15 min step → (480-30)/15 + 1 = 31
    expect(candidates).toHaveLength(31);
    for (const c of candidates) {
      expect(c.end.getTime() - c.start.getTime()).toBe(30 * 60_000);
    }
  });

  it('generates candidates at default step (CANDIDATE_STEP_MINUTES = 30)', () => {
    const timeline = [slot(9, 0, 12, 0)];
    const item = makeItem({ duration: 30 });

    const candidates = generateCandidateSlots(item, timeline, [], defaultBuffer);

    // 180 min window, 30 min duration, 30 min step → (180-30)/30 + 1 = 6
    expect(candidates).toHaveLength(6);
  });

  it('returns empty when duration exceeds available window', () => {
    const timeline = [slot(9, 0, 9, 15)];
    const item = makeItem({ duration: 30 });

    expect(generateCandidateSlots(item, timeline, [], defaultBuffer)).toHaveLength(0);
  });

  it('returns empty for zero-duration item', () => {
    const timeline = [slot(9, 0, 17, 0)];
    const item = makeItem({ duration: 0 });

    expect(generateCandidateSlots(item, timeline, [], defaultBuffer)).toHaveLength(0);
  });

  it('returns empty for negative-duration item', () => {
    const timeline = [slot(9, 0, 17, 0)];
    const item = makeItem({ duration: -10 });

    expect(generateCandidateSlots(item, timeline, [], defaultBuffer)).toHaveLength(0);
  });

  it('initializes all candidate scores to 0', () => {
    const timeline = [slot(9, 0, 17, 0)];
    const item = makeItem({ duration: 60 });
    const candidates = generateCandidateSlots(item, timeline, [], defaultBuffer);

    for (const c of candidates) {
      expect(c.score).toBe(0);
    }
  });

  // ---------------------------------------------------------------------------
  // Time window constraints
  // ---------------------------------------------------------------------------

  it('constrains candidates to the item time window (narrower than timeline)', () => {
    const timeline = [slot(7, 0, 22, 0)];
    const item = makeItem({
      duration: 30,
      timeWindow: { start: new Date(2026, 2, 2, 10, 0), end: new Date(2026, 2, 2, 12, 0) },
    });

    const candidates = generateCandidateSlots(item, timeline, [], defaultBuffer);

    for (const c of candidates) {
      expect(c.start.getTime()).toBeGreaterThanOrEqual(new Date(2026, 2, 2, 10, 0).getTime());
      expect(c.end.getTime()).toBeLessThanOrEqual(new Date(2026, 2, 2, 12, 0).getTime());
    }
    expect(candidates.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // Multiple timeline segments
  // ---------------------------------------------------------------------------

  it('generates candidates across multiple timeline segments', () => {
    const timeline = [slot(9, 0, 10, 0), slot(14, 0, 15, 0)];
    const item = makeItem({
      duration: 30,
      timeWindow: { start: new Date(2026, 2, 2, 8, 0), end: new Date(2026, 2, 2, 16, 0) },
    });

    const candidates = generateCandidateSlots(item, timeline, [], defaultBuffer);

    // Each 1-hour segment fits 2 candidates at 30-min step: (60-30)/30+1 = 2
    expect(candidates).toHaveLength(4);

    const morningSlots = candidates.filter((c) => c.start.getHours() < 12);
    const afternoonSlots = candidates.filter((c) => c.start.getHours() >= 12);
    expect(morningSlots).toHaveLength(2);
    expect(afternoonSlots).toHaveLength(2);
  });

  // ---------------------------------------------------------------------------
  // Occupied slot filtering
  // ---------------------------------------------------------------------------

  it('filters out candidates that overlap occupied slots', () => {
    const timeline = [slot(9, 0, 12, 0)];
    const occupied = [slot(10, 0, 11, 0)];
    const item = makeItem({ duration: 30 });

    const candidates = generateCandidateSlots(item, timeline, occupied, defaultBuffer);

    for (const c of candidates) {
      expect(slotsOverlap(c, occupied[0])).toBe(false);
    }
  });

  it('filters correctly with multiple occupied slots', () => {
    const timeline = [slot(9, 0, 17, 0)];
    const occupied = [slot(10, 0, 10, 30), slot(14, 0, 15, 0)];
    const item = makeItem({ duration: 30 });

    const candidates = generateCandidateSlots(item, timeline, occupied, defaultBuffer);

    for (const c of candidates) {
      for (const occ of occupied) {
        expect(slotsOverlap(c, occ)).toBe(false);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // Buffer between items
  // ---------------------------------------------------------------------------

  it('respects buffer between items', () => {
    const timeline = [slot(9, 0, 12, 0)];
    const occupied = [slot(10, 0, 10, 30)];
    const bufferConfig: BufferConfig = { breakBetweenItemsMinutes: 15 };
    const item = makeItem({ duration: 30 });

    const candidates = generateCandidateSlots(item, timeline, occupied, bufferConfig);

    for (const c of candidates) {
      const endsBeforeBuffer = c.end.getTime() <= new Date(2026, 2, 2, 9, 45).getTime();
      const startsAfterBuffer = c.start.getTime() >= new Date(2026, 2, 2, 10, 45).getTime();
      expect(endsBeforeBuffer || startsAfterBuffer).toBe(true);
    }
  });

  it('skips buffer when item has skipBuffer: true', () => {
    const timeline = [slot(9, 0, 12, 0)];
    const occupied = [slot(10, 0, 10, 30)];
    const bufferConfig: BufferConfig = { breakBetweenItemsMinutes: 15 };

    const itemWithBuffer = makeItem({ duration: 30 });
    const itemSkipBuffer = makeItem({ duration: 30, skipBuffer: true });

    const withBuffer = generateCandidateSlots(itemWithBuffer, timeline, occupied, bufferConfig);
    const skipped = generateCandidateSlots(itemSkipBuffer, timeline, occupied, bufferConfig);

    // Skipping buffer should produce more candidates (less exclusion zone)
    expect(skipped.length).toBeGreaterThan(withBuffer.length);
  });

  // ---------------------------------------------------------------------------
  // Dependency constraints
  // ---------------------------------------------------------------------------

  it('enforces hard dependency — no candidates before dependency end', () => {
    const timeline = [slot(9, 0, 17, 0)];
    const placements = new Map<string, TimeSlot>();
    placements.set('dep-item', slot(10, 0, 11, 0));

    const item = makeItem({ duration: 30, dependsOn: 'dep-item' });
    const candidates = generateCandidateSlots(
      item,
      timeline,
      [],
      defaultBuffer,
      placements,
      'dep-item',
    );

    for (const c of candidates) {
      expect(c.start.getTime()).toBeGreaterThanOrEqual(new Date(2026, 2, 2, 11, 0).getTime());
    }
    expect(candidates.length).toBeGreaterThan(0);
  });

  it('allows candidates on a later day even if dependency is on a previous day', () => {
    const timeline = [slot(9, 0, 17, 0, 2), slot(9, 0, 17, 0, 3)];
    const placements = new Map<string, TimeSlot>();
    placements.set('dep-item', slot(14, 0, 15, 0, 2));

    const item = makeItem({
      duration: 30,
      dependsOn: 'dep-item',
      timeWindow: { start: new Date(2026, 2, 3, 9, 0), end: new Date(2026, 2, 3, 17, 0) },
    });

    const candidates = generateCandidateSlots(
      item,
      timeline,
      [],
      defaultBuffer,
      placements,
      'dep-item',
    );

    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) {
      expect(c.start.getDate()).toBe(3);
    }
  });

  it('does not filter when dependency is not yet placed', () => {
    const timeline = [slot(9, 0, 17, 0)];
    const placements = new Map<string, TimeSlot>();
    const item = makeItem({ duration: 30, dependsOn: 'dep-item' });

    const withDep = generateCandidateSlots(
      item,
      timeline,
      [],
      defaultBuffer,
      placements,
      'dep-item',
    );
    const without = generateCandidateSlots(item, timeline, [], defaultBuffer);

    expect(withDep.length).toBe(without.length);
  });

  // ---------------------------------------------------------------------------
  // isSorted optimization parameter
  // ---------------------------------------------------------------------------

  it('produces identical results with isSorted=true when occupied are pre-sorted', () => {
    const timeline = [slot(9, 0, 17, 0)];
    const occupied = [slot(10, 0, 10, 30), slot(13, 0, 14, 0)]; // already sorted
    const item = makeItem({ duration: 30 });

    const normal = generateCandidateSlots(item, timeline, occupied, defaultBuffer);
    const sorted = generateCandidateSlots(
      item,
      timeline,
      occupied,
      defaultBuffer,
      undefined,
      undefined,
      undefined,
      30,
      true,
    );

    expect(sorted.length).toBe(normal.length);
    for (let i = 0; i < normal.length; i++) {
      expect(sorted[i].start.getTime()).toBe(normal[i].start.getTime());
    }
  });
});
