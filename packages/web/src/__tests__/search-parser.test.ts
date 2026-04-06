import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseQuery,
  getActivePrefix,
  parseDateExpression,
  parseTimeExpression,
  getValidationError,
} from '$lib/search-parser';

describe('parseQuery', () => {
  it('returns default filters for empty input', () => {
    const result = parseQuery('');
    expect(result.type).toBeNull();
    expect(result.priority).toBeNull();
    expect(result.color).toBeNull();
    expect(result.status).toBeNull();
    expect(result.dateRange).toBeNull();
    expect(result.timeMinutes).toBeNull();
    expect(result.scope).toBeNull();
    expect(result.freeText).toBe('');
  });

  it('parses free text with no filters', () => {
    const result = parseQuery('morning workout');
    expect(result.freeText).toBe('morning workout');
    expect(result.type).toBeNull();
  });

  it('parses type filter', () => {
    expect(parseQuery('type:habit').type).toBe('habit');
    expect(parseQuery('type:task').type).toBe('task');
    expect(parseQuery('type:meeting').type).toBe('meeting');
    expect(parseQuery('type:event').type).toBe('event');
  });

  it('ignores invalid type values', () => {
    expect(parseQuery('type:focus').type).toBeNull();
    expect(parseQuery('type:bogus').type).toBeNull();
  });

  it('parses priority filter by label', () => {
    expect(parseQuery('priority:low').priority).toBe(4);
    expect(parseQuery('priority:medium').priority).toBe(3);
    expect(parseQuery('priority:high').priority).toBe(2);
    expect(parseQuery('priority:critical').priority).toBe(1);
    expect(parseQuery('priority:crit').priority).toBe(1);
  });

  it('parses priority filter by number', () => {
    expect(parseQuery('priority:1').priority).toBe(1);
    expect(parseQuery('priority:4').priority).toBe(4);
  });

  it('ignores invalid priority values', () => {
    expect(parseQuery('priority:5').priority).toBeNull();
    expect(parseQuery('priority:none').priority).toBeNull();
  });

  it('parses color filter by name', () => {
    const result = parseQuery('color:blue');
    expect(result.color).toBe('#4285f4');
  });

  it('parses color filter by hex', () => {
    const result = parseQuery('color:#ff6d01');
    expect(result.color).toBe('#ff6d01');
  });

  it('ignores unknown color names', () => {
    expect(parseQuery('color:magenta').color).toBeNull();
  });

  it('parses status filter', () => {
    expect(parseQuery('status:open').status).toEqual({ field: 'status', value: ['open'] });
    expect(parseQuery('status:done').status).toEqual({ field: 'status', value: ['completed'] });
    expect(parseQuery('status:enabled').status).toEqual({ field: 'enabled', value: true });
    expect(parseQuery('status:disabled').status).toEqual({ field: 'enabled', value: false });
  });

  it('parses scope filter', () => {
    expect(parseQuery('in:settings').scope).toBe('settings');
    expect(parseQuery('in:nav').scope).toBe('nav');
    expect(parseQuery('in:bogus').scope).toBeNull();
  });

  it('parses time filter', () => {
    expect(parseQuery('time:9am').timeMinutes).toBe(540);
    expect(parseQuery('time:14:00').timeMinutes).toBe(840);
  });

  it('combines filters with free text', () => {
    const result = parseQuery('type:habit priority:high morning run');
    expect(result.type).toBe('habit');
    expect(result.priority).toBe(2);
    expect(result.freeText).toBe('morning run');
  });

  it('treats unknown prefix:value tokens as free text', () => {
    const result = parseQuery('foo:bar');
    expect(result.freeText).toBe('foo:bar');
  });

  it('handles whitespace-only input', () => {
    const result = parseQuery('   ');
    expect(result.freeText).toBe('');
  });

  it('parses date filter with multi-word lookahead (this week)', () => {
    const result = parseQuery('date:this week');
    expect(result.dateRange).not.toBeNull();
  });

  it('parses date filter with hyphenated multi-word (this-week)', () => {
    const result = parseQuery('date:this-week');
    expect(result.dateRange).not.toBeNull();
  });
});

describe('parseDateExpression', () => {
  let realDate: typeof Date;

  beforeEach(() => {
    realDate = globalThis.Date;
    // Fix "now" to 2026-03-23 (Monday) for deterministic tests
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 23, 12, 0, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses "today"', () => {
    const [start, end] = parseDateExpression('today')!;
    expect(start.getDate()).toBe(23);
    expect(end.getHours()).toBe(23);
    expect(end.getMinutes()).toBe(59);
  });

  it('parses "tomorrow"', () => {
    const [start] = parseDateExpression('tomorrow')!;
    expect(start.getDate()).toBe(24);
  });

  it('parses "yesterday"', () => {
    const [start] = parseDateExpression('yesterday')!;
    expect(start.getDate()).toBe(22);
  });

  it('parses "this week" (Mon-Sun)', () => {
    const [start, end] = parseDateExpression('this week')!;
    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0); // Sunday (end of day)
  });

  it('parses "next week"', () => {
    const [start, end] = parseDateExpression('next week')!;
    expect(start.getDay()).toBe(1);
    expect(start.getDate()).toBe(30); // Next Monday
  });

  it('parses "this month"', () => {
    const [start, end] = parseDateExpression('this month')!;
    expect(start.getDate()).toBe(1);
    expect(start.getMonth()).toBe(2); // March
    expect(end.getDate()).toBe(31);
  });

  it('parses "next month"', () => {
    const [start, end] = parseDateExpression('next month')!;
    expect(start.getMonth()).toBe(3); // April
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(30); // April has 30 days
  });

  it('parses ISO date format', () => {
    const [start, end] = parseDateExpression('2026-03-25')!;
    expect(start.getDate()).toBe(25);
    expect(start.getMonth()).toBe(2);
    expect(end.getHours()).toBe(23);
  });

  it('parses named month + day (mar 25)', () => {
    const [start] = parseDateExpression('mar 25')!;
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(25);
  });

  it('parses day + named month (25 mar)', () => {
    const [start] = parseDateExpression('25 mar')!;
    expect(start.getMonth()).toBe(2);
    expect(start.getDate()).toBe(25);
  });

  it('parses full month name (january 15)', () => {
    const [start] = parseDateExpression('january 15')!;
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(15);
  });

  it('parses two-part numeric date (15/03)', () => {
    const result = parseDateExpression('15/03');
    expect(result).not.toBeNull();
    // 15/03 is unambiguous (15 can only be day)
    expect(result![0].getDate()).toBe(15);
    expect(result![0].getMonth()).toBe(2);
  });

  it('parses three-part numeric date with year (25/03/2026)', () => {
    const result = parseDateExpression('25/03/2026');
    expect(result).not.toBeNull();
    expect(result![0].getFullYear()).toBe(2026);
  });

  it('parses two-digit year (25/03/26)', () => {
    const result = parseDateExpression('25/03/26');
    expect(result).not.toBeNull();
    expect(result![0].getFullYear()).toBe(2026);
  });

  it('returns null for invalid expression', () => {
    expect(parseDateExpression('notadate')).toBeNull();
    expect(parseDateExpression('')).toBeNull();
  });
});

describe('parseTimeExpression', () => {
  it('parses 12-hour time (am)', () => {
    expect(parseTimeExpression('9am')).toBe(540);
    expect(parseTimeExpression('12am')).toBe(0);
    expect(parseTimeExpression('11:30am')).toBe(690);
  });

  it('parses 12-hour time (pm)', () => {
    expect(parseTimeExpression('1pm')).toBe(780);
    expect(parseTimeExpression('12pm')).toBe(720);
    expect(parseTimeExpression('2:30pm')).toBe(870);
    expect(parseTimeExpression('11:00pm')).toBe(1380);
  });

  it('parses 24-hour time', () => {
    expect(parseTimeExpression('0:00')).toBe(0);
    expect(parseTimeExpression('9:00')).toBe(540);
    expect(parseTimeExpression('14:00')).toBe(840);
    expect(parseTimeExpression('23:59')).toBe(1439);
  });

  it('returns null for invalid time', () => {
    expect(parseTimeExpression('25:00')).toBeNull();
    expect(parseTimeExpression('abc')).toBeNull();
    expect(parseTimeExpression('')).toBeNull();
    expect(parseTimeExpression('14:60')).toBeNull();
  });
});

describe('getActivePrefix', () => {
  it('returns null for empty input', () => {
    expect(getActivePrefix('')).toBeNull();
  });

  it('detects lone colon', () => {
    expect(getActivePrefix(':')).toEqual({ prefix: ':', partial: '' });
  });

  it('detects known prefix with partial value', () => {
    expect(getActivePrefix('type:ha')).toEqual({ prefix: 'type', partial: 'ha' });
    expect(getActivePrefix('priority:')).toEqual({ prefix: 'priority', partial: '' });
  });

  it('returns null for unknown prefix', () => {
    expect(getActivePrefix('foo:bar')).toBeNull();
  });

  it('detects prefix at end of multi-token input', () => {
    expect(getActivePrefix('morning color:bl')).toEqual({ prefix: 'color', partial: 'bl' });
  });

  it('returns null for plain text', () => {
    expect(getActivePrefix('just some text')).toBeNull();
  });
});

describe('getValidationError', () => {
  it('returns null for empty value', () => {
    expect(getValidationError('type', '')).toBeNull();
  });

  it('returns null for valid type', () => {
    expect(getValidationError('type', 'habit')).toBeNull();
  });

  it('returns error for invalid type', () => {
    expect(getValidationError('type', 'bogus')).toMatch(/Unknown type/);
  });

  it('returns null for valid priority label', () => {
    expect(getValidationError('priority', 'high')).toBeNull();
  });

  it('returns error for invalid priority', () => {
    expect(getValidationError('priority', 'extreme')).toMatch(/Unknown priority/);
  });

  it('returns null for valid color name', () => {
    expect(getValidationError('color', 'blue')).toBeNull();
  });

  it('returns null for hex color', () => {
    expect(getValidationError('color', '#ff0000')).toBeNull();
  });

  it('returns error for invalid color', () => {
    expect(getValidationError('color', 'magenta')).toMatch(/Unknown color/);
  });

  it('returns null for valid status', () => {
    expect(getValidationError('status', 'open')).toBeNull();
  });

  it('returns error for invalid status', () => {
    expect(getValidationError('status', 'pending')).toMatch(/Unknown status/);
  });

  it('returns error for invalid date', () => {
    expect(getValidationError('date', 'notadate')).toMatch(/Unknown date/);
  });

  it('returns error for invalid time', () => {
    expect(getValidationError('time', 'noon')).toMatch(/Unknown time/);
  });

  it('returns error for invalid scope', () => {
    expect(getValidationError('in', 'dashboard')).toMatch(/Unknown scope/);
  });
});
