import {
  CandidateSlot,
  ItemType,
  ScheduleItem,
  TimeSlot,
  BufferConfig,
  SCORE_WEIGHTS,
  IDEAL_TIME_SIGMA_USER_SET,
  IDEAL_TIME_SIGMA_AUTO,
  MINUTES_PER_DAY,
  BUFFER_IDEAL_GAP_MULTIPLIER,
  CONTINUITY_NEUTRAL_SCORE,
  CONTINUITY_MAX_GAP_MINUTES,
  TOD_BELL_CENTER,
  TOD_BELL_SPREAD,
} from '@fluxure/shared';
import {
  isSameDayInTz,
  toDateStr,
  parseTimeToMinutes,
  minutesSinceMidnightInTz,
} from '@fluxure/shared';

/**
 * Score a candidate slot for a given schedule item.
 *
 * When idealTime is explicitly set by the user, ideal-time proximity
 * dominates (55 pts) and the generic time-of-day bias is suppressed.
 * Otherwise the original balanced weights apply.
 *
 * Scoring factors (total 0-100):
 *  With idealTime:       Without idealTime:
 *  - Ideal time: 55      - Ideal time: 40
 *  - Buffer:     20      - Buffer:     25
 *  - Continuity: 20      - Continuity: 20
 *  - Time-of-day: 5      - Time-of-day: 15
 */
export function scoreSlot(
  slot: CandidateSlot,
  item: ScheduleItem,
  existingPlacements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
  tz?: string,
  placementsByDay?: Map<string, TimeSlot[]>,
  precomputedIdealMinutes?: number,
): number {
  let score = 0;

  const hasIdealTime = !!item.idealTime && /^\d{1,2}:\d{2}$/.test(item.idealTime);
  // Habits and meetings have user-set preferred times; tasks/focus use auto-generated ones
  const userSetIdealTime =
    hasIdealTime && (item.type === ItemType.Habit || item.type === ItemType.Meeting);
  const weights = hasIdealTime ? SCORE_WEIGHTS.idealWithPref : SCORE_WEIGHTS.idealDefault;
  const wIdeal = weights.ideal;
  const wBuffer = weights.buffer;
  const wContinuity = weights.continuity;
  const wTimeOfDay = weights.tod;

  score +=
    scoreIdealTimeProximity(slot, item, userSetIdealTime, tz, precomputedIdealMinutes) * wIdeal;

  score +=
    (item.skipBuffer
      ? 0.5
      : scoreBufferCompliance(slot, existingPlacements, bufferConfig, tz, placementsByDay)) *
    wBuffer;

  score += scoreContinuity(slot, item, existingPlacements, tz) * wContinuity;

  score += scoreTimeOfDay(slot, item) * wTimeOfDay;

  // Round to 2 decimal places for deterministic score comparison.
  // Without rounding, floating-point imprecision can cause unstable sort order.
  return Math.round(score * 100) / 100;
}

/**
 * Score proximity to ideal time (0-1 scale).
 * Ideal time is an HH:MM preference. The closer the slot start is, the better.
 *
 * Uses a Gaussian decay. When the user explicitly sets a preferred time,
 * a tighter sigma (45 min) makes it a strong attractor. For auto-generated
 * ideal times (e.g. task chunks), a wider sigma (75 min) keeps placement flexible.
 */
function scoreIdealTimeProximity(
  slot: CandidateSlot,
  item: ScheduleItem,
  userSet: boolean,
  tz?: string,
  precomputedIdealMinutes?: number,
): number {
  const idealMinutes = precomputedIdealMinutes ?? parseTimeToMinutes(item.idealTime);
  if (idealMinutes === null) return 0; // invalid idealTime, no proximity score
  const slotMinutes = minutesSinceMidnightInTz(slot.start, tz);

  const rawDiff = Math.abs(slotMinutes - idealMinutes);
  const diff = Math.min(rawDiff, MINUTES_PER_DAY - rawDiff);

  // Tighter sigma for user-set preferred times, wider for auto-generated
  const sigma = userSet ? IDEAL_TIME_SIGMA_USER_SET : IDEAL_TIME_SIGMA_AUTO;
  return Math.exp(-(diff * diff) / (2 * sigma * sigma));
}

/**
 * Score buffer compliance (0-1 scale).
 * Checks how well the candidate respects buffers around existing placements.
 * Full score if the nearest neighbor is more than double the required buffer.
 * Proportional score otherwise.
 */
function scoreBufferCompliance(
  slot: CandidateSlot,
  existingPlacements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
  tz?: string,
  placementsByDay?: Map<string, TimeSlot[]>,
): number {
  if (existingPlacements.size === 0) {
    return 1; // No neighbors, full compliance
  }

  const requiredBufferMs = bufferConfig.breakBetweenItemsMinutes * 60 * 1000;
  if (requiredBufferMs === 0) {
    return 1;
  }

  // Use pre-indexed placements by day when available for performance
  let sameDayPlacements: TimeSlot[];
  if (placementsByDay && tz) {
    const dayKey = toDateStr(slot.start, tz);
    sameDayPlacements = placementsByDay.get(dayKey) ?? [];
  } else {
    sameDayPlacements = [];
    for (const [, placement] of existingPlacements) {
      if (isSameDayInTz(slot.start, placement.start, tz)) {
        sameDayPlacements.push(placement);
      }
    }
  }

  let nearestGapMs = Infinity;

  for (const placement of sameDayPlacements) {
    // Gap before: placement ends before slot starts
    if (placement.end.getTime() <= slot.start.getTime()) {
      const gap = slot.start.getTime() - placement.end.getTime();
      nearestGapMs = Math.min(nearestGapMs, gap);
    }

    // Gap after: slot ends before placement starts
    if (slot.end.getTime() <= placement.start.getTime()) {
      const gap = placement.start.getTime() - slot.end.getTime();
      nearestGapMs = Math.min(nearestGapMs, gap);
    }
  }

  if (nearestGapMs === Infinity) {
    return 1; // No same-day neighbors
  }

  // Perfect score if gap >= 2x required buffer, proportional otherwise
  const idealGap = requiredBufferMs * BUFFER_IDEAL_GAP_MULTIPLIER;
  return Math.min(nearestGapMs / idealGap, 1);
}

/**
 * Score continuity with related/dependent items (0-1 scale).
 * If the item depends on another item, it should be placed after it
 * on the same day, ideally close to it.
 */
function scoreContinuity(
  slot: CandidateSlot,
  item: ScheduleItem,
  existingPlacements: Map<string, TimeSlot>,
  tz?: string,
): number {
  if (!item.dependsOn) {
    return CONTINUITY_NEUTRAL_SCORE; // Neutral — no dependency
  }

  const dependency = existingPlacements.get(item.dependsOn);
  if (!dependency) {
    return CONTINUITY_NEUTRAL_SCORE; // Dependency not yet placed — neutral
  }

  // Must be on the same day
  if (!isSameDayInTz(slot.start, dependency.start, tz)) {
    return 0; // Wrong day — worst score
  }

  // Must be after the dependency
  if (slot.start.getTime() < dependency.end.getTime()) {
    return 0; // Before dependency — worst score
  }

  // Score by proximity: closer is better (within 4 hours = 240 min)
  const gapMinutes = (slot.start.getTime() - dependency.end.getTime()) / (1000 * 60);
  const maxDesiredGap = CONTINUITY_MAX_GAP_MINUTES;
  const proximity = 1 - Math.min(gapMinutes / maxDesiredGap, 1);

  return proximity;
}

/**
 * Score time-of-day preference (0-1 scale).
 * Items scheduled within the middle of their allowed window get slightly
 * higher scores than those at the edges.
 *
 * The bell curve centered at 0.3 assumes standard daytime windows. For overnight
 * or inverted windows, this "prefer early" heuristic may not be ideal, but ideal
 * time proximity (scored separately) is the dominant signal, so the impact is minimal.
 */
function scoreTimeOfDay(slot: CandidateSlot, item: ScheduleItem): number {
  const windowStart = item.timeWindow.start.getTime();
  const windowEnd = item.timeWindow.end.getTime();
  const windowDuration = windowEnd - windowStart;

  if (windowDuration <= 0) {
    return 0.5;
  }

  const slotStart = slot.start.getTime();
  const position = (slotStart - windowStart) / windowDuration;

  // Bell curve centered at 0.3 — slightly favor early-in-window placement
  const center = TOD_BELL_CENTER;
  const spread = TOD_BELL_SPREAD;
  const normalized = Math.exp(-Math.pow(position - center, 2) / (2 * spread * spread));

  return normalized;
}
