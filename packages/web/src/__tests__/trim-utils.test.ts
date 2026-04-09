import { describe, it, expect } from 'vitest';
import { trimStrings } from '$lib/utils/trim';

describe('trimStrings', () => {
  it('trims whitespace from string values', () => {
    const result = trimStrings({ name: '  hello  ', email: ' test@example.com ' });
    expect(result).toEqual({ name: 'hello', email: 'test@example.com' });
  });

  it('preserves non-string values', () => {
    const result = trimStrings({ count: 42, active: true, tags: null });
    expect(result).toEqual({ count: 42, active: true, tags: null });
  });

  it('handles empty strings', () => {
    const result = trimStrings({ name: '', other: '  ' });
    expect(result).toEqual({ name: '', other: '' });
  });

  it('does not mutate the input object', () => {
    const input = { name: '  hello  ' };
    const result = trimStrings(input);
    expect(input.name).toBe('  hello  ');
    expect(result.name).toBe('hello');
    expect(result).not.toBe(input);
  });

  it('handles empty object', () => {
    expect(trimStrings({})).toEqual({});
  });

  it('handles mixed string and non-string values', () => {
    const result = trimStrings({
      title: '  My Task ',
      duration: 30,
      enabled: false,
      color: '#4285f4 ',
    });
    expect(result).toEqual({
      title: 'My Task',
      duration: 30,
      enabled: false,
      color: '#4285f4',
    });
  });
});
