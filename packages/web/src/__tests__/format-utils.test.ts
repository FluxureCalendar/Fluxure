import { describe, it, expect } from 'vitest';
import { formatDuration, formatDateShort } from '$lib/utils/format';

describe('formatDuration', () => {
  it('formats minutes only', () => {
    expect(formatDuration(30)).toBe('30m');
  });

  it('formats zero minutes', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('formats exact hours', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
  });

  it('formats hours and minutes combined', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
    expect(formatDuration(75)).toBe('1h 15m');
  });

  it('handles large durations', () => {
    expect(formatDuration(480)).toBe('8h');
    expect(formatDuration(495)).toBe('8h 15m');
  });
});

describe('formatDateShort', () => {
  it('formats an ISO date string to short format', () => {
    const result = formatDateShort('2026-03-07T12:00:00Z');
    expect(result).toMatch(/Mar\s+7/);
  });

  it('returns empty string for null', () => {
    expect(formatDateShort(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatDateShort(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDateShort('')).toBe('');
  });

  it('formats different months correctly', () => {
    const jan = formatDateShort('2026-01-15T00:00:00Z');
    expect(jan).toMatch(/Jan\s+15/);

    const dec = formatDateShort('2026-12-25T00:00:00Z');
    expect(dec).toMatch(/Dec\s+25/);
  });
});
