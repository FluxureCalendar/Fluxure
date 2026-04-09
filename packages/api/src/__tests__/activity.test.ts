import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestAppWithPlan, TEST_USER_ID } from './helpers.js';

// ── Inline mock DB (vi.hoisted requirement) ──────────────────
const { mockDb } = vi.hoisted(() => {
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
  const mockOrderBy = vi.fn();

  function makeWhereResult(data: unknown[]) {
    const result = Promise.resolve(data);
    (result as any).limit = mockLimit;
    (result as any).orderBy = (..._args: unknown[]) => ({ limit: mockLimit });
    return result;
  }

  function makeLimitResult(data: unknown[]) {
    const result = { offset: mockOffset };
    mockOffset.mockResolvedValue(data);
    return result;
  }

  mockOrderBy.mockImplementation(() => {
    return { limit: mockLimit };
  });

  mockWhere.mockImplementation(() => {
    const idx = whereCallIndex++;
    const data = idx < whereResults.length ? whereResults[idx] : [];
    mockLimit.mockReturnValue(makeLimitResult(data));
    // Return a chainable object with orderBy
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
    _mockOrderBy: mockOrderBy,
    _setWhereResults: (results: unknown[][]) => {
      whereResults = results;
      whereCallIndex = 0;
    },
  };

  return { mockDb };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import activityRouter from '../routes/activity.js';

const freeApp = createTestAppWithPlan('activity', activityRouter, 'free');
const proApp = createTestAppWithPlan('activity', activityRouter, 'pro');

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
}

// ─── GET /api/activity ──────────────────────────────────────────

describe('GET /api/activity', () => {
  beforeEach(resetMocks);

  it('returns 403 for free plan (activity log not enabled)', async () => {
    const res = await request(freeApp).get('/api/activity');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
    expect(res.body.feature).toBe('activity log');
  });

  it('returns activity log entries for pro plan', async () => {
    const entries = [
      {
        id: 'a1',
        userId: TEST_USER_ID,
        action: 'created',
        entityType: 'habit',
        entityId: 'h1',
        details: null,
        createdAt: '2026-03-20T12:00:00Z',
      },
      {
        id: 'a2',
        userId: TEST_USER_ID,
        action: 'updated',
        entityType: 'task',
        entityId: 't1',
        details: null,
        createdAt: '2026-03-20T11:00:00Z',
      },
    ];

    // Activity route: .where().orderBy().limit() — configure limit to resolve data
    mockDb._mockWhere.mockImplementation(() => {
      const orderByFn = () => ({ limit: vi.fn().mockResolvedValue(entries) });
      const result = Promise.resolve(entries);
      (result as any).orderBy = orderByFn;
      return result;
    });

    const res = await request(proApp).get('/api/activity');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].action).toBe('created');
    expect(res.body[0].entityType).toBe('habit');
    expect(res.body[1].action).toBe('updated');
  });

  it('filters by entityType', async () => {
    const entries = [
      {
        id: 'a1',
        userId: TEST_USER_ID,
        action: 'created',
        entityType: 'habit',
        entityId: 'h1',
        details: null,
        createdAt: '2026-03-20T12:00:00Z',
      },
    ];

    mockDb._mockWhere.mockImplementation(() => {
      const orderByFn = () => ({ limit: vi.fn().mockResolvedValue(entries) });
      const result = Promise.resolve(entries);
      (result as any).orderBy = orderByFn;
      return result;
    });

    const res = await request(proApp).get('/api/activity?entityType=habit');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].entityType).toBe('habit');
  });

  it('accepts custom limit parameter', async () => {
    mockDb._mockWhere.mockImplementation(() => {
      const orderByFn = () => ({ limit: vi.fn().mockResolvedValue([]) });
      const result = Promise.resolve([]);
      (result as any).orderBy = orderByFn;
      return result;
    });

    const res = await request(proApp).get('/api/activity?limit=10');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 400 for invalid entityType', async () => {
    const res = await request(proApp).get('/api/activity?entityType=invalid');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid limit', async () => {
    const res = await request(proApp).get('/api/activity?limit=0');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});
