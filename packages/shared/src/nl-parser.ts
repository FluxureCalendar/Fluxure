import { addDays, set, TZDate } from './date-utils.js';
import type { DayOfWeek } from './types.js';

export type { DayOfWeek } from './types.js';

export interface ParsedHabit {
  type: 'habit';
  name: string;
  days?: DayOfWeek[];
  idealTime?: string; // HH:MM
  duration?: number; // minutes
}

export interface ParsedTask {
  type: 'task';
  name: string;
  dueDate?: string; // ISO datetime
  totalDuration?: number; // minutes
}

export interface ParsedMeeting {
  type: 'meeting';
  name: string;
  frequency?: 'daily' | 'weekly';
  day?: DayOfWeek;
  idealTime?: string; // HH:MM
  duration?: number; // minutes
}

export type ParsedItem = ParsedHabit | ParsedTask | ParsedMeeting;

const DAY_ABBREVS: Record<string, DayOfWeek> = {
  m: 'mon',
  mo: 'mon',
  mon: 'mon',
  monday: 'mon',
  t: 'tue',
  tu: 'tue',
  tue: 'tue',
  tuesday: 'tue',
  w: 'wed',
  we: 'wed',
  wed: 'wed',
  wednesday: 'wed',
  th: 'thu',
  thu: 'thu',
  thursday: 'thu',
  f: 'fri',
  fr: 'fri',
  fri: 'fri',
  friday: 'fri',
  sa: 'sat',
  sat: 'sat',
  saturday: 'sat',
  su: 'sun',
  sun: 'sun',
  sunday: 'sun',
};

const DAY_ORDER: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

/**
 * Parse a time string like "7am", "2pm", "14:00", "2:30pm" into "HH:MM" format.
 * Returns null if not a valid time.
 */
function parseTimeToken(token: string): string | null {
  // 24h format: "14:00", "9:30"
  const match24 = token.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const h = parseInt(match24[1]);
    const m = parseInt(match24[2]);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    return null;
  }

  // 12h format: "7am", "2pm", "2:30pm", "12am", "12pm"
  const match12 = token.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/i);
  if (match12) {
    let h = parseInt(match12[1]);
    const m = match12[2] ? parseInt(match12[2]) : 0;
    const period = match12[3].toLowerCase();
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (period === 'am') {
      if (h === 12) h = 0;
    } else {
      if (h !== 12) h += 12;
    }
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  return null;
}

/**
 * Parse a duration string like "1h", "30m", "1.5h", "90m" into minutes.
 * Returns null if not a valid duration.
 */
function parseDuration(token: string): number | null {
  const matchH = token.match(/^(\d+(?:\.\d+)?)h$/i);
  if (matchH) {
    const hours = parseFloat(matchH[1]);
    if (hours > 0 && hours <= 24) return Math.round(hours * 60);
    return null;
  }

  const matchM = token.match(/^(\d+)m$/i);
  if (matchM) {
    const mins = parseInt(matchM[1]);
    if (mins > 0 && mins <= 1440) return mins;
    return null;
  }

  return null;
}

/**
 * Parse a compact day string like "MWF", "TTh", "MTWThF" into an array of DayOfWeek.
 * Returns null if not recognized.
 */
function parseDayString(token: string): DayOfWeek[] | null {
  const lower = token.toLowerCase();

  // Special keywords
  if (lower === 'daily' || lower === 'everyday') {
    return [...DAY_ORDER];
  }
  if (lower === 'weekdays') {
    return ['mon', 'tue', 'wed', 'thu', 'fri'];
  }
  if (lower === 'weekends') {
    return ['sat', 'sun'];
  }

  // Full day name (single) — minimum 6 chars ("friday") distinguishes from abbreviations
  if (lower.length >= 6 && DAY_ABBREVS[lower]) {
    return [DAY_ABBREVS[lower]];
  }

  // Compact abbreviation string: "MWF", "TTh", "MTWThF", "MoWeF"
  // Try to greedily parse from left to right
  const days: DayOfWeek[] = [];
  let pos = 0;
  while (pos < lower.length) {
    let matched = false;
    // Try longest match first (up to 3 chars for "thu", "sat", "sun", etc.)
    for (let len = Math.min(3, lower.length - pos); len >= 1; len--) {
      const substr = lower.substring(pos, pos + len);
      if (DAY_ABBREVS[substr]) {
        const day = DAY_ABBREVS[substr];
        if (!days.includes(day)) {
          days.push(day);
        }
        pos += len;
        matched = true;
        break;
      }
    }
    if (!matched) return null; // Unrecognized character
  }

  return days.length > 0 ? days : null;
}

/**
 * Resolve a day name to the next occurrence of that day as an ISO date string.
 * When `timezone` is provided, the current day-of-week is determined in that timezone.
 */
function nextDayOfWeek(dayName: DayOfWeek, referenceDate?: Date, timezone?: string): string {
  const ref = referenceDate ?? new Date();
  const dayIndex = DAY_ORDER.indexOf(dayName);
  // JS: 0=Sun, 1=Mon ... 6=Sat
  // Our index: 0=Mon ... 6=Sun
  const targetJsDay = dayIndex === 6 ? 0 : dayIndex + 1;
  const currentJsDay = timezone ? new TZDate(ref, timezone).getDay() : ref.getDay();
  let daysAhead = targetJsDay - currentJsDay;
  if (daysAhead < 0) daysAhead += 7;
  if (daysAhead === 0) daysAhead = 7;
  const target = set(addDays(ref, daysAhead), {
    hours: 23,
    minutes: 59,
    seconds: 0,
    milliseconds: 0,
  });
  return target.toISOString();
}

/**
 * Try to parse a date expression from the tokens after "by".
 * Supports: day names ("Friday"), "March 15", "2026-03-15".
 * Returns ISO datetime or null.
 */
function parseDateExpr(
  tokens: string[],
  startIdx: number,
  referenceDate?: Date,
  timezone?: string,
): { date: string; consumed: number } | null {
  if (startIdx >= tokens.length) return null;
  const token = tokens[startIdx].toLowerCase();

  // ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(token)) {
    if (timezone) {
      const d = new TZDate(token + 'T23:59:00', timezone);
      if (!isNaN(d.getTime())) return { date: d.toISOString(), consumed: 1 };
    } else {
      const d = new Date(token + 'T23:59:00Z');
      if (!isNaN(d.getTime())) return { date: d.toISOString(), consumed: 1 };
    }
  }

  // Day name (full name, e.g. "friday" — 6+ chars)
  if (token.length >= 6 && DAY_ABBREVS[token]) {
    return { date: nextDayOfWeek(DAY_ABBREVS[token], referenceDate, timezone), consumed: 1 };
  }
  // Short day name
  const shortDay = DAY_ABBREVS[token];
  if (shortDay && token.length >= 3) {
    return { date: nextDayOfWeek(shortDay, referenceDate, timezone), consumed: 1 };
  }

  // Month + day: "March 15" or "march 15"
  // 'may' is both full name and abbreviation — no separate 3-letter entry needed
  if (MONTHS[token] !== undefined && startIdx + 1 < tokens.length) {
    const dayNum = parseInt(tokens[startIdx + 1]);
    if (dayNum >= 1 && dayNum <= 31) {
      const ref = referenceDate ?? new Date();
      const year = ref.getFullYear();
      let d = new Date(Date.UTC(year, MONTHS[token], dayNum, 23, 59, 0));
      // Validate: if JS rolled over (e.g. Feb 31 → Mar 3), reject
      if (d.getUTCDate() !== dayNum) return null;
      // If date is in the past, use next year
      if (d < ref) {
        d = new Date(Date.UTC(year + 1, MONTHS[token], dayNum, 23, 59, 0));
        if (d.getUTCDate() !== dayNum) return null;
      }
      return { date: d.toISOString(), consumed: 2 };
    }
  }

  return null;
}

/**
 * Classified token data extracted from a quick-add input string.
 */
interface ClassifiedTokens {
  time: string | null;
  duration: number | null;
  days: DayOfWeek[] | null;
  dueDate: string | null;
  frequency: 'daily' | 'weekly' | null;
  singleDay: DayOfWeek | null;
  name: string;
}

/**
 * Classify tokens from a quick-add input into structured fields.
 */
function classifyTokens(
  tokens: string[],
  referenceDate?: Date,
  timezone?: string,
): ClassifiedTokens {
  let time: string | null = null;
  let duration: number | null = null;
  let days: DayOfWeek[] | null = null;
  let dueDate: string | null = null;
  let frequency: 'daily' | 'weekly' | null = null;
  let singleDay: DayOfWeek | null = null;

  const consumed = new Set<number>();

  // First pass: find "by" keyword for tasks
  let byIndex = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].toLowerCase() === 'by' && i > 0) {
      byIndex = i;
      break;
    }
  }

  if (byIndex >= 0) {
    const dateResult = parseDateExpr(tokens, byIndex + 1, referenceDate, timezone);
    if (dateResult) {
      dueDate = dateResult.date;
      consumed.add(byIndex);
      for (let j = 0; j < dateResult.consumed; j++) {
        consumed.add(byIndex + 1 + j);
      }
    }
  }

  // Second pass: classify remaining tokens
  for (let i = 0; i < tokens.length; i++) {
    if (consumed.has(i)) continue;
    const t = tokens[i];
    const lower = t.toLowerCase();

    if (lower === 'weekly') {
      frequency = 'weekly';
      consumed.add(i);
      continue;
    }
    if (lower === 'daily') {
      frequency = 'daily';
      days = [...DAY_ORDER];
      consumed.add(i);
      continue;
    }

    const parsedTime = parseTimeToken(t);
    if (parsedTime) {
      time = parsedTime;
      consumed.add(i);
      continue;
    }

    const parsedDuration = parseDuration(t);
    if (parsedDuration !== null) {
      duration = parsedDuration;
      consumed.add(i);
      continue;
    }

    if (!dueDate) {
      const parsedDays = parseDayString(t);
      if (parsedDays) {
        if (parsedDays.length === 1) {
          singleDay = parsedDays[0];
        } else {
          days = parsedDays;
        }
        consumed.add(i);
        continue;
      }
    }
  }

  const nameTokens: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!consumed.has(i)) {
      nameTokens.push(tokens[i]);
    }
  }
  const name = nameTokens.join(' ').trim();

  return { time, duration, days, dueDate, frequency, singleDay, name };
}

/**
 * Determine the item type from classified tokens and build the result.
 */
function determineItemType(classified: ClassifiedTokens): ParsedItem | null {
  const { time, duration, days, dueDate, frequency, singleDay, name } = classified;
  if (!name) return null;

  // Task: has "by" + dueDate
  if (dueDate) {
    const result: ParsedTask = { type: 'task', name, dueDate };
    if (duration !== null) result.totalDuration = duration;
    return result;
  }

  // Habit: has multi-day pattern (MWF, weekdays, daily, etc.)
  if (days && days.length > 1) {
    const result: ParsedHabit = { type: 'habit', name, days };
    if (time) result.idealTime = time;
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Meeting: has "weekly" frequency + single day and/or time
  if (frequency === 'weekly' && (time || singleDay)) {
    const result: ParsedMeeting = { type: 'meeting', name, frequency };
    if (singleDay) result.day = singleDay;
    if (time) result.idealTime = time;
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Habit: has a single day + time
  if (singleDay && time) {
    const result: ParsedHabit = { type: 'habit', name, days: [singleDay], idealTime: time };
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Habit: has a single day pattern
  if (days && days.length === 1) {
    const result: ParsedHabit = { type: 'habit', name, days };
    if (time) result.idealTime = time;
    if (duration !== null) result.duration = duration;
    return result;
  }

  // Fallback: if we have a duration but nothing else, treat as task
  if (duration !== null) {
    return { type: 'task', name, totalDuration: duration } as ParsedTask;
  }

  return null;
}

/**
 * Parse a natural language quick-add input string into a structured item.
 *
 * Patterns:
 *   Habit:   "Gym MWF 7am 1h"
 *   Task:    "Finish report by Friday 3h"
 *   Meeting: "Call with Sarah weekly Thu 2pm 30m"
 */
export function parseQuickAdd(
  input: string,
  referenceDate?: Date,
  timezone?: string,
): ParsedItem | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > 500) return null;

  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return null;

  const classified = classifyTokens(tokens, referenceDate, timezone);
  return determineItemType(classified);
}
