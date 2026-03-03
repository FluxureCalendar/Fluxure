import { describe, it, expect } from 'vitest';
import { computeFreeBusyStatus } from '../free-busy.js';
import { EventStatus, TimeSlot, CandidateSlot } from '@fluxure/shared';

function makeCandidate(startHour: number, startMin: number, durationMin: number): CandidateSlot {
  return {
    start: new Date(2026, 2, 2, startHour, startMin, 0),
    end: new Date(
      2026,
      2,
      2,
      startHour + Math.floor((startMin + durationMin) / 60),
      (startMin + durationMin) % 60,
      0,
    ),
    score: 50,
  };
}

describe('computeFreeBusyStatus', () => {
  const currentPlacement: TimeSlot = {
    start: new Date(2026, 2, 2, 10, 0, 0),
    end: new Date(2026, 2, 2, 10, 30, 0),
  };

  it('should return Locked when item is pinned (forced/locked)', () => {
    const now = new Date(2026, 2, 1, 12, 0, 0); // well before event
    const candidates = [
      makeCandidate(11, 0, 30),
      makeCandidate(12, 0, 30),
      makeCandidate(13, 0, 30),
    ];

    const status = computeFreeBusyStatus(
      'item-1',
      currentPlacement,
      candidates,
      now,
      true, // pinned
    );

    expect(status).toBe(EventStatus.Locked);
  });

  it('should return Busy when fewer than minAlternativeSlots alternatives', () => {
    const now = new Date(2026, 2, 1, 12, 0, 0);

    // Only 1 alternative (below threshold of 2)
    const candidates = [
      makeCandidate(10, 0, 30), // overlaps current, not an alternative
      makeCandidate(11, 0, 30), // 1 alternative
    ];

    const status = computeFreeBusyStatus('item-1', currentPlacement, candidates, now, false);

    expect(status).toBe(EventStatus.Busy);
  });

  it('should return Busy when close to start time', () => {
    // Now is only 1 hour before start (threshold is 2 hours)
    const now = new Date(2026, 2, 2, 9, 0, 0);

    // Plenty of alternatives
    const candidates = [
      makeCandidate(11, 0, 30),
      makeCandidate(12, 0, 30),
      makeCandidate(13, 0, 30),
      makeCandidate(14, 0, 30),
    ];

    const status = computeFreeBusyStatus('item-1', currentPlacement, candidates, now, false);

    expect(status).toBe(EventStatus.Busy);
  });

  it('should return Free when enough alternatives and far from start', () => {
    const now = new Date(2026, 2, 1, 12, 0, 0); // day before

    // More than enough alternatives
    const candidates = [
      makeCandidate(11, 0, 30),
      makeCandidate(12, 0, 30),
      makeCandidate(13, 0, 30),
    ];

    const status = computeFreeBusyStatus('item-1', currentPlacement, candidates, now, false);

    expect(status).toBe(EventStatus.Free);
  });

  it('should not count overlapping candidates as alternatives', () => {
    const now = new Date(2026, 2, 1, 12, 0, 0);

    // All candidates overlap with current placement
    const candidates = [
      makeCandidate(10, 0, 30), // exact overlap
      makeCandidate(10, 15, 30), // partial overlap
      makeCandidate(9, 45, 30), // partial overlap
    ];

    const status = computeFreeBusyStatus('item-1', currentPlacement, candidates, now, false);

    expect(status).toBe(EventStatus.Busy);
  });

  it('should return Free when exactly at the threshold', () => {
    // Exactly 2 hours before (at threshold boundary)
    const now = new Date(2026, 2, 2, 8, 0, 0);

    const candidates = [
      makeCandidate(11, 0, 30),
      makeCandidate(12, 0, 30),
      makeCandidate(13, 0, 30),
    ];

    const status = computeFreeBusyStatus('item-1', currentPlacement, candidates, now, false);

    // At exactly the threshold, should be Free (< comparison)
    expect(status).toBe(EventStatus.Free);
  });

  it('should return Busy when exactly at min alternative slots threshold', () => {
    const now = new Date(2026, 2, 1, 12, 0, 0);

    // Exactly 1 alternative (minAlternativeSlots is 2)
    const candidates = [makeCandidate(11, 0, 30)];

    const status = computeFreeBusyStatus('item-1', currentPlacement, candidates, now, false);

    expect(status).toBe(EventStatus.Busy);
  });

  it('should return Free when exactly at min alternative slots', () => {
    const now = new Date(2026, 2, 1, 12, 0, 0);

    // Exactly 2 alternatives (minAlternativeSlots is 2)
    const candidates = [makeCandidate(11, 0, 30), makeCandidate(12, 0, 30)];

    const status = computeFreeBusyStatus('item-1', currentPlacement, candidates, now, false);

    expect(status).toBe(EventStatus.Free);
  });
});
