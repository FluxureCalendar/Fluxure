import { describe, it, expect } from 'vitest';
import { getPlanLimits, isUnlimited } from '../plan-limits.js';

describe('getPlanLimits', () => {
  it('returns free limits for free plan', () => {
    const limits = getPlanLimits('free');
    expect(limits.maxHabits).toBe(3);
    expect(limits.maxTasks).toBe(5);
    expect(limits.maxMeetings).toBe(2);
    expect(limits.maxCalendars).toBe(1);
    expect(limits.schedulingWindowDays).toBe(14);
    expect(limits.analyticsEnabled).toBe(false);
  });

  it('returns pro limits for pro plan', () => {
    const limits = getPlanLimits('pro');
    expect(limits.maxHabits).toBe(-1);
    expect(limits.maxTasks).toBe(-1);
    expect(limits.schedulingWindowDays).toBe(90);
    expect(limits.analyticsEnabled).toBe(true);
  });

  it('defaults to free for unknown plan', () => {
    const limits = getPlanLimits('unknown' as any);
    expect(limits.maxHabits).toBe(3);
  });
});

describe('isUnlimited', () => {
  it('returns true for -1', () => {
    expect(isUnlimited(-1)).toBe(true);
  });

  it('returns false for positive numbers', () => {
    expect(isUnlimited(3)).toBe(false);
    expect(isUnlimited(0)).toBe(false);
  });
});
