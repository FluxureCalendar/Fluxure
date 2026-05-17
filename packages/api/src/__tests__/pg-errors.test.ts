import { describe, expect, it } from 'vitest';
import { DrizzleQueryError } from 'drizzle-orm/errors';
import { pgErrorCode, PG_UNIQUE_VIOLATION, PG_FK_VIOLATION } from '../db/pg-errors.js';

/**
 * Models a real `pg` driver error: an Error instance carrying a SQLSTATE
 * string `code` (e.g. '23505' unique_violation, '23503' foreign_key_violation).
 */
function pgError(code: string): Error & { code: string } {
  const err = new Error('duplicate key value violates unique constraint') as Error & {
    code: string;
  };
  err.code = code;
  return err;
}

describe('pgErrorCode', () => {
  it('reads the SQLSTATE code from a raw pg error (pre-wrapping drizzle path)', () => {
    expect(pgErrorCode(pgError('23505'))).toBe('23505');
  });

  it('unwraps a DrizzleQueryError to the underlying pg code (the production bug)', () => {
    // drizzle-orm 0.45.2 wraps the driver error: the SQLSTATE code is on
    // `.cause`, NOT on the top-level DrizzleQueryError.
    const wrapped = new DrizzleQueryError(
      'insert into "habit_completions" ...',
      ['u', 'h', '2026-05-17'],
      pgError('23505'),
    );
    expect('code' in wrapped).toBe(false); // documents why the old check broke
    expect(pgErrorCode(wrapped)).toBe('23505');
  });

  it('unwraps a foreign-key violation through DrizzleQueryError', () => {
    const wrapped = new DrizzleQueryError('insert ...', [], pgError('23503'));
    expect(pgErrorCode(wrapped)).toBe('23503');
  });

  it('walks a nested cause chain', () => {
    const inner = pgError('23505');
    const middle = new Error('wrapper') as Error & { cause: unknown };
    middle.cause = inner;
    const outer = new Error('outer') as Error & { cause: unknown };
    outer.cause = middle;
    expect(pgErrorCode(outer)).toBe('23505');
  });

  it('returns undefined when no SQLSTATE code is present', () => {
    expect(pgErrorCode(new Error('plain'))).toBeUndefined();
    expect(pgErrorCode(null)).toBeUndefined();
    expect(pgErrorCode(undefined)).toBeUndefined();
    expect(pgErrorCode('boom')).toBeUndefined();
    expect(pgErrorCode({})).toBeUndefined();
  });

  it('ignores non-string codes (e.g. numeric Google API codes)', () => {
    expect(pgErrorCode({ code: 410 })).toBeUndefined();
  });

  it('does not hang on a circular cause chain', () => {
    const a = new Error('a') as Error & { cause: unknown };
    a.cause = a;
    expect(pgErrorCode(a)).toBeUndefined();
  });

  it('exposes the SQLSTATE constants it is used with', () => {
    expect(PG_UNIQUE_VIOLATION).toBe('23505');
    expect(PG_FK_VIOLATION).toBe('23503');
  });
});
