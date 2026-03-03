import {
  ScheduleItem,
  FocusTimeRule,
  BufferConfig,
  ItemType,
  QualityScore,
  QualityComponent,
  TimeSlot,
  QUALITY_WEIGHTS,
  QUALITY_IDEAL_MAX_DIFF_MINUTES,
  QUALITY_IDEAL_CLOSE_MINUTES,
  QUALITY_IDEAL_FAR_MINUTES,
  DAYS_PER_WEEK,
  MINUTES_PER_DAY,
} from '@fluxure/shared';
import { parseTimeToMinutes, minutesSinceMidnightInTz } from '@fluxure/shared';

/**
 * Calculate a schedule quality score from placed items and context.
 *
 * Pure function — no side effects or DB access.
 *
 * @param items        All ScheduleItems that were candidates for scheduling
 * @param placements   Map of itemId -> placed TimeSlot (items that got scheduled)
 * @param focusRules   Active focus time rules
 * @param bufferConfig Buffer/decompression settings
 * @param focusMinutesPlaced Actual focus minutes placed this period
 * @param tz           IANA timezone string
 */
export function calculateScheduleQuality(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  focusRules: FocusTimeRule[],
  bufferConfig: BufferConfig,
  focusMinutesPlaced: number,
  tz: string,
): QualityScore {
  const breakdown: string[] = [];

  const placement = scorePlacement(items, placements, breakdown);

  const idealTime = scoreIdealTime(items, placements, tz, breakdown);

  const focusTime = scoreFocusTime(focusRules, focusMinutesPlaced, breakdown);

  // Pre-sort placements once for buffer compliance scoring
  const sortedPlacementEntries = Array.from(placements.entries())
    .map(([id, slot]) => ({ id, startMs: slot.start.getTime(), endMs: slot.end.getTime() }))
    .sort((a, b) => a.startMs - b.startMs);
  const buffers = scoreBuffers(
    items,
    placements,
    bufferConfig,
    tz,
    breakdown,
    sortedPlacementEntries,
  );

  const priorities = scorePriorities(items, placements, breakdown);

  const overall = Math.round(
    placement.score * placement.weight +
      idealTime.score * idealTime.weight +
      focusTime.score * focusTime.weight +
      buffers.score * buffers.weight +
      priorities.score * priorities.weight,
  );

  return {
    overall,
    components: { placement, idealTime, focusTime, buffers, priorities },
    breakdown,
  };
}

function scorePlacement(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  breakdown: string[],
): QualityComponent {
  const total = items.length;
  if (total === 0) {
    return { score: 100, weight: QUALITY_WEIGHTS.placement, label: 'Placement Rate' };
  }

  const placed = items.filter((item) => placements.has(item.id)).length;
  const unplaced = total - placed;
  const score = Math.round((placed / total) * 100);

  if (unplaced > 0) {
    const byType = new Map<ItemType, number>();
    for (const item of items) {
      if (!placements.has(item.id)) {
        byType.set(item.type, (byType.get(item.type) ?? 0) + 1);
      }
    }
    for (const [type, count] of byType) {
      breakdown.push(`${count} ${type}${count > 1 ? 's' : ''} couldn't be scheduled`);
    }
  } else {
    breakdown.push('All items successfully scheduled');
  }

  return { score, weight: QUALITY_WEIGHTS.placement, label: 'Placement Rate' };
}

function scoreIdealTime(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  tz: string,
  breakdown: string[],
): QualityComponent {
  const placedItems = items.filter((item) => placements.has(item.id) && item.idealTime);
  if (placedItems.length === 0) {
    return { score: 100, weight: QUALITY_WEIGHTS.idealTime, label: 'Ideal Time' };
  }

  let totalScore = 0;
  let closeCount = 0;
  let farCount = 0;

  for (const item of placedItems) {
    const slot = placements.get(item.id)!;
    const idealMin = parseTimeToMinutes(item.idealTime);
    if (idealMin < 0) continue;
    const slotMin = minutesSinceMidnightInTz(slot.start, tz);
    const rawDiff = Math.abs(slotMin - idealMin);
    const diff = Math.min(rawDiff, MINUTES_PER_DAY - rawDiff);

    const itemScore = Math.max(0, 100 - (diff / QUALITY_IDEAL_MAX_DIFF_MINUTES) * 100);
    totalScore += itemScore;

    if (diff <= QUALITY_IDEAL_CLOSE_MINUTES) closeCount++;
    if (diff > QUALITY_IDEAL_FAR_MINUTES) farCount++;
  }

  const score = Math.round(totalScore / placedItems.length);

  if (closeCount > 0) {
    breakdown.push(
      `${closeCount} item${closeCount > 1 ? 's' : ''} placed within 30 min of ideal time`,
    );
  }
  if (farCount > 0) {
    breakdown.push(`${farCount} item${farCount > 1 ? 's' : ''} placed >2h from ideal time`);
  }

  return { score, weight: QUALITY_WEIGHTS.idealTime, label: 'Ideal Time' };
}

/**
 * Divides the weekly focus target by schedulableDays (e.g. 5 for working hours)
 * to derive a daily target when only a weekly total is configured.
 */
function scoreFocusTime(
  focusRules: FocusTimeRule[],
  focusMinutesPlaced: number,
  breakdown: string[],
  schedulableDays: number = 5,
): QualityComponent {
  const activeRules = focusRules.filter((r) => r.enabled);
  if (activeRules.length === 0) {
    return { score: 100, weight: QUALITY_WEIGHTS.focus, label: 'Focus Time' };
  }

  const effectiveDays = Math.max(1, Math.min(DAYS_PER_WEEK, schedulableDays));
  let targetDaily = activeRules.reduce((sum, r) => sum + (r.dailyTargetMinutes || 0), 0);
  if (targetDaily === 0) {
    const weeklyTotal = activeRules.reduce((sum, r) => sum + (r.weeklyTargetMinutes || 0), 0);
    if (weeklyTotal > 0) {
      targetDaily = weeklyTotal / effectiveDays;
    } else {
      return { score: 100, weight: QUALITY_WEIGHTS.focus, label: 'Focus Time' };
    }
  }

  const ratio = focusMinutesPlaced / targetDaily;
  const score = Math.min(100, Math.round(ratio * 100));
  const pct = Math.round(ratio * 100);
  breakdown.push(`Focus time ${pct}% of daily target`);

  return { score, weight: QUALITY_WEIGHTS.focus, label: 'Focus Time' };
}

/**
 * Check buffer compliance for all placed items.
 * Buffers between any adjacent items improve schedule quality.
 */
function scoreBuffers(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
  tz: string,
  breakdown: string[],
  preSortedPlacements?: Array<{ id: string; startMs: number; endMs: number }>,
): QualityComponent {
  const bufferedItems = items.filter((item) => placements.has(item.id) && !item.skipBuffer);

  if (bufferedItems.length === 0 || bufferConfig.breakBetweenItemsMinutes === 0) {
    return { score: 100, weight: QUALITY_WEIGHTS.buffers, label: 'Buffer Compliance' };
  }

  const requiredBufferMs = bufferConfig.breakBetweenItemsMinutes * 60 * 1000;
  let compliant = 0;

  const sortedPlacements =
    preSortedPlacements ??
    Array.from(placements.entries())
      .map(([id, slot]) => ({ id, startMs: slot.start.getTime(), endMs: slot.end.getTime() }))
      .sort((a, b) => a.startMs - b.startMs);

  for (const item of bufferedItems) {
    const slot = placements.get(item.id)!;
    const itemStartMs = slot.start.getTime();
    const itemEndMs = slot.end.getTime();
    let hasAdequateBuffer = true;

    let lo = 0,
      hi = sortedPlacements.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (sortedPlacements[mid].startMs < itemStartMs) lo = mid + 1;
      else hi = mid;
    }

    for (let i = lo - 1; i >= 0; i--) {
      const other = sortedPlacements[i];
      if (other.id === item.id) continue;
      const gap = itemStartMs - other.endMs;
      if (gap >= requiredBufferMs) break;
      if (gap >= 0 && gap < requiredBufferMs) {
        hasAdequateBuffer = false;
        break;
      }
    }

    if (hasAdequateBuffer) {
      for (let i = lo; i < sortedPlacements.length; i++) {
        const other = sortedPlacements[i];
        if (other.id === item.id) continue;
        const gap = other.startMs - itemEndMs;
        if (gap >= requiredBufferMs) break;
        if (gap >= 0 && gap < requiredBufferMs) {
          hasAdequateBuffer = false;
          break;
        }
      }
    }

    if (hasAdequateBuffer) compliant++;
  }

  const score = Math.round((compliant / bufferedItems.length) * 100);
  const noncompliant = bufferedItems.length - compliant;
  if (noncompliant > 0) {
    breakdown.push(`${noncompliant} item${noncompliant > 1 ? 's' : ''} missing buffer time`);
  } else {
    breakdown.push('All items have proper buffer time');
  }

  return { score, weight: QUALITY_WEIGHTS.buffers, label: 'Buffer Compliance' };
}

/**
 * Count inversions and total differing-priority pairs using a modified merge sort.
 * O(n log n) instead of O(n²). An inversion is when a lower-priority item
 * (higher number) appears before a higher-priority item (lower number).
 */
function countInversions(arr: number[]): { inversions: number; totalPairs: number } {
  const freqMap = new Map<number, number>();
  for (const v of arr) {
    freqMap.set(v, (freqMap.get(v) ?? 0) + 1);
  }
  const n = arr.length;
  const totalAllPairs = (n * (n - 1)) / 2;
  let samePriorityPairs = 0;
  for (const count of freqMap.values()) {
    samePriorityPairs += (count * (count - 1)) / 2;
  }
  const totalPairs = totalAllPairs - samePriorityPairs;

  function mergeSortCount(a: number[]): { sorted: number[]; inv: number } {
    if (a.length <= 1) return { sorted: a, inv: 0 };
    const mid = Math.floor(a.length / 2);
    const left = mergeSortCount(a.slice(0, mid));
    const right = mergeSortCount(a.slice(mid));
    let inv = left.inv + right.inv;
    const sorted: number[] = [];
    let i = 0,
      j = 0;
    while (i < left.sorted.length && j < right.sorted.length) {
      if (left.sorted[i] <= right.sorted[j]) {
        sorted.push(left.sorted[i++]);
      } else {
        // All remaining left elements are inversions relative to right[j]
        inv += left.sorted.length - i;
        sorted.push(right.sorted[j++]);
      }
    }
    while (i < left.sorted.length) sorted.push(left.sorted[i++]);
    while (j < right.sorted.length) sorted.push(right.sorted[j++]);
    return { sorted, inv };
  }

  // Equal elements go left-first (<=), so same-priority pairs are never counted as inversions
  const { inv: inversions } = mergeSortCount(arr);

  return { inversions, totalPairs };
}

function scorePriorities(
  items: ScheduleItem[],
  placements: Map<string, TimeSlot>,
  breakdown: string[],
): QualityComponent {
  const placedItems = items
    .filter((item) => placements.has(item.id))
    .map((item) => ({
      priority: item.priority,
      startMs: placements.get(item.id)!.start.getTime(),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  if (placedItems.length <= 1) {
    return { score: 100, weight: QUALITY_WEIGHTS.priorities, label: 'Priority Respect' };
  }

  const priorities = placedItems.map((p) => p.priority);
  const { inversions, totalPairs } = countInversions(priorities);

  if (totalPairs === 0) {
    return { score: 100, weight: QUALITY_WEIGHTS.priorities, label: 'Priority Respect' };
  }

  const inversionRate = inversions / totalPairs;
  const score = Math.round((1 - inversionRate) * 100);

  if (inversions > 0) {
    breakdown.push(`${inversions} priority inversion${inversions > 1 ? 's' : ''} detected`);
  } else {
    breakdown.push('Priority order fully respected');
  }

  return { score, weight: QUALITY_WEIGHTS.priorities, label: 'Priority Respect' };
}
