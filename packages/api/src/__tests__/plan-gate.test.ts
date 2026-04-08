import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { checkEntityLimit, sendPlanLimitError, sendFeatureGated } from '../middleware/plan-gate.js';
import { PLAN_LIMITS, getPlanLimits, isUnlimited } from '@fluxure/shared';

// ── Helpers ──────────────────────────────────────────────────

function createApp() {
  const app = express();
  app.use(express.json());
  return app;
}

// ── checkEntityLimit ─────────────────────────────────────────

describe('checkEntityLimit', () => {
  it('returns true when current count is below the limit', () => {
    expect(checkEntityLimit(0, 3)).toBe(true);
    expect(checkEntityLimit(2, 3)).toBe(true);
  });

  it('returns false when current count equals the limit', () => {
    expect(checkEntityLimit(3, 3)).toBe(false);
  });

  it('returns false when current count exceeds the limit (downgrade scenario)', () => {
    expect(checkEntityLimit(5, 3)).toBe(false);
  });

  it('returns true for unlimited (-1) regardless of count', () => {
    expect(checkEntityLimit(0, -1)).toBe(true);
    expect(checkEntityLimit(100, -1)).toBe(true);
    expect(checkEntityLimit(999999, -1)).toBe(true);
  });

  it('returns false when limit is zero', () => {
    expect(checkEntityLimit(0, 0)).toBe(false);
    expect(checkEntityLimit(1, 0)).toBe(false);
  });

  it('returns true when limit is 1 and count is 0', () => {
    expect(checkEntityLimit(0, 1)).toBe(true);
  });
});

// ── sendPlanLimitError ───────────────────────────────────────

describe('sendPlanLimitError', () => {
  it('returns 403 with plan_limit_reached structure', async () => {
    const app = createApp();
    app.get('/test', (_req, res) => {
      sendPlanLimitError(res, 'maxHabits', 3, 3);
    });
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'plan_limit_reached',
      limit: 'maxHabits',
      current: 3,
      max: 3,
      upgrade_message: 'Upgrade to Pro for unlimited habits',
      upgrade_url: '/settings#billing',
    });
  });

  it.each([
    ['maxHabits', 'Upgrade to Pro for unlimited habits'],
    ['maxTasks', 'Upgrade to Pro for unlimited tasks'],
    ['maxMeetings', 'Upgrade to Pro for unlimited meetings'],
    ['focusTime', 'Upgrade to Pro to use focus time'],
    ['maxCalendars', 'Upgrade to Pro for unlimited calendars'],
    ['maxSchedulingLinks', 'Upgrade to Pro for unlimited scheduling links'],
    ['maxTemplates', 'Upgrade to Pro for more scheduling templates'],
  ])('returns correct upgrade message for %s', async (limitName, expectedMessage) => {
    const app = createApp();
    app.get('/test', (_req, res) => {
      sendPlanLimitError(res, limitName, 1, 1);
    });
    const res = await request(app).get('/test');
    expect(res.body.upgrade_message).toBe(expectedMessage);
  });

  it('returns generic upgrade message for unknown limit name', async () => {
    const app = createApp();
    app.get('/test', (_req, res) => {
      sendPlanLimitError(res, 'unknownLimit', 5, 5);
    });
    const res = await request(app).get('/test');
    expect(res.body.upgrade_message).toBe('Upgrade to Pro to unlock this feature');
  });

  it('includes correct current and max values in the response', async () => {
    const app = createApp();
    app.get('/test', (_req, res) => {
      sendPlanLimitError(res, 'maxTasks', 4, 5);
    });
    const res = await request(app).get('/test');
    expect(res.body.current).toBe(4);
    expect(res.body.max).toBe(5);
  });
});

// ── sendFeatureGated ─────────────────────────────────────────

describe('sendFeatureGated', () => {
  it('returns 403 with feature_not_available structure', async () => {
    const app = createApp();
    app.get('/test', (_req, res) => {
      sendFeatureGated(res, 'analytics');
    });
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'feature_not_available',
      feature: 'analytics',
      upgrade_message: 'Upgrade to Pro to access analytics',
      upgrade_url: '/settings#billing',
    });
  });

  it.each(['analytics', 'activity log', 'focus time', 'push notifications'])(
    'includes feature name "%s" in response and upgrade message',
    async (feature) => {
      const app = createApp();
      app.get('/test', (_req, res) => {
        sendFeatureGated(res, feature);
      });
      const res = await request(app).get('/test');
      expect(res.body.feature).toBe(feature);
      expect(res.body.upgrade_message).toBe(`Upgrade to Pro to access ${feature}`);
    },
  );
});

// ── getPlanLimits ────────────────────────────────────────────

describe('getPlanLimits', () => {
  it('returns free plan limits for "free"', () => {
    expect(getPlanLimits('free')).toEqual(PLAN_LIMITS.free);
  });

  it('returns pro plan limits for "pro"', () => {
    expect(getPlanLimits('pro')).toEqual(PLAN_LIMITS.pro);
  });

  it('falls back to free plan for unknown plan strings', () => {
    expect(getPlanLimits('team')).toEqual(PLAN_LIMITS.free);
    expect(getPlanLimits('enterprise')).toEqual(PLAN_LIMITS.free);
    expect(getPlanLimits('')).toEqual(PLAN_LIMITS.free);
  });
});

// ── isUnlimited ──────────────────────────────────────────────

describe('isUnlimited', () => {
  it('returns true for -1', () => {
    expect(isUnlimited(-1)).toBe(true);
  });

  it('returns false for zero and positive values', () => {
    expect(isUnlimited(0)).toBe(false);
    expect(isUnlimited(1)).toBe(false);
    expect(isUnlimited(100)).toBe(false);
  });
});

// ── PLAN_LIMITS structure validation ─────────────────────────

describe('PLAN_LIMITS structure', () => {
  it('free plan has restrictive numeric limits', () => {
    const free = PLAN_LIMITS.free;
    expect(free.maxHabits).toBe(3);
    expect(free.maxTasks).toBe(5);
    expect(free.maxMeetings).toBe(2);
    expect(free.maxCalendars).toBe(1);
    expect(free.maxSchedulingLinks).toBe(1);
    expect(free.maxTemplates).toBe(2);
    expect(free.schedulingWindowDays).toBe(14);
  });

  it('free plan has boolean features disabled', () => {
    const free = PLAN_LIMITS.free;
    expect(free.focusTimeEnabled).toBe(false);
    expect(free.analyticsEnabled).toBe(false);
    expect(free.activityLogEnabled).toBe(false);
    expect(free.qualityScoreBreakdown).toBe(false);
    expect(free.qualityScoreTrend).toBe(false);
    expect(free.pushNotifications).toBe(false);
    expect(free.prioritySupport).toBe(false);
  });

  it('pro plan has unlimited numeric limits where appropriate', () => {
    const pro = PLAN_LIMITS.pro;
    expect(isUnlimited(pro.maxHabits)).toBe(true);
    expect(isUnlimited(pro.maxTasks)).toBe(true);
    expect(isUnlimited(pro.maxMeetings)).toBe(true);
    expect(isUnlimited(pro.maxCalendars)).toBe(true);
    expect(isUnlimited(pro.maxSchedulingLinks)).toBe(true);
    // Templates are capped even on pro
    expect(pro.maxTemplates).toBe(8);
    expect(pro.schedulingWindowDays).toBe(90);
  });

  it('pro plan has boolean features enabled', () => {
    const pro = PLAN_LIMITS.pro;
    expect(pro.focusTimeEnabled).toBe(true);
    expect(pro.analyticsEnabled).toBe(true);
    expect(pro.activityLogEnabled).toBe(true);
    expect(pro.qualityScoreBreakdown).toBe(true);
    expect(pro.qualityScoreTrend).toBe(true);
    expect(pro.pushNotifications).toBe(true);
    expect(pro.prioritySupport).toBe(true);
  });

  it('checkEntityLimit agrees with free plan limits', () => {
    const free = PLAN_LIMITS.free;
    // At limit → blocked
    expect(checkEntityLimit(free.maxHabits, free.maxHabits)).toBe(false);
    expect(checkEntityLimit(free.maxTasks, free.maxTasks)).toBe(false);
    // Under limit → allowed
    expect(checkEntityLimit(free.maxHabits - 1, free.maxHabits)).toBe(true);
    expect(checkEntityLimit(free.maxTasks - 1, free.maxTasks)).toBe(true);
  });

  it('checkEntityLimit agrees with pro plan limits (unlimited)', () => {
    const pro = PLAN_LIMITS.pro;
    expect(checkEntityLimit(1000, pro.maxHabits)).toBe(true);
    expect(checkEntityLimit(1000, pro.maxTasks)).toBe(true);
    // Templates have a finite pro limit
    expect(checkEntityLimit(pro.maxTemplates, pro.maxTemplates)).toBe(false);
    expect(checkEntityLimit(pro.maxTemplates - 1, pro.maxTemplates)).toBe(true);
  });
});
