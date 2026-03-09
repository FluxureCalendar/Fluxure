import { describe, it, expect } from 'vitest';
import { isValidTimezone, parseTime, parseTimeToMinutes } from '../date-utils.js';

describe('isValidTimezone', () => {
  it('should accept valid IANA timezone identifiers', () => {
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Europe/London')).toBe(true);
    expect(isValidTimezone('Asia/Tokyo')).toBe(true);
    expect(isValidTimezone('Pacific/Auckland')).toBe(true);
    expect(isValidTimezone('UTC')).toBe(true);
    expect(isValidTimezone('Pacific/Honolulu')).toBe(true);
    expect(isValidTimezone('Australia/Sydney')).toBe(true);
  });

  it('should reject invalid timezone strings', () => {
    expect(isValidTimezone('America/New_Yo_rk')).toBe(false);
    expect(isValidTimezone('NotATimezone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('Fake/Zone')).toBe(false);
  });
});

describe('parseTime', () => {
  it('should parse valid HH:MM strings', () => {
    expect(parseTime('09:00')).toEqual({ hours: 9, minutes: 0 });
    expect(parseTime('23:59')).toEqual({ hours: 23, minutes: 59 });
    expect(parseTime('00:00')).toEqual({ hours: 0, minutes: 0 });
  });

  it('should return null for invalid strings', () => {
    expect(parseTime('')).toBeNull();
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('9:00')).toEqual({ hours: 9, minutes: 0 }); // 1-digit hour is valid
  });
});

describe('parseTimeToMinutes', () => {
  it('should convert HH:MM to minutes since midnight', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('09:30')).toBe(570);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('should return null for invalid input', () => {
    expect(parseTimeToMinutes('')).toBeNull();
    expect(parseTimeToMinutes('invalid')).toBeNull();
  });
});
