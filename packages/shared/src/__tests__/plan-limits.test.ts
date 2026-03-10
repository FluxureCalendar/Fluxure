import { describe, it, expect } from 'vitest';
import { getPlanLimits, isUnlimited, PLAN_LIMITS, PLAN_TYPES } from '../plan-limits.js';
import type { PlanLimits, PlanType } from '../plan-limits.js';

describe('PLAN_TYPES', () => {
  it('contains exactly free and pro', () => {
    expect(PLAN_TYPES).toEqual(['free', 'pro']);
  });
});

describe('PLAN_LIMITS', () => {
  it('has an entry for every plan type', () => {
    for (const plan of PLAN_TYPES) {
      expect(PLAN_LIMITS[plan]).toBeDefined();
    }
  });

  it('all limit objects satisfy the PlanLimits interface shape', () => {
    const expectedKeys: (keyof PlanLimits)[] = [
      'maxHabits',
      'maxTasks',
      'maxMeetings',
      'meetingsEnabled',
      'focusTimeEnabled',
      'maxCalendars',
      'maxSchedulingLinks',
      'maxTemplates',
      'schedulingWindowDays',
      'analyticsEnabled',
      'analyticsMaxDays',
      'changeHistoryDays',
      'activityLogEnabled',
      'qualityScoreBreakdown',
      'qualityScoreTrend',
      'bookingPageBranding',
      'pushNotifications',
      'prioritySupport',
    ];
    for (const plan of PLAN_TYPES) {
      const limits = PLAN_LIMITS[plan];
      for (const key of expectedKeys) {
        expect(limits).toHaveProperty(key);
      }
    }
  });
});

describe('getPlanLimits', () => {
  describe('free plan — all limits', () => {
    const limits = getPlanLimits('free');

    it('maxHabits = 3', () => expect(limits.maxHabits).toBe(3));
    it('maxTasks = 5', () => expect(limits.maxTasks).toBe(5));
    it('maxMeetings = 2', () => expect(limits.maxMeetings).toBe(2));
    it('meetingsEnabled = false', () => expect(limits.meetingsEnabled).toBe(false));
    it('focusTimeEnabled = false', () => expect(limits.focusTimeEnabled).toBe(false));
    it('maxCalendars = 1', () => expect(limits.maxCalendars).toBe(1));
    it('maxSchedulingLinks = 1', () => expect(limits.maxSchedulingLinks).toBe(1));
    it('maxTemplates = 2', () => expect(limits.maxTemplates).toBe(2));
    it('schedulingWindowDays = 14', () => expect(limits.schedulingWindowDays).toBe(14));
    it('analyticsEnabled = false', () => expect(limits.analyticsEnabled).toBe(false));
    it('analyticsMaxDays = 0', () => expect(limits.analyticsMaxDays).toBe(0));
    it('changeHistoryDays = 1', () => expect(limits.changeHistoryDays).toBe(1));
    it('activityLogEnabled = false', () => expect(limits.activityLogEnabled).toBe(false));
    it('qualityScoreBreakdown = false', () => expect(limits.qualityScoreBreakdown).toBe(false));
    it('qualityScoreTrend = false', () => expect(limits.qualityScoreTrend).toBe(false));
    it('bookingPageBranding = true', () => expect(limits.bookingPageBranding).toBe(true));
    it('pushNotifications = false', () => expect(limits.pushNotifications).toBe(false));
    it('prioritySupport = false', () => expect(limits.prioritySupport).toBe(false));
  });

  describe('pro plan — all limits', () => {
    const limits = getPlanLimits('pro');

    it('maxHabits = unlimited (-1)', () => expect(limits.maxHabits).toBe(-1));
    it('maxTasks = unlimited (-1)', () => expect(limits.maxTasks).toBe(-1));
    it('maxMeetings = unlimited (-1)', () => expect(limits.maxMeetings).toBe(-1));
    it('meetingsEnabled = false', () => expect(limits.meetingsEnabled).toBe(false));
    it('focusTimeEnabled = true', () => expect(limits.focusTimeEnabled).toBe(true));
    it('maxCalendars = unlimited (-1)', () => expect(limits.maxCalendars).toBe(-1));
    it('maxSchedulingLinks = unlimited (-1)', () => expect(limits.maxSchedulingLinks).toBe(-1));
    it('maxTemplates = 8', () => expect(limits.maxTemplates).toBe(8));
    it('schedulingWindowDays = 90', () => expect(limits.schedulingWindowDays).toBe(90));
    it('analyticsEnabled = true', () => expect(limits.analyticsEnabled).toBe(true));
    it('analyticsMaxDays = 365', () => expect(limits.analyticsMaxDays).toBe(365));
    it('changeHistoryDays = 30', () => expect(limits.changeHistoryDays).toBe(30));
    it('activityLogEnabled = true', () => expect(limits.activityLogEnabled).toBe(true));
    it('qualityScoreBreakdown = true', () => expect(limits.qualityScoreBreakdown).toBe(true));
    it('qualityScoreTrend = true', () => expect(limits.qualityScoreTrend).toBe(true));
    it('bookingPageBranding = false', () => expect(limits.bookingPageBranding).toBe(false));
    it('pushNotifications = true', () => expect(limits.pushNotifications).toBe(true));
    it('prioritySupport = true', () => expect(limits.prioritySupport).toBe(true));
  });

  describe('pro plan has strictly better or equal limits than free', () => {
    const free = getPlanLimits('free');
    const pro = getPlanLimits('pro');

    it('maxHabits: pro >= free (or unlimited)', () => {
      expect(isUnlimited(pro.maxHabits) || pro.maxHabits >= free.maxHabits).toBe(true);
    });
    it('maxTasks: pro >= free (or unlimited)', () => {
      expect(isUnlimited(pro.maxTasks) || pro.maxTasks >= free.maxTasks).toBe(true);
    });
    it('maxMeetings: pro >= free (or unlimited)', () => {
      expect(isUnlimited(pro.maxMeetings) || pro.maxMeetings >= free.maxMeetings).toBe(true);
    });
    it('maxCalendars: pro >= free (or unlimited)', () => {
      expect(isUnlimited(pro.maxCalendars) || pro.maxCalendars >= free.maxCalendars).toBe(true);
    });
    it('maxSchedulingLinks: pro >= free (or unlimited)', () => {
      expect(
        isUnlimited(pro.maxSchedulingLinks) || pro.maxSchedulingLinks >= free.maxSchedulingLinks,
      ).toBe(true);
    });
    it('maxTemplates: pro >= free', () => {
      expect(pro.maxTemplates).toBeGreaterThanOrEqual(free.maxTemplates);
    });
    it('schedulingWindowDays: pro >= free', () => {
      expect(pro.schedulingWindowDays).toBeGreaterThanOrEqual(free.schedulingWindowDays);
    });
    it('analyticsMaxDays: pro >= free', () => {
      expect(pro.analyticsMaxDays).toBeGreaterThanOrEqual(free.analyticsMaxDays);
    });
    it('changeHistoryDays: pro >= free', () => {
      expect(pro.changeHistoryDays).toBeGreaterThanOrEqual(free.changeHistoryDays);
    });
  });

  describe('fallback for unknown plans', () => {
    it('returns free limits for unknown string', () => {
      const limits = getPlanLimits('unknown' as any);
      expect(limits).toEqual(PLAN_LIMITS.free);
    });

    it('returns free limits for empty string', () => {
      const limits = getPlanLimits('' as any);
      expect(limits).toEqual(PLAN_LIMITS.free);
    });

    it('returns free limits for team (not yet implemented)', () => {
      const limits = getPlanLimits('team' as any);
      expect(limits).toEqual(PLAN_LIMITS.free);
    });
  });

  describe('numeric limits are finite and non-negative (or -1 for unlimited)', () => {
    const numericKeys: (keyof PlanLimits)[] = [
      'maxHabits',
      'maxTasks',
      'maxMeetings',
      'maxCalendars',
      'maxSchedulingLinks',
      'maxTemplates',
      'schedulingWindowDays',
      'analyticsMaxDays',
      'changeHistoryDays',
    ];

    for (const plan of PLAN_TYPES) {
      for (const key of numericKeys) {
        it(`${plan}.${key} is -1 (unlimited) or >= 0`, () => {
          const value = PLAN_LIMITS[plan][key] as number;
          expect(value === -1 || value >= 0).toBe(true);
          expect(Number.isFinite(value)).toBe(true);
        });
      }
    }
  });
});

describe('isUnlimited', () => {
  it('returns true for -1', () => {
    expect(isUnlimited(-1)).toBe(true);
  });

  it('returns false for 0', () => {
    expect(isUnlimited(0)).toBe(false);
  });

  it('returns false for positive numbers', () => {
    expect(isUnlimited(1)).toBe(false);
    expect(isUnlimited(3)).toBe(false);
    expect(isUnlimited(100)).toBe(false);
  });

  it('returns false for -2 (only -1 is unlimited)', () => {
    expect(isUnlimited(-2)).toBe(false);
  });

  it('correctly identifies unlimited fields in pro plan', () => {
    const pro = getPlanLimits('pro');
    expect(isUnlimited(pro.maxHabits)).toBe(true);
    expect(isUnlimited(pro.maxTasks)).toBe(true);
    expect(isUnlimited(pro.maxMeetings)).toBe(true);
    expect(isUnlimited(pro.maxCalendars)).toBe(true);
    expect(isUnlimited(pro.maxSchedulingLinks)).toBe(true);
  });

  it('correctly identifies limited fields in free plan', () => {
    const free = getPlanLimits('free');
    expect(isUnlimited(free.maxHabits)).toBe(false);
    expect(isUnlimited(free.maxTasks)).toBe(false);
    expect(isUnlimited(free.maxMeetings)).toBe(false);
    expect(isUnlimited(free.maxCalendars)).toBe(false);
    expect(isUnlimited(free.maxSchedulingLinks)).toBe(false);
  });
});
