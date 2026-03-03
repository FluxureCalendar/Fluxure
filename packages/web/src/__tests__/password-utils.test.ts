import { describe, it, expect } from 'vitest';
import { getPasswordStrength } from '$lib/utils/password';

describe('getPasswordStrength', () => {
  it('rates empty password as weak', () => {
    expect(getPasswordStrength('')).toBe('weak');
  });

  it('rates short password as weak', () => {
    expect(getPasswordStrength('abc')).toBe('weak');
  });

  it('rates password meeting minimum length but no variety as weak', () => {
    expect(getPasswordStrength('abcdefgh')).toBe('weak');
  });

  it('rates password with length and mixed case as fair', () => {
    expect(getPasswordStrength('Abcdefg1')).toBe('fair');
  });

  it('rates strong password with all criteria', () => {
    expect(getPasswordStrength('Abcdefghij1!')).toBe('strong');
  });

  it('rates 12-char lowercase-only password as weak', () => {
    expect(getPasswordStrength('abcdefghijkl')).toBe('weak');
  });

  it('rates 12-char mixed case with digit as strong', () => {
    expect(getPasswordStrength('Abcdefghijk1')).toBe('strong');
  });

  it('rates password with special chars contributing to score', () => {
    expect(getPasswordStrength('Abcdef1!')).toBe('strong');
  });
});
