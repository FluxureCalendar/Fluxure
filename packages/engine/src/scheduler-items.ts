import {
  Habit,
  Task,
  SmartMeeting,
  UserSettings,
  ScheduleItem,
  TimeSlot,
  ItemType,
  Priority,
  Frequency,
  TaskStatus,
  type DayOfWeek,
} from '@fluxure/shared';
import { TYPE_ORDER, MONTH_WEEK_MIN, MONTH_WEEK_MAX } from '@fluxure/shared';
import { getSchedulingWindow } from './timeline.js';
import {
  parseTime,
  setTimeInTz,
  getDayOfWeekInTz,
  startOfDayInTz,
  nextDayInTz,
  getDatePartsInTz,
  toDateStr,
  getISOWeek,
  getISOWeekYear,
  eachDayOfInterval,
  TZDate,
} from '@fluxure/shared';

const DAY_ABBREVS: readonly DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function getDayAbbrev(date: Date, tz: string): DayOfWeek {
  const dayIndex = getDayOfWeekInTz(date, tz);
  return DAY_ABBREVS[dayIndex];
}

function isMonthlyTargetDay(
  day: Date,
  tz: string,
  config?: { monthDay?: number | null; monthWeek?: number | null; monthWeekday?: string | null },
): boolean {
  const localDay = getDatePartsInTz(day, tz).day;

  if (config?.monthDay != null) {
    return localDay === config.monthDay;
  }
  if (config?.monthWeek != null && config?.monthWeekday != null) {
    const dayAbbrev = getDayAbbrev(day, tz);
    if (dayAbbrev !== config.monthWeekday) return false;
    const targetWeek = Math.min(MONTH_WEEK_MAX, Math.max(MONTH_WEEK_MIN, config.monthWeek));
    if (targetWeek === MONTH_WEEK_MAX) {
      const { month: localMonth, year: localYear } = getDatePartsInTz(day, tz);
      const daysInMonth = new Date(localYear, localMonth, 0).getDate();
      return localDay + 7 > daysInMonth;
    }
    return Math.ceil(localDay / 7) === targetWeek;
  }
  return localDay === 1;
}

export function buildDayWindow(
  day: Date,
  windowStart: string,
  windowEnd: string,
  tz: string,
): TimeSlot {
  const start = parseTime(windowStart) ?? { hours: 9, minutes: 0 };
  const end = parseTime(windowEnd) ?? { hours: 17, minutes: 0 };
  const s = setTimeInTz(day, start.hours, start.minutes, tz);
  // Equal start/end produces a zero-length window, not a 24h window.
  if (windowStart === windowEnd) {
    return { start: s, end: s };
  }
  // windowEnd="00:00" means end-of-day, not start-of-day.
  const isEndMidnight = end.hours === 0 && end.minutes === 0 && windowEnd !== windowStart;
  const e = isEndMidnight ? nextDayInTz(day, tz) : setTimeInTz(day, end.hours, end.minutes, tz);
  // DST spring-forward: start and end resolve to the same instant (zero-width window).
  if (e.getTime() === s.getTime()) {
    return { start: s, end: e };
  }
  if (e < s) {
    const next = nextDayInTz(e, tz);
    return { start: s, end: next };
  }
  return { start: s, end: e };
}

export function enumerateDays(startDate: Date, endDate: Date, tz: string): Date[] {
  const start = new TZDate(startOfDayInTz(startDate, tz), tz);
  const end = new TZDate(startOfDayInTz(endDate, tz), tz);
  return eachDayOfInterval({ start, end }).map((d) => startOfDayInTz(new Date(d.getTime()), tz));
}

export function habitsToScheduleItems(
  habits: Habit[],
  scheduleStart: Date,
  scheduleEnd: Date,
  windowStart: Date,
  tz: string,
  precomputedDays?: Date[],
  completedHabitDays?: Set<string>,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const days = precomputedDays ?? enumerateDays(scheduleStart, scheduleEnd, tz);

  for (const habit of habits) {
    if (!habit.enabled) continue;

    const duration = habit.durationMax;
    if (duration <= 0) continue;
    const durationMin = habit.durationMin;

    const applicableDays = habit.days;

    for (const day of days) {
      const dayAbbrev = getDayAbbrev(day, tz);
      if (!applicableDays.includes(dayAbbrev)) continue;

      // Skip days where the habit was already completed
      const dayKey = `${habit.id}__${toDateStr(day, tz)}`;
      if (completedHabitDays?.has(dayKey)) continue;

      const timeWindow = buildDayWindow(day, habit.windowStart, habit.windowEnd, tz);
      items.push({
        id: `${habit.id}__${toDateStr(day, tz)}`,
        name: habit.name,
        type: ItemType.Habit,
        priority: habit.priority,
        timeWindow,
        idealTime: habit.idealTime,
        duration,
        durationMin,
        skipBuffer: habit.skipBuffer ?? false,
        forced: habit.forced,
        dependsOn: habit.dependsOn ? `${habit.dependsOn}__${toDateStr(day, tz)}` : null,
      });
    }
  }

  return items;
}

export function computeChunks(
  remaining: number,
  chunkMin: number,
  chunkMax: number,
): { numChunks: number; chunkSize: number; chunkSizes: number[] } {
  if (remaining <= chunkMax) {
    return { numChunks: 1, chunkSize: remaining, chunkSizes: [remaining] };
  }

  let numChunks = Math.ceil(remaining / chunkMax);
  let chunkSize = Math.ceil(remaining / numChunks);

  if (chunkSize > chunkMax) {
    chunkSize = chunkMax;
    numChunks = Math.ceil(remaining / chunkSize);
  }

  const chunkSizes: number[] = [];
  let left = remaining;
  for (let i = 0; i < numChunks; i++) {
    const thisChunk = Math.min(chunkSize, left);
    chunkSizes.push(thisChunk);
    left -= thisChunk;
  }

  // If last chunk is a runt (< chunkMin), merge it into the previous chunk
  if (chunkSizes.length > 1 && chunkSizes[chunkSizes.length - 1] < chunkMin) {
    const lastChunk = chunkSizes[chunkSizes.length - 1];
    const prev = chunkSizes[chunkSizes.length - 2];
    if (prev + lastChunk <= chunkMax) {
      chunkSizes[chunkSizes.length - 2] = prev + lastChunk;
      chunkSizes.pop();
    } else {
      // Redistribute last two chunks evenly
      const total = prev + lastChunk;
      chunkSizes[chunkSizes.length - 2] = Math.ceil(total / 2);
      chunkSizes[chunkSizes.length - 1] = total - Math.ceil(total / 2);
    }
    numChunks = chunkSizes.length;
  }

  return { numChunks, chunkSize, chunkSizes };
}

export function tasksToScheduleItems(
  tasks: Task[],
  scheduleStart: Date,
  scheduleEnd: Date,
  userSettings: UserSettings,
): ScheduleItem[] {
  const items: ScheduleItem[] = [];

  for (const task of tasks) {
    if (task.status === TaskStatus.Completed || task.status === TaskStatus.DoneScheduling) continue;
    if (!task.chunkMax || task.chunkMax <= 0) continue;

    const remaining = task.remainingDuration;
    if (remaining <= 0) continue;

    const { numChunks, chunkSizes } = computeChunks(remaining, task.chunkMin, task.chunkMax);

    const earliest = task.earliestStart ? new Date(task.earliestStart) : new Date(scheduleStart);
    const due = task.dueDate ? new Date(task.dueDate) : null;

    if (due && due < scheduleStart) {
      continue;
    }

    const windowEnd = due && due < scheduleEnd ? due : scheduleEnd;
    const { start: hourStart } = getSchedulingWindow(task.schedulingHours, userSettings);
    const priority = task.isUpNext ? Priority.Critical : task.priority;

    for (let i = 0; i < numChunks; i++) {
      const thisChunkSize = chunkSizes[i];
      if (thisChunkSize <= 0) break;

      const timeWindow: TimeSlot = {
        start: earliest < scheduleStart ? new Date(scheduleStart) : new Date(earliest),
        end: new Date(windowEnd),
      };

      items.push({
        id: `${task.id}__chunk${i}`,
        name: task.name,
        type: ItemType.Task,
        priority,
        timeWindow,
        idealTime: hourStart,
        duration: thisChunkSize,
        skipBuffer: task.skipBuffer ?? false,
        forced: false,
        dependsOn: i > 0 ? `${task.id}__chunk${i - 1}` : null,
      });
    }
  }

  return items;
}

export function meetingsToScheduleItems(
  meetings: SmartMeeting[],
  scheduleStart: Date,
  scheduleEnd: Date,
  windowStart: Date,
  tz: string,
  userSettings: UserSettings,
  precomputedDays?: Date[],
): ScheduleItem[] {
  const items: ScheduleItem[] = [];
  const days = precomputedDays ?? enumerateDays(scheduleStart, scheduleEnd, tz);

  for (const meeting of meetings) {
    if (meeting.duration <= 0) continue;

    const defaultWorkHours = userSettings.workingHours ?? { start: '09:00', end: '17:00' };
    const mWindowStart = meeting.windowStart ?? defaultWorkHours.start;
    const mWindowEnd = meeting.windowEnd ?? defaultWorkHours.end;
    const mIdealTime = meeting.idealTime ?? mWindowStart;

    if (meeting.frequency === Frequency.Daily) {
      for (const day of days) {
        const timeWindow = buildDayWindow(day, mWindowStart, mWindowEnd, tz);
        items.push({
          id: `${meeting.id}__${toDateStr(day, tz)}`,
          name: meeting.name,
          type: ItemType.Meeting,
          priority: meeting.priority,
          timeWindow,
          idealTime: mIdealTime,
          duration: meeting.duration,
          skipBuffer: meeting.skipBuffer ?? false,
          forced: false,
          dependsOn: null,
        });
      }
    } else if (meeting.frequency === Frequency.Weekly) {
      const weekInterval = meeting.frequencyConfig?.weekInterval ?? 1;
      const scheduledWeeks = new Set<string>();
      for (const day of days) {
        const tzDay = new TZDate(day, tz);
        const weekNum = getISOWeek(tzDay);
        const isoYear = getISOWeekYear(tzDay);
        const weekKey = `${isoYear}-W${String(weekNum).padStart(2, '0')}`;
        if (scheduledWeeks.has(weekKey)) continue;

        if (weekInterval > 1) {
          const daysDiff = Math.round(
            (startOfDayInTz(day, tz).getTime() - startOfDayInTz(windowStart, tz).getTime()) /
              (1000 * 60 * 60 * 24),
          );
          const weeksSinceStart = Math.floor(daysDiff / 7);
          if (weeksSinceStart % weekInterval !== 0) continue;
        }

        scheduledWeeks.add(weekKey);
        const dayStr = toDateStr(day, tz);
        const timeWindow = buildDayWindow(day, mWindowStart, mWindowEnd, tz);
        items.push({
          id: `${meeting.id}__${dayStr}`,
          name: meeting.name,
          type: ItemType.Meeting,
          priority: meeting.priority,
          timeWindow,
          idealTime: mIdealTime,
          duration: meeting.duration,
          skipBuffer: meeting.skipBuffer ?? false,
          forced: false,
          dependsOn: null,
        });
      }
    } else if (meeting.frequency === Frequency.Monthly) {
      for (const day of days) {
        if (!isMonthlyTargetDay(day, tz, meeting.frequencyConfig)) continue;

        const dayStr = toDateStr(day, tz);
        const timeWindow = buildDayWindow(day, mWindowStart, mWindowEnd, tz);
        items.push({
          id: `${meeting.id}__${dayStr}`,
          name: meeting.name,
          type: ItemType.Meeting,
          priority: meeting.priority,
          timeWindow,
          idealTime: mIdealTime,
          duration: meeting.duration,
          skipBuffer: meeting.skipBuffer ?? false,
          forced: false,
          dependsOn: null,
        });
      }
    } else if (meeting.frequency === Frequency.Custom) {
      const customDays = meeting.frequencyConfig?.days;
      if (!customDays || customDays.length === 0) {
        // Cannot schedule without specified days — caller should report via unschedulable
        continue;
      }
      for (const day of days) {
        const dayAbbrev = getDayAbbrev(day, tz);
        if (!customDays.includes(dayAbbrev)) continue;

        const dayStr = toDateStr(day, tz);
        const timeWindow = buildDayWindow(day, mWindowStart, mWindowEnd, tz);
        items.push({
          id: `${meeting.id}__${dayStr}`,
          name: meeting.name,
          type: ItemType.Meeting,
          priority: meeting.priority,
          timeWindow,
          idealTime: mIdealTime,
          duration: meeting.duration,
          skipBuffer: meeting.skipBuffer ?? false,
          forced: false,
          dependsOn: null,
        });
      }
    }
  }

  return items;
}

export function sortScheduleItems(items: ScheduleItem[]): ScheduleItem[] {
  return [...items].sort((a, b) => {
    if (a.priority !== b.priority) {
      return a.priority - b.priority;
    }

    const typeA = TYPE_ORDER[a.type];
    const typeB = TYPE_ORDER[b.type];
    if (typeA !== typeB) {
      return typeA - typeB;
    }

    const timeDiff = a.timeWindow.end.getTime() - b.timeWindow.end.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }

    return a.id.localeCompare(b.id);
  });
}
