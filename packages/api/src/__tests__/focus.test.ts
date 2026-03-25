import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createTestAppWithPlan, TEST_USER_ID } from './helpers.js';

const { mockDb } = vi.hoisted(() => {
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockWhereReturning = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSet = vi.fn().mockReturnValue({ where: mockWhereReturning });
  const mockOnConflictDoUpdate = vi.fn().mockResolvedValue(undefined);
  const mockValues = vi.fn().mockReturnValue({
    returning: mockReturning,
    onConflictDoUpdate: mockOnConflictDoUpdate,
  });
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
    _mockOnConflictDoUpdate: mockOnConflictDoUpdate,
    _mockLimit: mockLimit,
    _mockOffset: mockOffset,
    _setWhereResults: (results: unknown[][]) => {
      whereResults = results;
      whereCallIndex = 0;
    },
  };

  return { mockDb };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../ws.js', () => ({
  broadcastToUser: vi.fn(),
  broadcast: vi.fn(),
}));
vi.mock('../polling-ref.js', () => ({
  triggerReschedule: vi.fn(),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../config.js', () => ({
  FRONTEND_URL: 'http://localhost:5173',
  allowedOrigins: ['http://localhost:5173'],
  INSTANCE_ID: 'test-instance',
  isSelfHosted: () => false,
}));
vi.mock('express-rate-limit', () => ({
  default: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../rate-limiters.js', () => ({
  createStore: vi.fn().mockReturnValue(undefined),
  bookingLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import focusRouter from '../routes/focus.js';

const freeApp = createTestAppWithPlan('focus-time', focusRouter, 'free');
const proApp = createTestAppWithPlan('focus-time', focusRouter, 'pro');

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb._mockOnConflictDoUpdate.mockResolvedValue(undefined);
  mockDb._mockValues.mockReturnValue({
    returning: mockDb._mockReturning,
    onConflictDoUpdate: mockDb._mockOnConflictDoUpdate,
  });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockWhereReturning.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

const MOCK_FOCUS_ROW = {
  id: '00000000-0000-0000-0000-000000000001',
  userId: TEST_USER_ID,
  weeklyTargetMinutes: 600,
  dailyTargetMinutes: 120,
  schedulingHours: 'working',
  windowStart: null,
  windowEnd: null,
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ─── GET /api/focus-time ─────────────────────────────────────────

describe('GET /api/focus-time', () => {
  beforeEach(resetMocks);

  it('returns 403 for free plan (focus time not enabled)', async () => {
    const res = await request(freeApp).get('/api/focus-time');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
    expect(res.body.feature).toBe('focus time');
  });

  it('returns default focus rule when none exists (pro plan)', async () => {
    mockDb._setWhereResults([[]]);

    const res = await request(proApp).get('/api/focus-time');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('default');
    expect(res.body.weeklyTargetMinutes).toBe(600);
    expect(res.body.dailyTargetMinutes).toBe(120);
    expect(res.body.enabled).toBe(false);
  });

  it('returns existing focus rule (pro plan)', async () => {
    mockDb._setWhereResults([[MOCK_FOCUS_ROW]]);

    const res = await request(proApp).get('/api/focus-time');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(MOCK_FOCUS_ROW.id);
    expect(res.body.weeklyTargetMinutes).toBe(600);
    expect(res.body.enabled).toBe(true);
  });
});

// ─── PUT /api/focus-time ─────────────────────────────────────────

describe('PUT /api/focus-time', () => {
  beforeEach(resetMocks);

  it('returns 403 for free plan', async () => {
    const res = await request(freeApp).put('/api/focus-time').send({ enabled: true });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('feature_not_available');
  });

  it('upserts focus rule and returns updated row (pro plan)', async () => {
    const updatedRow = { ...MOCK_FOCUS_ROW, enabled: true, dailyTargetMinutes: 90 };
    // After upsert, the select returns the updated row
    mockDb._setWhereResults([[updatedRow]]);

    const res = await request(proApp)
      .put('/api/focus-time')
      .send({ enabled: true, dailyTargetMinutes: 90 });

    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.dailyTargetMinutes).toBe(90);
    expect(mockDb.insert).toHaveBeenCalled();
  });

  it('returns 400 for invalid input', async () => {
    const res = await request(proApp).put('/api/focus-time').send({ weeklyTargetMinutes: -5 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });
});
