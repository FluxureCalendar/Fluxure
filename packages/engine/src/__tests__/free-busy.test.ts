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

const placement: TimeSlot = {
  start: new Date(2026, 2, 2, 10, 0, 0),
  end: new Date(2026, 2, 2, 10, 30, 0),
};

const dayBefore = new Date(2026, 2, 1, 12, 0, 0);

const enoughAlternatives = [
  makeCandidate(11, 0, 30),
  makeCandidate(12, 0, 30),
  makeCandidate(13, 0, 30),
];

describe('computeFreeBusyStatus', () => {
  describe('Completed status', () => {
    it('should return Completed when event has already ended', () => {
      const now = new Date(2026, 2, 2, 11, 0, 0); // after 10:30 end
      const status = computeFreeBusyStatus(placement, enoughAlternatives, now, false);
      expect(status).toBe(EventStatus.Completed);
    });

    it('should return Completed when now equals event end time', () => {
      const now = new Date(2026, 2, 2, 10, 30, 0); // exactly at end
      const status = computeFreeBusyStatus(placement, enoughAlternatives, now, false);
      expect(status).toBe(EventStatus.Completed);
    });
  });

  describe('Locked status (pinned items)', () => {
    it('should return Locked when item is pinned', () => {
      const status = computeFreeBusyStatus(placement, enoughAlternatives, dayBefore, true);
      expect(status).toBe(EventStatus.Locked);
    });

    it('should return Locked regardless of alternatives when pinned', () => {
      const status = computeFreeBusyStatus(placement, [], dayBefore, true);
      expect(status).toBe(EventStatus.Locked);
    });
  });

  describe('In-progress events', () => {
    it('should return Busy when event is currently in progress', () => {
      const now = new Date(2026, 2, 2, 10, 15, 0); // mid-event
      const status = computeFreeBusyStatus(placement, enoughAlternatives, now, false);
      expect(status).toBe(EventStatus.Busy);
    });

    it('should return Busy when now equals event start time', () => {
      const now = new Date(2026, 2, 2, 10, 0, 0); // exactly at start
      const status = computeFreeBusyStatus(placement, enoughAlternatives, now, false);
      expect(status).toBe(EventStatus.Busy);
    });
  });

  describe('Alternative slot counting', () => {
    it('should return Busy when no candidates at all', () => {
      const status = computeFreeBusyStatus(placement, [], dayBefore, false);
      expect(status).toBe(EventStatus.Busy);
    });

    it('should return Busy with only 1 alternative (below threshold of 2)', () => {
      const candidates = [makeCandidate(11, 0, 30)];
      const status = computeFreeBusyStatus(placement, candidates, dayBefore, false);
      expect(status).toBe(EventStatus.Busy);
    });

    it('should return Free with exactly 2 alternatives (at threshold)', () => {
      const candidates = [makeCandidate(11, 0, 30), makeCandidate(12, 0, 30)];
      const status = computeFreeBusyStatus(placement, candidates, dayBefore, false);
      expect(status).toBe(EventStatus.Free);
    });

    it('should not count overlapping candidates as alternatives', () => {
      const candidates = [
        makeCandidate(10, 0, 30), // exact overlap
        makeCandidate(10, 15, 30), // partial overlap
        makeCandidate(9, 45, 30), // partial overlap (ends during placement)
      ];
      const status = computeFreeBusyStatus(placement, candidates, dayBefore, false);
      expect(status).toBe(EventStatus.Busy);
    });

    it('should count adjacent non-overlapping candidates as alternatives', () => {
      const candidates = [
        makeCandidate(9, 30, 30), // ends exactly at placement start (no overlap)
        makeCandidate(10, 30, 30), // starts exactly at placement end (no overlap)
      ];
      const status = computeFreeBusyStatus(placement, candidates, dayBefore, false);
      expect(status).toBe(EventStatus.Free);
    });

    it('should count only non-overlapping candidates even when mixed', () => {
      const candidates = [
        makeCandidate(10, 0, 30), // overlaps — not counted
        makeCandidate(10, 10, 30), // overlaps — not counted
        makeCandidate(11, 0, 30), // valid alternative
        makeCandidate(12, 0, 30), // valid alternative
      ];
      const status = computeFreeBusyStatus(placement, candidates, dayBefore, false);
      expect(status).toBe(EventStatus.Free);
    });
  });

  describe('Time proximity threshold', () => {
    it('should return Busy when only 1 hour before start', () => {
      const now = new Date(2026, 2, 2, 9, 0, 0);
      const status = computeFreeBusyStatus(placement, enoughAlternatives, now, false);
      expect(status).toBe(EventStatus.Busy);
    });

    it('should return Free at exactly 2 hours before start (boundary)', () => {
      const now = new Date(2026, 2, 2, 8, 0, 0);
      const status = computeFreeBusyStatus(placement, enoughAlternatives, now, false);
      expect(status).toBe(EventStatus.Free);
    });

    it('should return Busy at 1h59m before start (just under threshold)', () => {
      const now = new Date(2026, 2, 2, 8, 1, 0);
      const status = computeFreeBusyStatus(placement, enoughAlternatives, now, false);
      expect(status).toBe(EventStatus.Busy);
    });

    it('should return Free when well before start with enough alternatives', () => {
      const status = computeFreeBusyStatus(placement, enoughAlternatives, dayBefore, false);
      expect(status).toBe(EventStatus.Free);
    });
  });

  describe('Priority ordering (Completed > Locked > In-progress > alternatives > time)', () => {
    it('Completed takes priority over pinned', () => {
      const now = new Date(2026, 2, 2, 11, 0, 0); // after end
      const status = computeFreeBusyStatus(placement, [], now, true);
      expect(status).toBe(EventStatus.Completed);
    });

    it('Locked takes priority over in-progress', () => {
      const now = new Date(2026, 2, 2, 10, 15, 0); // mid-event
      const status = computeFreeBusyStatus(placement, [], now, true);
      // Completed check happens first (10:15 < 10:30 end), then pinned
      expect(status).toBe(EventStatus.Locked);
    });
  });

  describe('Real-world scenarios', () => {
    it('back-to-back meetings: limited alternatives → Busy', () => {
      // Packed schedule with only 1 non-overlapping slot
      const packedCandidates = [
        makeCandidate(10, 0, 30), // overlaps current
        makeCandidate(14, 0, 30), // only alternative
      ];
      const now = new Date(2026, 2, 1, 18, 0, 0);
      const status = computeFreeBusyStatus(placement, packedCandidates, now, false);
      expect(status).toBe(EventStatus.Busy);
    });

    it('open afternoon: plenty of alternatives → Free', () => {
      const openCandidates = [
        makeCandidate(13, 0, 30),
        makeCandidate(13, 30, 30),
        makeCandidate(14, 0, 30),
        makeCandidate(14, 30, 30),
        makeCandidate(15, 0, 30),
      ];
      const now = new Date(2026, 2, 1, 18, 0, 0);
      const status = computeFreeBusyStatus(placement, openCandidates, now, false);
      expect(status).toBe(EventStatus.Free);
    });

    it('lunch break slot as sole alternative is not enough', () => {
      const candidates = [
        makeCandidate(10, 0, 30), // overlaps
        makeCandidate(12, 0, 30), // lunch — only 1 alternative
      ];
      const now = new Date(2026, 2, 1, 18, 0, 0);
      const status = computeFreeBusyStatus(placement, candidates, now, false);
      expect(status).toBe(EventStatus.Busy);
    });
  });
});
