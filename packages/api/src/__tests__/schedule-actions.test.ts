import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createTestApp, TEST_USER_ID, TEST_UUID_1 } from './helpers.js';

const { mockDb } = vi.hoisted(() => {
  const mockWhere = vi.fn().mockResolvedValue([]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  const mockReturning = vi.fn().mockResolvedValue([]);
  const mockValues = vi.fn().mockReturnValue({ returning: mockReturning });
  const mockSetWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn().mockReturnValue({ where: mockSetWhere });
  const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);
  return {
    mockDb: {
      select: vi.fn().mockReturnValue({ from: mockFrom }),
      insert: vi.fn().mockReturnValue({ values: mockValues }),
      update: vi.fn().mockReturnValue({ set: mockSet }),
      delete: vi.fn().mockReturnValue({ where: mockDeleteWhere }),
      _mockWhere: mockWhere,
      _mockFrom: mockFrom,
      _mockValues: mockValues,
      _mockReturning: mockReturning,
      _mockSet: mockSet,
      _mockSetWhere: mockSetWhere,
      _mockDeleteWhere: mockDeleteWhere,
    },
  };
});

vi.mock('../db/pg-index.js', () => ({ db: mockDb }));
vi.mock('../ws.js', () => ({ broadcastToUser: vi.fn(), broadcast: vi.fn() }));
vi.mock('../polling-ref.js', () => ({ triggerReschedule: vi.fn() }));
vi.mock('../scheduler-registry.js', () => ({
  schedulerRegistry: {
    get: vi.fn().mockReturnValue(undefined),
    getOrCreate: vi.fn().mockRejectedValue(new Error('Google not connected')),
    cancelIdle: vi.fn(),
    scheduleIdle: vi.fn(),
  },
}));
vi.mock('../cache/redis.js', () => ({
  cacheHashDelAll: vi.fn().mockResolvedValue(undefined),
  getRedisClient: vi.fn().mockReturnValue(null),
}));
vi.mock('../routes/analytics.js', () => ({
  invalidateAnalyticsCache: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../routes/schedule-helpers.js', () => ({
  getUserSettings: vi.fn().mockResolvedValue({ trimCompletedEvents: false, timezone: 'UTC' }),
}));
vi.mock('../logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

beforeAll(() => {
  process.env.NODE_ENV = 'test';
});

const { registerScheduleActions } = await import('../routes/schedule-actions.js');
const router = express.Router();
registerScheduleActions(router);
const app = createTestApp('schedule', router);

const HABIT_ID = '33333333-3333-3333-3333-333333333333';
const SCHEDULED_DATE = '2026-05-17';

function habitEventRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_UUID_1,
    userId: TEST_USER_ID,
    itemType: 'habit',
    itemId: `${HABIT_ID}__${SCHEDULED_DATE}`,
    title: 'Morning Run',
    googleEventId: null,
    calendarId: null,
    start: '2026-05-17T11:00:00.000Z',
    end: '2026-05-17T12:00:00.000Z',
    status: 'locked',
    ...overrides,
  };
}

function resetMocks() {
  vi.clearAllMocks();
  mockDb._mockWhere.mockResolvedValue([]);
  mockDb._mockFrom.mockReturnValue({ where: mockDb._mockWhere });
  mockDb.select.mockReturnValue({ from: mockDb._mockFrom });
  mockDb.insert.mockReturnValue({ values: mockDb._mockValues });
  mockDb._mockValues.mockReturnValue({ returning: mockDb._mockReturning });
  mockDb._mockReturning.mockResolvedValue([]);
  mockDb._mockSet.mockReturnValue({ where: mockDb._mockSetWhere });
  mockDb._mockSetWhere.mockResolvedValue(undefined);
  mockDb.update.mockReturnValue({ set: mockDb._mockSet });
  mockDb._mockDeleteWhere.mockResolvedValue(undefined);
  mockDb.delete.mockReturnValue({ where: mockDb._mockDeleteWhere });
}

describe('POST /api/schedule/:eventId/lock — unlock handoff', () => {
  beforeEach(resetMocks);

  it('deletes the habit_completions row when unlocking a habit event (scheduler handoff)', async () => {
    mockDb._mockWhere.mockResolvedValue([habitEventRow()]);

    const res = await request(app)
      .post(`/api/schedule/${TEST_UUID_1}/lock`)
      .send({ locked: false });

    expect(res.status).toBe(200);
    // Handoff: unlocking a completed habit must clear its completion record
    // so the engine reschedules it instead of deleting the orphaned event.
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('does NOT delete a habit_completions row when locking (locked: true)', async () => {
    mockDb._mockWhere.mockResolvedValue([habitEventRow({ status: 'free' })]);

    const res = await request(app).post(`/api/schedule/${TEST_UUID_1}/lock`).send({ locked: true });

    expect(res.status).toBe(200);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('does NOT attempt completion cleanup when unlocking a non-habit event', async () => {
    mockDb._mockWhere.mockResolvedValue([habitEventRow({ itemType: 'task', itemId: TEST_UUID_1 })]);

    const res = await request(app)
      .post(`/api/schedule/${TEST_UUID_1}/lock`)
      .send({ locked: false });

    expect(res.status).toBe(200);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
