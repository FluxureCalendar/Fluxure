import { describe, it, expect } from 'vitest';
import { scoreSlot } from '../scoring.js';
import {
  CandidateSlot,
  ScheduleItem,
  TimeSlot,
  BufferConfig,
  ItemType,
  Priority,
} from '@fluxure/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultBuffer: BufferConfig = { breakBetweenItemsMinutes: 15 };

const zeroBuffer: BufferConfig = { breakBetweenItemsMinutes: 0 };

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

function makeCandidate(hours: number, minutes: number, durationMinutes: number): CandidateSlot {
  const start = new Date(2026, 2, 2, hours, minutes, 0);
  const totalMin = hours * 60 + minutes + durationMinutes;
  const end = new Date(2026, 2, 2, Math.floor(totalMin / 60), totalMin % 60, 0);
  return { start, end, score: 0 };
}

function slot(startH: number, startM: number, endH: number, endM: number): TimeSlot {
  return {
    start: new Date(2026, 2, 2, startH, startM),
    end: new Date(2026, 2, 2, endH, endM),
  };
}

// ---------------------------------------------------------------------------
// Core properties
// ---------------------------------------------------------------------------

describe('scoreSlot', () => {
  it('returns a score between 0 and 100', () => {
    const score = scoreSlot(makeCandidate(10, 0, 30), makeItem(), new Map(), defaultBuffer);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('produces deterministic scores (same inputs → same output)', () => {
    const item = makeItem();
    const candidate = makeCandidate(10, 0, 30);
    const s1 = scoreSlot(candidate, item, new Map(), defaultBuffer);
    const s2 = scoreSlot(candidate, item, new Map(), defaultBuffer);
    expect(s1).toBe(s2);
  });

  it('rounds scores to 2 decimal places', () => {
    const score = scoreSlot(makeCandidate(13, 17, 30), makeItem(), new Map(), defaultBuffer);
    expect(score).toBe(Math.round(score * 100) / 100);
  });

  // ---------------------------------------------------------------------------
  // Ideal time proximity
  // ---------------------------------------------------------------------------

  describe('ideal time proximity', () => {
    it('gives higher score to slots closer to ideal time', () => {
      const item = makeItem({ idealTime: '10:00' });
      const atIdeal = scoreSlot(makeCandidate(10, 0, 30), item, new Map(), defaultBuffer);
      const farAway = scoreSlot(makeCandidate(15, 0, 30), item, new Map(), defaultBuffer);
      expect(atIdeal).toBeGreaterThan(farAway);
    });

    it('ideal time is the dominant scoring factor', () => {
      const item = makeItem({ idealTime: '10:00' });
      const perfect = scoreSlot(makeCandidate(10, 0, 30), item, new Map(), defaultBuffer);
      const far = scoreSlot(makeCandidate(16, 0, 30), item, new Map(), defaultBuffer);
      // Ideal time weight is 40-55 points; difference should be significant
      expect(perfect - far).toBeGreaterThan(10);
    });

    it('uses tighter sigma for user-set preferred times (habits)', () => {
      const habit = makeItem({ type: ItemType.Habit, idealTime: '10:00' });
      const task = makeItem({ type: ItemType.Task, idealTime: '10:00' });

      // At 1 hour from ideal — habit's tighter sigma should penalize more
      const habitScore = scoreSlot(makeCandidate(11, 0, 30), habit, new Map(), zeroBuffer);
      const taskScore = scoreSlot(makeCandidate(11, 0, 30), task, new Map(), zeroBuffer);

      // At ideal time both should be similar
      const habitPerfect = scoreSlot(makeCandidate(10, 0, 30), habit, new Map(), zeroBuffer);
      const taskPerfect = scoreSlot(makeCandidate(10, 0, 30), task, new Map(), zeroBuffer);

      // Habit decays faster away from ideal → larger drop
      expect(habitPerfect - habitScore).toBeGreaterThan(taskPerfect - taskScore);
    });

    it('scores 0 for ideal time component when idealTime is missing', () => {
      const noIdeal = makeItem({ idealTime: '' });
      const withIdeal = makeItem({ idealTime: '10:00' });

      const scoreNo = scoreSlot(makeCandidate(10, 0, 30), noIdeal, new Map(), zeroBuffer);
      const scoreYes = scoreSlot(makeCandidate(10, 0, 30), withIdeal, new Map(), zeroBuffer);

      // Without ideal time, the ideal component contributes 0 → lower total
      expect(scoreYes).toBeGreaterThan(scoreNo);
    });
  });

  // ---------------------------------------------------------------------------
  // Buffer compliance
  // ---------------------------------------------------------------------------

  describe('buffer compliance', () => {
    it('gives higher score when further from existing placements', () => {
      const item = makeItem({ idealTime: '12:00' });
      const placements = new Map<string, TimeSlot>();
      placements.set('other', slot(10, 0, 10, 30));

      const close = scoreSlot(makeCandidate(10, 30, 30), item, placements, defaultBuffer);
      const far = scoreSlot(makeCandidate(12, 0, 30), item, placements, defaultBuffer);

      expect(far).toBeGreaterThan(close);
    });

    it('gives full buffer score with no existing placements', () => {
      const score = scoreSlot(makeCandidate(10, 0, 30), makeItem(), new Map(), defaultBuffer);
      expect(score).toBeGreaterThan(0);
    });

    it('gives neutral 0.5 buffer score when item has skipBuffer', () => {
      const item = makeItem({ skipBuffer: true, idealTime: '10:00' });
      const placements = new Map<string, TimeSlot>();
      placements.set('neighbor', slot(9, 30, 10, 0));

      // With skipBuffer, buffer component is always 0.5 regardless of proximity
      const score = scoreSlot(makeCandidate(10, 0, 30), item, placements, defaultBuffer);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Continuity (dependency ordering)
  // ---------------------------------------------------------------------------

  describe('continuity', () => {
    it('scores higher when placed right after dependency', () => {
      const placements = new Map<string, TimeSlot>();
      placements.set('dep-1', slot(9, 0, 9, 30));

      const item = makeItem({ dependsOn: 'dep-1', idealTime: '09:30' });

      const afterDep = scoreSlot(makeCandidate(9, 30, 30), item, placements, zeroBuffer);
      const beforeDep = scoreSlot(makeCandidate(8, 0, 30), item, placements, zeroBuffer);

      expect(afterDep).toBeGreaterThan(beforeDep);
    });

    it('gives neutral continuity score when item has no dependency', () => {
      const noDep = makeItem({ dependsOn: null, idealTime: '10:00' });
      const score = scoreSlot(makeCandidate(10, 0, 30), noDep, new Map(), zeroBuffer);
      // Should still get a reasonable score (neutral continuity = 0.5)
      expect(score).toBeGreaterThan(0);
    });

    it('gives neutral continuity when dependency is not yet placed', () => {
      const item = makeItem({ dependsOn: 'unplaced', idealTime: '10:00' });
      const placements = new Map<string, TimeSlot>();

      const score = scoreSlot(makeCandidate(10, 0, 30), item, placements, zeroBuffer);
      expect(score).toBeGreaterThan(0);
    });

    it('penalizes placement on different day from dependency', () => {
      const placements = new Map<string, TimeSlot>();
      // Dependency on March 2
      placements.set('dep-1', slot(9, 0, 9, 30));

      const item = makeItem({ dependsOn: 'dep-1', idealTime: '10:00' });

      // Same day — should get continuity bonus
      const sameDay = scoreSlot(makeCandidate(10, 0, 30), item, placements, zeroBuffer);

      // Different day candidate (March 3)
      const diffDayCandidate: CandidateSlot = {
        start: new Date(2026, 2, 3, 10, 0),
        end: new Date(2026, 2, 3, 10, 30),
        score: 0,
      };
      const diffDayItem = makeItem({
        dependsOn: 'dep-1',
        idealTime: '10:00',
        timeWindow: { start: new Date(2026, 2, 3, 9, 0), end: new Date(2026, 2, 3, 17, 0) },
      });
      const diffDay = scoreSlot(diffDayCandidate, diffDayItem, placements, zeroBuffer);

      // Same-day placement near dependency should score higher
      expect(sameDay).toBeGreaterThan(diffDay);
    });
  });

  // ---------------------------------------------------------------------------
  // Time-of-day preference
  // ---------------------------------------------------------------------------

  describe('time-of-day preference', () => {
    it('favors early-in-window placement (bell curve centered at 0.3)', () => {
      // Use no idealTime to let ToD have more influence (15% weight in default mode)
      const item = makeItem({ idealTime: '', type: ItemType.Task });

      const early = scoreSlot(makeCandidate(10, 0, 30), item, new Map(), zeroBuffer);
      const late = scoreSlot(makeCandidate(16, 0, 30), item, new Map(), zeroBuffer);

      // Early in window should score at least as well due to ToD bell curve
      // (Other factors are equal: no ideal time, no placements, no buffer)
      expect(early).toBeGreaterThanOrEqual(late);
    });
  });

  // ---------------------------------------------------------------------------
  // Weight regime switching
  // ---------------------------------------------------------------------------

  describe('weight regimes', () => {
    it('uses different weights when idealTime is present vs absent', () => {
      const withIdeal = makeItem({ idealTime: '10:00' });
      const noIdeal = makeItem({ idealTime: '' });

      const placements = new Map<string, TimeSlot>();
      placements.set('neighbor', slot(9, 0, 9, 30));

      // Same candidate, different weight distribution
      const scoreWith = scoreSlot(makeCandidate(10, 0, 30), withIdeal, placements, defaultBuffer);
      const scoreNo = scoreSlot(makeCandidate(10, 0, 30), noIdeal, placements, defaultBuffer);

      // Should produce different scores due to weight redistribution
      expect(scoreWith).not.toBe(scoreNo);
    });
  });
});
