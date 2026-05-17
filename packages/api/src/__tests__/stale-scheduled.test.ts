import { describe, it, expect } from 'vitest';
import { isStaleScheduledItemId } from '../utils/stale-scheduled.js';

// Fixed cutoff so tests never depend on the wall clock.
const CUTOFF = Date.parse('2026-05-10T00:00:00.000Z');

describe('isStaleScheduledItemId', () => {
  it('flags a habit occurrence whose itemId date is well before the cutoff', () => {
    expect(isStaleScheduledItemId('11111111-1111-1111-1111-111111111111__2026-04-01', CUTOFF)).toBe(
      true,
    );
  });

  it('keeps an occurrence whose itemId date is after the cutoff', () => {
    expect(isStaleScheduledItemId('11111111-1111-1111-1111-111111111111__2026-05-17', CUTOFF)).toBe(
      false,
    );
  });

  it('flags an occurrence one day before the cutoff', () => {
    expect(isStaleScheduledItemId('aaaa__2026-05-09', CUTOFF)).toBe(true);
  });

  it('keeps an occurrence exactly at the cutoff (strictly-older only)', () => {
    expect(isStaleScheduledItemId('aaaa__2026-05-10', CUTOFF)).toBe(false);
  });

  it('keeps task itemIds (chunk suffix is not a date)', () => {
    expect(isStaleScheduledItemId('22222222-2222-2222-2222-222222222222__chunk0', CUTOFF)).toBe(
      false,
    );
  });

  it('keeps itemIds with no date separator', () => {
    expect(isStaleScheduledItemId('33333333-3333-3333-3333-333333333333', CUTOFF)).toBe(false);
  });

  it('keeps malformed date suffixes', () => {
    expect(isStaleScheduledItemId('aaaa__not-a-date', CUTOFF)).toBe(false);
  });

  it('returns false for empty / null / undefined itemIds', () => {
    expect(isStaleScheduledItemId('', CUTOFF)).toBe(false);
    expect(isStaleScheduledItemId(null, CUTOFF)).toBe(false);
    expect(isStaleScheduledItemId(undefined, CUTOFF)).toBe(false);
  });
});
