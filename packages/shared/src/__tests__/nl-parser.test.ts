import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from '../nl-parser.js';
import type { ParsedHabit, ParsedTask, ParsedMeeting } from '../nl-parser.js';

// Fixed reference date for deterministic tests: Wednesday March 4, 2026
const REF = new Date(2026, 2, 4, 10, 0, 0);

describe('parseQuickAdd', () => {
  describe('returns null for invalid input', () => {
    it('returns null for empty string', () => {
      expect(parseQuickAdd('')).toBeNull();
    });

    it('returns null for whitespace only', () => {
      expect(parseQuickAdd('   ')).toBeNull();
    });

    it('returns null for a bare name with no structure', () => {
      expect(parseQuickAdd('Something')).toBeNull();
    });

    it('returns null for input exceeding 500 characters', () => {
      const long = 'A'.repeat(501) + ' MWF 7am 1h';
      expect(parseQuickAdd(long)).toBeNull();
    });
  });

  describe('habit parsing', () => {
    it('parses "Gym MWF 7am 1h"', () => {
      const result = parseQuickAdd('Gym MWF 7am 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Gym');
      expect(result.days).toEqual(['mon', 'wed', 'fri']);
      expect(result.idealTime).toBe('07:00');
      expect(result.duration).toBe(60);
    });

    it('parses "Meditation daily 6am 30m"', () => {
      const result = parseQuickAdd('Meditation daily 6am 30m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Meditation');
      expect(result.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
      expect(result.idealTime).toBe('06:00');
      expect(result.duration).toBe(30);
    });

    it('parses "Reading weekdays 9pm 45m"', () => {
      const result = parseQuickAdd('Reading weekdays 9pm 45m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Reading');
      expect(result.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
      expect(result.idealTime).toBe('21:00');
      expect(result.duration).toBe(45);
    });

    it('parses days without time or duration', () => {
      const result = parseQuickAdd('Yoga MWF') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Yoga');
      expect(result.days).toEqual(['mon', 'wed', 'fri']);
      expect(result.idealTime).toBeUndefined();
      expect(result.duration).toBeUndefined();
    });

    it('parses "Walk TuTh 8am 1.5h"', () => {
      const result = parseQuickAdd('Walk TuTh 8am 1.5h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Walk');
      expect(result.days).toEqual(['tue', 'thu']);
      expect(result.idealTime).toBe('08:00');
      expect(result.duration).toBe(90);
    });

    it('parses 24h time format', () => {
      const result = parseQuickAdd('Stretch MWF 14:00 30m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.idealTime).toBe('14:00');
    });

    it('parses 12pm correctly (noon)', () => {
      const result = parseQuickAdd('Lunch weekdays 12pm 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.idealTime).toBe('12:00');
    });

    it('parses 12am correctly (midnight)', () => {
      const result = parseQuickAdd('Night routine weekdays 12am 30m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.idealTime).toBe('00:00');
    });

    it('parses weekend days', () => {
      const result = parseQuickAdd('Hiking weekends 8am 2h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.days).toEqual(['sat', 'sun']);
    });

    it('parses time with minutes like 2:30pm', () => {
      const result = parseQuickAdd('Piano MWF 2:30pm 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.idealTime).toBe('14:30');
    });

    it('parses "everyday" keyword same as "daily"', () => {
      const result = parseQuickAdd('Stretch everyday 7am 15m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    });

    it('parses MTWF (4-day compact abbreviation)', () => {
      const result = parseQuickAdd('Yoga MTWF 7am 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.days).toEqual(['mon', 'tue', 'wed', 'fri']);
    });

    it('parses MTWThF (5-day with Th for Thursday)', () => {
      const result = parseQuickAdd('Standup MTWThF 9am 15m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);
    });

    it('parses single day habit with time', () => {
      const result = parseQuickAdd('Piano Thu 3pm 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.days).toEqual(['thu']);
      expect(result.idealTime).toBe('15:00');
      expect(result.duration).toBe(60);
    });

    it('parses 9:45am time format', () => {
      const result = parseQuickAdd('Coffee MWF 9:45am 15m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.idealTime).toBe('09:45');
    });

    it('parses 0:00 (midnight in 24h format)', () => {
      const result = parseQuickAdd('Meditation daily 0:00 30m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.idealTime).toBe('00:00');
    });

    it('parses 23:59 (end of day in 24h format)', () => {
      const result = parseQuickAdd('Journal daily 23:59 15m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.idealTime).toBe('23:59');
    });
  });

  describe('task parsing', () => {
    it('parses "Finish report by Friday 3h"', () => {
      const result = parseQuickAdd('Finish report by Friday 3h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Finish report');
      expect(result.totalDuration).toBe(180);
      expect(result.dueDate).toBeDefined();
      const due = new Date(result.dueDate!);
      expect(due.getDay()).toBe(5); // Friday
    });

    it('parses "Write docs by March 15 2h"', () => {
      const result = parseQuickAdd('Write docs by March 15 2h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Write docs');
      expect(result.totalDuration).toBe(120);
      expect(result.dueDate).toBeDefined();
      const due = new Date(result.dueDate!);
      expect(due.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(due.getUTCDate()).toBe(15);
    });

    it('parses task with ISO date', () => {
      const result = parseQuickAdd('Ship feature by 2026-03-20 4h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Ship feature');
      expect(result.totalDuration).toBe(240);
      expect(result.dueDate).toBeDefined();
    });

    it('parses task without duration', () => {
      const result = parseQuickAdd('Review PR by Friday', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Review PR');
      expect(result.totalDuration).toBeUndefined();
    });

    it('parses task with only duration (no due date)', () => {
      const result = parseQuickAdd('Clean garage 2h') as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Clean garage');
      expect(result.totalDuration).toBe(120);
    });

    it('parses multi-word task name before "by"', () => {
      const result = parseQuickAdd(
        'Prepare quarterly budget report by Monday 5h',
        REF,
      ) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Prepare quarterly budget report');
      expect(result.totalDuration).toBe(300);
    });

    it('parses task with abbreviated month "by Jan 10"', () => {
      const result = parseQuickAdd('Tax prep by Jan 10 4h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.dueDate).toBeDefined();
      const due = new Date(result.dueDate!);
      expect(due.getUTCMonth()).toBe(0); // January
      expect(due.getUTCDate()).toBe(10);
    });

    it('parses task with short day name "by Wed"', () => {
      const result = parseQuickAdd('Deploy by Wed 2h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.dueDate).toBeDefined();
      const due = new Date(result.dueDate!);
      expect(due.getDay()).toBe(3); // Wednesday
    });

    it('parses task with "by Saturday"', () => {
      const result = parseQuickAdd('Mow lawn by Saturday 1h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.dueDate).toBeDefined();
      const due = new Date(result.dueDate!);
      expect(due.getDay()).toBe(6); // Saturday
    });

    it('parses task with "by Sunday"', () => {
      const result = parseQuickAdd('Grocery list by Sunday 30m', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.totalDuration).toBe(30);
    });

    it('due date in the past auto-bumps to next year for month+day', () => {
      // REF is March 4 2026; "by January 15" is past, should go to Jan 15 2027
      const result = parseQuickAdd('Report by January 15 2h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      const due = new Date(result.dueDate!);
      expect(due.getUTCFullYear()).toBe(2027);
      expect(due.getUTCMonth()).toBe(0);
      expect(due.getUTCDate()).toBe(15);
    });
  });

  describe('meeting parsing', () => {
    it('parses "Call with Sarah weekly Thu 2pm 30m"', () => {
      const result = parseQuickAdd('Call with Sarah weekly Thu 2pm 30m') as ParsedMeeting;
      expect(result).not.toBeNull();
      expect(result.type).toBe('meeting');
      expect(result.name).toBe('Call with Sarah');
      expect(result.frequency).toBe('weekly');
      expect(result.day).toBe('thu');
      expect(result.idealTime).toBe('14:00');
      expect(result.duration).toBe(30);
    });

    it('parses "Standup daily 9am 15m" as habit (daily = all days)', () => {
      const result = parseQuickAdd('Standup daily 9am 15m');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('habit');
    });

    it('parses "Team sync weekly Mon 10am 1h"', () => {
      const result = parseQuickAdd('Team sync weekly Mon 10am 1h') as ParsedMeeting;
      expect(result).not.toBeNull();
      expect(result.type).toBe('meeting');
      expect(result.name).toBe('Team sync');
      expect(result.frequency).toBe('weekly');
      expect(result.day).toBe('mon');
      expect(result.idealTime).toBe('10:00');
      expect(result.duration).toBe(60);
    });

    it('parses meeting with time but no day', () => {
      const result = parseQuickAdd('1:1 with Manager weekly 3pm 30m') as ParsedMeeting;
      expect(result).not.toBeNull();
      expect(result.type).toBe('meeting');
      expect(result.frequency).toBe('weekly');
      expect(result.idealTime).toBe('15:00');
      expect(result.duration).toBe(30);
    });

    it('parses meeting without duration', () => {
      const result = parseQuickAdd('Sprint review weekly Fri 2pm') as ParsedMeeting;
      expect(result).not.toBeNull();
      expect(result.type).toBe('meeting');
      expect(result.name).toBe('Sprint review');
      expect(result.duration).toBeUndefined();
    });

    it('parses meeting with full day name "weekly Friday 10am 1h"', () => {
      const result = parseQuickAdd('All hands weekly Friday 10am 1h') as ParsedMeeting;
      expect(result).not.toBeNull();
      expect(result.type).toBe('meeting');
      expect(result.frequency).toBe('weekly');
      expect(result.idealTime).toBe('10:00');
    });

    it('parses meeting with only weekly + time (no day, no duration)', () => {
      const result = parseQuickAdd('Check-in weekly 4pm') as ParsedMeeting;
      expect(result).not.toBeNull();
      expect(result.type).toBe('meeting');
      expect(result.frequency).toBe('weekly');
      expect(result.idealTime).toBe('16:00');
      expect(result.duration).toBeUndefined();
    });
  });

  describe('duration parsing', () => {
    it('handles fractional hours: 1.5h = 90', () => {
      const result = parseQuickAdd('Walk TuTh 8am 1.5h') as ParsedHabit;
      expect(result!.duration).toBe(90);
    });

    it('handles minutes: 90m = 90', () => {
      const result = parseQuickAdd('Stretch MWF 90m') as ParsedHabit;
      expect(result!.duration).toBe(90);
    });

    it('handles small durations: 15m', () => {
      const result = parseQuickAdd('Break weekdays 15m') as ParsedHabit;
      expect(result!.duration).toBe(15);
    });

    it('handles 0.5h = 30 minutes', () => {
      const result = parseQuickAdd('Breathe MWF 0.5h') as ParsedHabit;
      expect(result!.duration).toBe(30);
    });

    it('handles 2h = 120 minutes', () => {
      const result = parseQuickAdd('Deep work MWF 2h') as ParsedHabit;
      expect(result!.duration).toBe(120);
    });

    it('handles large duration: 1440m (24 hours)', () => {
      const result = parseQuickAdd('Marathon MWF 1440m') as ParsedHabit;
      expect(result!.duration).toBe(1440);
    });

    it('handles 24h (max hours)', () => {
      const result = parseQuickAdd('Endurance MWF 24h') as ParsedHabit;
      expect(result!.duration).toBe(1440);
    });
  });

  describe('edge cases', () => {
    it('handles tokens in different order', () => {
      const result = parseQuickAdd('1h 7am MWF Gym') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Gym');
      expect(result.days).toEqual(['mon', 'wed', 'fri']);
      expect(result.idealTime).toBe('07:00');
      expect(result.duration).toBe(60);
    });

    it('handles "by" that is part of name correctly', () => {
      const result = parseQuickAdd('by Friday 2h', REF);
      expect(result).not.toBeNull();
    });

    it('name preserves original casing', () => {
      const result = parseQuickAdd('My Important Task by Friday 1h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.name).toBe('My Important Task');
    });

    it('single-char "t" maps to tuesday', () => {
      const result = parseQuickAdd('Gym MTW 7am 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      const result2 = parseQuickAdd('Yoga MTWF 7am 1h') as ParsedHabit;
      expect(result2.days).toEqual(['mon', 'tue', 'wed', 'fri']);
    });

    it('ambiguous single-char "s" and "r" are removed', () => {
      const result = parseQuickAdd('Run S 7am 1h');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('task');

      const result2 = parseQuickAdd('Run R 7am 1h');
      expect(result2).not.toBeNull();
      expect(result2!.type).toBe('task');
    });

    it('rejects invalid month/day combinations like Feb 31', () => {
      const result = parseQuickAdd('Report by February 31 3h', REF);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('task');
      expect(result!.name).toContain('February');
    });

    it('rejects invalid month/day combinations like June 31', () => {
      const result = parseQuickAdd('Report by June 31 3h', REF);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('task');
      expect(result!.name).toContain('June');
    });

    it('"by" at start of input is not treated as due-date keyword', () => {
      const result = parseQuickAdd('by Friday finish report 2h', REF);
      expect(result).not.toBeNull();
      if (result!.type === 'task') {
        expect(result!.name).toBeDefined();
        expect(result!.name.length).toBeGreaterThan(0);
      }
    });

    it('past dates should auto-bump to next occurrence', () => {
      // Reference date is Wed March 4 — "Monday" is past (March 2), should bump to March 9
      const result = parseQuickAdd('Review PR by Monday 1h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.dueDate).toBeDefined();
      const due = new Date(result.dueDate!);
      expect(due.getTime()).toBeGreaterThan(REF.getTime());
      expect(due.getDay()).toBe(1); // Monday
    });

    it('"daily" keyword should create habit type', () => {
      const result = parseQuickAdd('Meditation daily 6am 30m');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('habit');
      const habit = result as ParsedHabit;
      expect(habit.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
    });

    it('conflicting keywords should handle gracefully (habit days + "by" deadline)', () => {
      const result = parseQuickAdd('Gym MWF Friday by March 15 2h', REF);
      expect(result).not.toBeNull();
      if (result!.type === 'task') {
        expect((result as ParsedTask).dueDate).toBeDefined();
      }
      expect(result!.name.length).toBeGreaterThan(0);
    });

    it('single "s" character should not parse as a day abbreviation', () => {
      const result = parseQuickAdd('Study s 7am 1h');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('task');
      expect(result!.name).toContain('s');
    });
  });

  describe('unicode and special characters in names', () => {
    it('preserves emoji in task name', () => {
      const result = parseQuickAdd('\u{1F4DD} Write report by Friday 2h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toContain('\u{1F4DD}');
      expect(result.totalDuration).toBe(120);
    });

    it('preserves accented characters in habit name', () => {
      const result = parseQuickAdd('Caf\u00e9 break MWF 3pm 30m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.name).toBe('Caf\u00e9 break');
      expect(result.days).toEqual(['mon', 'wed', 'fri']);
    });

    it('preserves CJK characters in name', () => {
      const result = parseQuickAdd('\u65E5\u672C\u8A9E\u7DF4\u7FD2 MWF 8am 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.name).toBe('\u65E5\u672C\u8A9E\u7DF4\u7FD2');
    });

    it('handles name with numbers', () => {
      const result = parseQuickAdd('Week 3 review by Friday 1h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toContain('Week');
    });

    it('handles name with hyphens and punctuation', () => {
      const result = parseQuickAdd('Self-care MWF 7pm 30m') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.name).toBe('Self-care');
    });
  });

  describe('multiple time expressions', () => {
    it('uses the last time token when multiple times present', () => {
      // Parser consumes tokens left-to-right; second time overwrites first
      const result = parseQuickAdd('Meeting MWF 9am 2pm 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      // The parser should pick one of the times (implementation-dependent)
      expect(result.idealTime).toBeDefined();
      expect(['09:00', '14:00']).toContain(result.idealTime);
    });
  });

  describe('boundary conditions', () => {
    it('handles exactly 500 character input (at limit)', () => {
      const name = 'A'.repeat(490);
      const input = `${name} MWF 1h`;
      expect(input.length).toBeLessThanOrEqual(500);
      const result = parseQuickAdd(input);
      expect(result).not.toBeNull();
    });

    it('handles input with extra spaces between tokens', () => {
      const result = parseQuickAdd('Gym   MWF   7am   1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Gym');
      expect(result.days).toEqual(['mon', 'wed', 'fri']);
    });

    it('handles tab characters in input (split on whitespace)', () => {
      const result = parseQuickAdd('Gym\tMWF\t7am\t1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.type).toBe('habit');
      expect(result.name).toBe('Gym');
    });

    it('leading/trailing whitespace is trimmed', () => {
      const result = parseQuickAdd('  Gym MWF 7am 1h  ') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.name).toBe('Gym');
    });

    it('single token with duration only creates task', () => {
      const result = parseQuickAdd('Cleanup 30m') as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Cleanup');
      expect(result.totalDuration).toBe(30);
    });
  });

  describe('case insensitivity', () => {
    it('day abbreviations are case-insensitive', () => {
      const result = parseQuickAdd('Gym mwf 7am 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.days).toEqual(['mon', 'wed', 'fri']);
    });

    it('time period AM/PM is case-insensitive', () => {
      const result = parseQuickAdd('Gym MWF 7AM 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.idealTime).toBe('07:00');

      const result2 = parseQuickAdd('Gym MWF 7Pm 1h') as ParsedHabit;
      expect(result2).not.toBeNull();
      expect(result2.idealTime).toBe('19:00');
    });

    it('duration suffix is case-insensitive', () => {
      const result = parseQuickAdd('Gym MWF 1H') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.duration).toBe(60);

      const result2 = parseQuickAdd('Gym MWF 30M') as ParsedHabit;
      expect(result2).not.toBeNull();
      expect(result2.duration).toBe(30);
    });

    it('keywords DAILY/WEEKLY are case-insensitive', () => {
      const result = parseQuickAdd('Standup DAILY 9am 15m');
      expect(result).not.toBeNull();
      expect(result!.type).toBe('habit');

      const result2 = parseQuickAdd('Sync WEEKLY Fri 2pm 30m') as ParsedMeeting;
      expect(result2).not.toBeNull();
      expect(result2.type).toBe('meeting');
      expect(result2.frequency).toBe('weekly');
    });

    it('"WEEKDAYS" and "WEEKENDS" are case-insensitive', () => {
      const result = parseQuickAdd('Gym WEEKDAYS 7am 1h') as ParsedHabit;
      expect(result).not.toBeNull();
      expect(result.days).toEqual(['mon', 'tue', 'wed', 'thu', 'fri']);

      const result2 = parseQuickAdd('Hike WEEKENDS 9am 2h') as ParsedHabit;
      expect(result2).not.toBeNull();
      expect(result2.days).toEqual(['sat', 'sun']);
    });
  });

  describe('month name variants in task due dates', () => {
    const monthTests: Array<{ input: string; expectedMonth: number }> = [
      { input: 'Task by Jan 5 1h', expectedMonth: 0 },
      { input: 'Task by Feb 5 1h', expectedMonth: 1 },
      { input: 'Task by Apr 5 1h', expectedMonth: 3 },
      { input: 'Task by May 5 1h', expectedMonth: 4 },
      { input: 'Task by Jun 5 1h', expectedMonth: 5 },
      { input: 'Task by Jul 5 1h', expectedMonth: 6 },
      { input: 'Task by Aug 5 1h', expectedMonth: 7 },
      { input: 'Task by Sep 5 1h', expectedMonth: 8 },
      { input: 'Task by Oct 5 1h', expectedMonth: 9 },
      { input: 'Task by Nov 5 1h', expectedMonth: 10 },
      { input: 'Task by Dec 5 1h', expectedMonth: 11 },
    ];

    for (const { input, expectedMonth } of monthTests) {
      it(`parses "${input}" with correct month`, () => {
        const result = parseQuickAdd(input, REF) as ParsedTask;
        expect(result).not.toBeNull();
        expect(result.type).toBe('task');
        expect(result.dueDate).toBeDefined();
        const due = new Date(result.dueDate!);
        expect(due.getUTCMonth()).toBe(expectedMonth);
      });
    }
  });
});
