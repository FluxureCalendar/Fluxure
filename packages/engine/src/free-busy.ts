import { EventStatus, TimeSlot, CandidateSlot } from '@fluxure/shared';
import { FLIP_THRESHOLDS } from '@fluxure/shared';
import { slotsOverlap } from './slots.js';

/**
 * Compute the Free/Busy/Locked status for a placed schedule item.
 *
 * Logic:
 * 1. If item is pinned (forced or event-locked): return Locked
 * 2. Count remaining alternative slots (candidates that don't overlap
 *    the current placement)
 * 3. If alternatives < FLIP_THRESHOLDS.minAlternativeSlots: return Busy
 * 4. If time until start < FLIP_THRESHOLDS.hoursBeforeStart hours: return Busy
 * 5. Otherwise: return Free
 */
export function computeFreeBusyStatus(
  currentPlacement: TimeSlot,
  allCandidateSlots: CandidateSlot[],
  now: Date,
  pinned: boolean = false,
): EventStatus {
  if (currentPlacement.end.getTime() <= now.getTime()) {
    return EventStatus.Completed;
  }

  if (pinned) {
    return EventStatus.Locked;
  }

  // In-progress events cannot be moved
  if (currentPlacement.start.getTime() <= now.getTime()) {
    return EventStatus.Busy;
  }

  const alternatives = allCandidateSlots.filter(
    (candidate) => !slotsOverlap(candidate, currentPlacement),
  );

  if (alternatives.length < FLIP_THRESHOLDS.minAlternativeSlots) {
    return EventStatus.Busy;
  }

  const hoursUntilStart = (currentPlacement.start.getTime() - now.getTime()) / (1000 * 60 * 60);
  if (hoursUntilStart < FLIP_THRESHOLDS.hoursBeforeStart) {
    return EventStatus.Busy;
  }

  return EventStatus.Free;
}
