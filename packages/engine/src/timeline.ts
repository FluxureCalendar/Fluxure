import { TimeSlot, UserSettings, SchedulingHours, MONDAY, FRIDAY } from '@fluxure/shared';
import {
  parseTime,
  setTimeInTz,
  getDayOfWeekInTz,
  startOfDayInTz,
  nextDayInTz,
} from '@fluxure/shared';

/**
 * Get the scheduling hours (start/end) for a given SchedulingHours type.
 */
export function getSchedulingWindow(
  schedulingHours: SchedulingHours,
  userSettings: UserSettings,
): { start: string; end: string } {
  switch (schedulingHours) {
    case SchedulingHours.Working:
      return userSettings.workingHours;
    case SchedulingHours.Personal:
      return userSettings.personalHours;
    case SchedulingHours.Custom:
      // Custom defaults to personal hours since we don't have custom config here
      return userSettings.personalHours;
    default:
      return userSettings.workingHours;
  }
}

/**
 * Build a timeline of available time slots between startDate and endDate.
 *
 * For each day in the range, creates slots for both working hours and personal hours.
 * Working hours are a subset of personal hours. We produce one slot per day per
 * scheduling-hours window.
 *
 * The returned slots are non-overlapping and sorted chronologically.
 */
export function buildTimeline(
  startDate: Date,
  endDate: Date,
  userSettings: UserSettings,
): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const tz = userSettings.timezone || 'UTC';

  const workStart = parseTime(userSettings.workingHours.start) ?? { hours: 9, minutes: 0 };
  const workEnd = parseTime(userSettings.workingHours.end) ?? { hours: 17, minutes: 0 };
  const personalStart = parseTime(userSettings.personalHours.start) ?? { hours: 7, minutes: 0 };
  const personalEnd = parseTime(userSettings.personalHours.end) ?? { hours: 22, minutes: 0 };

  let current = startOfDayInTz(startDate, tz);
  const endMidnight = startOfDayInTz(endDate, tz);
  const endBound = nextDayInTz(endMidnight, tz);

  while (current < endBound) {
    const dayOfWeek = getDayOfWeekInTz(current, tz);
    const isWeekday = dayOfWeek >= MONDAY && dayOfWeek <= FRIDAY;

    if (isWeekday) {
      // Pre-work personal time
      if (
        personalStart.hours < workStart.hours ||
        (personalStart.hours === workStart.hours && personalStart.minutes < workStart.minutes)
      ) {
        const preWorkStart = setTimeInTz(current, personalStart.hours, personalStart.minutes, tz);
        const preWorkEnd = setTimeInTz(current, workStart.hours, workStart.minutes, tz);

        if (preWorkStart < preWorkEnd) {
          slots.push(clampSlot({ start: preWorkStart, end: preWorkEnd }, startDate, endDate));
        }
      }

      const wStart = setTimeInTz(current, workStart.hours, workStart.minutes, tz);
      const wEnd = setTimeInTz(current, workEnd.hours, workEnd.minutes, tz);

      if (wStart < wEnd) {
        slots.push(clampSlot({ start: wStart, end: wEnd }, startDate, endDate));
      }

      // Post-work personal time
      if (
        personalEnd.hours > workEnd.hours ||
        (personalEnd.hours === workEnd.hours && personalEnd.minutes > workEnd.minutes)
      ) {
        const postWorkStart = setTimeInTz(current, workEnd.hours, workEnd.minutes, tz);
        const postWorkEnd = setTimeInTz(current, personalEnd.hours, personalEnd.minutes, tz);

        if (postWorkStart < postWorkEnd) {
          slots.push(clampSlot({ start: postWorkStart, end: postWorkEnd }, startDate, endDate));
        }
      }
    } else {
      // Weekend: only personal hours
      const pStart = setTimeInTz(current, personalStart.hours, personalStart.minutes, tz);
      const pEnd = setTimeInTz(current, personalEnd.hours, personalEnd.minutes, tz);

      if (pStart < pEnd) {
        slots.push(clampSlot({ start: pStart, end: pEnd }, startDate, endDate));
      }
    }

    current = nextDayInTz(current, tz);
  }

  return slots.filter((s) => s.start < s.end);
}

/**
 * Clamp a slot to be within [startDate, endDate].
 */
function clampSlot(slot: TimeSlot, startDate: Date, endDate: Date): TimeSlot {
  return {
    start: slot.start < startDate ? new Date(startDate) : new Date(slot.start),
    end: slot.end > endDate ? new Date(endDate) : new Date(slot.end),
  };
}
