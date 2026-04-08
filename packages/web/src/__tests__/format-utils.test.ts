import { describe, it, expect } from 'vitest';
import { formatDuration, formatDateShort } from '$lib/utils/format';

describe('formatDuration', () => {
  it('formats zero minutes', () => {
    expect(formatDuration(0)).toBe('0m');
  });

  it('formats minutes only (< 60)', () => {
    expect(formatDuration(1)).toBe('1m');
    expect(formatDuration(30)).toBe('30m');
    expect(formatDuration(59)).toBe('59m');
  });

  it('formats exact hours', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(120)).toBe('2h');
    expect(formatDuration(180)).toBe('3h');
  });

  it('formats hours and minutes combined', () => {
    expect(formatDuration(61)).toBe('1h 1m');
    expect(formatDuration(75)).toBe('1h 15m');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(150)).toBe('2h 30m');
  });

  it('handles large durations', () => {
    expect(formatDuration(480)).toBe('8h');
    expect(formatDuration(495)).toBe('8h 15m');
    expect(formatDuration(1440)).toBe('24h');
  });

  it('handles negative input gracefully', () => {
    // Math.floor(-61/60) = -2, -61%60 = -1 → both truthy → "-2h -1m"
    const result = formatDuration(-61);
    expect(result).toBe('-2h -1m');
  });
});

describe('formatDateShort', () => {
  it('returns empty string for null', () => {
    expect(formatDateShort(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(formatDateShort(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(formatDateShort('')).toBe('');
  });

  it('formats an ISO date string to short format', () => {
    const result = formatDateShort('2026-03-07T12:00:00Z');
    expect(result).toMatch(/Mar\s+7/);
  });

  it('formats different months correctly', () => {
    expect(formatDateShort('2026-01-15T00:00:00Z')).toMatch(/Jan\s+15/);
    expect(formatDateShort('2026-06-01T00:00:00Z')).toMatch(/Jun\s+1/);
    expect(formatDateShort('2026-12-25T00:00:00Z')).toMatch(/Dec\s+25/);
  });

  it('formats first day of the year', () => {
    expect(formatDateShort('2026-01-01T12:00:00Z')).toMatch(/Jan\s+1/);
  });

  it('formats last day of the year', () => {
    expect(formatDateShort('2026-12-31T12:00:00Z')).toMatch(/Dec\s+31/);
  });

  it('handles date-only strings', () => {
    const result = formatDateShort('2026-09-15');
    expect(result).toMatch(/Sep\s+15/);
  });
});
