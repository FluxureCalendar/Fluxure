import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import { createTestApp, createMockHabit, createMockTask, createMockEvent } from './helpers.js';

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

import searchRouter from '../routes/search.js';

const app = createTestApp('search', searchRouter);

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

// ─── GET /api/search/index ───────────────────────────────────────

describe('GET /api/search/index', () => {
  beforeEach(resetMocks);

  it('returns empty arrays when no data exists', async () => {
    // Three parallel queries: habits, tasks, events — all return []
    mockDb._setWhereResults([[], [], []]);

    const res = await request(app).get('/api/search/index');

    expect(res.status).toBe(200);
    expect(res.body.habits).toEqual([]);
    expect(res.body.tasks).toEqual([]);
    expect(res.body.events).toEqual([]);
    expect(res.body.meetings).toEqual([]);
  });

  it('returns search index with habits, tasks, and events', async () => {
    const habit = { id: 'h1', name: 'Run', priority: 2, color: null, enabled: true, days: ['mon'] };
    const task = {
      id: 't1',
      name: 'Report',
      priority: 2,
      color: null,
      status: 'open',
      dueDate: null,
      enabled: true,
    };
    const event = {
      id: 'e1',
      title: 'Meeting',
      start: '2026-03-20T09:00:00Z',
      end: '2026-03-20T10:00:00Z',
      isAllDay: false,
    };

    mockDb._setWhereResults([[habit], [task], [event]]);

    const res = await request(app).get('/api/search/index');

    expect(res.status).toBe(200);
    expect(res.body.habits).toHaveLength(1);
    expect(res.body.habits[0].name).toBe('Run');
    expect(res.body.tasks).toHaveLength(1);
    expect(res.body.tasks[0].name).toBe('Report');
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0].title).toBe('Meeting');
    expect(res.body.meetings).toEqual([]);
  });
});
