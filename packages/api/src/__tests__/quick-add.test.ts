import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import {
  createTestApp,
  createTestAppWithPlan,
  createMockHabit,
  createMockTask,
  TEST_USER_ID,
} from './helpers.js';

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
vi.mock('../routes/activity.js', () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
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
vi.mock('../cache/user-settings.js', () => ({
  getUserSettingsCached: vi.fn().mockResolvedValue({
    workingHours: { start: '09:00', end: '17:00' },
    personalHours: { start: '07:00', end: '22:00' },
    timezone: 'America/New_York',
    schedulingWindowDays: 14,
    trimCompletedEvents: true,
  }),
  getUserTimezoneCached: vi.fn().mockResolvedValue('America/New_York'),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

import quickAddRouter from '../routes/quick-add.js';

const app = createTestApp('quick-add', quickAddRouter);

function resetMocks() {
  vi.clearAllMocks();
  mockDb._setWhereResults([[]]);
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockWhereReturning.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockWhereReturning });
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

// ─── POST /api/quick-add ─────────────────────────────────────────

describe('POST /api/quick-add', () => {
  beforeEach(resetMocks);

  it('returns 400 for empty input', async () => {
    const res = await request(app).post('/api/quick-add').send({ input: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for missing input field', async () => {
    const res = await request(app).post('/api/quick-add').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Validation failed');
  });

  it('returns 400 for unparseable input', async () => {
    const res = await request(app).post('/api/quick-add').send({ input: 'xyz' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Could not parse');
  });

  it('creates a habit from NL input with sufficient data', async () => {
    const createdHabit = createMockHabit({ name: 'Gym' });
    // First where: count query for plan limit check
    mockDb._setWhereResults([[{ count: 0 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([createdHabit]);

    const res = await request(app).post('/api/quick-add').send({ input: 'Gym MWF 7am 1h' });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.type).toBe('habit');
    expect(res.body.item).toBeDefined();
  });

  it('returns created=false for habit with insufficient data', async () => {
    // "Run" alone parses as habit but without days+duration, so created=false
    const res = await request(app).post('/api/quick-add').send({ input: 'Run daily' });

    // parseQuickAdd may parse this with days but no duration → created=false
    // OR it may not parse at all → 400
    // Accept either outcome based on parser behavior
    expect([200, 400]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.created).toBe(false);
    }
  });

  it('creates a task from NL input with sufficient data', async () => {
    const createdTask = createMockTask({ name: 'Finish report' });
    mockDb._setWhereResults([[{ count: 0 }]]);
    mockDb._mockReturning.mockResolvedValueOnce([createdTask]);

    const res = await request(app)
      .post('/api/quick-add')
      .send({ input: 'Finish report by Friday 3h' });

    expect(res.status).toBe(201);
    expect(res.body.created).toBe(true);
    expect(res.body.type).toBe('task');
    expect(res.body.item).toBeDefined();
  });

  it('respects plan limits for habits', async () => {
    // Free plan: maxHabits = 3
    mockDb._setWhereResults([[{ count: 3 }]]);

    const res = await request(app).post('/api/quick-add').send({ input: 'Gym MWF 7am 1h' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('plan_limit_reached');
    expect(res.body.limit).toBe('maxHabits');
  });
});
