// ============================================================
// Fluxure date/timezone utilities — powered by date-fns v4 + @date-fns/tz
// ============================================================
//
// This module re-exports commonly used date-fns functions so that consumers
// import from one place, and provides Fluxure-specific timezone-aware helpers
// that replace the old Intl.DateTimeFormat-based functions in engine/utils.ts.

import { TZDate } from '@date-fns/tz';
import { addDays as _addDays, getDay as _getDay, isSameDay as _isSameDay } from 'date-fns';

// ============================================================
// Re-exports — import these from '@fluxure/shared' instead of 'date-fns'
// ============================================================

export {
  addMinutes,
  addHours,
  addDays,
  subDays,
  set,
  differenceInMinutes,
  differenceInHours,
  differenceInDays,
  eachDayOfInterval,
  startOfDay,
  startOfWeek,
  endOfDay,
  format,
  getISOWeek,
  getISOWeekYear,
  getDay,
  isSameDay,
  isValid,
  parseISO,
} from 'date-fns';

export { TZDate } from '@date-fns/tz';

// ============================================================
// Pure string parsers (no date library needed)
// ============================================================

/**
 * Parse an "HH:MM" string into { hours, minutes }.
 * Returns null for invalid input.
 */
export function parseTime(hhmm: string): { hours: number; minutes: number } | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) {
    return null;
  }
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { hours: h, minutes: m };
}

/**
 * Parse an "HH:MM" string into total minutes since midnight.
 * Returns -1 for invalid/empty input or out-of-range values.
 */
export function parseTimeToMinutes(hhmm: string): number {
  const parsed = parseTime(hhmm);
  if (!parsed) return -1;
  return parsed.hours * 60 + parsed.minutes;
}

// ============================================================
// Timezone-aware helpers (replace old Intl.DateTimeFormat versions)
// ============================================================

/**
 * Project a Date into a timezone and extract { year, month (1-12), day }.
 */
export function getDatePartsInTz(
  date: Date,
  tz: string,
): { year: number; month: number; day: number } {
  const d = new TZDate(date, tz);
  return {
    year: d.getFullYear(),
    month: d.getMonth() + 1, // TZDate months are 0-based, return 1-based like original
    day: d.getDate(),
  };
}

/**
 * Create a Date representing a specific time on a specific calendar day in a
 * timezone (DST-safe).
 *
 * The calendar day is taken from `date` projected into `tz`. The returned Date
 * is a plain Date (not TZDate) whose `.getTime()` is the correct UTC instant.
 */
export function setTimeInTz(date: Date, hours: number, minutes: number, tz: string): Date {
  const { year, month, day } = getDatePartsInTz(date, tz);
  // TZDate constructor: (year, monthIndex, day, h, m, s, tz)
  const tzd = new TZDate(year, month - 1, day, hours, minutes, 0, tz);
  return new Date(tzd.getTime());
}

/**
 * Midnight (start of day) in a timezone.
 */
export function startOfDayInTz(date: Date, tz: string): Date {
  return setTimeInTz(date, 0, 0, tz);
}

/**
 * Advance one calendar day in a timezone (DST-safe).
 * Returns midnight of the next day.
 */
export function nextDayInTz(date: Date, tz: string): Date {
  const tomorrow = _addDays(new TZDate(date, tz), 1);
  return startOfDayInTz(new Date(tomorrow.getTime()), tz);
}

/**
 * Get day of week (0=Sun, 6=Sat) in a timezone.
 */
export function getDayOfWeekInTz(date: Date, tz: string): number {
  return _getDay(new TZDate(date, tz));
}

/**
 * Format a date as "YYYY-MM-DD" in a timezone.
 */
export function toDateStr(date: Date, tz: string): string {
  const { year, month, day } = getDatePartsInTz(date, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Check if two dates fall on the same calendar day in a timezone.
 * When `tz` is omitted, compares in local (UTC-like) time.
 */
export function isSameDayInTz(a: Date, b: Date, tz?: string): boolean {
  if (tz) {
    return _isSameDay(new TZDate(a, tz), new TZDate(b, tz));
  }
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Minutes since midnight for a date in a timezone.
 * When `tz` is omitted, uses the date's local hours/minutes.
 */
export function minutesSinceMidnightInTz(d: Date, tz?: string): number {
  if (tz) {
    const tzd = new TZDate(d, tz);
    return tzd.getHours() * 60 + tzd.getMinutes();
  }
  return d.getHours() * 60 + d.getMinutes();
}
