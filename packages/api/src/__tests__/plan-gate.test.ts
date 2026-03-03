import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { checkEntityLimit, sendPlanLimitError, sendFeatureGated } from '../middleware/plan-gate.js';

function createApp() {
  const app = express();
  app.use(express.json());
  return app;
}

describe('sendPlanLimitError', () => {
  it('returns 403 with plan_limit_reached structure', async () => {
    const app = createApp();
    app.get('/test', (_req, res) => {
      sendPlanLimitError(res, 'maxHabits', 3, 3);
    });
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('plan_limit_reached');
    expect(res.body.limit).toBe('maxHabits');
    expect(res.body.current).toBe(3);
    expect(res.body.max).toBe(3);
    expect(res.body.upgrade_url).toBe('/settings#billing');
  });
});

describe('sendFeatureGated', () => {
  it('returns 403 with feature_not_available', async () => {
    const app = createApp();
    app.get('/test', (_req, res) => {
      sendFeatureGated(res, 'analytics');
    });
    const res = await request(app).get('/test');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
    expect(res.body.feature).toBe('analytics');
  });
});

describe('checkEntityLimit', () => {
  it('returns true when under limit', () => {
    expect(checkEntityLimit(2, 3)).toBe(true);
  });
  it('returns false when at limit', () => {
    expect(checkEntityLimit(3, 3)).toBe(false);
  });
  it('returns true when limit is unlimited (-1)', () => {
    expect(checkEntityLimit(100, -1)).toBe(true);
  });
});
