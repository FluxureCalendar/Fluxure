import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestAppWithPlan, TEST_USER_ID } from './helpers.js';

// ── Inline mock DB (vi.hoisted requirement) ──────────────────
const { mockDb, mockCacheGet, mockCacheSet } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhereReturning = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhereReturning });
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);

  let whereResults: unknown[][] = [[]];
  let whereCallIndex = 0;
  const mockOffset = vi.fn();
  const mockLimit = vi.fn();
  const mockWhere = vi.fn();

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    (result as any).limit = mockLimit;
    (result as any).orderBy = vi.fn().mockReturnValue({ limit: mockLimit });
    return result;
  }

  function makeLimitResult(data: unknown[]) {
    const result = { offset: mockOffset };
    mockOffset.mockResolvedValue(data);
    return result;
  }

  mockWhere.mockImplementation(() => {
    const idx = whereCallIndex++;
    const data = idx < whereResults.length ? whereResults[idx] : [];
    mockLimit.mockReturnValue(makeLimitResult(data));
    return makeWhereResult(data);
  });

  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });

  const mockDb = {
    select: vi.fn().mockReturnValue({ from: mockFrom }),
    insert: vi.fn().mockReturnValue({ values: mockValues }),
    update: vi.fn().mockReturnValue({ set: mockSet }),
    delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
    transaction: vi.fn().mockImplementation(async (fn: any) => {
      const tx = {
        select: vi.fn().mockReturnValue({ from: mockFrom }),
        insert: vi.fn().mockReturnValue({ values: mockValues }),
        update: vi.fn().mockReturnValue({ set: mockSet }),
        delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      };
      return fn(tx);
    }),
    _mockWhere: mockWhere,
    _mockFrom: mockFrom,
    _mockValues: mockValues,
    _mockReturning: mockReturning,
    _mockSet: mockSet,
    _mockWhereReturning: mockWhereReturning,
    _mockDeleteWhere: mockDeleteWhere,
    _mockLimit: mockLimit,
    _mockOffset: mockOffset,
    _setWhereResults: (results: unknown[][]) => {
      whereResults = results;
      whereCallIndex = 0;
    },
  };

  const mockCacheGet = vi.fn().mockResolvedValue(null);
  const mockCacheSet = vi.fn().mockResolvedValue(undefined);

  return { mockDb, mockCacheGet, mockCacheSet };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../cache/redis.js', () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
  cacheDel: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../cache/user-settings.js', () => ({
  getUserTimezoneCached: vi.fn().mockResolvedValue('America/New_York'),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import analyticsRouter from '../routes/analytics.js';

const freeApp = createTestAppWithPlan('analytics', analyticsRouter, 'free');
const proApp = createTestAppWithPlan('analytics', analyticsRouter, 'pro');

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockCacheGet.mockResolvedValue(null);
  mockCacheSet.mockResolvedValue(undefined);
}

// ─── GET /api/analytics ──────────────────────────────────────────

describe('GET /api/analytics', () => {
  beforeEach(resetMocks);

  it('returns 403 for free plan (analytics not enabled)', async () => {
    const res = await request(freeApp).get('/api/analytics');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
    expect(res.body.feature).toBe('analytics');
  });

  it('returns analytics data for pro plan', async () => {
    // 4 parallel queries: events, habits, timezone, completions
    const events = [
      {
        id: 'e1',
        userId: TEST_USER_ID,
        itemType: 'habit',
        start: '2026-03-20T09:00:00Z',
        end: '2026-03-20T09:30:00Z',
      },
      {
        id: 'e2',
        userId: TEST_USER_ID,
        itemType: 'task',
        start: '2026-03-20T10:00:00Z',
        end: '2026-03-20T11:00:00Z',
      },
    ];
    const habits = [
      { id: 'h1', userId: TEST_USER_ID, enabled: true, days: ['mon', 'tue', 'wed', 'thu', 'fri'] },
    ];
    const completions: unknown[] = [];

    // events, habits, completions (timezone is separate mock)
    mockDb._setWhereResults([events, habits, completions]);

    const res = await request(proApp).get('/api/analytics');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('habitMinutes');
    expect(res.body).toHaveProperty('taskMinutes');
    expect(res.body).toHaveProperty('meetingMinutes');
    expect(res.body).toHaveProperty('focusMinutes');
    expect(res.body).toHaveProperty('habitCompletionRate');
    expect(res.body).toHaveProperty('weeklyBreakdown');
    expect(res.body.habitMinutes).toBe(30);
    expect(res.body.taskMinutes).toBe(60);
  });

  it('returns cached data when available', async () => {
    const cachedData = {
      habitMinutes: 100,
      taskMinutes: 200,
      meetingMinutes: 50,
      focusMinutes: 30,
      habitCompletionRate: 0.8,
      weeklyBreakdown: [],
    };
    mockCacheGet.mockResolvedValue(cachedData);

    const res = await request(proApp).get('/api/analytics');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(cachedData);
    // Should not have queried DB
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid from date format', async () => {
    const res = await request(proApp).get('/api/analytics?from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid "from" date format/);
  });

  it('returns 400 for invalid to date format', async () => {
    const res = await request(proApp).get('/api/analytics?to=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid "to" date format/);
  });

  it('returns 400 when from is after to', async () => {
    const res = await request(proApp).get('/api/analytics?from=2026-03-25&to=2026-03-20');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/"from" must be before "to"/);
  });

  it('returns 400 when range exceeds max days', async () => {
    const res = await request(proApp).get('/api/analytics?from=2025-01-01&to=2026-03-25');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Date range must not exceed/);
  });

  it('accepts valid ISO date range', async () => {
    mockDb._setWhereResults([[], [], []]);

    const res = await request(proApp).get('/api/analytics?from=2026-03-01&to=2026-03-25');
    expect(res.status).toBe(200);
  });
});

// ─── GET /api/analytics/daily-breakdown ──────────────────────────

describe('GET /api/analytics/daily-breakdown', () => {
  beforeEach(resetMocks);

  it('returns 403 for free plan', async () => {
    const res = await request(freeApp).get('/api/analytics/daily-breakdown');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
  });

  it('returns daily breakdown for pro plan', async () => {
    const events = [
      {
        id: 'e1',
        userId: TEST_USER_ID,
        itemType: 'focus',
        start: '2026-03-20T14:00:00Z',
        end: '2026-03-20T15:00:00Z',
      },
    ];
    mockDb._setWhereResults([events]);

    const res = await request(proApp).get('/api/analytics/daily-breakdown');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dailyBreakdown');
    expect(Array.isArray(res.body.dailyBreakdown)).toBe(true);
  });

  it('returns 400 for invalid date params', async () => {
    const res = await request(proApp).get('/api/analytics/daily-breakdown?from=bad');
    expect(res.status).toBe(400);
  });
});
