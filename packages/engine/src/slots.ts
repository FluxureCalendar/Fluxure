import {
  ScheduleItem,
  TimeSlot,
  CandidateSlot,
  BufferConfig,
  CANDIDATE_STEP_MINUTES,
} from '@fluxure/shared';

/**
 * Check whether two time slots overlap.
 */
export function slotsOverlap(a: TimeSlot, b: TimeSlot): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Generate candidate placement slots for a given ScheduleItem.
 *
 * 1. Walk the timeline and find slots that fall within the item's timeWindow.
 * 2. Within each available slot, slide a window of `item.duration` minutes
 *    to produce candidate placements.
 * 3. Filter out candidates that overlap with any occupied slot (including buffers).
 * 4. If dependsOn is set and the dependency is placed, filter out candidates
 *    that start before the dependency ends on the same day (hard constraint).
 * 5. Return candidates with an initial score of 0 (scoring happens later).
 */
export function generateCandidateSlots(
  item: ScheduleItem,
  timeline: TimeSlot[],
  occupiedSlots: TimeSlot[],
  bufferConfig: BufferConfig,
  existingPlacements?: Map<string, TimeSlot>,
  dependsOn?: string | null,
  tz?: string,
  stepMinutes: number = CANDIDATE_STEP_MINUTES,
  isSorted: boolean = false,
): CandidateSlot[] {
  const candidates: CandidateSlot[] = [];
  const durationMs = item.duration * 60 * 1000;
  if (durationMs <= 0) return candidates;
  const stepMs = stepMinutes * 60 * 1000;
  const bufferMs = item.skipBuffer ? 0 : bufferConfig.breakBetweenItemsMinutes * 60 * 1000;

  // Pre-sort occupied slots for binary search; skip when caller guarantees sort order
  const mapped = occupiedSlots.map((s) => ({
    startMs: s.start.getTime() - bufferMs,
    endMs: s.end.getTime() + bufferMs,
  }));
  const sortedOccupied = isSorted ? mapped : mapped.sort((a, b) => a.startMs - b.startMs);

  // Resolve dependency placement for hard constraint
  const depPlacement =
    dependsOn && existingPlacements ? (existingPlacements.get(dependsOn) ?? null) : null;

  for (const slot of timeline) {
    const windowStart = Math.max(slot.start.getTime(), item.timeWindow.start.getTime());
    const windowEnd = Math.min(slot.end.getTime(), item.timeWindow.end.getTime());

    if (windowEnd - windowStart < durationMs) {
      continue;
    }

    // Slide a duration-sized window, snapped to the step grid.
    // Grid snapping to stepMs intervals is intentional: it keeps scoring deterministic
    // (identical inputs always produce the same candidate set) and bounds the number of
    // candidates to O(windowDuration / stepMs). The trade-off is that in tight windows
    // where (windowEnd - windowStart - durationMs) < stepMs, a valid placement can be
    // skipped because the single grid-aligned candidate overshoots the window boundary.
    let candidateStart = Math.ceil(windowStart / stepMs) * stepMs;
    while (candidateStart + durationMs <= windowEnd) {
      const candidateEnd = candidateStart + durationMs;

      // Binary search for overlapping occupied slots (with buffer padding)
      let hasConflict = false;
      let lo = 0,
        hi = sortedOccupied.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (sortedOccupied[mid].startMs < candidateEnd) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      // Check backwards for any slot whose end extends past candidateStart
      for (let i = lo - 1; i >= 0; i--) {
        if (sortedOccupied[i].endMs <= candidateStart) break;
        hasConflict = true;
        break;
      }

      // Hard dependency constraint: candidate must start after the dependency ends.
      // For task chunks (chunk1 depends on chunk0), this is absolute — chunk1 cannot
      // be placed before chunk0 on any day. For habits, the dependency ID is day-specific
      // (e.g., habit-id__2026-03-02) so the placement is inherently same-day.
      const violatesDependency =
        depPlacement != null && candidateStart < depPlacement.end.getTime();

      if (!hasConflict && !violatesDependency) {
        candidates.push({
          start: new Date(candidateStart),
          end: new Date(candidateEnd),
          score: 0,
        });
      }

      candidateStart += stepMs;
    }
  }

  return candidates;
}
