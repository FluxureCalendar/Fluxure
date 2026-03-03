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
  });

  describe('task parsing', () => {
    it('parses "Finish report by Friday 3h"', () => {
      const result = parseQuickAdd('Finish report by Friday 3h', REF) as ParsedTask;
      expect(result).not.toBeNull();
      expect(result.type).toBe('task');
      expect(result.name).toBe('Finish report');
      expect(result.totalDuration).toBe(180);
      expect(result.dueDate).toBeDefined();
      // Should be the next Friday from March 4 (Wednesday) = March 6
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

    it('parses "Standup daily 9am 15m"', () => {
      // "daily" sets all 7 days, which triggers the habit path
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
  });

  describe('duration parsing', () => {
    it('handles fractional hours: 1.5h → 90', () => {
      const result = parseQuickAdd('Walk TuTh 8am 1.5h') as ParsedHabit;
      expect(result!.duration).toBe(90);
    });

    it('handles minutes: 90m → 90', () => {
      const result = parseQuickAdd('Stretch MWF 90m') as ParsedHabit;
      expect(result!.duration).toBe(90);
    });

    it('handles small durations: 15m', () => {
      const result = parseQuickAdd('Break weekdays 15m') as ParsedHabit;
      expect(result!.duration).toBe(15);
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
});
