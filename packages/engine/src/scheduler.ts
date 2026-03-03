import type BTree from 'sorted-btree';
import BTreeModule from 'sorted-btree';
// sorted-btree CJS/ESM interop: default export is the namespace in ESM runtime
const BTreeClass = (
  typeof BTreeModule === 'function'
    ? BTreeModule
    : (BTreeModule as unknown as { default: typeof BTreeModule }).default
) as typeof BTreeModule;
if (typeof BTreeClass !== 'function') {
  throw new Error('sorted-btree interop failed: BTreeClass is not a constructor');
}
import {
  Habit,
  Task,
  SmartMeeting,
  FocusTimeRule,
  CalendarEvent,
  BufferConfig,
  UserSettings,
  ScheduleResult,
  ScheduleItem,
  TimeSlot,
  CandidateSlot,
  ItemType,
  Priority,
  EventStatus,
  TaskStatus,
} from '@fluxure/shared';
import {
  DAYS_PER_WEEK,
  DEFAULT_SCHEDULING_WINDOW_DAYS,
  MAX_SCHEDULING_WINDOW_DAYS,
  FOCUS_TIME_RISK_MULTIPLIER,
  DEFAULT_FOCUS_BLOCK_MINUTES,
  CANDIDATE_STEP_MINUTES,
} from '@fluxure/shared';
import { buildTimeline, getSchedulingWindow } from './timeline.js';
import { generateCandidateSlots } from './slots.js';
import { scoreSlot } from './scoring.js';
import { computeFreeBusyStatus } from './free-busy.js';
import { generateCalendarOperations } from './scheduler-ops.js';
import {
  buildDayWindow,
  enumerateDays,
  habitsToScheduleItems,
  tasksToScheduleItems,
  meetingsToScheduleItems,
  sortScheduleItems,
} from './scheduler-items.js';
import {
  parseTimeToMinutes,
  startOfDayInTz,
  nextDayInTz,
  toDateStr,
  startOfWeek,
  addDays,
  TZDate,
} from '@fluxure/shared';

// BTree-backed sorted slot collection for O(log n) insertion
class SortedSlots {
  private tree: BTree<number, TimeSlot[]>;
  private _length: number;

  constructor(initial: TimeSlot[] = []) {
    this.tree = new BTreeClass<number, TimeSlot[]>(undefined, (a, b) => a - b);
    this._length = 0;
    for (const slot of initial) {
      this.insert(slot);
    }
  }

  get length(): number {
    return this._length;
  }

  insert(slot: TimeSlot): void {
    const key = slot.start.getTime();
    const existing = this.tree.get(key);
    if (existing) {
      existing.push(slot);
    } else {
      this.tree.set(key, [slot]);
    }
    this._length++;
  }

  toArray(): TimeSlot[] {
    const result: TimeSlot[] = [];
    this.tree.forEach((slots) => {
      for (const s of slots) result.push(s);
    });
    return result;
  }

  filter(predicate: (slot: TimeSlot) => boolean): TimeSlot[] {
    const result: TimeSlot[] = [];
    this.tree.forEach((slots) => {
      for (const s of slots) {
        if (predicate(s)) result.push(s);
      }
    });
    return result;
  }
}

interface CircularDependencyError {
  habitId: string;
  message: string;
}

function detectCircularDependencies(habits: Habit[]): {
  errors: CircularDependencyError[];
  cyclicIds: Set<string>;
} {
  const errors: CircularDependencyError[] = [];
  const cyclicIds = new Set<string>();
  const visited = new Set<string>();
  const inStack = new Set<string>();
  const reported = new Set<string>();

  const habitMap = new Map<string, Habit>();
  for (const h of habits) {
    habitMap.set(h.id, h);
  }

  function dfs(id: string): boolean {
    if (inStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    inStack.add(id);
    const habit = habitMap.get(id);
    if (habit?.dependsOn) {
      if (dfs(habit.dependsOn)) {
        cyclicIds.add(id);
        if (!reported.has(id)) {
          reported.add(id);
          errors.push({
            habitId: id,
            message: `Circular dependency detected involving habit "${habit.name}"`,
          });
        }
        return true;
      }
    }
    inStack.delete(id);
    return false;
  }

  for (const habit of habits) {
    dfs(habit.id);
  }
  return { errors, cyclicIds };
}

interface ClassifiedEvents {
  softExternalEvents: TimeSlot[];
  existingManagedEvents: Map<string, CalendarEvent>;
  lockedPlacements: Map<string, TimeSlot>;
  lockedExistingIds: Set<string>;
  fixedEvents: TimeSlot[];
  softExternalKeySet: Set<string>;
}

function classifyCalendarEvents(
  calendarEvents: CalendarEvent[],
  habits: Habit[],
  currentTime: Date,
): ClassifiedEvents {
  const hardFixedEvents: TimeSlot[] = [];
  const softExternalEvents: TimeSlot[] = [];
  const existingManagedEvents = new Map<string, CalendarEvent>();
  const lockedPlacements = new Map<string, TimeSlot>();
  const lockedExistingIds = new Set<string>();

  const entityForcedMap = new Map<string, boolean>();
  for (const h of habits) entityForcedMap.set(h.id, h.forced);

  for (const event of calendarEvents) {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);

    if (!event.isManaged) {
      if (event.status === EventStatus.Locked) {
        hardFixedEvents.push({ start: eventStart, end: eventEnd });
      } else {
        softExternalEvents.push({ start: eventStart, end: eventEnd });
      }
    } else if (event.itemId) {
      const baseId = event.itemId.split('__')[0];
      const isPinned = entityForcedMap.get(baseId) || event.status === EventStatus.Locked;
      if (isPinned) {
        hardFixedEvents.push({ start: eventStart, end: eventEnd });
      }
    }

    if (event.isManaged && event.itemId && eventEnd > currentTime) {
      existingManagedEvents.set(event.itemId, event);
      const baseId = event.itemId.split('__')[0];
      const isPinned = entityForcedMap.get(baseId) || event.status === EventStatus.Locked;
      if (isPinned) {
        lockedPlacements.set(event.itemId, { start: eventStart, end: eventEnd });
        lockedExistingIds.add(event.itemId);
      }
    }
  }

  const fixedEvents: TimeSlot[] = [...hardFixedEvents, ...softExternalEvents];

  const softExternalKeySet = new Set<string>();
  for (const ext of softExternalEvents) {
    softExternalKeySet.add(`${ext.start.getTime()}-${ext.end.getTime()}`);
  }

  return {
    softExternalEvents,
    existingManagedEvents,
    lockedPlacements,
    lockedExistingIds,
    fixedEvents,
    softExternalKeySet,
  };
}

function pinStartedItems(
  allItems: ScheduleItem[],
  existingManagedEvents: Map<string, CalendarEvent>,
  lockedPlacements: Map<string, TimeSlot>,
  lockedExistingIds: Set<string>,
  currentTime: Date,
): Set<string> {
  const pinnedItemIds = new Set(lockedPlacements.keys());
  for (const item of allItems) {
    if (pinnedItemIds.has(item.id)) continue;
    const existing = existingManagedEvents.get(item.id);
    if (!existing) continue;
    const existingStart = new Date(existing.start);
    const existingEnd = new Date(existing.end);
    if (isNaN(existingStart.getTime()) || isNaN(existingEnd.getTime())) continue;
    if (existingStart.getTime() <= currentTime.getTime()) {
      lockedPlacements.set(item.id, { start: existingStart, end: existingEnd });
      pinnedItemIds.add(item.id);
      lockedExistingIds.add(item.id);
    }
  }
  return pinnedItemIds;
}

function scoreBestPlacement(
  candidates: CandidateSlot[],
  item: ScheduleItem,
  placements: Map<string, TimeSlot>,
  bufferConfig: BufferConfig,
  tz: string,
  placementsByDay?: Map<string, TimeSlot[]>,
): { placement: TimeSlot; scored: CandidateSlot[] } {
  const rawIdealMinutes = item.idealTime ? parseTimeToMinutes(item.idealTime) : -1;
  const precomputedIdealMinutes = rawIdealMinutes >= 0 ? rawIdealMinutes : undefined;
  const scored = candidates.map((candidate) => ({
    ...candidate,
    score: scoreSlot(
      candidate,
      item,
      placements,
      bufferConfig,
      tz,
      placementsByDay,
      precomputedIdealMinutes,
    ),
  }));
  scored.sort((a, b) => b.score - a.score);

  const best = scored[0];
  const placement: TimeSlot = { start: new Date(best.start), end: new Date(best.end) };
  return { placement, scored };
}

function placeFlexibleItems(
  flexibleItems: ScheduleItem[],
  timeline: TimeSlot[],
  occupiedSlots: SortedSlots,
  placements: Map<string, TimeSlot>,
  candidateSlotsMap: Map<string, CandidateSlot[]>,
  unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }>,
  bufferConfig: BufferConfig,
  softExternalEvents: TimeSlot[],
  softExternalKeySet: Set<string>,
  tz: string,
  placementsByDay: Map<string, TimeSlot[]>,
): void {
  // Cache the occupied array outside the loop; update incrementally after each placement
  const cachedOccupied = occupiedSlots.toArray();

  for (const item of flexibleItems) {
    let candidates = generateCandidateSlots(
      item,
      timeline,
      cachedOccupied,
      bufferConfig,
      placements,
      item.dependsOn,
      tz,
      CANDIDATE_STEP_MINUTES,
      true,
    );

    let effectiveItem = item;
    if (candidates.length === 0 && item.durationMin && item.durationMin < item.duration) {
      effectiveItem = { ...item, duration: item.durationMin };
      candidates = generateCandidateSlots(
        effectiveItem,
        timeline,
        cachedOccupied,
        bufferConfig,
        placements,
        item.dependsOn,
        tz,
        30,
        true,
      );
    }

    candidateSlotsMap.set(item.id, candidates);

    // Critical items can override soft external events when no other slots are available
    if (
      candidates.length === 0 &&
      effectiveItem.priority === Priority.Critical &&
      softExternalEvents.length > 0
    ) {
      const hardOnlyOccupied = cachedOccupied.filter(
        (slot) => !softExternalKeySet.has(`${slot.start.getTime()}-${slot.end.getTime()}`),
      );
      candidates = generateCandidateSlots(
        effectiveItem,
        timeline,
        hardOnlyOccupied,
        bufferConfig,
        placements,
        item.dependsOn,
        tz,
      );
    }

    if (candidates.length === 0) {
      unschedulable.push({
        itemId: item.id,
        itemType: item.type,
        reason: 'No available slots in the scheduling window',
      });
      continue;
    }

    const { placement, scored } = scoreBestPlacement(
      candidates,
      effectiveItem,
      placements,
      bufferConfig,
      tz,
      placementsByDay,
    );
    placements.set(item.id, placement);
    occupiedSlots.insert(placement);

    // Insert into cachedOccupied at the correct sorted position using binary search
    {
      const newStartTime = placement.start.getTime();
      let lo = 0;
      let hi = cachedOccupied.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (cachedOccupied[mid].start.getTime() < newStartTime) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
      }
      if (lo === cachedOccupied.length) {
        cachedOccupied.push(placement);
      } else {
        cachedOccupied.splice(lo, 0, placement);
      }
    }

    const pDayKey = toDateStr(placement.start, tz);
    const pDaySlots = placementsByDay.get(pDayKey);
    if (pDaySlots) {
      pDaySlots.push(placement);
    } else {
      placementsByDay.set(pDayKey, [placement]);
    }

    candidateSlotsMap.set(item.id, scored);
  }
}

function collectUnschedulable(
  circularErrors: CircularDependencyError[],
  tasks: Task[],
  scheduleStart: Date,
): Array<{ itemId: string; itemType: ItemType; reason: string }> {
  const unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }> = [];

  for (const error of circularErrors) {
    unschedulable.push({ itemId: error.habitId, itemType: ItemType.Habit, reason: error.message });
  }

  for (const task of tasks) {
    if (task.status === TaskStatus.Completed || task.status === TaskStatus.DoneScheduling) continue;
    if (!task.dueDate) continue;
    if (new Date(task.dueDate) < scheduleStart) {
      unschedulable.push({
        itemId: task.id,
        itemType: ItemType.Task,
        reason: `Task is overdue (due: ${task.dueDate})`,
      });
    }
  }

  return unschedulable;
}

function seedLockedPlacements(
  lockedPlacements: Map<string, TimeSlot>,
  placements: Map<string, TimeSlot>,
  placementsByDay: Map<string, TimeSlot[]>,
  itemMap: Map<string, ScheduleItem>,
  allItems: ScheduleItem[],
  tz: string,
): void {
  for (const [itemId, slot] of lockedPlacements) {
    placements.set(itemId, slot);
    const dayKey = toDateStr(slot.start, tz);
    const daySlots = placementsByDay.get(dayKey);
    if (daySlots) {
      daySlots.push(slot);
    } else {
      placementsByDay.set(dayKey, [slot]);
    }
  }
  for (const item of allItems) {
    itemMap.set(item.id, item);
  }
}

export function reschedule(
  habits: Habit[],
  tasks: Task[],
  meetings: SmartMeeting[],
  focusRules: FocusTimeRule[],
  calendarEvents: CalendarEvent[],
  bufferConfig: BufferConfig,
  userSettings: UserSettings,
  now?: Date,
): ScheduleResult {
  const currentTime = now ?? new Date();
  const tz = userSettings.timezone || 'UTC';

  const { errors: circularErrors, cyclicIds: circularHabitIds } =
    detectCircularDependencies(habits);

  const safeDays = Math.min(
    userSettings.schedulingWindowDays || DEFAULT_SCHEDULING_WINDOW_DAYS,
    MAX_SCHEDULING_WINDOW_DAYS,
  );
  const scheduleStart = new Date(currentTime);
  let scheduleEnd = startOfDayInTz(currentTime, tz);
  for (let i = 0; i < safeDays; i++) {
    scheduleEnd = nextDayInTz(scheduleEnd, tz);
  }

  const days = enumerateDays(scheduleStart, scheduleEnd, tz);
  const timeline = buildTimeline(scheduleStart, scheduleEnd, userSettings);
  const classified = classifyCalendarEvents(calendarEvents, habits, currentTime);

  const habitItems = habitsToScheduleItems(
    habits,
    scheduleStart,
    scheduleEnd,
    scheduleStart,
    tz,
    days,
  );
  const taskItems = tasksToScheduleItems(tasks, scheduleStart, scheduleEnd, userSettings);
  const meetingItems = meetingsToScheduleItems(
    meetings,
    scheduleStart,
    scheduleEnd,
    scheduleStart,
    tz,
    userSettings,
    days,
  );

  const unschedulable = collectUnschedulable(circularErrors, tasks, scheduleStart);

  // Strip dependsOn immutably for circular habits
  if (circularHabitIds.size > 0) {
    for (let i = 0; i < habitItems.length; i++) {
      const item = habitItems[i];
      if (circularHabitIds.has(item.id.split('__')[0])) {
        habitItems[i] = { ...item, dependsOn: null };
      }
    }
  }

  // Pin started items and sort flexible ones
  const allItems = [...habitItems, ...taskItems, ...meetingItems];
  const pinnedItemIds = pinStartedItems(
    allItems,
    classified.existingManagedEvents,
    classified.lockedPlacements,
    classified.lockedExistingIds,
    currentTime,
  );
  const flexibleItems = sortScheduleItems(allItems.filter((item) => !pinnedItemIds.has(item.id)));

  const initialSlots = [...classified.fixedEvents];
  for (const [, slot] of classified.lockedPlacements) {
    initialSlots.push(slot);
  }
  const occupiedSlots = new SortedSlots(initialSlots);

  const placements = new Map<string, TimeSlot>();
  const candidateSlotsMap = new Map<string, CandidateSlot[]>();
  const itemMap = new Map<string, ScheduleItem>();
  const placementsByDay = new Map<string, TimeSlot[]>();

  seedLockedPlacements(
    classified.lockedPlacements,
    placements,
    placementsByDay,
    itemMap,
    allItems,
    tz,
  );

  placeFlexibleItems(
    flexibleItems,
    timeline,
    occupiedSlots,
    placements,
    candidateSlotsMap,
    unschedulable,
    bufferConfig,
    classified.softExternalEvents,
    classified.softExternalKeySet,
    tz,
    placementsByDay,
  );

  const activeFocusRules = focusRules.filter((r) => r.enabled);
  if (activeFocusRules.length > 0) {
    const itemTypeMap = new Map<string, ItemType>();
    for (const item of flexibleItems) {
      itemTypeMap.set(item.id, item.type);
    }

    placeFocusTime(
      activeFocusRules,
      timeline,
      occupiedSlots,
      placements,
      candidateSlotsMap,
      itemMap,
      unschedulable,
      bufferConfig,
      userSettings,
      scheduleStart,
      scheduleEnd,
      currentTime,
      itemTypeMap,
      days,
      placementsByDay,
    );
  }

  const statuses = new Map<string, EventStatus>();
  for (const [itemId, placement] of placements) {
    const item = itemMap.get(itemId);
    const candidates = candidateSlotsMap.get(itemId) ?? [];
    const isLocked = item?.forced || classified.lockedExistingIds.has(itemId);
    statuses.set(
      itemId,
      computeFreeBusyStatus(itemId, placement, candidates, currentTime, isLocked),
    );
  }

  const operations = generateCalendarOperations(
    placements,
    statuses,
    itemMap,
    classified.existingManagedEvents,
    classified.lockedExistingIds,
  );

  return { operations, unschedulable };
}

function computeWeeklyFocusMetrics(
  placements: Map<string, TimeSlot>,
  timeline: TimeSlot[],
  mergedOccupied: TimeSlot[],
  itemTypeMap: Map<string, ItemType>,
  weekStart: Date,
  weekEnd: Date,
): { placedMinutes: number; availableMinutes: number } {
  let placedMinutes = 0;
  for (const [id, slot] of placements) {
    if (slot.end > weekStart && slot.start < weekEnd) {
      if (itemTypeMap.get(id) !== ItemType.Meeting) {
        const overlapMs = Math.max(
          0,
          Math.min(slot.end.getTime(), weekEnd.getTime()) -
            Math.max(slot.start.getTime(), weekStart.getTime()),
        );
        placedMinutes += overlapMs / 60000;
      }
    }
  }

  // Two-pointer sweep: both timeline and mergedOccupied are sorted by start time
  let availableMinutes = 0;
  let j = 0;
  for (const slot of timeline) {
    if (slot.start < weekStart || slot.start >= weekEnd) continue;
    let availableMs = slot.end.getTime() - slot.start.getTime();
    // Advance past occupied slots that end before this timeline slot starts
    while (j < mergedOccupied.length && mergedOccupied[j].end.getTime() <= slot.start.getTime()) {
      j++;
    }
    let k = j;
    while (k < mergedOccupied.length && mergedOccupied[k].start.getTime() < slot.end.getTime()) {
      const overlapStart = Math.max(slot.start.getTime(), mergedOccupied[k].start.getTime());
      const overlapEnd = Math.min(slot.end.getTime(), mergedOccupied[k].end.getTime());
      if (overlapEnd > overlapStart) {
        availableMs -= overlapEnd - overlapStart;
      }
      k++;
    }
    availableMinutes += Math.max(0, availableMs) / (1000 * 60);
  }

  return { placedMinutes, availableMinutes };
}

function placeFocusTime(
  focusRules: FocusTimeRule[],
  timeline: TimeSlot[],
  occupiedSlots: SortedSlots,
  placements: Map<string, TimeSlot>,
  candidateSlotsMap: Map<string, CandidateSlot[]>,
  itemMap: Map<string, ScheduleItem>,
  _unschedulable: Array<{ itemId: string; itemType: ItemType; reason: string }>,
  bufferConfig: BufferConfig,
  userSettings: UserSettings,
  _scheduleStart: Date,
  scheduleEnd: Date,
  now: Date,
  itemTypeMap: Map<string, ItemType> = new Map(),
  precomputedDays?: Date[],
  placementsByDay?: Map<string, TimeSlot[]>,
): void {
  const tz = userSettings.timezone || 'UTC';

  // Cache the occupied array; update incrementally after each placement
  const cachedFocusOccupied = occupiedSlots.toArray();

  // Build merged occupied intervals once; update incrementally per placement
  const mergedOccupied: TimeSlot[] = [];
  for (const slot of cachedFocusOccupied) {
    const last = mergedOccupied[mergedOccupied.length - 1];
    if (last && slot.start.getTime() <= last.end.getTime()) {
      mergedOccupied[mergedOccupied.length - 1] = {
        start: last.start,
        end: new Date(Math.max(last.end.getTime(), slot.end.getTime())),
      };
    } else {
      mergedOccupied.push({ start: new Date(slot.start), end: new Date(slot.end) });
    }
  }

  // Week boundaries are identical for every rule, compute once
  const weekStartTz = startOfWeek(new TZDate(now, tz), { weekStartsOn: 0 });
  const weekStart = startOfDayInTz(new Date(weekStartTz.getTime()), tz);
  const weekEndTz = addDays(weekStartTz, DAYS_PER_WEEK);
  const weekEnd = startOfDayInTz(new Date(weekEndTz.getTime()), tz);

  for (const rule of focusRules) {
    const { placedMinutes, availableMinutes } = computeWeeklyFocusMetrics(
      placements,
      timeline,
      mergedOccupied,
      itemTypeMap,
      weekStart,
      weekEnd,
    );

    const targetRemaining = rule.weeklyTargetMinutes - placedMinutes;
    if (targetRemaining <= 0) continue;
    if (availableMinutes > targetRemaining * FOCUS_TIME_RISK_MULTIPLIER) continue;

    const blockSize =
      rule.dailyTargetMinutes > 0
        ? rule.dailyTargetMinutes
        : Math.min(DEFAULT_FOCUS_BLOCK_MINUTES, targetRemaining);

    let placedTotal = 0;
    const todayStart = startOfDayInTz(now, tz);
    const focusDays = precomputedDays
      ? precomputedDays.filter((d) => d >= todayStart)
      : enumerateDays(now, scheduleEnd, tz);

    for (const day of focusDays) {
      if (placedTotal >= targetRemaining) break;

      const { start: hourStart, end: hourEnd } = getSchedulingWindow(
        rule.schedulingHours,
        userSettings,
      );

      const focusItem: ScheduleItem = {
        id: `focus_${rule.id}__${toDateStr(day, tz)}`,
        type: ItemType.Focus,
        priority: Priority.Low,
        timeWindow: buildDayWindow(day, hourStart, hourEnd, tz),
        idealTime: hourStart,
        duration: Math.min(blockSize, targetRemaining - placedTotal),
        skipBuffer: false,
        forced: false,
        dependsOn: null,
      };

      itemMap.set(focusItem.id, focusItem);

      const candidates = generateCandidateSlots(
        focusItem,
        timeline,
        cachedFocusOccupied,
        bufferConfig,
        undefined,
        undefined,
        tz,
        CANDIDATE_STEP_MINUTES,
        true,
      );
      candidateSlotsMap.set(focusItem.id, candidates);

      if (candidates.length === 0) continue;

      const { placement } = scoreBestPlacement(
        candidates,
        focusItem,
        placements,
        bufferConfig,
        tz,
        placementsByDay,
      );
      placements.set(focusItem.id, placement);
      occupiedSlots.insert(placement);

      // Binary-search insert into cachedFocusOccupied and merge into mergedOccupied
      {
        const newStartTime = placement.start.getTime();

        let lo = 0;
        let hi = cachedFocusOccupied.length;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (cachedFocusOccupied[mid].start.getTime() < newStartTime) {
            lo = mid + 1;
          } else {
            hi = mid;
          }
        }
        if (lo === cachedFocusOccupied.length) {
          cachedFocusOccupied.push(placement);
        } else {
          cachedFocusOccupied.splice(lo, 0, placement);
        }

        const newSlot: TimeSlot = {
          start: new Date(placement.start),
          end: new Date(placement.end),
        };
        let mlo = 0;
        let mhi = mergedOccupied.length;
        while (mlo < mhi) {
          const mid = (mlo + mhi) >>> 1;
          if (mergedOccupied[mid].start.getTime() < newStartTime) {
            mlo = mid + 1;
          } else {
            mhi = mid;
          }
        }
        // Merge with preceding slot if it overlaps
        if (mlo > 0 && mergedOccupied[mlo - 1].end.getTime() >= newStartTime) {
          mlo--;
          newSlot.start = mergedOccupied[mlo].start;
          newSlot.end = new Date(
            Math.max(mergedOccupied[mlo].end.getTime(), placement.end.getTime()),
          );
        }
        // Absorb any subsequent slots that overlap with newSlot
        let mend = mlo + (newSlot.start === mergedOccupied[mlo]?.start ? 1 : 0);
        while (
          mend < mergedOccupied.length &&
          mergedOccupied[mend].start.getTime() <= newSlot.end.getTime()
        ) {
          newSlot.end = new Date(
            Math.max(newSlot.end.getTime(), mergedOccupied[mend].end.getTime()),
          );
          mend++;
        }
        mergedOccupied.splice(mlo, mend - mlo, newSlot);
      }

      if (placementsByDay) {
        const pDayKey = toDateStr(placement.start, tz);
        const pDaySlots = placementsByDay.get(pDayKey);
        if (pDaySlots) {
          pDaySlots.push(placement);
        } else {
          placementsByDay.set(pDayKey, [placement]);
        }
      }

      placedTotal += focusItem.duration;
    }
  }
}
