import type { UserSettings } from '@fluxure/shared';
import {
  SchedulingHours,
  DEFAULT_WORKING_HOURS,
  DEFAULT_PERSONAL_HOURS,
  DEFAULT_SCHEDULING_WINDOW_DAYS,
  DEFAULT_TIMEZONE,
  DEFAULT_PAST_EVENT_RETENTION_DAYS,
} from '@fluxure/shared';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  workingHours: DEFAULT_WORKING_HOURS,
  personalHours: DEFAULT_PERSONAL_HOURS,
  timezone: DEFAULT_TIMEZONE,
  schedulingWindowDays: DEFAULT_SCHEDULING_WINDOW_DAYS,
  trimCompletedEvents: true,
  pastEventRetentionDays: DEFAULT_PAST_EVENT_RETENTION_DAYS,
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
      // Use entity's own windowStart/windowEnd if provided, otherwise fall back to personalHours
      if (customStart && customEnd) {
        return { start: customStart, end: customEnd };
      }
      return userSettings.personalHours;
    default:
      return userSettings.workingHours;
  }
}
