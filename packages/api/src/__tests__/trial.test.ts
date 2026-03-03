import { describe, it, expect } from 'vitest';
import { isTrialActive, getEffectivePlan, getTrialDaysRemaining } from '../billing/trial.js';

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

describe('isTrialActive', () => {
  it('returns true when plan=pro, planPeriodEnd in future, no stripeSubscriptionId', () => {
    expect(
      isTrialActive({ plan: 'pro', planPeriodEnd: daysFromNow(10), stripeSubscriptionId: null }),
    ).toBe(true);
  });

  it('returns false when plan=pro but planPeriodEnd in past (expired)', () => {
    expect(
      isTrialActive({ plan: 'pro', planPeriodEnd: daysFromNow(-1), stripeSubscriptionId: null }),
    ).toBe(false);
  });

  it('returns false when plan=pro with stripeSubscriptionId (paid, not trial)', () => {
    expect(
      isTrialActive({
        plan: 'pro',
        planPeriodEnd: daysFromNow(10),
        stripeSubscriptionId: 'sub_123',
      }),
    ).toBe(false);
  });

  it('returns false when plan=free', () => {
    expect(isTrialActive({ plan: 'free', planPeriodEnd: null, stripeSubscriptionId: null })).toBe(
      false,
    );
  });

  it('returns false when plan=pro but planPeriodEnd is null', () => {
    expect(isTrialActive({ plan: 'pro', planPeriodEnd: null, stripeSubscriptionId: null })).toBe(
      false,
    );
  });
});

describe('getEffectivePlan', () => {
  it('returns pro when trial is active', () => {
    expect(
      getEffectivePlan({ plan: 'pro', planPeriodEnd: daysFromNow(10), stripeSubscriptionId: null }),
    ).toBe('pro');
  });

  it('returns free when trial expired', () => {
    expect(
      getEffectivePlan({ plan: 'pro', planPeriodEnd: daysFromNow(-1), stripeSubscriptionId: null }),
    ).toBe('free');
  });

  it('returns pro when paid subscriber (has stripeSubscriptionId)', () => {
    expect(
      getEffectivePlan({
        plan: 'pro',
        planPeriodEnd: daysFromNow(30),
        stripeSubscriptionId: 'sub_123',
      }),
    ).toBe('pro');
  });

  it('returns free when plan is free', () => {
    expect(
      getEffectivePlan({ plan: 'free', planPeriodEnd: null, stripeSubscriptionId: null }),
    ).toBe('free');
  });
});

describe('getTrialDaysRemaining', () => {
  it('returns correct days when planPeriodEnd is 10 days out', () => {
    const result = getTrialDaysRemaining(daysFromNow(10));
    expect(result).toBe(10);
  });

  it('returns 0 when planPeriodEnd is in the past', () => {
    expect(getTrialDaysRemaining(daysFromNow(-5))).toBe(0);
  });

  it('returns null when planPeriodEnd is null', () => {
    expect(getTrialDaysRemaining(null)).toBeNull();
  });

  it('returns 1 for a date just over 0 days away', () => {
    const almostTomorrow = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    expect(getTrialDaysRemaining(almostTomorrow)).toBe(1);
  });
});
