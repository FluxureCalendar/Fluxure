import { describe, it, expect } from 'vitest';
import { getPasswordStrength } from '$lib/utils/password';

describe('getPasswordStrength', () => {
  // Weak: score <= 2
  it('rates empty password as weak', () => {
    expect(getPasswordStrength('')).toBe('weak');
  });

  it('rates short password as weak', () => {
    expect(getPasswordStrength('abc')).toBe('weak');
  });

  it('rates password at min length but all lowercase as weak', () => {
    // score: +1 (length >= 8) = 1
    expect(getPasswordStrength('abcdefgh')).toBe('weak');
  });

  it('rates long all-lowercase as weak', () => {
    // score: +1 (>= 8) + 1 (>= 12) = 2
    expect(getPasswordStrength('abcdefghijkl')).toBe('weak');
  });

  it('rates short password with mixed case as weak', () => {
    // score: +1 (mixed case) = 1 (no length points)
    expect(getPasswordStrength('AbCdEf')).toBe('weak');
  });

  // Fair: score == 3
  it('rates password with length + mixed case as fair', () => {
    // score: +1 (>= 8) + 1 (mixed case) + 1 (digit) = 3
    expect(getPasswordStrength('Abcdefg1')).toBe('fair');
  });

  it('rates long all-lowercase with digit as fair', () => {
    // score: +1 (>= 8) + 1 (>= 12) + 1 (digit) = 3
    expect(getPasswordStrength('abcdefghijk1')).toBe('fair');
  });

  // Strong: score >= 4
  it('rates strong password with all criteria', () => {
    // score: +1 (>= 8) + 1 (>= 12) + 1 (mixed case) + 1 (digit) + 1 (special) = 5
    expect(getPasswordStrength('Abcdefghij1!')).toBe('strong');
  });

  it('rates 12-char mixed case with digit as strong', () => {
    // score: +1 (>= 8) + 1 (>= 12) + 1 (mixed case) + 1 (digit) = 4
    expect(getPasswordStrength('Abcdefghijk1')).toBe('strong');
  });

  it('rates 8-char with mixed case, digit, and special as strong', () => {
    // score: +1 (>= 8) + 1 (mixed case) + 1 (digit) + 1 (special) = 4
    expect(getPasswordStrength('Abcdef1!')).toBe('strong');
  });

  it('rates long password with mixed case and special (no digit) as strong', () => {
    // score: +1 (>= 8) + 1 (>= 12) + 1 (mixed case) + 1 (special) = 4
    expect(getPasswordStrength('Abcdefghijkl!')).toBe('strong');
  });

  it('handles whitespace-only input as weak', () => {
    expect(getPasswordStrength('        ')).toBe('weak');
  });
});
