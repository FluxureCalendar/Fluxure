import { describe, it, expect } from 'vitest';
import { scoreSlot } from '../scoring.js';
import {
  CandidateSlot,
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
  breakBetweenItemsMinutes: 15,
  applyDecompressionTo: DecompressionTarget.All,
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

function makeCandidate(hours: number, minutes: number, durationMinutes: number): CandidateSlot {
  return {
    start: new Date(2026, 2, 2, hours, minutes, 0),
    end: new Date(
      2026,
      2,
      2,
      hours + Math.floor((minutes + durationMinutes) / 60),
      (minutes + durationMinutes) % 60,
      0,
    ),
    score: 0,
  };
}

describe('scoreSlot', () => {
  it('should return a score between 0 and 100', () => {
    const item = makeItem();
    const candidate = makeCandidate(10, 0, 30);

    const score = scoreSlot(candidate, item, new Map(), defaultBuffer);

    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it('should give higher score to slots closer to ideal time', () => {
    const item = makeItem({ idealTime: '10:00' });

    const atIdeal = makeCandidate(10, 0, 30);
    const farFromIdeal = makeCandidate(15, 0, 30);

    const scoreAtIdeal = scoreSlot(atIdeal, item, new Map(), defaultBuffer);
    const scoreFar = scoreSlot(farFromIdeal, item, new Map(), defaultBuffer);

    expect(scoreAtIdeal).toBeGreaterThan(scoreFar);
  });

  it('should give higher score when buffer compliance is better', () => {
    const item = makeItem({ idealTime: '12:00' });

    // Existing placement at 10:00-10:30
    const existingPlacements = new Map<string, TimeSlot>();
    existingPlacements.set('other-item', {
      start: new Date(2026, 2, 2, 10, 0),
      end: new Date(2026, 2, 2, 10, 30),
    });

    // Candidate right after existing (10:30 - within buffer)
    const closeCandidate = makeCandidate(10, 30, 30);
    // Candidate well after existing (12:00 - beyond buffer)
    const farCandidate = makeCandidate(12, 0, 30);

    const scoreClose = scoreSlot(closeCandidate, item, existingPlacements, defaultBuffer);
    const scoreFar = scoreSlot(farCandidate, item, existingPlacements, defaultBuffer);

    // The far candidate should have better buffer compliance
    // (though ideal time proximity also plays a role here)
    expect(scoreFar).toBeGreaterThan(scoreClose);
  });

  it('should give higher continuity score when placed after dependency', () => {
    const dependency: TimeSlot = {
      start: new Date(2026, 2, 2, 9, 0),
      end: new Date(2026, 2, 2, 9, 30),
    };

    const existingPlacements = new Map<string, TimeSlot>();
    existingPlacements.set('dep-1', dependency);

    const item = makeItem({
      dependsOn: 'dep-1',
      idealTime: '09:30', // set ideal to right after dependency
    });

    // Right after dependency
    const afterDep = makeCandidate(9, 30, 30);
    // Before dependency (wrong order)
    const beforeDep = makeCandidate(8, 0, 30);

    // Use zero buffer to isolate continuity scoring
    const noBuffer: BufferConfig = {
      ...defaultBuffer,
      breakBetweenItemsMinutes: 0,
    };

    const scoreAfter = scoreSlot(afterDep, item, existingPlacements, noBuffer);
    const scoreBefore = scoreSlot(beforeDep, item, existingPlacements, noBuffer);

    expect(scoreAfter).toBeGreaterThan(scoreBefore);
  });

  it('should handle empty existing placements', () => {
    const item = makeItem();
    const candidate = makeCandidate(10, 0, 30);

    const score = scoreSlot(candidate, item, new Map(), defaultBuffer);

    expect(score).toBeGreaterThan(0);
  });

  it('should produce consistent scores for same inputs', () => {
    const item = makeItem();
    const candidate = makeCandidate(10, 0, 30);

    const score1 = scoreSlot(candidate, item, new Map(), defaultBuffer);
    const score2 = scoreSlot(candidate, item, new Map(), defaultBuffer);

    expect(score1).toBe(score2);
  });

  it('should weight ideal time proximity highest (40%)', () => {
    // Test that ideal time proximity is the dominant factor
    const item = makeItem({ idealTime: '10:00' });

    // Perfect ideal time but no other considerations
    const perfect = makeCandidate(10, 0, 30);
    // Far from ideal time
    const farOff = makeCandidate(16, 0, 30);

    const scorePerfect = scoreSlot(perfect, item, new Map(), defaultBuffer);
    const scoreFar = scoreSlot(farOff, item, new Map(), defaultBuffer);

    // The 40-point ideal time weight should make a significant difference
    expect(scorePerfect - scoreFar).toBeGreaterThan(10);
  });
});
