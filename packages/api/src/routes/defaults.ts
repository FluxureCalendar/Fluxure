import type { UserSettings } from '@fluxure/shared';
import {
  SchedulingHours,
  DEFAULT_WORKING_HOURS,
  DEFAULT_PERSONAL_HOURS,
  DEFAULT_SCHEDULING_WINDOW_DAYS,
  DEFAULT_TIMEZONE,
  DEFAULT_BREAK_BETWEEN_MINUTES,
} from '@fluxure/shared';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  workingHours: DEFAULT_WORKING_HOURS,
  personalHours: DEFAULT_PERSONAL_HOURS,
  timezone: DEFAULT_TIMEZONE,
  schedulingWindowDays: DEFAULT_SCHEDULING_WINDOW_DAYS,
  trimCompletedEvents: true,
  freeSlotOnComplete: false,
  breakBetweenItemsMinutes: DEFAULT_BREAK_BETWEEN_MINUTES,
  autoCompleteHabits: true,
};

export function getHoursWindow(
  schedulingHours: SchedulingHours,
  userSettings: UserSettings,
  customStart?: string,
  customEnd?: string,
): { start: string; end: string } {
  switch (schedulingHours) {
    case SchedulingHours.Working:
      return userSettings.workingHours;
    case SchedulingHours.Personal:
      return userSettings.personalHours;
    case SchedulingHours.Custom:
      if (customStart && customEnd) {
        return { start: customStart, end: customEnd };
      }
      return userSettings.personalHours;
    default:
      return userSettings.workingHours;
  }
}
